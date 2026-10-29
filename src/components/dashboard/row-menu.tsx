import { Ellipsis, GitPullRequest, Ticket } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motionTokens } from "@/components/arc/lib/motion-tokens";
import type { TicketRow } from "@/core/tickets";

/**
 * "…" in a ticket's gutter, under the pointer and while the row is open:
 * where else the ticket lives (its tracker, its pull request). The menu is
 * drawn over the page, since the groups clip what leaves them.
 */
export function RowMenu({ row }: { row: TicketRow }) {
  const reduced = useReducedMotion();
  const [at, setAt] = useState<
    { left: number; top: number } | { left: number; bottom: number } | null
  >(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const open = at !== null;

  useEffect(() => {
    if (!open) return;
    const close = () => setAt(null);
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !button.current?.contains(target))
        close();
    };
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
        button.current?.focus();
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      const items = [
        ...(menu.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ??
          []),
      ];
      const index = items.indexOf(document.activeElement as HTMLElement);
      const next =
        event.key === "ArrowDown"
          ? (index + 1) % items.length
          : (index - 1 + items.length) % items.length;
      items[next]?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", keys);
    // A menu pinned to the page would drift from its row.
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    requestAnimationFrame(() =>
      menu.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus(),
    );
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", keys);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const toggle = () => {
    if (open) return setAt(null);
    const box = button.current!.getBoundingClientRect();
    // Near the foot of the window, the menu opens upward.
    setAt(
      window.innerHeight - box.bottom < 200
        ? { left: box.left, bottom: window.innerHeight - box.top + 4 }
        : { left: box.left, top: box.bottom + 4 },
    );
  };
  return (
    <>
      <button
        ref={button}
        type="button"
        className="tix-dots"
        aria-label={`${row.ref} actions`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        <Ellipsis size={16} aria-hidden="true" />
      </button>
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {at && (
              <motion.div
                ref={menu}
                className="row-menu"
                role="menu"
                aria-label={`${row.ref} actions`}
                style={at}
                initial={
                  reduced ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98 }
                }
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.1 } }}
                transition={
                  reduced
                    ? { duration: motionTokens.duration.instant }
                    : motionTokens.spring.smooth
                }
              >
                {row.url && (
                  <a
                    className="ps-item"
                    role="menuitem"
                    href={row.url}
                    target="_blank"
                    rel="noopener"
                    onClick={() => setAt(null)}
                  >
                    <Ticket size={15} aria-hidden="true" />
                    Open ticket
                  </a>
                )}
                {row.pullRequest && (
                  <a
                    className="ps-item"
                    role="menuitem"
                    href={row.pullRequest.url}
                    target="_blank"
                    rel="noopener"
                    onClick={() => setAt(null)}
                  >
                    <GitPullRequest size={15} aria-hidden="true" />
                    Open pull request
                  </a>
                )}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
}
