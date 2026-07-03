import { useCallback, useState } from "react";
import { useAction } from "convex/react";
import { AlertCircle } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { ChatInput } from "./ChatInput";
import { MessageList } from "./MessageList";
import type { ChatMessage } from "./types";

function createId() {
  return crypto.randomUUID();
}

export function ChatContainer() {
  const ask = useAction(api.chat.ask);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isLoading) return;

      setError(null);
      setInput("");

      const userMessage: ChatMessage = {
        id: createId(),
        role: "user",
        content: trimmed,
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, userMessage]);
      setIsLoading(true);

      try {
        const history = messages.map((message) => ({
          role: message.role,
          content: message.content,
        }));
        const reply = await ask({ message: trimmed, history });

        const assistantMessage: ChatMessage = {
          id: createId(),
          role: "assistant",
          content: reply,
          timestamp: Date.now(),
        };

        setMessages((prev) => [...prev, assistantMessage]);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Something went wrong. Please try again.";
        setError(message);
      } finally {
        setIsLoading(false);
      }
    },
    [messages, ask, isLoading],
  );

  const handleSend = () => {
    if (!input.trim()) {
      setError("Please enter a message before sending.");
      return;
    }
    void sendMessage(input);
  };

  const handleSuggestionClick = (text: string) => {
    setInput(text);
    void sendMessage(text);
  };

  return (
    <div className="mx-auto flex h-svh w-full max-w-3xl flex-col bg-[var(--bg)]">
      <header className="shrink-0 border-b border-[var(--border)] px-5 py-4">
        <h1 className="m-0 text-xl font-semibold tracking-tight text-[var(--text-h)]">
          AI Finance Chatbot
        </h1>
        <p className="mt-1 text-sm text-[var(--text)]">
          Ask questions about your business data
        </p>
      </header>

      <MessageList
        messages={messages}
        isLoading={isLoading}
        onSuggestionClick={handleSuggestionClick}
      />

      {error && (
        <div
          className="mx-5 mb-2 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-300"
          role="alert"
        >
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <ChatInput
        value={input}
        onChange={(value) => {
          setInput(value);
          if (error) setError(null);
        }}
        onSend={handleSend}
        disabled={isLoading}
      />
    </div>
  );
}
