import { Play } from "lucide-react";
import { Markdown, Rich } from "@/components/markdown";
import { chatParts } from "@/core/chat";

/** An agent's words: its moments of the film are buttons that go there. */
export function ChatWords({
  body,
  onSeek,
}: {
  body: string;
  /** Plays the film from a moment; null without a film. */
  onSeek: ((ms: number) => void) | null;
}) {
  return (
    <Markdown
      source={body}
      className="pp-say"
      inline={(text) =>
        chatParts(text).map((part, j) =>
          part.kind === "text" ? (
            <Rich key={j} text={part.text} />
          ) : onSeek ? (
            <button
              key={j}
              type="button"
              className="pp-at"
              aria-label={`Play from ${part.label}`}
              onClick={() => onSeek(part.ms)}
            >
              <Play size={9} fill="currentColor" aria-hidden="true" />
              {part.label}
            </button>
          ) : (
            part.label
          ),
        )
      }
    />
  );
}
