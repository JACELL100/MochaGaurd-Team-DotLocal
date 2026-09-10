"""Supabase access-token verification and role helpers.

The browser never receives database credentials.  FastAPI validates the Supabase session by
asking Supabase Auth for the bearer token's user; this works for Google OAuth and remains valid
when Supabase rotates its signing keys.
"""
from __future__ import annotations

from dataclasses import dataclass

import httpx
from fastapi import HTTPException, Request, status

from .config import settings


@dataclass(frozen=True)
class Principal:
    user_id: str
    email: str
    display_name: str | None


class SupabaseAuth:
    def __init__(self) -> None:
        self.client = httpx.AsyncClient(timeout=8.0)

    async def aclose(self) -> None:
        await self.client.aclose()

    async def authenticate(self, token: str) -> Principal:
        if not settings.supabase_url or not settings.supabase_anon_key:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                                detail='Supabase Auth is not configured')
        response = await self.client.get(
            f'{settings.supabase_url.rstrip("/")}/auth/v1/user',
            headers={'Authorization': f'Bearer {token}', 'apikey': settings.supabase_anon_key},
        )
        if response.status_code != 200:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Invalid or expired session')
        raw = response.json()
        email = (raw.get('email') or '').lower()
        meta = raw.get('user_metadata') or {}
        return Principal(
            user_id=str(raw['id']), email=email,
            display_name=meta.get('full_name') or meta.get('name'),
        )


async def get_principal(request: Request) -> Principal:
    header = request.headers.get('authorization', '')
    if not header.lower().startswith('bearer '):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Sign in is required')
    service = request.app.state.service
    return await service.auth.authenticate(header[7:].strip())
