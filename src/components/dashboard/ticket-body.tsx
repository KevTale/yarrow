import { useLayoutEffect, useRef, useState } from "react";
import { Markdown } from "@/components/markdown";

/**
 * A ticket's description while it is written: read as its row will show it,
 * the Markdown itself once they click in to write.
 */
export function TicketBody({
  value,
  maxLength,
  onChange,
}: {
  value: string;
  maxLength: number;
  onChange: (value: string) => void;
}) {
  const [writing, setWriting] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const field = box.current;
    if (!writing || !field) return;
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  }, [writing]);

  if (value.trim() && !writing)
    return (
      <div
        className="nt-body nt-read"
        role="textbox"
        aria-label="Description"
        aria-multiline="true"
        tabIndex={0}
        onFocus={() => setWriting(true)}
      >
        <Markdown source={value} />
      </div>
    );
  return (
    <textarea
      ref={box}
      className="nt-body"
      aria-label="Description"
      placeholder="Description, in Markdown"
      rows={7}
      value={value}
      maxLength={maxLength}
      onChange={(event) => onChange(event.target.value)}
      onFocus={() => setWriting(true)}
      onBlur={() => {
        // Another window taken a moment leaves it where it was.
        if (document.activeElement !== box.current) setWriting(false);
      }}
    />
  );
}
