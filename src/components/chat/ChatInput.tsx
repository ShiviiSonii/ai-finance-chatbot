import { useRef, type FormEvent, type KeyboardEvent } from "react";
import { Send } from "lucide-react";

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled?: boolean;
}

export function ChatInput({
  value,
  onChange,
  onSend,
  disabled = false,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSend();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  const handleInput = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  };

  return (
    <div className="shrink-0 border-t border-[var(--border)] px-4 py-3 pb-4 sm:px-5 sm:pb-5">
      <form className="flex items-end gap-2.5" onSubmit={handleSubmit}>
        <textarea
          ref={textareaRef}
          className="max-h-32 min-h-11 flex-1 resize-none rounded-xl border border-[var(--border)] bg-[var(--code-bg)] px-4 py-2.5 text-[0.9375rem] leading-relaxed text-[var(--text-h)] transition-[border-color,box-shadow] placeholder:text-[var(--text)] placeholder:opacity-70 focus:border-[var(--accent-border)] focus:shadow-[0_0_0_3px_var(--accent-bg)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          placeholder="Ask about invoices, payments, or purchase orders…"
          rows={1}
          disabled={disabled}
          aria-label="Message input"
        />
        <button
          type="submit"
          className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-[var(--accent)] text-white transition-[opacity,transform] hover:opacity-90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={disabled || !value.trim()}
          aria-label="Send message"
        >
          <Send size={18} />
        </button>
      </form>
    </div>
  );
}
