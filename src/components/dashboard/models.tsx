import { useEffect, useRef, useState } from "react";
import { money } from "@/core/packs";
import { formatSeconds, formatTokens, type TicketModel } from "@/core/tickets";

/** Who wrote and who reviewed, with time, tokens and cost on hover or tap. */
export function ModelsCell({
  models,
  inline = false,
}: {
  models: TicketModel[];
  /** On one line, as in the landing's board meta. */
  inline?: boolean;
}) {
  if (models.length === 0) return null;
  return (
    <span className={`md-models ${inline ? "inline" : ""}`}>
      {models.map((model) => (
        <ModelChip key={model.role} model={model} />
      ))}
    </span>
  );
}

/** Estimated popover height, to open it upward near the bottom of the screen. */
const POP_HEIGHT = 130;

function ModelChip({ model }: { model: TicketModel }) {
  const chip = useRef<HTMLSpanElement>(null);
  // Fixed coordinates: the popover escapes scrolling boxes (the landing lists).
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const known =
    model.seconds !== null ||
    model.costCents !== null ||
    model.inputTokens !== null;

  const show = () => {
    const rect = chip.current?.getBoundingClientRect();
    if (!rect) return;
    const below = rect.bottom + 6 + POP_HEIGHT < window.innerHeight;
    setAt({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 250)),
      top: below ? rect.bottom + 6 : rect.top - 6 - POP_HEIGHT,
    });
  };

  useEffect(() => {
    if (!at) return;
    const hide = () => setAt(null);
    window.addEventListener("scroll", hide, { capture: true, once: true });
    return () => window.removeEventListener("scroll", hide, { capture: true });
  }, [at]);

  const label = (
    <>
      {model.name}
      {model.effort && <i>{model.effort}</i>}
    </>
  );
  return (
    <span
      ref={chip}
      className={`md-model ${model.role} ${model.active ? "active" : ""}`}
      onMouseEnter={known ? show : undefined}
      onMouseLeave={() => setAt(null)}
    >
      {known ? (
        <button
          type="button"
          className="md-name"
          aria-expanded={at !== null}
          onClick={() => (at ? setAt(null) : show())}
          onFocus={show}
          onBlur={() => setAt(null)}
        >
          {label}
        </button>
      ) : (
        <span className="md-name">{label}</span>
      )}
      {known && at && (
        <span
          className="md-pop"
          role="tooltip"
          style={{ left: at.left, top: at.top }}
        >
          <b>
            {model.name}
            {model.effort && <i>{model.effort}</i>}
          </b>
          {model.seconds !== null && (
            <span>
              <em>{model.role === "implementer" ? "Writing" : "Reviewing"}</em>
              {model.secondsExact ? "" : "≈ "}
              {formatSeconds(model.seconds)}
            </span>
          )}
          {model.inputTokens !== null && (
            <span>
              <em>Tokens</em>
              {formatTokens(model.inputTokens)} in
              {model.cachedInputTokens
                ? ` (${formatTokens(model.cachedInputTokens)} cached)`
                : ""}{" "}
              · {formatTokens(model.outputTokens ?? 0)} out
            </span>
          )}
          {model.costCents !== null && (
            <span>
              <em>Cost</em>
              {model.costExact ? "" : "≈ "}
              {money(model.costCents)}
            </span>
          )}
        </span>
      )}
    </span>
  );
}
