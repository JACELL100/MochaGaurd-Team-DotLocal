import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";

function safeNext(value: string | null) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/tonight";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const destination = new URL(safeNext(url.searchParams.get("next")), url.origin);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!code || !supabaseUrl || !supabaseKey) {
    destination.pathname = "/login";
    destination.searchParams.set("error", "Supabase sign-in is not configured or the callback was invalid.");
    return NextResponse.redirect(destination);
  }
  const response = NextResponse.redirect(destination);
  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        const cookie = request.headers.get("cookie") ?? "";
        return cookie.split(/;\s*/).filter(Boolean).map((item) => {
          const index = item.indexOf("=");
          return { name: item.slice(0, index), value: item.slice(index + 1) };
        });
      },
      setAll(cookies) {
        for (const cookie of cookies) response.cookies.set(cookie.name, cookie.value, cookie.options);
      },
    },
  });
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    destination.pathname = "/login";
    destination.searchParams.set("error", "Google sign-in could not be completed. Try again.");
    return NextResponse.redirect(destination);
  }
  return response;
}
