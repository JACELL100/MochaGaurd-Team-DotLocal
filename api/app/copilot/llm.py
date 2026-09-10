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
        self._client: httpx.AsyncClient | None = None

    @property
    def configured(self) -> bool:
        return bool(self.key)

    def _http(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=httpx.Timeout(settings.llm_timeout_s + 1.0))
        return self._client

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    async def complete_json(self, prompt: str, *, max_tokens: int = 220, timeout: float | None = None) -> dict:
        if not self.key:
            raise LLMUnavailable('GROQ_API_KEY not set')
        body = {
            'model': self.model,
            'messages': [{'role': 'system', 'content': SYSTEM}, {'role': 'user', 'content': prompt}],
            'temperature': 0.2,
            'max_completion_tokens': max_tokens,
            'response_format': {'type': 'json_object'},
        }
        try:
            response = await self._http().post(
                URL, json=body, headers={'Authorization': f'Bearer {self.key}'},
                timeout=timeout or settings.llm_timeout_s,
            )
            response.raise_for_status()
            content = response.json()['choices'][0]['message']['content']
            parsed = json.loads(content)
            if not isinstance(parsed, dict):
                raise TypeError('Groq response is not a JSON object')
            return parsed
        except (httpx.HTTPError, KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
            raise LLMUnavailable(f'{type(exc).__name__}: {exc}') from exc


llm = GroqClient()
