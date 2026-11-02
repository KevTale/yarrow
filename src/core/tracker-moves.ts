/**
 * Moving a tracker ticket across its board as Yarrow works. Columns follow
 * statuses, which every team names its own way; each status belongs to one
 * of three fixed categories, used only to propose the defaults.
 */
export type MoveEvent = "started" | "pullRequest" | "merged" | "stopped";
export const moveEvents: MoveEvent[] = [
  "started",
  "pullRequest",
  "merged",
  "stopped",
];

/**
 * Yarrow stopped: the ticket goes back to the status it had before Yarrow
 * moved it on starting (decided 2026-10-28), unless the builder chose a
 * status or "Don't move". Nothing moves when Yarrow did not move it.
 */
export const BACK = "back";

/**
 * Target status per event (its id in the tracker), or BACK for "stopped";
 * null: don't move. "stopped" may be missing from moves saved before it
 * existed: it is then BACK.
 */
export type TicketMoves = Record<
  Exclude<MoveEvent, "stopped">,
  string | null
> & {
  stopped?: string | null;
};

export interface TrackerStatus {
  id: string;
  name: string;
  category: "todo" | "progress" | "done";
}

export const categoryRank: Record<TrackerStatus["category"], number> = {
  todo: 0,
  progress: 1,
  done: 2,
};

const reviewName = /review|revue|revisi|relecture|qa\b|test|validat/i;

/**
 * What a builder sees before choosing: started → the first "in progress"
 * status that is not a review; pull request → a review status if there is
 * one; merged → don't move (many teams close tickets after shipping).
 */
export function defaultMoves(statuses: TrackerStatus[]): TicketMoves {
  const progress = statuses.filter((status) => status.category === "progress");
  const review = progress.find((status) => reviewName.test(status.name));
  const started = progress.find((status) => status !== review);
  return {
    started: started?.id ?? null,
    pullRequest: review?.id ?? null,
    merged: null,
    stopped: BACK,
  };
}

/** The builder's moves, or the defaults; "stopped" filled in when missing. */
export const movesOf = (
  saved: TicketMoves | null,
  statuses: TrackerStatus[],
): TicketMoves =>
  saved ? { stopped: BACK, ...saved } : defaultMoves(statuses);
