import { accessToken } from "@/lib/supabase/server";

const BASE = (process.env.FASTAPI_URL ?? "http://localhost:8000").replace(/\/$/, "");

export async function POST(request: Request) {
  const token = await accessToken();

  if (!token) {
    // Return a graceful SSE stream telling the user to sign in
    return new Response(
      `data: ${JSON.stringify({ token: "⚠️ Please sign in to use the MochaGuard Copilot." })}\n\ndata: [DONE]\n\n`,
      {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        },
      },
    );
  }

  const body = await request.json();

  let upstream: Response;
  try {
    upstream = await fetch(`${BASE}/copilot/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    return new Response(
      `data: ${JSON.stringify({ token: "⚠️ Could not reach the risk service. Is the API running?" })}\n\ndata: [DONE]\n\n`,
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    );
  }

  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => "");
    return new Response(
      `data: ${JSON.stringify({ token: `⚠️ Service error (${upstream.status}): ${errText.slice(0, 120)}` })}\n\ndata: [DONE]\n\n`,
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    );
  }

  // Forward the SSE stream directly
  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}
