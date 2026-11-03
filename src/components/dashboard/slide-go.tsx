import {
  animate,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useTransform,
} from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/navigation-feedback";

const KNOB = 24;
/** How far the knob must go, of its run, for the slide to count. */
const THRESHOLD = 0.8;

/**
 * Start, Retry and Merge: a lever pulled to the right, the confirmation and
 * the act in one gesture (decided 2026-10-27, replacing a second click). A
 * slide short of the end springs back; a click only nudges the knob, to
 * show it slides. Enter or Space on the focused lever does it at once.
 */
export function SlideGo({
  label,
  prompt = label,
  icon,
  tone = "amber",
  busy = false,
  disabled = false,
  onGo,
}: {
  /** The act, a word: "Start", "Retry", "Merge". */
  label: string;
  /** What the track says, when more than the word. */
  prompt?: string;
  icon: React.ReactNode;
  tone?: "amber" | "dark";
  /** The act is under way: the knob stays at the end, spinning. */
  busy?: boolean;
  disabled?: boolean;
  /** Done when it settles: the lever comes back unless it is busy. */
  onGo: () => unknown;
}) {
  const reduced = useReducedMotion();
  const track = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLButtonElement>(null);
  const [run, setRun] = useState(0);
  const [armed, setArmed] = useState(false);
  const x = useMotionValue(0);
  // Lit once far enough that letting go does it.
  useMotionValueEvent(x, "change", (value) =>
    setArmed(run > 0 && value >= run * THRESHOLD),
  );
  const fill = useTransform(x, (value) => value + KNOB);
  const fade = useTransform(x, [0, Math.max(run, 1) * 0.6], [1, 0]);

  useEffect(() => {
    const element = track.current;
    if (!element) return;
    const measure = () =>
      setRun(
        element.clientWidth -
          (knob.current?.offsetWidth ?? KNOB) -
          2 * parseFloat(getComputedStyle(element).paddingLeft),
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  function go() {
    if (disabled || busy) return;
    animate(
      x,
      run,
      reduced
        ? { duration: 0 }
        : { type: "spring", stiffness: 600, damping: 32 },
    );
    navigator.vibrate?.(12);
    // Back to the start once the act is over: the row changes, or it
    // failed and says so beside it.
    void Promise.resolve(onGo())
      .catch(() => undefined)
      .then(() =>
        animate(x, 0, { type: "spring", stiffness: 500, damping: 34 }),
      );
  }

  return (
    <div
      ref={track}
      className={`tix-go tix-slide ${tone} ${armed ? "armed" : ""} ${busy ? "busy" : ""}`}
      aria-disabled={disabled || undefined}
    >
      <motion.span className="tix-slide-fill" style={{ width: fill }} />
      <motion.span className="tix-slide-label" style={{ opacity: fade }}>
        {prompt}
        <span className="tix-slide-hint" aria-hidden="true">
          ›››
        </span>
      </motion.span>
      <motion.button
        ref={knob}
        type="button"
        className="tix-slide-knob"
        aria-label={`Slide to ${label.toLowerCase()}`}
        data-tip={`Slide to ${label.toLowerCase()}`}
        disabled={disabled}
        aria-busy={busy}
        drag={disabled || busy ? false : "x"}
        dragConstraints={{ left: 0, right: run }}
        dragElastic={0.04}
        dragMomentum={false}
        style={{ x }}
        whileTap={{ scale: 0.94 }}
        onDragEnd={() => {
          if (x.get() >= run * THRESHOLD) go();
          else animate(x, 0, { type: "spring", stiffness: 500, damping: 30 });
        }}
        onClick={() => {
          // A click shows the way: the knob hops and comes back.
          if (busy || disabled || x.get() > 2 || reduced) return;
          animate(x, [0, Math.min(18, run), 0], { duration: 0.45 });
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          go();
        }}
      >
        {busy ? <Spinner /> : icon}
      </motion.button>
    </div>
  );
}
