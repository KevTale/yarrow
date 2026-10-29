/** Minutes in a UTC day: a daily funding's window lies within one. */
export const MINUTES_PER_DAY = 1440;

/** The window a new daily funding lands in: the first half hour of the day. */
export const DEFAULT_WINDOW = { start: 0, end: 30 } as const;

/**
 * The minute of the UTC day a daily funding lands, drawn in its window:
 * a new draw each day, the same draw at every tick of that day, so the
 * credits do not all arrive at once and nothing needs storing.
 */
export function fundingMinute(
  userId: string,
  day: string,
  window: { start: number; end: number },
): number {
  let hash = 0x811c9dc5;
  for (const char of `${userId}:${day}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return window.start + (hash % (window.end - window.start + 1));
}

/**
 * How a new daily funding starts: credited today at once, or left to the
 * cron, at its minute.
 */
export type FundingStart = "now" | "scheduled";

/**
 * A funding scheduled after today's minute went by starts tomorrow: a
 * credit never lands outside its window. `at` is today's minute.
 */
export function startsTomorrow(createdAt: Date, now: Date, at: number) {
  const day = (date: Date) => date.toISOString().slice(0, 10);
  if (day(createdAt) !== day(now)) return false;
  return createdAt.getUTCHours() * 60 + createdAt.getUTCMinutes() > at;
}

/** 450 → "07:30". */
export function clock(minutes: number): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** "07:30" → 450; null for anything that is not a time of day. */
export function parseClock(text: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}
