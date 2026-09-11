"use client";

import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  type KeyboardEvent,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Cpu, X, Send, ImagePlus, ChevronDown, RotateCcw } from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

interface ContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

interface Message {
  role: "user" | "assistant";
  /** Sent to the API. String for text-only, array for multimodal. */
  content: string | ContentPart[];
  /** Images attached to a user message, kept for display. */
  displayImages?: string[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getDisplayText(msg: Message): string {
  if (typeof msg.content === "string") return msg.content;
  return msg.content
    .filter((p): p is ContentPart & { type: "text" } => p.type === "text")
    .map((p) => p.text ?? "")
    .join("");
}

function getDisplayImages(msg: Message): string[] {
  if (msg.displayImages) return msg.displayImages;
  if (typeof msg.content === "string") return [];
  return msg.content
    .filter((p): p is ContentPart & { type: "image_url" } => p.type === "image_url")
    .map((p) => p.image_url?.url ?? "");
}

function parseSSEToken(line: string): string | null {
  if (!line.startsWith("data: ")) return null;
  const payload = line.slice(6);
  if (payload === "[DONE]") return null;
  try {
    const obj = JSON.parse(payload) as { token?: string };
    return obj.token ?? null;
  } catch {
    return null;
  }
}

// ── Suggestion chips shown on the empty state ────────────────────────────────
const SUGGESTIONS = [
  "Why was my position frozen?",
  "What is a p99 adverse move?",
  "How does overnight funding work?",
  "Explain my leverage limit",
];

// ── Component ────────────────────────────────────────────────────────────────

interface CopilotChatProps {
  /** Pass the account ID to let the copilot fetch live position context. */
  accountId?: string;
}

export function CopilotChat({ accountId }: CopilotChatProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Scroll to newest message whenever messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Focus the textarea whenever the panel opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => textareaRef.current?.focus(), 80);
    }
  }, [isOpen]);

  // ── Image paste handler ───────────────────────────────────────────────────

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items).filter((item) =>
      item.type.startsWith("image/"),
    );
    if (items.length === 0) return;
    e.preventDefault();
    items.forEach((item) => {
      const blob = item.getAsFile();
      if (!blob) return;
      const reader = new FileReader();
      reader.onload = () => {
        setPendingImages((prev) => [...prev, reader.result as string]);
      };
      reader.readAsDataURL(blob);
    });
  }, []);

  // ── Send message ──────────────────────────────────────────────────────────

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text && pendingImages.length === 0) return;
    if (isStreaming) return;

    // Build the Groq-compatible content
    let userContent: string | ContentPart[];
    if (pendingImages.length > 0) {
      const parts: ContentPart[] = [];
      if (text) parts.push({ type: "text", text });
      pendingImages.forEach((url) =>
        parts.push({ type: "image_url", image_url: { url } }),
      );
      userContent = parts;
    } else {
      userContent = text;
    }

    const userMsg: Message = {
      role: "user",
      content: userContent,
      displayImages: pendingImages.length > 0 ? [...pendingImages] : undefined,
    };

    // Optimistically append user message + blank assistant placeholder
    const history = [...messages, userMsg];
    const assistantPlaceholder: Message = { role: "assistant", content: "" };
    setMessages([...history, assistantPlaceholder]);
    setInput("");
    setPendingImages([]);
    setIsStreaming(true);

    // Reset textarea height
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    try {
      abortRef.current = new AbortController();

      const response = await fetch("/api/copilot/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.map((m) => ({ role: m.role, content: m.content })),
          account_id: accountId ?? null,
        }),
        signal: abortRef.current.signal,
      });

      if (!response.body) {
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = {
            ...copy[copy.length - 1],
            content: "⚠️ No response received.",
          };
          return copy;
        });
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const token = parseSSEToken(line.trim());
          if (token !== null) {
            accumulated += token;
            const snapshot = accumulated;
            setMessages((prev) => {
              const copy = [...prev];
              copy[copy.length - 1] = { ...copy[copy.length - 1], content: snapshot };
              return copy;
            });
          }
        }
      }
    } catch (err: unknown) {
      if ((err as { name?: string })?.name !== "AbortError") {
        setMessages((prev) => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          if (last?.role === "assistant" && !last.content) {
            copy[copy.length - 1] = {
              ...last,
              content: "⚠️ Connection error. Please try again.",
            };
          }
          return copy;
        });
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [input, pendingImages, messages, isStreaming, accountId]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const stopStreaming = () => {
    abortRef.current?.abort();
  };

  const clearChat = () => {
    stopStreaming();
    setMessages([]);
    setPendingImages([]);
    setInput("");
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Floating toggle button */}
      <AnimatePresence>
        {!isOpen && (
          <motion.button
            key="copilot-toggle"
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.7, opacity: 0 }}
            whileHover={{ scale: 1.06 }}
            whileTap={{ scale: 0.94 }}
            transition={{ type: "spring", stiffness: 400, damping: 25 }}
            onClick={() => setIsOpen(true)}
            className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-4 py-3 rounded-2xl bg-[#7C3AED] text-white shadow-[0_4px_30px_rgba(124,58,237,0.55)] hover:bg-[#6D28D9] transition-colors select-none"
            aria-label="Open MochaGuard Copilot"
          >
            <Cpu className="w-4 h-4 shrink-0" />
            <span className="text-sm font-semibold tracking-tight">Copilot</span>
            {messages.length > 0 && (
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white/20 text-[10px] font-bold">
                {messages.filter((m) => m.role === "assistant").length}
              </span>
            )}
          </motion.button>
        )}
      </AnimatePresence>

      {/* Chat panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            key="copilot-panel"
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.96 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="fixed bottom-6 right-6 z-50 flex flex-col rounded-2xl border border-[#7C3AED]/35 bg-[#05050A]/96 backdrop-blur-2xl shadow-[0_8px_60px_rgba(124,58,237,0.22)] overflow-hidden"
            style={{
              width: "min(420px, calc(100vw - 2.5rem))",
              height: "min(620px, calc(100dvh - 5.5rem))",
            }}
          >
            {/* ── Header ── */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#231F42] bg-[#0B0A14] shrink-0">
              <div className="flex items-center gap-2.5">
                {/* Icon */}
                <div className="relative w-7 h-7 rounded-lg bg-[#7C3AED]/15 border border-[#7C3AED]/40 flex items-center justify-center shadow-[0_0_10px_rgba(124,58,237,0.3)]">
                  <Cpu className="w-3.5 h-3.5 text-[#A78BFA]" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-white leading-none">
                    MochaGuard Copilot
                  </div>
                  <div className="text-[10px] font-mono mt-0.5">
                    {isStreaming ? (
                      <span className="text-[#A78BFA] animate-pulse">Thinking…</span>
                    ) : (
                      <span className="text-[#4A5568]">Groq · Fact-bounded</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-0.5">
                {messages.length > 0 && (
                  <button
                    onClick={clearChat}
                    title="Clear conversation"
                    className="p-1.5 rounded-lg text-[#4A5568] hover:text-[#94A3B8] hover:bg-[#121024] transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  onClick={() => setIsOpen(false)}
                  title="Minimise"
                  className="p-1.5 rounded-lg text-[#4A5568] hover:text-white hover:bg-[#121024] transition-colors"
                >
                  <ChevronDown className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* ── Messages ── */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 scroll-smooth">
              {/* Empty state */}
              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-center gap-5 pb-4">
                  <div className="w-14 h-14 rounded-2xl bg-[#7C3AED]/12 border border-[#7C3AED]/30 flex items-center justify-center shadow-[0_0_20px_rgba(124,58,237,0.2)]">
                    <Cpu className="w-7 h-7 text-[#A78BFA]" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-white mb-1.5">
                      Ask me anything
                    </div>
                    <div className="text-xs text-[#4A5568] leading-relaxed max-w-[220px]">
                      I can explain risk decisions, leverage limits, funding costs,
                      or analyse a chart you paste in.
                    </div>
                  </div>
                  {/* Suggestion chips */}
                  <div className="flex flex-wrap gap-2 justify-center max-w-[300px]">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        onClick={() => {
                          setInput(s);
                          textareaRef.current?.focus();
                        }}
                        className="px-3 py-1.5 rounded-xl text-[11px] font-medium bg-[#0B0A14] border border-[#231F42] text-[#64748B] hover:border-[#7C3AED]/50 hover:text-[#A78BFA] transition-colors"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Message bubbles */}
              {messages.map((msg, i) => {
                const text = getDisplayText(msg);
                const images = getDisplayImages(msg);
                const isLast = i === messages.length - 1;
                const isAssistantStreaming =
                  msg.role === "assistant" && isStreaming && isLast;

                return (
                  <div
                    key={i}
                    className={`flex flex-col gap-1.5 ${
                      msg.role === "user" ? "items-end" : "items-start"
                    }`}
                  >
                    {/* Attached images */}
                    {images.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {images.map((src, j) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            key={j}
                            src={src}
                            alt="Shared image"
                            className="max-w-[200px] max-h-[140px] rounded-xl object-cover border border-[#231F42]"
                          />
                        ))}
                      </div>
                    )}

                    {/* Text bubble */}
                    {(text || isAssistantStreaming) && (
                      <div
                        className={`max-w-[88%] px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words ${
                          msg.role === "user"
                            ? "rounded-2xl rounded-tr-sm bg-[#7C3AED]/20 border border-[#7C3AED]/35 text-white"
                            : "rounded-2xl rounded-tl-sm bg-[#0B0A14] border border-[#1C1836] text-[#E2E8F0]"
                        }`}
                      >
                        {/* Loading dots when streaming but no text yet */}
                        {isAssistantStreaming && !text ? (
                          <span className="flex gap-1 items-center h-4">
                            {[0, 150, 300].map((delay) => (
                              <span
                                key={delay}
                                className="w-1.5 h-1.5 rounded-full bg-[#4A5568] animate-bounce"
                                style={{ animationDelay: `${delay}ms` }}
                              />
                            ))}
                          </span>
                        ) : (
                          <>
                            {text}
                            {/* Blinking cursor while streaming */}
                            {isAssistantStreaming && (
                              <span className="inline-block w-[2px] h-[14px] bg-[#A78BFA] ml-0.5 animate-pulse align-middle rounded-full" />
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              <div ref={messagesEndRef} />
            </div>

            {/* ── Pending image previews ── */}
            {pendingImages.length > 0 && (
              <div className="flex gap-2 px-4 py-2 border-t border-[#1C1836] overflow-x-auto shrink-0">
                {pendingImages.map((src, i) => (
                  <div key={i} className="relative shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={src}
                      alt="Pending"
                      className="w-14 h-14 rounded-xl object-cover border border-[#231F42]"
                    />
                    <button
                      onClick={() =>
                        setPendingImages((prev) => prev.filter((_, j) => j !== i))
                      }
                      className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-[#EF4444] flex items-center justify-center"
                      aria-label="Remove image"
                    >
                      <X className="w-2.5 h-2.5 text-white" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* ── Input area ── */}
            <div className="border-t border-[#231F42] bg-[#0B0A14] px-3 py-3 shrink-0">
              <div className="flex items-end gap-2">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  onInput={(e) => {
                    const el = e.currentTarget;
                    el.style.height = "auto";
                    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
                  }}
                  placeholder="Ask anything… or paste an image"
                  rows={1}
                  disabled={isStreaming}
                  className="flex-1 resize-none rounded-xl bg-[#121024] border border-[#231F42] px-3 py-2 text-sm text-white placeholder:text-[#3D4A5C] focus:border-[#7C3AED]/60 focus:outline-none transition-colors disabled:opacity-60 max-h-32 overflow-y-auto leading-relaxed"
                />

                {isStreaming ? (
                  <button
                    onClick={stopStreaming}
                    title="Stop"
                    className="shrink-0 w-9 h-9 rounded-xl bg-[#1C1836] border border-[#231F42] hover:border-[#7C3AED]/40 transition-colors flex items-center justify-center"
                  >
                    <span className="w-3 h-3 rounded-sm bg-[#94A3B8]" />
                  </button>
                ) : (
                  <button
                    onClick={sendMessage}
                    disabled={!input.trim() && pendingImages.length === 0}
                    title="Send (Enter)"
                    className="shrink-0 w-9 h-9 rounded-xl bg-[#7C3AED] disabled:opacity-35 hover:bg-[#6D28D9] transition-colors flex items-center justify-center shadow-[0_0_12px_rgba(124,58,237,0.4)]"
                  >
                    <Send className="w-4 h-4 text-white" />
                  </button>
                )}
              </div>

              {/* Footer hint */}
              <div className="flex items-center gap-1.5 mt-1.5 pl-0.5">
                <ImagePlus className="w-2.5 h-2.5 text-[#3D4A5C]" />
                <span className="text-[10px] text-[#3D4A5C]">
                  Paste images · Shift+Enter for newline · Enter to send
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
