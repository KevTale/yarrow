/**
 * The pull request's conversation: a member asks about the pull request,
 * the repository or the project's tickets, written on the dashboard, and an
 * agent answers. Yarrow pays for the answers (no sponsor, no ledger entry);
 * their tokens are kept to know what it costs.
 */

/** Who answers, and how hard it thinks: chat is quick back and forth. */
export const CHAT_MODEL = "claude-opus-5-5";
export const CHAT_EFFORT = "low";

/** Questions one person may ask in a day (UTC), every project together. */
export const CHAT_DAILY_QUESTIONS = 80;

/** Tool calls one answer may make before it must answer with what it has. */
export const CHAT_MAX_STEPS = 12;

/** What one answer used, as the provider counts it. */
export interface ChatUsage {
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** US dollars per million tokens, list price. */
const RATES: Record<
  string,
  { input: number; output: number; cacheRead: number; cacheWrite: number }
> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
};

/** What an answer cost Yarrow, in cents (fractions kept: most cost under one). */
export function chatCostCents(usage: ChatUsage): number {
  const rate = RATES[usage.model] ?? RATES[CHAT_MODEL]!;
  return (
    (usage.input * rate.input +
      usage.output * rate.output +
      usage.cacheRead * rate.cacheRead +
      usage.cacheWrite * rate.cacheWrite) /
    10_000
  );
}

export const addUsage = (a: ChatUsage, b: ChatUsage): ChatUsage => ({
  model: a.model,
  input: a.input + b.input,
  output: a.output + b.output,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite,
});

/** The start of the day the cap counts in (UTC). */
export function chatDayStart(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

/**
 * A moment of the presentation, as the agent writes it: `[at 0:56]`. The
 * dashboard turns it into a button that takes the film there.
 */
const MOMENT = /\[at (\d{1,2}):([0-5]\d)\]/g;

export type ChatPart =
  | { kind: "text"; text: string }
  | { kind: "moment"; ms: number; label: string };

export function chatParts(text: string): ChatPart[] {
  const parts: ChatPart[] = [];
  let last = 0;
  for (const match of text.matchAll(MOMENT)) {
    if (match.index > last)
      parts.push({ kind: "text", text: text.slice(last, match.index) });
    const minutes = Number(match[1]);
    const seconds = Number(match[2]);
    parts.push({
      kind: "moment",
      ms: (minutes * 60 + seconds) * 1000,
      label: `${minutes}:${match[2]}`,
    });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ kind: "text", text: text.slice(last) });
  return parts;
}

/** A film's clock, as the player shows it and the agent writes it. */
export const clockLabel = (ms: number) => {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};
