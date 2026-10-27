import { motion, useReducedMotion } from "motion/react";
import { useId, useRef, useState, type ReactNode } from "react";
import { motionTokens } from "./arc/lib/motion-tokens";

export interface SegmentedItem<T extends string> {
  value: T;
  label: ReactNode;
  /** A figure after the label, such as a total or a count. */
  extra?: ReactNode;
}

/**
 * uiarc's button group, for a choice among a few: segments joined on one
 * surface under a hairline, nearly a pill, a hairline between them; one
 * soft fill rests on the chosen segment and is handed (motion's shared
 * layout) to the segment under the pointer, and back when it leaves; a
 * press dips the label. Arrow keys, Home and End move the choice; only the
 * chosen segment is in the tab order.
 *
 * `kind` sets the semantics: tabs (`aria-selected`), radios
 * (`aria-checked`), or toggles (`aria-pressed`, where `value` may be null:
 * nothing chosen, no fill at rest).
 */
export function Segmented<T extends string>({
  items,
  value,
  onChange,
  label,
  kind = "tabs",
  className,
}: {
  items: SegmentedItem<T>[];
  value: T | null;
  onChange: (value: T) => void;
  label: string;
  kind?: "tabs" | "radio" | "pressed";
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const fill = useId();
  const [hover, setHover] = useState<T | null>(null);
  const active = hover ?? value;
  const keys = items.map((item) => item.value);
  const at = active === null ? -1 : keys.indexOf(active);
  const move = (event: React.KeyboardEvent) => {
    const last = keys.length - 1;
    const index = value === null ? -1 : keys.indexOf(value);
    const next =
      event.key === "ArrowRight"
        ? index >= last
          ? 0
          : index + 1
        : event.key === "ArrowLeft"
          ? index <= 0
            ? last
            : index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : -1;
    if (next < 0) return;
    event.preventDefault();
    onChange(keys[next]!);
    root.current
      ?.querySelector<HTMLElement>(`[data-key="${keys[next]}"]`)
      ?.focus();
  };
  const state = (chosen: boolean) =>
    kind === "tabs"
      ? { role: "tab", "aria-selected": chosen }
      : kind === "radio"
        ? { role: "radio", "aria-checked": chosen }
        : { "aria-pressed": chosen };
  return (
    <div
      className={["seg", className].filter(Boolean).join(" ")}
      role={
        kind === "tabs" ? "tablist" : kind === "radio" ? "radiogroup" : "group"
      }
      aria-label={label}
      ref={root}
      onPointerMove={(event) => {
        // Touch has no hover: the fill follows the choice alone.
        if (event.pointerType === "touch") return;
        const segment = (event.target as HTMLElement).closest<HTMLElement>(
          "[data-key]",
        );
        setHover(segment ? (segment.dataset.key as T) : null);
      }}
      onPointerLeave={() => setHover(null)}
      onKeyDown={move}
    >
      {items.map((item, index) => {
        const chosen = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            data-key={item.value}
            data-chosen={chosen || undefined}
            // The hairline steps aside where the fill arrives.
            data-quiet={
              at >= 0 && (index === at || index === at + 1) ? "" : undefined
            }
            tabIndex={chosen || (value === null && index === 0) ? 0 : -1}
            {...state(chosen)}
            onClick={() => onChange(item.value)}
          >
            {item.value === active && (
              <motion.span
                layoutId={fill}
                className="seg-fill"
                aria-hidden="true"
                // Set here, motion keeps the corners round through the
                // stretch: the frame's 17px less the 3px inset and border.
                style={{ borderRadius: 13 }}
                transition={
                  reduced ? { duration: 0 } : motionTokens.spring.morph
                }
              />
            )}
            <span className="seg-content">
              {item.label}
              {item.extra !== undefined && (
                <span className="seg-extra">{item.extra}</span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
