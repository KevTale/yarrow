import { ArrowUp } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { TRY_WORDS, type TryTurn } from "@/core/try-ticket";

/**
 * A turn of the landing's agent: everything it has written so far, each time
 * more arrives. False when the day's turns are spent.
 */
export async function askSample(
  turn: TryTurn,
  onRaw: (raw: string) => void,
): Promise<boolean> {
  const response = await fetch("/try-agent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(turn),
  });
  if (response.status === 429) return false;
  if (!response.ok || !response.body) throw new Error("refused");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let raw = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return true;
    raw += decoder.decode(value, { stream: true });
    onRaw(raw);
  }
}

/** The chat's box, growing with what is typed: Enter sends. */
export function SampleBox({
  label,
  placeholder,
  text,
  onText,
  onSend,
  waiting,
}: {
  label: string;
  placeholder: string;
  text: string;
  onText: (text: string) => void;
  onSend: () => void;
  waiting: boolean;
}) {
  const box = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const area = box.current;
    if (!area) return;
    area.style.height = "auto";
    area.style.height = `${area.scrollHeight}px`;
  }, [text]);
  return (
    <div className="pp-asking">
      <form
        className="pp-input"
        onSubmit={(event) => {
          event.preventDefault();
          onSend();
        }}
      >
        <textarea
          ref={box}
          aria-label={label}
          placeholder={placeholder}
          rows={1}
          value={text}
          maxLength={TRY_WORDS}
          onChange={(event) => onText(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              onSend();
            }
          }}
        />
        {text.trim() && (
          <button
            type="submit"
            className="pp-go"
            aria-label="Send"
            aria-disabled={waiting}
          >
            <ArrowUp size={17} strokeWidth={2.2} />
          </button>
        )}
      </form>
    </div>
  );
}
