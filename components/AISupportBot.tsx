"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { ORG_NAME, SUPPORT_WHATSAPP } from "@/lib/config";

interface ChatMessage {
  id: string;
  role: "user" | "bot";
  text: string;
  timestamp: string;
  links?: { label: string; href: string }[];
}

const STORAGE_KEY = "apex_support_chat_history";

const QUICK_ACTIONS = [
  { label: "🔑 Where is my Room ID & Pass?", query: "Where do I get my match Room ID and Password?" },
  { label: "💳 Check Payment Verification", query: "How long does payment and UTR verification take?" },
  { label: "🎯 How do Slots 5 to 25 work?", query: "How does slot allocation work from Slot 5 to 25?" },
  { label: "🏆 Prize Pool & UPI Payouts", query: "How is the prize pool distributed among the top 4 teams?" },
  { label: "💬 Contact Host WhatsApp", query: "Give me the official WhatsApp support link to contact the host." },
];

export function AISupportBot() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load chat history from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMessages(parsed);
          return;
        }
      }
    } catch {}

    // Initial greeting if no history
    const welcomeMsg: ChatMessage = {
      id: "welcome-1",
      role: "bot",
      text: `👋 Hey Captain! I'm the **${ORG_NAME} AI Assistant**.\n\nNeed help with your **Room ID & Password**, **UTR verification**, or **Slot 5-25 allocation**? Ask me anything below or tap a quick question!`,
      timestamp: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
      links: [
        { label: "🔑 My Tournaments (IDP)", href: "/my-tournaments" },
        { label: "🎮 Register Lobby", href: "/register" },
      ],
    };
    setMessages([welcomeMsg]);
  }, []);

  // Save to localStorage whenever messages change
  useEffect(() => {
    if (messages.length > 0) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
      } catch {}
    }
  }, [messages]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      setUnreadCount(0);
    }
  }, [messages, isOpen]);

  const handleSend = async (textToSend?: string) => {
    const text = (textToSend || input).trim();
    if (!text || isTyping) return;

    const userMsg: ChatMessage = {
      id: `usr-${Date.now()}`,
      role: "user",
      text,
      timestamp: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
    };

    setMessages((prev) => [...prev, userMsg]);
    if (!textToSend) setInput("");
    setIsTyping(true);

    try {
      // Collect recent history for context
      const history = messages.slice(-5).map((m) => ({
        role: m.role === "user" ? ("user" as const) : ("model" as const),
        text: m.text,
      }));

      const res = await fetch("/api/ai/support-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history }),
      });

      const data = await res.json();
      const replyText = data.reply || "I'm having trouble connecting right now, but you can always reach our host on WhatsApp!";

      // Extract markdown links if present
      const links: { label: string; href: string }[] = [];
      const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
      let match;
      while ((match = linkRegex.exec(replyText)) !== null) {
        links.push({ label: match[1], href: match[2] });
      }

      if (text.toLowerCase().includes("whatsapp") || replyText.toLowerCase().includes("whatsapp")) {
        links.push({
          label: "💬 Open WhatsApp Chat",
          href: `https://wa.me/91${SUPPORT_WHATSAPP}?text=Hello%20Apex%20Support`,
        });
      }

      const botMsg: ChatMessage = {
        id: `bot-${Date.now()}`,
        role: "bot",
        text: replyText,
        timestamp: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
        links: links.length > 0 ? links : undefined,
      };

      setMessages((prev) => [...prev, botMsg]);
    } catch {
      const errorMsg: ChatMessage = {
        id: `bot-${Date.now()}`,
        role: "bot",
        text: `Network hiccup! For instant assistance, please chat directly with our host on WhatsApp at +91 ${SUPPORT_WHATSAPP}.`,
        timestamp: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
        links: [
          {
            label: "💬 WhatsApp Host (+91 " + SUPPORT_WHATSAPP + ")",
            href: `https://wa.me/91${SUPPORT_WHATSAPP}?text=Hello%20Apex%20Support`,
          },
        ],
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleClearHistory = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
    const freshWelcome: ChatMessage = {
      id: "welcome-fresh",
      role: "bot",
      text: `Chat cleared! How can I help you today with your BGMI matches?`,
      timestamp: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
    };
    setMessages([freshWelcome]);
  };

  return (
    <>
      {/* ── Floating Launcher Button (Bottom Right) ── */}
      <div className="fixed bottom-5 right-5 z-40">
        {!isOpen && (
          <button
            type="button"
            onClick={() => setIsOpen(true)}
            className="group relative flex items-center gap-2.5 rounded-full bg-gradient-to-r from-amber-500 to-amber-400 px-4 py-3 text-slate-950 font-black text-xs shadow-xl shadow-amber-500/25 transition-all duration-300 hover:scale-105 hover:shadow-amber-500/40 active:scale-95 cursor-pointer border border-amber-300"
            aria-label="Open AI Tournament Support Bot"
          >
            <span className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-slate-950 opacity-40" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-600" />
            </span>
            <span className="text-base">🤖</span>
            <span className="hidden sm:inline font-extrabold tracking-wide">AI Support &amp; IDP Guide</span>
            {unreadCount > 0 && (
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-rose-600 text-[10px] font-black text-white">
                {unreadCount}
              </span>
            )}
          </button>
        )}
      </div>

      {/* ── Chat Modal Window ── */}
      {isOpen && (
        <div className="fixed bottom-4 right-4 z-50 flex h-[560px] max-h-[88vh] w-[92vw] max-w-[390px] flex-col rounded-3xl border border-slate-700/60 bg-[#0B132B] text-slate-100 shadow-2xl shadow-black/80 backdrop-blur-xl animate-in slide-in-from-bottom-5 duration-200 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-white/10 bg-[#070D1F] px-4 py-3">
            <div className="flex items-center gap-2.5">
              <div className="relative flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-tr from-amber-500 to-amber-300 text-slate-950 font-black text-sm shadow-xs">
                🤖
                <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#070D1F] bg-emerald-500" />
              </div>
              <div>
                <h3 className="text-xs font-black text-white flex items-center gap-1.5">
                  <span>Apex AI Assistant</span>
                  <span className="rounded-full bg-amber-400/20 px-1.5 py-0.2 text-[9px] font-bold text-amber-300 border border-amber-400/30">
                    24/7 Live
                  </span>
                </h3>
                <p className="text-[10px] text-slate-400">BGMI Scrims, IDP &amp; Slots Guide</p>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleClearHistory}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-slate-200 transition-colors cursor-pointer text-xs"
                title="Clear conversation history"
              >
                🗑️
              </button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white transition-colors cursor-pointer text-sm font-bold"
                aria-label="Close chat"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Quick FAQ Chips Bar */}
          <div className="border-b border-white/5 bg-[#091126] px-3 py-2 overflow-x-auto no-scrollbar flex gap-1.5 shrink-0">
            {QUICK_ACTIONS.map((qa, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleSend(qa.query)}
                disabled={isTyping}
                className="shrink-0 rounded-full border border-amber-400/25 bg-amber-400/10 px-2.5 py-1 text-[10px] font-bold text-amber-200 hover:bg-amber-400/20 transition-all cursor-pointer disabled:opacity-50"
              >
                {qa.label}
              </button>
            ))}
          </div>

          {/* Messages Scroll Area */}
          <div className="flex-1 space-y-3 overflow-y-auto p-4 text-xs">
            {messages.map((m) => {
              const isUser = m.role === "user";
              return (
                <div
                  key={m.id}
                  className={`flex flex-col ${isUser ? "items-end" : "items-start"} space-y-1`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl p-3 leading-relaxed ${
                      isUser
                        ? "bg-amber-400 text-slate-950 font-bold rounded-br-xs shadow-sm"
                        : "bg-white/10 text-slate-100 border border-white/10 rounded-bl-xs backdrop-blur-md"
                    }`}
                  >
                    <div className="whitespace-pre-wrap">{m.text}</div>

                    {/* Action navigation pills */}
                    {m.links && m.links.length > 0 && (
                      <div className="mt-2.5 flex flex-wrap gap-1.5 pt-2 border-t border-white/15">
                        {m.links.map((link, lIdx) => (
                          <Link
                            key={lIdx}
                            href={link.href}
                            target={link.href.startsWith("http") ? "_blank" : undefined}
                            className="inline-flex items-center gap-1 rounded-lg bg-amber-400/20 px-2 py-1 text-[10px] font-black text-amber-300 hover:bg-amber-400/30 border border-amber-400/30 transition-all"
                          >
                            <span>{link.label}</span>
                            <span>➔</span>
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                  <span className="px-1 text-[9px] text-slate-500 font-mono">{m.timestamp}</span>
                </div>
              );
            })}

            {isTyping && (
              <div className="flex items-center gap-1.5 rounded-2xl bg-white/10 p-3 text-slate-400 max-w-[120px]">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-bounce" />
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-bounce [animation-delay:0.2s]" />
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-bounce [animation-delay:0.4s]" />
                <span className="text-[10px] font-bold text-amber-300 ml-1">Thinking…</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Chat Input Footer */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="border-t border-white/10 bg-[#070D1F] p-2.5 flex items-center gap-2"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask anything (e.g. IDP time, slot, UTR)…"
              className="flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white placeholder-slate-400 outline-none focus:border-amber-400 focus:bg-white/10 transition-colors"
            />
            <button
              type="submit"
              disabled={!input.trim() || isTyping}
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-400 text-slate-950 font-black hover:bg-amber-300 transition-colors disabled:opacity-40 cursor-pointer shrink-0 shadow-xs"
              aria-label="Send query"
            >
              ➔
            </button>
          </form>
        </div>
      )}
    </>
  );
}
