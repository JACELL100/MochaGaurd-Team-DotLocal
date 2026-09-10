'''Create or reset a confirmed email/password user for local development.

Why this exists
---------------
Google sign-in returns the browser to whatever URL Supabase's redirect allow-list permits. If
`http://localhost:3000/**` is not on that list, Supabase falls back to the project's Site URL,
so signing in from localhost lands on the deployed site instead. Adding localhost to the
allow-list is the proper fix; this is the way to work locally without changing project settings
at all, because password auth involves no redirect.

The user is created with `email_confirm: true` via the service-role key, so there is no
confirmation email to click. Run it against your own account so the risk API resolves the same
account row your Google login would.

    python scripts/dev_user.py you@example.com 'SomePassword!123'

The service-role key never leaves the server. Do not use this to hand out production access.
'''
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings  # noqa: E402


async def main(email: str, password: str) -> None:
    base = settings.supabase_url.rstrip('/')
    service_key = settings.supabase_service_role_key
    if not base or not service_key:
        raise SystemExit('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in api/.env')
    if len(password) < 8:
        raise SystemExit('Choose a password of at least 8 characters.')

    admin = {'apikey': service_key, 'Authorization': f'Bearer {service_key}'}
    async with httpx.AsyncClient(timeout=30) as client:
        created = await client.post(f'{base}/auth/v1/admin/users', headers=admin,
                                    json={'email': email, 'password': password,
                                          'email_confirm': True})
        if created.status_code in (200, 201):
            print(f'Created confirmed user {email}.')
        else:
            # Already exists: find the id and reset the password instead.
            listing = await client.get(f'{base}/auth/v1/admin/users', headers=admin,
                                       params={'page': 1, 'per_page': 200})
            listing.raise_for_status()
            users = listing.json().get('users', [])
            match = next((u for u in users if (u.get('email') or '').lower() == email.lower()), None)
            if match is None:
                raise SystemExit(f'Could not create or find {email}: {created.text[:300]}')
            updated = await client.put(f'{base}/auth/v1/admin/users/{match["id"]}', headers=admin,
                                       json={'password': password, 'email_confirm': True})
            updated.raise_for_status()
            print(f'Reset the password for existing user {email}.')

        # Prove it works rather than assuming it does.
        check = await client.post(f'{base}/auth/v1/token', params={'grant_type': 'password'},
                                  headers={'apikey': settings.supabase_anon_key},
                                  json={'email': email, 'password': password})
        if check.status_code != 200:
            raise SystemExit(f'Sign-in check failed: {check.status_code} {check.text[:300]}')
        print('Verified: this email and password returns a valid session.')
        print('Sign in at http://localhost:3000/login using the "Local development sign-in" form.')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('usage: python scripts/dev_user.py <email> <password>')
    asyncio.run(main(sys.argv[1], sys.argv[2]))
