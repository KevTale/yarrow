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
 * Target status per event (its id in the tracker); null: don't move.
 * "stopped" may be missing from moves saved before it existed.
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
    // Where an abandoned ticket goes is the builder's call.
    stopped: null,
  };
}
