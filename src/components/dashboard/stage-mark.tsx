import type { TicketStage } from "@/core/tickets";

/** The five petals of Yarrow's flower, around its heart. */
const PETALS = [0, 1, 2, 3, 4].map((index) => {
  const angle = ((-90 + index * 72) * Math.PI) / 180;
  return { cx: 8 + 5.2 * Math.cos(angle), cy: 8 + 5.2 * Math.sin(angle) };
});

/**
 * A group's mark, drawn from Yarrow's flower rather than the usual circles:
 * To do its outline, In progress three petals out of five, To review every
 * petal, Done the whole flower with its heart; Stopped its outline in red,
 * a bar at its heart.
 */
export function StageMark({ stage }: { stage: TicketStage }) {
  const filled =
    stage === "progress" ? 3 : stage === "review" || stage === "done" ? 5 : 0;
  return (
    <svg
      className={`tix-stage ${stage}`}
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      {PETALS.map((petal, index) => (
        <circle
          key={index}
          {...petal}
          r={index < filled ? 2.1 : 1.6}
          className={index < filled ? "full" : "bare"}
        />
      ))}
      {stage === "done" && <circle cx={8} cy={8} r={2.2} className="full" />}
      {stage === "stopped" && (
        <rect
          x={5.6}
          y={7.25}
          width={4.8}
          height={1.5}
          rx={0.75}
          className="full"
        />
      )}
    </svg>
  );
}
