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

/** The most of an answer read aloud: the thread keeps the rest. */
const SPOKEN_CHARS = 1500;

/** An answer as it is said: its words, without what only reads. */
export function spokenAnswer(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[at \d{1,2}:[0-5]\d\]/g, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*#>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SPOKEN_CHARS);
}

/** An answer that is read, not heard: what it shows only the eye can follow. */
export function answerToRead(body: string, card: unknown): boolean {
  return (
    Boolean(card) ||
    body.length > SPOKEN_CHARS ||
    /```|^\s*(?:[-*]|\d+\.)\s/m.test(body)
  );
}

/** A ticket the agent proposes in the conversation, created only from its card. */
export interface ChatTicket {
  title: string;
  body: string;
  /** The suggested ticket it comes from, which then leaves that list. */
  note?: string;
}

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
  // The live call's other voices (src/runner/talk-models.ts).
  "claude-opus-5-5:fast": {
    input: 8,
    output: 40,
    cacheRead: 0.4,
    cacheWrite: 10,
  },
  "claude-sonnet-5-5": {
    input: 2,
    output: 10,
    cacheRead: 0.2,
    cacheWrite: 2.5,
  },
  "claude-haiku-5-5": {
    input: 0.1,
    output: 0.5,
    cacheRead: 0.01,
    cacheWrite: 0.125,
  },
  "muse-wonder-1.0": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 4 },
  "muse-spark-1.3": {
    input: 1.25,
    output: 4.25,
    cacheRead: 0.15,
    cacheWrite: 1.25,
  },
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
