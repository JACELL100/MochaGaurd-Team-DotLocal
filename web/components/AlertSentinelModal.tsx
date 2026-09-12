"use client";

import React, { useState, useEffect } from "react";
import {
  Bell,
  Volume2,
  VolumeX,
  Send,
  ShieldAlert,
  Smartphone,
  CheckCircle2,
  AlertTriangle,
  Radio,
  Sparkles,
  X,
  ExternalLink,
  Info,
  Play,
  Square,
  Lock,
  Eye,
  EyeOff,
  Zap,
} from "lucide-react";
import { alertSound } from "@/lib/audioAlert";

interface AlertSentinelModalProps {
  isOpen: boolean;
  onClose: () => void;
  accountId?: string;
  accountName?: string;
  symbol?: string;
}

export function AlertSentinelModal({
  isOpen,
  onClose,
  accountId = "demo-trader-01",
  accountName = "Sample Trader (demo-trader-01)",
  symbol = "NVDA",
}: AlertSentinelModalProps) {
  const [volume, setVolume] = useState<number>(0.85);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [desktopPermission, setDesktopPermission] = useState<NotificationPermission>("default");
  const [desktopNotificationStatus, setDesktopNotificationStatus] = useState<string | null>(null);

  const DEFAULT_BOT_TOKEN = "8951497487:AAHmt0_PAuQbCVbKuSkDTudv5NG5ocjzwVI";
  const DEFAULT_BOT_USERNAME = "MochaGuard_bot";

  const [botToken, setBotToken] = useState(DEFAULT_BOT_TOKEN);
  const [chatId, setChatId] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [isDispatchingTelegram, setIsDispatchingTelegram] = useState(false);
  const [isDetectingChat, setIsDetectingChat] = useState(false);
  const [detectStatus, setDetectStatus] = useState<string | null>(null);
  const [subscriberCount, setSubscriberCount] = useState<number>(0);
  const [telegramResult, setTelegramResult] = useState<{
    success?: boolean;
    mode?: string;
    message?: string;
    preview?: string;
  } | null>(null);

  // Full emergency drill state
  const [isDrillActive, setIsDrillActive] = useState(false);

  // Load saved credentials & check browser notification support
  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedToken = localStorage.getItem("mochaguard_tg_bot_token") || DEFAULT_BOT_TOKEN;
      const savedChatId = localStorage.getItem("mochaguard_tg_chat_id") || "";
      const savedVol = localStorage.getItem("mochaguard_alert_vol");
      setBotToken(savedToken);
      if (savedChatId) setChatId(savedChatId);
      if (savedVol) setVolume(parseFloat(savedVol));

      if ("Notification" in window) {
        setDesktopPermission(Notification.permission);
      }

      // Check for subscribers
      fetch(`/api/alerts/telegram?bot_token=${encodeURIComponent(savedToken)}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.count) setSubscriberCount(data.count);
        })
        .catch(() => {});
    }
  }, []);

  // Save changes to localStorage
  const handleSaveTelegramConfig = (tokenVal: string, chatVal: string) => {
    setBotToken(tokenVal);
    setChatId(chatVal);
    if (typeof window !== "undefined") {
      localStorage.setItem("mochaguard_tg_bot_token", tokenVal);
      localStorage.setItem("mochaguard_tg_chat_id", chatVal);
    }
  };

  const handleVolumeChange = (newVol: number) => {
    setVolume(newVol);
    if (typeof window !== "undefined") {
      localStorage.setItem("mochaguard_alert_vol", newVol.toString());
    }
  };

  // 1. Audio Siren Test
  const handleTestSiren = async () => {
    if (isPlayingAudio) return;
    setIsPlayingAudio(true);
    await alertSound.playEmergencySiren(volume);
    setTimeout(() => {
      setIsPlayingAudio(false);
    }, 2400);
  };

  const handleTestChime = async () => {
    await alertSound.playConfirmationChime(volume);
  };

  // 2. Request Desktop Notification Permission
  const handleRequestDesktopPermission = async () => {
    if (!("Notification" in window)) {
      setDesktopNotificationStatus("Browser does not support desktop notifications.");
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      setDesktopPermission(permission);
      if (permission === "granted") {
        setDesktopNotificationStatus("Desktop alerts activated! You will receive system notifications.");
        new Notification("MochaGuard Sentinel Activated", {
          body: "2 AM Sleep-Safe notifications are armed. You will be alerted before 15:45 ET auto-derisk.",
          icon: "/favicon.ico",
        });
        await alertSound.playConfirmationChime(volume);
      } else {
        setDesktopNotificationStatus("Permission was not granted by browser settings.");
      }
    } catch {
      setDesktopNotificationStatus("Failed to request permission.");
    }
  };

  const handleFireDesktopNotification = () => {
    if (desktopPermission !== "granted") {
      handleRequestDesktopPermission();
      return;
    }
    new Notification("MochaGuard 2 AM Sentinel Alert", {
      body: `CRITICAL: ${symbol} overnight gap buffer below threshold! Trim 15 shares or deposit $1,250 before 15:45 ET.`,
      icon: "/favicon.ico",
      tag: "mochaguard-emergency",
      requireInteraction: true,
    });
    alertSound.playEmergencySiren(volume);
  };

  // 3. Telegram Test Dispatch
  const handleSendTelegramTest = async () => {
    setIsDispatchingTelegram(true);
    setTelegramResult(null);
    try {
      const res = await fetch("/api/alerts/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "test",
          bot_token: botToken.trim() || undefined,
          chat_id: chatId.trim() || undefined,
          account_name: accountName,
          symbol: symbol,
        }),
      });

      const data = await res.json();
      const resultPayload = data.result || {};
      const isOk = res.ok && resultPayload.ok !== false && !resultPayload.error;
      if (isOk) {
        setTelegramResult({
          success: true,
          mode: resultPayload.simulated ? "sandbox" : "live",
          message: resultPayload.simulated
            ? "Sandbox mode simulated alert successfully. (Enter real Bot Token & Chat ID for direct Telegram push)"
            : `Delivered live to Telegram chat ${chatId}! Check your phone/chat.`,
          preview: data.preview_message,
        });
        await alertSound.playConfirmationChime(volume);
      } else {
        setTelegramResult({
          success: false,
          message: resultPayload.error || data.error || "Failed to dispatch Telegram message",
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Network error";
      setTelegramResult({ success: false, message: msg });
    } finally {
      setIsDispatchingTelegram(false);
    }
  };

  // Auto-detect subscribers from bot
  const handleDetectChatId = async () => {
    setIsDetectingChat(true);
    setDetectStatus("Checking for messages to @MochaGuard_bot...");
    try {
      const res = await fetch(`/api/alerts/telegram?bot_token=${encodeURIComponent(botToken.trim())}`);
      const data = await res.json();
      const subs = data.subscribers || [];
      setSubscriberCount(subs.length);
      if (subs.length > 0) {
        const latest = subs[subs.length - 1];
        setChatId(latest.chat_id);
        handleSaveTelegramConfig(botToken, latest.chat_id);
        setDetectStatus(`Detected @${latest.username || latest.first_name} (ID: ${latest.chat_id})!`);
        await alertSound.playConfirmationChime(volume);
      } else {
        setDetectStatus("No messages yet. Open @MochaGuard_bot in Telegram and tap 'Start', then try again!");
      }
    } catch {
      setDetectStatus("Error checking bot subscribers.");
    } finally {
      setIsDetectingChat(false);
    }
  };

  // Broadcast to all users
  const handleBroadcastAll = async () => {
    setIsDispatchingTelegram(true);
    setTelegramResult(null);
    try {
      const res = await fetch("/api/alerts/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "broadcast",
          bot_token: botToken.trim() || undefined,
          account_name: accountName,
          symbol: symbol,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        const bc = data.broadcast || {};
        setTelegramResult({
          success: bc.ok ?? true,
          mode: "broadcast",
          message: `Broadcast Sent: Delivered to ${bc.sent ?? 0} user(s) out of ${bc.total ?? 0}!`,
          preview: data.preview_message,
        });
        await alertSound.playConfirmationChime(volume);
      } else {
        setTelegramResult({ success: false, message: data.error || "Broadcast failed" });
      }
    } catch (err: unknown) {
      setTelegramResult({ success: false, message: err instanceof Error ? err.message : "Error" });
    } finally {
      setIsDispatchingTelegram(false);
    }
  };

  // 4. Combined 2 AM Emergency Drill
  const handleSimulateFullDrill = async () => {
    setIsDrillActive(true);

    // Audio alarm
    alertSound.playEmergencySiren(volume);

    // Desktop notification
    if (desktopPermission === "granted") {
      new Notification("MochaGuard 2 AM EMERGENCY DRILL", {
        body: `CRITICAL MARGIN BUFFER EXCEEDED: ${symbol} overnight exposure risk. Automatic de-risk will execute in 15 minutes!`,
        icon: "/favicon.ico",
        requireInteraction: true,
      });
    }

    // Telegram dispatch
    try {
      await fetch("/api/alerts/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "dispatch",
          account_id: accountId,
          bot_token: botToken.trim() || undefined,
          chat_id: chatId.trim() || undefined,
        }),
      });
    } catch {
      // Drill still proceeds smoothly
    }

    setTimeout(() => {
      setIsDrillActive(false);
    }, 2800);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-6 bg-black/85 backdrop-blur-md overflow-y-auto animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl max-h-[92vh] flex flex-col rounded-3xl border border-[#231F42] bg-[#0A0915] p-6 sm:p-8 shadow-[0_0_60px_rgba(124,58,237,0.25)] text-foreground my-auto overflow-y-auto">
        {/* Glow Header Accents */}
        <div className="absolute -top-12 left-1/2 -translate-x-1/2 w-64 h-24 bg-[#7C3AED]/20 blur-3xl pointer-events-none" />

        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-2 rounded-xl text-[#94A3B8] hover:text-white hover:bg-[#1A1636] transition-colors"
          aria-label="Close modal"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="flex items-start gap-4 mb-6">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#7C3AED]/30 to-[#4C1D95]/40 border border-[#7C3AED]/50 text-[#A78BFA] shadow-[0_0_20px_rgba(124,58,237,0.3)]">
            <Radio className="w-6 h-6 animate-pulse text-[#C4B5FD]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-white tracking-tight">2 AM Sleep-Safe Sentinel</h2>
              <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full bg-[#7C3AED]/20 border border-[#7C3AED]/40 text-[#C4B5FD]">
                Multi-Channel Alert Hub
              </span>
            </div>
            <p className="text-xs text-[#94A3B8] mt-1 leading-relaxed">
              Wake up before the broker liquidates you. High-decibel audible alarms, native desktop web notifications,
              and Telegram push alerts triggered at 15:00 ET.
            </p>
          </div>
        </div>

        {/* Channels Grid */}
        <div className="space-y-4">
          {/* Channel 1: High-Volume Audible Alarm */}
          <div className="p-4 rounded-2xl border border-[#1F1B38] bg-[#0F0D20] space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-[#EF4444]/15 border border-[#EF4444]/30 text-[#F87171]">
                  <Volume2 className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-white">Emergency Wake-Up Siren (Web Audio API)</div>
                  <div className="text-[11px] text-[#64748B]">Blinkit/Rapido-style dual oscillator frequency ramp</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleTestChime}
                  className="px-2.5 py-1 text-[11px] font-medium rounded-lg border border-[#28224D] bg-[#14122B] text-[#A78BFA] hover:bg-[#1E1B3E] transition-colors"
                >
                  Subtle Chime
                </button>
                <button
                  type="button"
                  onClick={handleTestSiren}
                  disabled={isPlayingAudio}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-all shadow-md ${
                    isPlayingAudio
                      ? "bg-[#EF4444] text-white animate-pulse"
                      : "bg-[#EF4444]/20 border border-[#EF4444]/40 text-[#FCA5A5] hover:bg-[#EF4444]/30"
                  }`}
                >
                  {isPlayingAudio ? (
                    <>
                      <Square className="w-3 h-3 fill-white" /> Sounding Siren...
                    </>
                  ) : (
                    <>
                      <Play className="w-3 h-3 fill-current" /> Test High-Decibel Siren
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Volume Control */}
            <div className="flex items-center gap-3 pt-1 border-t border-[#1C1836]">
              <span className="text-[11px] text-[#94A3B8] font-mono flex items-center gap-1">
                Volume: {Math.round(volume * 100)}%
              </span>
              <input
                type="range"
                min="0.1"
                max="1.0"
                step="0.05"
                value={volume}
                onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                className="flex-1 h-1.5 bg-[#1E1A38] rounded-lg appearance-none cursor-pointer accent-[#7C3AED]"
              />
              <span className="text-[10px] text-[#64748B]">Zero audio file downloads required</span>
            </div>
          </div>

          {/* Channel 2: Desktop Push Notifications */}
          <div className="p-4 rounded-2xl border border-[#1F1B38] bg-[#0F0D20] space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-[#3B82F6]/15 border border-[#3B82F6]/30 text-[#60A5FA]">
                  <Bell className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-white">Browser Desktop Web Notification</div>
                  <div className="text-[11px] text-[#64748B]">System tray popups outside active tab</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`px-2 py-0.5 text-[10px] font-mono rounded-full border ${
                    desktopPermission === "granted"
                      ? "bg-[#10B981]/20 border-[#10B981]/40 text-[#34D399]"
                      : desktopPermission === "denied"
                      ? "bg-[#EF4444]/20 border-[#EF4444]/40 text-[#F87171]"
                      : "bg-[#F59E0B]/20 border-[#F59E0B]/40 text-[#FBBF24]"
                  }`}
                >
                  {desktopPermission === "granted" ? "Granted" : desktopPermission === "denied" ? "Blocked" : "Needs Permission"}
                </span>

                {desktopPermission !== "granted" ? (
                  <button
                    type="button"
                    onClick={handleRequestDesktopPermission}
                    className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-[#3B82F6]/20 border border-[#3B82F6]/40 text-[#93C5FD] hover:bg-[#3B82F6]/30 transition-all"
                  >
                    Enable Notifications
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleFireDesktopNotification}
                    className="px-3 py-1.5 text-xs font-semibold rounded-xl border border-[#28224D] bg-[#14122B] text-white hover:bg-[#1E1B3E] transition-all"
                  >
                    Trigger Test Desktop Alert
                  </button>
                )}
              </div>
            </div>
            {desktopNotificationStatus && (
              <p className="text-[11px] text-[#94A3B8] italic">{desktopNotificationStatus}</p>
            )}
          </div>

          {/* Channel 3: Telegram Push Bot */}
          <div className="p-4 rounded-2xl border border-[#1F1B38] bg-[#0F0D20] space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-[#0088CC]/15 border border-[#0088CC]/30 text-[#38BDF8]">
                  <Smartphone className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-white">Telegram Sleep-Safe Push Bot</div>
                  <div className="text-[11px] text-[#64748B]">Push notifications with inline action buttons</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {subscriberCount > 0 && (
                  <span className="px-2 py-0.5 text-[10px] font-mono rounded-full bg-[#10B981]/15 text-[#34D399] border border-[#10B981]/30">
                    {subscriberCount} Subscriber{subscriberCount > 1 ? "s" : ""}
                  </span>
                )}
                <span className="px-2 py-0.5 text-[10px] font-mono rounded-full bg-[#1A1636] text-[#A78BFA] border border-[#2D265A]">
                  @{DEFAULT_BOT_USERNAME}
                </span>
              </div>
            </div>

            {/* Quick Setup Wizard Banner */}
            <div className="p-3 rounded-xl border border-[#2D265A] bg-[#121028] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 text-xs">
              <div className="space-y-0.5">
                <div className="font-semibold text-white flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-[#A78BFA]" />
                  Connect your Telegram in 2 clicks:
                </div>
                <div className="text-[11px] text-[#94A3B8]">
                  1. Tap Start in the bot &nbsp;·&nbsp; 2. Click Auto-Detect Chat ID
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <a
                  href={`https://t.me/${DEFAULT_BOT_USERNAME}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-[#0088CC]/20 border border-[#0088CC]/40 text-[#38BDF8] hover:bg-[#0088CC]/30 flex items-center gap-1 transition-all"
                >
                  <ExternalLink className="w-3 h-3" />
                  Open @{DEFAULT_BOT_USERNAME}
                </a>
                <button
                  type="button"
                  onClick={handleDetectChatId}
                  disabled={isDetectingChat}
                  className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-[#7C3AED]/20 border border-[#7C3AED]/40 text-[#C4B5FD] hover:bg-[#7C3AED]/30 flex items-center gap-1 transition-all disabled:opacity-50"
                >
                  <Zap className="w-3 h-3" />
                  {isDetectingChat ? "Detecting..." : "Auto-Detect Chat ID"}
                </button>
              </div>
            </div>

            {detectStatus && (
              <p className="text-[11px] text-[#C4B5FD] bg-[#161230] p-2 rounded-lg border border-[#2A2350] italic">
                {detectStatus}
              </p>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
              {/* Bot Token */}
              <div>
                <label className="block text-[11px] font-medium text-[#94A3B8] mb-1">
                  Telegram Bot Token
                </label>
                <div className="relative">
                  <input
                    type={showToken ? "text" : "password"}
                    placeholder="123456789:ABCdef..."
                    value={botToken}
                    onChange={(e) => handleSaveTelegramConfig(e.target.value, chatId)}
                    className="w-full bg-[#0A0915] border border-[#231F42] rounded-xl px-3 py-1.5 text-xs text-white placeholder-[#4B5563] focus:outline-none focus:border-[#7C3AED]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken(!showToken)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#64748B] hover:text-white"
                  >
                    {showToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {/* Chat ID */}
              <div>
                <label className="block text-[11px] font-medium text-[#94A3B8] mb-1">
                  Your Telegram Chat ID <span className="text-[#64748B]">(or click Auto-Detect above)</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. 987654321"
                  value={chatId}
                  onChange={(e) => handleSaveTelegramConfig(botToken, e.target.value)}
                  className="w-full bg-[#0A0915] border border-[#231F42] rounded-xl px-3 py-1.5 text-xs text-white placeholder-[#4B5563] focus:outline-none focus:border-[#7C3AED]"
                />
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-between gap-2.5 pt-1">
              <p className="text-[10px] text-[#64748B] flex items-center gap-1">
                <Info className="w-3 h-3 text-[#7C3AED]" />
                Sends 15:00 ET closing alerts directly to your phone.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSendTelegramTest}
                  disabled={isDispatchingTelegram || !chatId.trim()}
                  className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-gradient-to-r from-[#0088CC] to-[#0077B5] hover:brightness-110 text-white flex items-center gap-1.5 transition-all shadow-md disabled:opacity-40"
                >
                  <Send className="w-3 h-3" />
                  {isDispatchingTelegram ? "Sending..." : "Send Test to My Phone"}
                </button>
                <button
                  type="button"
                  onClick={handleBroadcastAll}
                  disabled={isDispatchingTelegram}
                  className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-gradient-to-r from-[#7C3AED] to-[#6D28D9] hover:brightness-110 text-white flex items-center gap-1.5 transition-all shadow-md disabled:opacity-40"
                  title="Broadcast alert to all registered subscribers"
                >
                  <Radio className="w-3 h-3 text-[#C4B5FD]" />
                  Broadcast to All Users
                </button>
              </div>
            </div>

            {/* Telegram Result Banner */}
            {telegramResult && (
              <div
                className={`p-3 rounded-xl text-xs border ${
                  telegramResult.success
                    ? "bg-[#10B981]/10 border-[#10B981]/30 text-[#34D399]"
                    : "bg-[#EF4444]/10 border-[#EF4444]/30 text-[#F87171]"
                }`}
              >
                <div className="font-semibold flex items-center gap-1.5">
                  {telegramResult.success ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                  {telegramResult.message}
                </div>
                {telegramResult.preview && (
                  <div className="mt-2 text-[10px] font-mono text-[#94A3B8] bg-[#0A0915] p-2 rounded-lg border border-[#231F42] whitespace-pre-line">
                    {telegramResult.preview.replace(/<[^>]+>/g, "")}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* The Big Red Panic Drill Button */}
        <div className="mt-6 pt-5 border-t border-[#1C1836] flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-left">
            <div className="text-xs font-semibold text-white flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-[#F59E0B]" />
              Simulate 2 AM Emergency Trigger
            </div>
            <div className="text-[11px] text-[#64748B]">
              Fires the high-volume siren, desktop notification, and Telegram alert at once.
            </div>
          </div>

          <button
            type="button"
            onClick={handleSimulateFullDrill}
            disabled={isDrillActive}
            className={`w-full sm:w-auto px-5 py-2.5 rounded-2xl text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-[0_0_25px_rgba(239,68,68,0.4)] ${
              isDrillActive
                ? "bg-[#EF4444] text-white animate-pulse"
                : "bg-gradient-to-r from-[#DC2626] via-[#EF4444] to-[#B91C1C] hover:brightness-110 text-white"
            }`}
          >
            <ShieldAlert className="w-4 h-4" />
            {isDrillActive ? "ALARM TRIGGERED!" : "Run 2 AM Emergency Drill"}
          </button>
        </div>
      </div>
    </div>
  );
}
