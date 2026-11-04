"use client";

import React, { useEffect, useRef, useState } from "react";
import { SendHorizontal, X } from "lucide-react";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ActiveTool {
  name: string;
  label: string;
}

function toolLabel(name: string, args: unknown): string {
  if (name === "web_swarm") {
    let workers = 3;
    if (args && typeof args === "object" && "max_workers" in args && typeof args.max_workers === "number") {
      workers = args.max_workers;
    }
    return `Swarm web: ${workers} worker`;
  }
  if (name === "fetch_url") return "Membaca halaman web";
  if (name === "search_knowledge") return "Mencari di data";
  if (name === "get_stock" || name === "top_holders") return "Mengambil data kepemilikan saham";
  if (name === "get_investor") return "Mengambil portofolio investor";
  if (name === "sector_rotation") return "Menghitung rotasi sektor";
  if (name === "bandar_signals") return "Memeriksa sinyal Bandar Detector";
  return `Menjalankan ${name}`;
}

const SAMPLE_QUESTIONS = [
  "Siapa pemegang terbesar AADI dan berapa persennya?",
  "Saham apa saja yang dipegang ADARO STRATEGIC INVESTMENTS?",
  "Sektor mana yang memimpin rotasi 21 hari terakhir?",
  "Berita terbaru tentang IHSG minggu ini",
];

export function ChatPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeTools, setActiveTools] = useState<ActiveTool[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, activeTools, errorMsg]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: trimmed }];
    setMessages([...nextMessages, { role: "assistant", content: "" }]);
    setInput("");
    setErrorMsg(null);
    setLoading(true);
    setActiveTools([]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages.slice(-40) }),
      });

      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const j: unknown = await res.json();
          if (j && typeof j === "object" && "error" in j && typeof j.error === "string") {
            msg = j.error;
          }
        } catch {
          // Body is not JSON; keep the status line.
        }
        setErrorMsg(msg);
        setMessages(nextMessages);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setErrorMsg("Stream tidak tersedia");
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const block of parts) {
          const line = block.trim();
          if (!line.startsWith("data:")) continue;
          const jsonStr = line.slice(5).trim();
          if (!jsonStr) continue;
          try {
            const ev: unknown = JSON.parse(jsonStr);
            if (!ev || typeof ev !== "object" || !("type" in ev)) continue;
            if (ev.type === "token" && "text" in ev && typeof ev.text === "string") {
              const tokenText = ev.text;
              setMessages((prev) => {
                const copy = [...prev];
                const last = copy[copy.length - 1];
                if (last && last.role === "assistant") {
                  copy[copy.length - 1] = { ...last, content: last.content + tokenText };
                }
                return copy;
              });
            } else if (ev.type === "tool_start" && "name" in ev && typeof ev.name === "string") {
              const tName = ev.name;
              const tArgs = "args" in ev ? ev.args : undefined;
              setActiveTools((prev) => [...prev, { name: tName, label: toolLabel(tName, tArgs) }]);
            } else if (ev.type === "tool_end" && "name" in ev && typeof ev.name === "string") {
              const tName = ev.name;
              setActiveTools((prev) => prev.filter((t) => t.name !== tName));
            } else if (ev.type === "error" && "message" in ev && typeof ev.message === "string") {
              setErrorMsg(ev.message);
            }
          } catch {
            // Skip a malformed SSE frame instead of aborting the stream.
          }
        }
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setActiveTools([]);
      setLoading(false);
    }
  }

  return (
    <aside
      role="dialog"
      aria-label="Asisten riset"
      className="fixed inset-0 z-[200] flex flex-col border-l border-edge bg-card text-ink md:inset-y-0 md:right-0 md:left-auto md:w-[420px] md:shadow-raised"
    >
      <div className="flex items-center justify-between gap-3 px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-2xl font-bold">Asisten riset</h2>
          <p className="text-base text-muted">Data sistem, harga IDX, dan pencarian web</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Tutup asisten riset"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-muted hover:bg-ink/5 hover:text-ink"
        >
          <X aria-hidden className="h-5 w-5" />
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-5 pb-4 text-sm">
        {messages.length === 0 && (
          <div className="space-y-2">
            <p className="text-lg">Contoh pertanyaan</p>
            <ul className="space-y-2">
              {SAMPLE_QUESTIONS.map((q) => (
                <li key={q}>
                  <button type="button" onClick={() => send(q)} className="btn-ghost w-full justify-start text-left">
                    {q}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {messages.map((m, idx) => (
          <div
            key={idx}
            className={
              m.role === "user"
                ? "scribble ml-8 bg-ink px-4 py-3 text-white"
                : "scribble mr-4 border border-edge bg-canvas px-4 py-3"
            }
          >
            <div className="break-words whitespace-pre-wrap">
              {m.content || (loading && idx === messages.length - 1 ? "Menyiapkan jawaban" : "")}
            </div>
          </div>
        ))}

        {activeTools.map((t, i) => (
          <div key={`${t.name}-${i}`} role="status" className="space-y-1.5 rounded-card border border-edge bg-canvas px-4 py-3">
            <div className="text-base text-muted">{t.label}</div>
            <div className="shimmer h-1.5 w-full rounded-full" />
          </div>
        ))}

        {errorMsg && (
          <div role="alert" className="rounded-control border border-loss bg-card px-4 py-3 text-base text-loss">
            {errorMsg}
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
        className="flex gap-2 px-5 pt-3"
        style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
      >
        <label htmlFor="chat-input" className="sr-only">
          Pertanyaan
        </label>
        <input
          id="chat-input"
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Tanyakan saham, investor, atau riset web"
          disabled={loading}
          className="field flex-1"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          aria-label="Kirim pertanyaan"
          className="btn w-12 px-0 disabled:opacity-50"
        >
          <SendHorizontal aria-hidden className="h-5 w-5" />
        </button>
      </form>
    </aside>
  );
}
