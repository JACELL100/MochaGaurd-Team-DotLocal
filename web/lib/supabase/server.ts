import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function accessToken(): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  const store = await cookies();
  const client = createServerClient(url, key, {
    cookies: {
      getAll() {
        return store.getAll();
      },
      setAll() {
        // Server Components cannot mutate cookies. The OAuth callback and browser client refresh them.
      },
    },
  });
  const { data } = await client.auth.getSession();
  return data.session?.access_token ?? null;
}


/** Identity of the signed-in viewer, for rendering the header on the server. */
export interface Viewer {
  email: string;
  name: string | null;
  avatar: string | null;
}

/**
 * The current viewer, resolved on the server so the header is correct in the first paint.
 *
 * The client keeps this in sync afterwards via `onAuthStateChange`; without the server pass the
 * header would flash an empty slot (or "Sign In") until JavaScript hydrated.
 */
export async function currentViewer(): Promise<Viewer | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  const store = await cookies();
  const client = createServerClient(url, key, {
    cookies: {
      getAll() {
        return store.getAll();
      },
      setAll() {
        // Server Components cannot mutate cookies; the callback and browser client refresh them.
      },
    },
  });
  const { data } = await client.auth.getUser();
  const user = data.user;
  if (!user?.email) return null;
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  return {
    email: user.email,
    name: (meta.full_name as string) ?? (meta.name as string) ?? null,
    avatar: (meta.avatar_url as string) ?? (meta.picture as string) ?? null,
  };
}
