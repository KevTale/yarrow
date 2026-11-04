import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { motionTokens } from "@/components/arc/lib/motion-tokens";

/** What opens in the list opens at once, the rows under it making way. */
function useFold() {
  const reduced = useReducedMotion();
  return {
    initial: reduced ? { opacity: 0 } : { height: 0, opacity: 0 },
    animate: { height: "auto", opacity: 1 },
    exit: reduced ? { opacity: 0 } : { height: 0, opacity: 0 },
    transition: { duration: 0.1, ease: motionTokens.ease.standard },
  };
}

/** A ticket's content, under its row. */
export function OpenRow({
  open,
  children,
}: {
  open: boolean;
  children: ReactNode;
}) {
  const fold = useFold();
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div className="tix-opened" {...fold}>
          <div className="tix-card">{children}</div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * A group's rows, under its head. It folds on the member's word; a ticket
 * leaving it empty, or arriving first, changes it at once, the list sliding
 * for that from where it stood.
 */
export function GroupRows({
  open,
  empty,
  children,
}: {
  open: boolean;
  empty: boolean;
  children: ReactNode;
}) {
  const fold = useFold();
  if (empty) return null;
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.ul className="tix-rows" {...fold}>
          {children}
        </motion.ul>
      )}
    </AnimatePresence>
  );
}
