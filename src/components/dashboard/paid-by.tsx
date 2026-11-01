import { useEffect, useRef, useState } from "react";
import type { PaidBy, TicketRow } from "@/core/tickets";
import { Logo } from "@/components/boards";
import { shortSite } from "@/core/pr-card";
import { PullCosts } from "./pull-panel";

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

/**
 * Who paid, on the ticket's line: "Paid by", the first sponsor and "+N".
 * Hovering or focusing the whole cell shows every sponsor in full, each
 * linked to its website, then each model's time and cost and the total.
 */
export function SponsorCell({
  row,
  projectId,
}: {
  row: TicketRow;
  projectId: string;
}) {
  const cell = useRef<HTMLSpanElement>(null);
  const leaving = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Fixed coordinates: the card escapes the list's clipped box.
  const [at, setAt] = useState<{
    right: number;
    top?: number;
    bottom?: number;
  } | null>(null);

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

  const first = row.paidBy[0];
  if (!first) return <span className="tix-sponsor" />;
  const names = row.paidBy.map(
    (sponsor) => sponsor.name ?? "Anonymous sponsor",
  );

  const show = () => {
    if (leaving.current) clearTimeout(leaving.current);
    if (at) return;
    const rect = cell.current?.getBoundingClientRect();
    if (!rect) return;
    const right = Math.max(8, window.innerWidth - rect.right);
    // Low in the window, it opens upward.
    setAt(
      rect.bottom > window.innerHeight * 0.6
        ? { right, bottom: window.innerHeight - rect.top + 6 }
        : { right, top: rect.bottom + 6 },
    );
  };
  // A short grace, so the pointer can cross to the card's links.
  const hide = () => {
    leaving.current = setTimeout(() => setAt(null), 160);
  };

  return (
    <span
      ref={cell}
      className="tix-sponsor"
      tabIndex={0}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      <span className="tix-paid">Paid by</span>
      <Logo name={first.name} url={first.logoUrl} size="small" />
      <span>{names[0]}</span>
      {names.length > 1 && (
        <span className="tix-more">+{names.length - 1}</span>
      )}
      {at && (
        <span
          className="pb-pop"
          role="tooltip"
          style={{ right: at.right, top: at.top, bottom: at.bottom }}
        >
          {row.paidBy.map((sponsor, i) => (
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
          {row.pullRequest && (
            <PullCosts projectId={projectId} rowKey={row.key} />
          )}
        </span>
      )}
    </span>
  );
}
