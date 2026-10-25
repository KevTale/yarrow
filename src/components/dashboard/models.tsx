import { useState } from "react";
import { money } from "@/core/packs";
import { formatSeconds, formatTokens, type TicketModel } from "@/core/tickets";

/** Who wrote and who reviewed, with time, tokens and cost on hover or tap. */
export function ModelsCell({ models }: { models: TicketModel[] }) {
  if (models.length === 0) return null;
  return (
    <span className="md-models">
      {models.map((model) => (
        <ModelChip key={model.role} model={model} />
      ))}
    </span>
  );
}

function ModelChip({ model }: { model: TicketModel }) {
  const [open, setOpen] = useState(false);
  const known =
    model.seconds !== null ||
    model.costCents !== null ||
    model.inputTokens !== null;
  const label = (
    <>
      {model.name}
      {model.effort && <i>{model.effort}</i>}
    </>
  );
  return (
    <span
      className={`md-model ${model.role} ${model.active ? "active" : ""} ${open ? "open" : ""}`}
      onMouseLeave={() => setOpen(false)}
    >
      {known ? (
        <button
          type="button"
          className="md-name"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {label}
        </button>
      ) : (
        <span className="md-name">{label}</span>
      )}
      {known && (
        <span className="md-pop" role="tooltip">
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
