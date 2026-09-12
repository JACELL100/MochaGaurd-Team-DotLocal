"""Telegram Alert Sentinel for MochaGuard.

Dispatches actionable overnight risk alerts before the 15:30 closing ramp.
"""
from __future__ import annotations

import logging
from typing import Any
import httpx

from ..config import settings

log = logging.getLogger('mochaguard.telegram')


async def send_telegram_message(
    chat_id: str | None = None,
    text: str = '',
    bot_token: str | None = None,
    buttons: list[list[dict[str, str]]] | None = None,
) -> dict[str, Any]:
    """Send an HTML-formatted message with optional inline keyboard buttons."""
    token = bot_token or settings.telegram_bot_token
    target_chat = chat_id or settings.telegram_chat_id

    # Simulated sandbox mode when no token is configured
    if not token or not target_chat:
        log.info('Telegram token or chat_id not set; running in simulated sandbox mode')
        return {
            'ok': True,
            'simulated': True,
            'chat_id': target_chat or 'sandbox_demo_chat',
            'preview_text': text,
            'message': 'Simulated dispatch successful. Configure TELEGRAM_BOT_TOKEN to deliver to physical devices.',
        }

    url = f'https://api.telegram.org/bot{token}/sendMessage'
    payload: dict[str, Any] = {
        'chat_id': target_chat,
        'text': text,
        'parse_mode': 'HTML',
        'disable_web_page_preview': False,
    }

    # Only include inline keyboard buttons if they have valid public URLs (Telegram rejects localhost)
    valid_buttons = []
    if buttons:
        for row in buttons:
            valid_row = [
                b for b in row
                if b.get('url', '').startswith('https://') and 'localhost' not in b.get('url', '') and '127.0.0.1' not in b.get('url', '')
            ]
            if valid_row:
                valid_buttons.append(valid_row)

    if valid_buttons:
        payload['reply_markup'] = {'inline_keyboard': valid_buttons}

    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            res = await client.post(url, json=payload)
            res.raise_for_status()
            data = res.json()
            return {'ok': True, 'simulated': False, 'telegram_response': data}
        except httpx.HTTPStatusError as exc:
            # If rejected due to inline buttons/markup, retry once without reply_markup
            if 'reply_markup' in payload:
                try:
                    payload.pop('reply_markup')
                    retry_res = await client.post(url, json=payload)
                    retry_res.raise_for_status()
                    return {'ok': True, 'simulated': False, 'telegram_response': retry_res.json()}
                except Exception:
                    pass

            log.warning('Telegram API error: %s', exc.response.text)
            return {
                'ok': False,
                'simulated': False,
                'error': f'Telegram API error: {exc.response.status_code} {exc.response.text}',
            }
        except Exception as exc:
            log.exception('Failed to dispatch telegram alert')
            return {'ok': False, 'simulated': False, 'error': str(exc)}


def format_sleep_safe_alert(
    account_name: str,
    action: str,
    symbol: str | None = None,
    deadline_et: str = '15:45 ET',
    deadline_local: str = '01:15 AM',
    required_cash: float = 1200.0,
    shares_to_trim: int = 15,
    web_url: str = 'http://localhost:3000',
) -> tuple[str, list[list[dict[str, str]]]]:
    """Format rich Telegram HTML text with inline buttons."""
    sym_text = f"<b>{symbol}</b>" if symbol else "your levered portfolio"
    
    msg = (
        f"🚨 <b>MOCHAGUARD 2 AM RISK SENTINEL</b>\n"
        f"━━━━━━━━━━━━━━━━━━━━━━\n"
        f"👤 <b>Account:</b> {account_name}\n"
        f"⚠️ <b>Action Needed:</b> {action.upper()}\n\n"
        f"Market close is approaching. {sym_text} has high overnight risk or AMC earnings. "
        f"To avoid automatic liquidation during the 15:45 closing ramp, please act before:\n\n"
        f"⏰ <b>Deadline:</b> <code>{deadline_et}</code> (<b>{deadline_local}</b> your local time)\n\n"
        f"💡 <b>Required Action:</b>\n"
        f"• Deposit <b>${required_cash:,.2f}</b> margin cash, OR\n"
        f"• Trim <b>{shares_to_trim} shares</b> before 15:45 ET.\n\n"
        f"<i>MochaGuard does not wait for 2 AM email replies. Unattended accounts will de-risk automatically with participation-capped orders.</i>"
    )

    buttons = [
        [
            {'text': '📊 View Tonight Briefing', 'url': f'{web_url}/tonight'},
            {'text': '⚡ Simulate Gap Shock', 'url': f'{web_url}/stress-test'},
        ]
    ]

    return msg, buttons


async def get_bot_subscribers(bot_token: str | None = None) -> list[dict[str, Any]]:
    """Discover all Telegram users/chats that have started or messaged the bot."""
    token = bot_token or settings.telegram_bot_token
    if not token:
        return []

    url = f'https://api.telegram.org/bot{token}/getUpdates'
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.get(url)
            if res.status_code != 200:
                log.warning('getUpdates failed: %s', res.text)
                return []
            data = res.json()
            subscribers: dict[str, dict[str, Any]] = {}
            for u in data.get('result', []):
                msg = u.get('message') or u.get('channel_post') or u.get('my_chat_member', {}).get('chat') or {}
                chat = msg.get('chat') if isinstance(msg, dict) and 'chat' in msg else msg
                if not chat or 'id' not in chat:
                    continue
                cid = str(chat['id'])
                subscribers[cid] = {
                    'chat_id': cid,
                    'first_name': chat.get('first_name') or chat.get('title') or 'User',
                    'username': chat.get('username') or '',
                    'type': chat.get('type') or 'private',
                }
            return list(subscribers.values())
    except Exception as exc:
        log.warning('Error fetching bot subscribers: %s', exc)
        return []


async def broadcast_sleep_safe_alert(
    text: str,
    buttons: list[list[dict[str, str]]] | None = None,
    bot_token: str | None = None,
    chat_ids: list[str] | None = None,
) -> dict[str, Any]:
    """Broadcast an alert to all registered subscribers or specific chat IDs."""
    token = bot_token or settings.telegram_bot_token
    targets = chat_ids or []
    
    if not targets:
        # Auto-discover subscribers from bot updates
        discovered = await get_bot_subscribers(token)
        targets = [s['chat_id'] for s in discovered]
        if settings.telegram_chat_id and settings.telegram_chat_id not in targets:
            targets.append(settings.telegram_chat_id)

    if not targets:
        return {
            'ok': False,
            'message': 'No subscribers found. Open @MochaGuard_bot in Telegram and tap Start to subscribe.',
            'total': 0,
            'sent': 0,
        }

    results = []
    sent_count = 0
    for cid in targets:
        res = await send_telegram_message(
            chat_id=cid,
            text=text,
            bot_token=token,
            buttons=buttons,
        )
        if res.get('ok'):
            sent_count += 1
        results.append({'chat_id': cid, 'result': res})

    return {
        'ok': sent_count > 0,
        'total': len(targets),
        'sent': sent_count,
        'failed': len(targets) - sent_count,
        'details': results,
    }

