"""Interactive copilot chat: multi-turn conversation with optional account context.

Separate from the engine's narration pipeline (copilot.service / copilot.explain).
Those modules run *after* decisions to narrate them; this module handles on-demand
trader questions in a chat interface.
"""
from __future__ import annotations

import json
import logging
from typing import AsyncIterator

import httpx

from ..config import settings

log = logging.getLogger('mochaguard.copilot.chat')

_GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'

CHAT_SYSTEM = """\
You are MochaGuard Copilot, the AI assistant for Mochatrade — a risk-aware perpetual-futures broker.

You help retail traders understand:
• Portfolio risk: leverage limits, margin requirements, worst-case gap losses
• Engine decisions: what triggered a freeze, reduce, margin call, or close action
• Market concepts: overnight gap risk, earnings volatility, funding rates, p99 adverse moves
• MochaGuard's protection model: the SAFETY buffer, closure multipliers, earnings guards

Guidelines:
- Be concise, calm, and specific. Reference numbers from the ACCOUNT CONTEXT section when provided.
- Never invent financial figures not present in the context. Say "I don't have that data right now" if needed.
- Never give investment advice beyond explaining what the risk engine has already decided.
- When an image is shared, describe what you observe and connect it to risk concepts where relevant.
- Write in plain prose. Reserve bullet points for genuinely list-like content.
"""


async def stream_chat(
    messages: list[dict],
    *,
    context: str | None = None,
    timeout: float = 45.0,
) -> AsyncIterator[str]:
    """Yield text tokens as they arrive from Groq."""
    if not settings.groq_api_key:
        yield '⚠️ Copilot is unavailable: GROQ_API_KEY is not configured on this server.'
        return

    system_content = CHAT_SYSTEM
    if context:
        system_content += f'\n\n--- ACCOUNT CONTEXT ---\n{context}\n--- END CONTEXT ---'

    # qwen/qwen3.8-27b (the default GROQ_MODEL) natively supports both text and images,
    # so no model switching is needed for multimodal messages.
    groq_messages = [{'role': 'system', 'content': system_content}] + list(messages)

    body = {
        'model': settings.groq_model,
        'messages': groq_messages,
        'temperature': 0.5,
        'max_tokens': 1024,
        'stream': True,
    }

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(timeout)) as client:
            async with client.stream(
                'POST',
                _GROQ_URL,
                json=body,
                headers={'Authorization': f'Bearer {settings.groq_api_key}'},
            ) as response:
                if not response.is_success:
                    body_bytes = await response.aread()
                    log.error('Groq chat error %s: %s', response.status_code, body_bytes[:200])
                    yield f'⚠️ Could not reach the AI service (HTTP {response.status_code}).'
                    return

                async for line in response.aiter_lines():
                    if not line.startswith('data: '):
                        continue
                    payload = line[6:]
                    if payload == '[DONE]':
                        break
                    try:
                        chunk = json.loads(payload)
                        delta = chunk['choices'][0]['delta'].get('content') or ''
                        if delta:
                            yield delta
                    except (json.JSONDecodeError, KeyError, IndexError):
                        continue

    except httpx.TimeoutException:
        yield '\n\n⚠️ The response timed out. Please try again.'
    except Exception as exc:
        log.exception('Unexpected error in copilot chat stream: %s', exc)
        yield f'\n\n⚠️ An unexpected error occurred ({type(exc).__name__}).'
