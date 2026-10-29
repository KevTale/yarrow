import { useEffect, useRef, useState } from "react";
import type { PaidBy } from "@/core/tickets";
import { Logo } from "@/components/boards";
import { shortSite } from "@/core/pr-card";

/** The sponsor's website, through /out/ so the click counts. */
export const sponsorHref = (sponsor: PaidBy) =>
  sponsor.publicId && sponsor.websiteUrl ? `/out/${sponsor.publicId}` : null;

/** A sponsor's name, linked to its website when it has one. */
export function SponsorLink({
  sponsor,
  className,
  children,
}: {
  sponsor: PaidBy;
  className?: string;
  children: React.ReactNode;
}) {
  const href = sponsorHref(sponsor);
  return href ? (
    <a className={className} href={href} target="_blank" rel="noopener">
      {children}
    </a>
  ) : (
    <span className={className}>{children}</span>
  );
}

/** Estimated popover height per sponsor, to open it upward near the bottom. */
const POP_ROW = 64;

/**
 * Who paid for the ticket: the first sponsor's logo and name, its sentence
 * under it, "+N" for the others, linked to its website. Every sponsor in
 * full on hover or focus, each linked, when a line is cut or there is more
 * than one.
 */
export function PaidByCell({ sponsors }: { sponsors: PaidBy[] }) {
  const cell = useRef<HTMLSpanElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  const leaving = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Fixed coordinates: the popover escapes the table's scrolling box.
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    if (!at) return;
    const hide = () => setAt(null);
    window.addEventListener("scroll", hide, { capture: true, once: true });
    return () => window.removeEventListener("scroll", hide, { capture: true });
  }, [at]);
  useEffect(
    () => () => {
      if (leaving.current) clearTimeout(leaving.current);
    },
    [],
  );

  const first = sponsors[0];
  if (!first) return null;
  const more = sponsors.length - 1;

  const show = () => {
    if (leaving.current) clearTimeout(leaving.current);
    if (at) return;
    const lines = text.current ? [...text.current.children] : [];
    const cut = lines.some((line) => line.scrollWidth > line.clientWidth);
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
  // A short grace, so the pointer can cross to the popover's links.
  const hide = () => {
    leaving.current = setTimeout(() => setAt(null), 160);
  };

  return (
    <span
      ref={cell}
      className="pb-cell"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      <SponsorLink sponsor={first} className="pb-main">
        <Logo name={first.name} url={first.logoUrl} size="small" />
        <span ref={text} className="pb-text">
          <b>{first.name ?? "Anonymous sponsor"}</b>
          {first.description && <span>{first.description}</span>}
        </span>
      </SponsorLink>
      {more > 0 && <span className="pb-more">+{more}</span>}
      {at && (
        <span
          className="pb-pop"
          role="tooltip"
          style={{ left: at.left, top: at.top }}
        >
          {sponsors.map((sponsor, i) => (
            <SponsorLink key={i} sponsor={sponsor} className="pb-sponsor">
              <Logo name={sponsor.name} url={sponsor.logoUrl} size="small" />
              <span>
                <b>{sponsor.name ?? "Anonymous sponsor"}</b>
                {sponsor.description && <span>{sponsor.description}</span>}
                {sponsor.websiteUrl && (
                  <span className="pb-site">
                    {shortSite(sponsor.websiteUrl) ?? sponsor.websiteUrl}
                  </span>
                )}
              </span>
            </SponsorLink>
          ))}
        </span>
      )}
    </span>
  );
}
