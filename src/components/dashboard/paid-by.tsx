import { useEffect, useRef, useState } from "react";
import type { PaidBy } from "@/core/tickets";
import { Logo } from "@/components/boards";

const domain = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/** Estimated popover height per sponsor, to open it upward near the bottom. */
const POP_ROW = 64;

/**
 * Who paid for the ticket: the first sponsor's logo, name and sentence on
 * one line, "+N" for the others. Every sponsor in full on hover or tap,
 * when the line is cut or there is more than one.
 */
export function PaidByCell({ sponsors }: { sponsors: PaidBy[] }) {
  const cell = useRef<HTMLSpanElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  // Fixed coordinates: the popover escapes the table's scrolling box.
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    if (!at) return;
    const hide = () => setAt(null);
    window.addEventListener("scroll", hide, { capture: true, once: true });
    return () => window.removeEventListener("scroll", hide, { capture: true });
  }, [at]);

  const first = sponsors[0];
  if (!first) return null;
  const more = sponsors.length - 1;

  const show = () => {
    const line = text.current;
    const cut = line ? line.scrollWidth > line.clientWidth : false;
    if (!cut && more === 0) return;
    const rect = cell.current?.getBoundingClientRect();
    if (!rect) return;
    const height = 20 + POP_ROW * sponsors.length;
    const below = rect.bottom + 6 + height < window.innerHeight;
    setAt({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 300)),
      top: below ? rect.bottom + 6 : rect.top - 6 - height,
    });
  };

  return (
    <span
      ref={cell}
      className="pb-cell"
      tabIndex={0}
      onMouseEnter={show}
      onMouseLeave={() => setAt(null)}
      onFocus={show}
      onBlur={() => setAt(null)}
      onClick={() => (at ? setAt(null) : show())}
    >
      <Logo name={first.name} url={first.logoUrl} size="small" />
      <span ref={text} className="pb-text">
        <b>{first.name ?? "Anonymous sponsor"}</b>
        {first.description && <span> {first.description}</span>}
      </span>
      {more > 0 && <span className="pb-more">+{more}</span>}
      {at && (
        <span
          className="pb-pop"
          role="tooltip"
          style={{ left: at.left, top: at.top }}
        >
          {sponsors.map((sponsor, i) => (
            <span key={i} className="pb-sponsor">
              <Logo name={sponsor.name} url={sponsor.logoUrl} size="small" />
              <span>
                <b>{sponsor.name ?? "Anonymous sponsor"}</b>
                {sponsor.description && <span>{sponsor.description}</span>}
                {sponsor.websiteUrl && (
                  <span className="pb-site">{domain(sponsor.websiteUrl)}</span>
                )}
              </span>
            </span>
          ))}
        </span>
      )}
    </span>
  );
}
