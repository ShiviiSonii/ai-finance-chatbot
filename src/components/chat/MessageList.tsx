import { useEffect, useRef } from "react";
import { Bot, MessageSquare } from "lucide-react";
import { ChatBubble } from "./ChatBubble";
import type { ChatMessage } from "./types";

interface MessageListProps {
  messages: ChatMessage[];
  isLoading: boolean;
  onSuggestionClick: (text: string) => void;
}

const SUGGESTIONS = [
  "Show all unpaid invoices",
  "Who is our top paying customer?",
  "List overdue invoices",
];

function LoadingDots() {
  return (
    <div className="flex gap-1 rounded-2xl rounded-bl-sm border border-[var(--border)] bg-[var(--code-bg)] px-4 py-3">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="size-2 animate-bounce rounded-full bg-[var(--text)] opacity-40"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </div>
  );
}

export function MessageList({
  messages,
  isLoading,
  onSuggestionClick,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  if (messages.length === 0 && !isLoading) {
    return (
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto scroll-smooth p-4 sm:p-5">
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-8 text-center text-[var(--text)]">
          <MessageSquare
            className="mb-4 size-12 text-[var(--accent)] opacity-80"
            strokeWidth={1.5}
          />
          <h2 className="m-0 mb-2 text-lg text-[var(--text-h)]">
            Finance Assistant
          </h2>
          <p className="max-w-xs text-[0.9375rem] leading-relaxed">
            Ask about purchase orders, invoices, payments, and customer balances.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {SUGGESTIONS.map((text) => (
              <button
                key={text}
                type="button"
                className="cursor-pointer rounded-full border border-[var(--border)] bg-[var(--code-bg)] px-3.5 py-2 text-[0.8125rem] text-[var(--text-h)] transition-colors hover:border-[var(--accent-border)] hover:bg-[var(--accent-bg)]"
                onClick={() => onSuggestionClick(text)}
              >
                {text}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex flex-1 flex-col gap-4 overflow-y-auto scroll-smooth p-4 sm:p-5"
      role="log"
      aria-live="polite"
    >
      {messages.map((message) => (
        <ChatBubble key={message.id} message={message} />
      ))}

      {isLoading && (
        <div className="flex items-center gap-2.5 self-start py-2" aria-label="Assistant is typing">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--code-bg)] text-[var(--text-h)]">
            <Bot size={16} />
          </div>
          <LoadingDots />
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
