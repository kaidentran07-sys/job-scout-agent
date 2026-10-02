"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import ChatMarkdown from "@/components/ChatMarkdown";
import { getOrCreateSessionId } from "@/lib/session";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolsUsed?: string[];
  isError?: boolean; // error replies are shown but never sent back as history
};

const STARTERS = [
  "How should I answer 'tell me about yourself'?",
  "I want to watch Spotify and Visa",
  "Show me business analyst roles",
];

const NETWORK_ERROR_REPLY =
  "Can't reach you right now. Check your connection, then hit send again. I'll be right here.";

let nextId = 0;
const makeId = () => `m${nextId++}`;

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const sessionIdRef = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    sessionIdRef.current = getOrCreateSessionId();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || loading) return;

    const userMessage: Message = { id: makeId(), role: "user", content };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);

    let assistant: Message;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionIdRef.current ?? getOrCreateSessionId(),
          messages: nextMessages
            .filter((m) => !m.isError)
            .map(({ role, content }) => ({ role, content })),
        }),
      });
      const data: { reply?: string; toolsUsed?: string[] } = await res.json();
      assistant = {
        id: makeId(),
        role: "assistant",
        content: data.reply ?? NETWORK_ERROR_REPLY,
        toolsUsed: data.toolsUsed ?? [],
        isError: !res.ok,
      };
    } catch {
      assistant = {
        id: makeId(),
        role: "assistant",
        content: NETWORK_ERROR_REPLY,
        isError: true,
      };
    }
    setMessages((prev) => [...prev, assistant]);
    setLoading(false);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    send(input);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(input);
    }
  }

  return (
    <div className="flex h-dvh justify-center sm:p-4">
      <div className="flex w-full max-w-3xl flex-col overflow-hidden bg-white shadow-sm sm:rounded-2xl sm:border sm:border-slate-200">
        {/* Header */}
        <header className="flex items-center gap-3 border-b border-slate-200 px-4 py-3 sm:px-6">
          <div
            aria-hidden
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-600 font-semibold text-white"
          >
            CR
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-semibold text-slate-900">Coach Reed</h1>
            <p className="truncate text-sm text-slate-500">
              Your brutally honest, genuinely rooting-for-you career coach
            </p>
          </div>
        </header>

        {/* Messages */}
        <main className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <p className="text-lg font-medium text-slate-800">
                Ready when you are.
              </p>
              <p className="mt-1 max-w-sm text-sm text-slate-500">
                Ask for career advice, tell me which companies to watch, or ask
                what roles are open.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                {STARTERS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    className="rounded-full border border-teal-200 bg-teal-50 px-3.5 py-1.5 text-sm text-teal-800 transition hover:border-teal-300 hover:bg-teal-100"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <ul className="space-y-4">
              {messages.map((m) =>
                m.role === "user" ? (
                  <li key={m.id} className="flex justify-end">
                    <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-teal-600 px-4 py-2.5 text-[15px] leading-relaxed text-white">
                      {m.content}
                    </div>
                  </li>
                ) : (
                  <li key={m.id} className="flex flex-col items-start">
                    <div
                      className={`max-w-[92%] min-w-0 rounded-2xl rounded-bl-sm border px-4 py-2.5 text-[15px] leading-relaxed ${
                        m.isError
                          ? "border-amber-200 bg-amber-50 text-amber-900"
                          : "border-slate-200 bg-slate-50 text-slate-800"
                      }`}
                    >
                      <ChatMarkdown>{m.content}</ChatMarkdown>
                    </div>
                    {m.toolsUsed && m.toolsUsed.length > 0 && (
                      <span className="mt-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-xs text-slate-500">
                        🔧 Used: {m.toolsUsed.join(", ")}
                      </span>
                    )}
                  </li>
                ),
              )}
              {loading && (
                <li className="flex justify-start" aria-live="polite">
                  <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-500">
                    <span className="flex gap-1" aria-hidden>
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-teal-500 [animation-delay:-0.3s]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-teal-500 [animation-delay:-0.15s]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-teal-500" />
                    </span>
                    Coach is thinking...
                  </div>
                </li>
              )}
            </ul>
          )}
          <div ref={bottomRef} />
        </main>

        {/* Input */}
        <form
          onSubmit={handleSubmit}
          className="border-t border-slate-200 bg-white px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4"
        >
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              placeholder="Message Coach Reed..."
              aria-label="Message Coach Reed"
              className="max-h-40 min-h-11 flex-1 resize-none rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-[15px] text-slate-800 placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none field-sizing-content"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="h-11 shrink-0 rounded-xl bg-teal-600 px-4 text-sm font-medium text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              Send
            </button>
          </div>
          <p className="mt-1.5 hidden text-xs text-slate-400 sm:block">
            Enter to send · Shift+Enter for a new line
          </p>
        </form>
      </div>
    </div>
  );
}
