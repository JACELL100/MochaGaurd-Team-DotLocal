import { NextResponse } from "next/server";

const FASTAPI_URL = (process.env.FASTAPI_URL ?? "http://localhost:8000").replace(/\/$/, "");

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("bot_token") || process.env.TELEGRAM_BOT_TOKEN;

  try {
    const apiRes = await fetch(`${FASTAPI_URL}/alerts/telegram/subscribers${token ? `?bot_token=${encodeURIComponent(token)}` : ""}`, {
      signal: AbortSignal.timeout(6000),
    });
    if (apiRes.ok) {
      return NextResponse.json(await apiRes.json());
    }
  } catch {
    // If backend is uncontacted, query Telegram directly
    if (token) {
      try {
        const tgRes = await fetch(`https://api.telegram.org/bot${token}/getUpdates`, { signal: AbortSignal.timeout(6000) });
        const tgData = await tgRes.json();
        const subs: Record<string, { chat_id: string; first_name: string; username: string }> = {};
        for (const u of tgData.result || []) {
          const msg = u.message || u.channel_post || u.my_chat_member?.chat;
          const chat = msg?.chat || msg;
          if (chat?.id) {
            subs[String(chat.id)] = {
              chat_id: String(chat.id),
              first_name: chat.first_name || chat.title || "Telegram User",
              username: chat.username || "",
            };
          }
        }
        return NextResponse.json({ subscribers: Object.values(subs), count: Object.keys(subs).length });
      } catch {}
    }
  }

  return NextResponse.json({ subscribers: [], count: 0 });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const action = body.action ?? "test";
    
    let endpoint = "/alerts/telegram/test";
    if (action === "dispatch") endpoint = "/alerts/telegram/dispatch";
    else if (action === "broadcast") endpoint = "/alerts/telegram/broadcast";
    else if (action === "subscribers") endpoint = "/alerts/telegram/subscribers";

    try {
      const apiRes = await fetch(`${FASTAPI_URL}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      });

      if (apiRes.ok) {
        const data = await apiRes.json();
        return NextResponse.json(data);
      }
      
      const errorText = await apiRes.text();
      return NextResponse.json(
        { error: errorText || "FastAPI returned an error" },
        { status: apiRes.status }
      );
    } catch {
      // Standalone fallback
      return NextResponse.json({
        result: {
          ok: true,
          mode: "sandbox",
          message: "[STANDALONE SIMULATION] Alert generated: 'MochaGuard 2 AM Sentinel Alert: NVDA reports tonight. Margin buffer critical.'",
          sent_at: new Date().toISOString(),
        },
        broadcast: {
          ok: true,
          total: 1,
          sent: 1,
          message: "Simulated broadcast to all active subscribers.",
        },
        preview_message: `🚨 <b>MochaGuard Sentinel Alert</b>\n\nAccount: <code>${body.account_name ?? "All Accounts"}</code>\nRisk: Margin buffer under critical threshold.\nAction: Trim 15 shares or deposit $1,250 before 15:45 ET.`,
      });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Invalid request";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
