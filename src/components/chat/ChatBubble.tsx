import { Bot, User } from "lucide-react";
import { MessageContent } from "./MessageContent";
import type { ChatMessage } from "./types";

interface ChatBubbleProps {
  message: ChatMessage;
}

export function ChatBubble({ message }: ChatBubbleProps) {
  const isUser = message.role === "user";

  return (
    <div
      className={`flex gap-2.5 ${
        isUser
          ? "max-w-[92%] flex-row-reverse self-end sm:max-w-[85%]"
          : "w-full max-w-full self-start"
      }`}
    >
      <div
        className={`flex size-8 shrink-0 items-center justify-center rounded-full ${
          isUser
            ? "bg-[var(--accent-bg)] text-[var(--accent)]"
            : "bg-[var(--code-bg)] text-[var(--text-h)]"
        }`}
        aria-hidden="true"
      >
        {isUser ? <User size={16} /> : <Bot size={16} />}
      </div>
      <div
        className={`break-words rounded-2xl px-4 py-3 text-[0.9375rem] leading-relaxed ${
          isUser
            ? "rounded-br-sm bg-[var(--accent)] text-white"
            : "min-w-0 flex-1 rounded-bl-sm border border-[var(--border)] bg-[var(--code-bg)] text-[var(--text-h)]"
        }`}
      >
        {isUser ? message.content : <MessageContent content={message.content} />}
      </div>
    </div>
  );
}
