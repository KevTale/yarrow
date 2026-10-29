import { useServerFn } from "@tanstack/react-start";
import {
  CircleSlash,
  Ellipsis,
  GitPullRequest,
  GitPullRequestClosed,
  Ticket,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motionTokens } from "@/components/arc/lib/motion-tokens";
import { Spinner } from "@/components/navigation-feedback";
import type { TicketRow } from "@/core/tickets";
import {
  closePullRequestFn,
  closeTicketFn,
} from "@/functions/builder.functions";

/** Where a ticket can be closed from: never while the agents work on it. */
const closable = (row: TicketRow) =>
  !row.pending &&
  ["none", "queued", "abstained", "pull_request"].includes(row.status);

/**
 * "…" in a ticket's gutter, under the pointer and while the row is open:
 * where else the ticket lives (its tracker, its pull request), and closing
 * it or its pull request, each asked twice. The menu is drawn over the
 * page, since the groups clip what leaves them.
 */
export function RowMenu({
  row,
  projectId,
  onChanged,
}: {
  row: TicketRow;
  projectId: string;
  onChanged: () => void;
}) {
  const reduced = useReducedMotion();
  const closeTicket = useServerFn(closeTicketFn);
  const closePull = useServerFn(closePullRequestFn);
  // The close asked once, waiting for its second click; then at work.
  const [armed, setArmed] = useState<"ticket" | "pull" | null>(null);
  const [pending, setPending] = useState<"ticket" | "pull" | null>(null);
  const [error, setError] = useState("");
  const [at, setAt] = useState<
    { left: number; top: number } | { left: number; bottom: number } | null
  >(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const open = at !== null;

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(null), 4000);
    return () => clearTimeout(timer);
  }, [armed]);

  async function confirm(kind: "ticket" | "pull") {
    if (pending) return;
    if (armed !== kind) {
      setError("");
      return setArmed(kind);
    }
    setArmed(null);
    setPending(kind);
    try {
      const data = { projectId, key: row.key };
      const result =
        kind === "ticket"
          ? await closeTicket({ data })
          : await closePull({ data });
      if (result.ok) {
        setAt(null);
        onChanged();
      } else setError(result.error);
    } catch {
      setError("That did not go through. Try again.");
    } finally {
      setPending(null);
    }
  }

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
    setArmed(null);
    setError("");
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
                {closable(row) && <span className="ps-sep" />}
                {row.status === "pull_request" && row.pullRequest && (
                  <button
                    type="button"
                    className={`ps-item danger ${armed === "pull" ? "armed" : ""}`}
                    role="menuitem"
                    aria-disabled={pending !== null}
                    onClick={() => void confirm("pull")}
                  >
                    {pending === "pull" ? (
                      <Spinner />
                    ) : (
                      <GitPullRequestClosed size={15} aria-hidden="true" />
                    )}
                    {armed === "pull" ? "Confirm close?" : "Close pull request"}
                  </button>
                )}
                {closable(row) && (
                  <button
                    type="button"
                    className={`ps-item danger ${armed === "ticket" ? "armed" : ""}`}
                    role="menuitem"
                    aria-disabled={pending !== null}
                    onClick={() => void confirm("ticket")}
                  >
                    {pending === "ticket" ? (
                      <Spinner />
                    ) : (
                      <CircleSlash size={15} aria-hidden="true" />
                    )}
                    {armed === "ticket" ? "Confirm close?" : "Close ticket"}
                  </button>
                )}
                {error && (
                  <p className="row-menu-error" role="alert">
                    {error}
                  </p>
                )}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
}
