'''Groq (OpenAI-compatible) chat completion with a hard timeout. Narration only, never decisions.'''
from __future__ import annotations

import json
import logging

import httpx

from ..config import settings

log = logging.getLogger('mochaguard.llm')
URL = 'https://api.groq.com/openai/v1/chat/completions'

SYSTEM = (
    'You are the MochaGuard risk copilot for Mochatrade, a global stock broker. You explain risk-engine '
    'decisions to retail traders in plain, calm, specific language. You NEVER invent numbers: every figure you '
    'write must appear verbatim in the FACTS you are given. You never give investment advice beyond the '
    'engine\'s stated action. Respond with strict json only.'
)


class LLMUnavailable(RuntimeError):
    pass


class GroqClient:
    def __init__(self, api_key: str | None = None, model: str | None = None):
        self.key = api_key or settings.groq_api_key
        self.model = model or settings.groq_model
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(settings.llm_timeout_s + 1.0))

    @property
    def configured(self) -> bool:
        return bool(self.key)

    async def aclose(self) -> None:
        await self._client.aclose()

    async def complete_json(self, prompt: str, *, max_tokens: int = 220, timeout: float | None = None) -> dict:
        if not self.key:
            raise LLMUnavailable('GROQ_API_KEY not set')
        body = {
            'model': self.model,
            'messages': [{'role': 'system', 'content': SYSTEM}, {'role': 'user', 'content': prompt}],
            'temperature': 0.2,
            'max_tokens': max_tokens,
            'response_format': {'type': 'json_object'},
        }
        try:
            r = await self._client.post(URL, json=body, headers={'Authorization': f'Bearer {self.key}'},
                                        timeout=timeout or settings.llm_timeout_s)
            r.raise_for_status()
            content = r.json()['choices'][0]['message']['content']
            return json.loads(content)
        except (httpx.HTTPError, KeyError, ValueError, json.JSONDecodeError) as e:
            raise LLMUnavailable(f'{type(e).__name__}: {e}') from e


llm = GroqClient()
