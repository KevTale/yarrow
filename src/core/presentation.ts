import { z } from "zod";

/**
 * The presentation of a pull request: the agent's screen, recorded in the
 * sandbox one chapter at a time, with its voice over it. The brain voices
 * each chapter and stores this timeline; the player reads it.
 */

/**
 * Speech rate the recorder pads each chapter to before the voice exists:
 * the voice speaks about 3.3 words a second (measured on the first desktop
 * presentations), a little slower here so the film rarely runs short.
 */
const WORDS_PER_SECOND = 3.1;

export function estimateSpeechMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.round((words / WORDS_PER_SECOND) * 1000) + 600;
}

/** One subtitle: at most two short lines, each word shown as it is said. */
export const cueSchema = z.object({
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  text: z.string(),
  /** When each word starts; none without a voice: the cue shows whole. */
  words: z
    .array(
      z.object({ startMs: z.number().int().nonnegative(), text: z.string() }),
    )
    .default([]),
});
export type Cue = z.infer<typeof cueSchema>;

const boxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

const loose = z
  .union([z.string(), z.number()])
  .transform(String)
  .pipe(z.string().max(2000));

/** One of the plan's actions, as the recorder plays it (src/runner/recorder). */
export const liveActionSchema = z.object({
  do: z.enum([
    "point",
    "circle",
    "hover",
    "click",
    "fill",
    "type",
    "press",
    "select",
    "scroll",
    "goto",
    "reload",
    "wait",
  ]),
  target: z.string().max(500).optional(),
  text: loose.optional(),
  value: loose.optional(),
  key: z.string().max(100).optional(),
  path: z.string().max(500).optional(),
  y: z.number().optional(),
  ms: z.number().optional(),
});
export type LiveAction = z.infer<typeof liveActionSchema>;

/** A chapter as the agent planned it: what the stage plays live (workers/stage.ts). */
export const liveChapterSchema = z.object({
  app: z.enum(["before", "after"]),
  path: z.string().max(500).nullable(),
  actions: z.array(liveActionSchema).max(40),
  command: z.string().max(2000).nullable(),
  cwd: z.string().max(500).nullable(),
  before: z.boolean(),
});
export type LiveChapter = z.infer<typeof liveChapterSchema>;

/** Where the plan's apps answered: the app as it is, and as it was. */
export const presentationAppsSchema = z.object({
  before: z.string().max(500).nullable(),
  after: z.string().max(500).nullable(),
});

export const presentationChapterSchema = z.object({
  title: z.string().min(1).max(80),
  tab: z.enum(["app", "ticket", "terminal"]),
  /** What the address bar shows: the page, the ticket, the command. */
  url: z.string().max(500).nullable(),
  /** The page's title, for the app's tab. */
  page: z.string().max(120).nullable().default(null),
  /** The app as it was before the change. */
  before: z.boolean().default(false),
  /** How long it still shows the app as it was, until its tab is clicked. */
  beforeMs: z.number().int().nonnegative().default(0),
  /** Filmed on the agent's desktop: the clip is the whole screen, windows and dock. */
  desktop: z.boolean().default(false),
  say: z.string().max(2000),
  /** The clip, from startMs (the page loaded) for durationMs. */
  video: z
    .object({
      key: z.string(),
      startMs: z.number().int().nonnegative(),
      durationMs: z.number().int().positive(),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    })
    .nullable(),
  audio: z
    .object({ key: z.string(), durationMs: z.number().int().positive() })
    .nullable(),
  cues: z.array(cueSchema),
  /** Where the agent pointed and clicked, from the chapter's start. */
  marks: z
    .array(
      z.object({
        atMs: z.number().int().nonnegative(),
        kind: z.enum(["point", "click", "type"]),
        box: boxSchema,
      }),
    )
    .default([]),
  /** Where the address bar went while it played (a link, a filter in the address). */
  urls: z
    .array(
      z.object({
        atMs: z.number().int().nonnegative(),
        url: z.string().max(500),
      }),
    )
    .max(50)
    .default([]),
  /** None for a ticket, a phone or a given output, and before 2026-10-28. */
  live: liveChapterSchema.nullable().default(null),
});
export type PresentationChapter = z.infer<typeof presentationChapterSchema>;

export const presentationSchema = z.object({
  version: z.literal(1),
  title: z.string().min(1).max(200),
  language: z.string().default("en"),
  /** Who spoke it: a live talk later uses the same voice. */
  voice: z
    .object({
      provider: z.string(),
      voice: z.string(),
      model: z.string().nullable(),
    })
    .nullable(),
  ticket: z.object({
    source: z.string(),
    title: z.string(),
    url: z.string(),
  }),
  poster: z.string().nullable(),
  apps: presentationAppsSchema.nullable().default(null),
  chapters: z.array(presentationChapterSchema).min(1).max(12),
});
export type Presentation = z.infer<typeof presentationSchema>;

/** After the last word, before the next chapter. */
const PAUSE_MS = 450;
/** What the last click or command shows, given time to show. */
const SETTLE_MS = 1500;

/**
 * A chapter lasts as long as its voice, and its clip until the last thing
 * done has shown: the clip was filmed to a guess at how long the words
 * take, and the seconds past them were silence. Without a voice, the
 * longer of the clip and the guess.
 */
export function chapterMs(chapter: PresentationChapter): number {
  const clip = chapter.video?.durationMs ?? 0;
  const voice = chapter.audio?.durationMs ?? 0;
  if (!voice) return clip || estimateSpeechMs(chapter.say);
  const last = chapter.marks.at(-1)?.atMs;
  const shown = Math.max(
    voice + PAUSE_MS,
    last === undefined ? 0 : last + SETTLE_MS,
  );
  return Math.max(voice, Math.min(clip, shown));
}

/** What the address bar shows at `ms`: the page loaded, then where it went. */
export function urlAt(chapter: PresentationChapter, ms: number): string | null {
  let url = chapter.url;
  for (const step of chapter.urls) if (step.atMs <= ms) url = step.url;
  return url;
}

/**
 * The chapter the poster was taken in, as the recorder picks it: the app
 * after the change, else its proof run, else the first chapter.
 */
export function posterChapter(timeline: Presentation): PresentationChapter {
  const { chapters } = timeline;
  return (
    chapters.find((chapter) => chapter.tab === "app" && !chapter.before) ??
    chapters.find((chapter) => chapter.tab === "terminal" && !chapter.before) ??
    chapters[0]!
  );
}

/** Per character, as text-to-speech providers report it, in seconds. */
export interface Alignment {
  characters: string[];
  starts: number[];
  ends: number[];
}

const CUE_CHARS = 84;
// An ellipsis is a beat inside the sentence, not its end.
const SENTENCE_END = /(?<!\.\.)[.!?]["')]?$/;
const PAUSE = /[,;:…]["')]?$|\.\.\.$|^[—–]$/;

const textLength = (words: { text: string }[]) =>
  words.reduce((sum, word, i) => sum + word.text.length + (i ? 1 : 0), 0);

/**
 * A sentence too long for one subtitle, in parts of about equal length,
 * cut where the voice pauses when it can.
 */
function split<T extends { text: string }>(words: T[]): T[][] {
  const total = textLength(words);
  if (total <= CUE_CHARS || words.length < 2) return [words];
  const target = total / Math.ceil(total / CUE_CHARS);
  let cut = 1;
  let best = Infinity;
  for (let i = 1; i < words.length; i++) {
    const left = textLength(words.slice(0, i));
    if (left > CUE_CHARS) break;
    const score =
      Math.abs(left - target) -
      (PAUSE.test(words[i - 1]!.text) ? CUE_CHARS / 3 : 0);
    if (score < best) {
      best = score;
      cut = i;
    }
  }
  return [words.slice(0, cut), ...split(words.slice(cut))];
}

/** Words grouped into subtitles: a sentence each, a short one joining the one before. */
function group<T extends { text: string }>(words: T[]): T[][] {
  const sentences: T[][] = [];
  let current: T[] = [];
  for (const word of words) {
    current.push(word);
    if (SENTENCE_END.test(word.text)) {
      sentences.push(current);
      current = [];
    }
  }
  if (current.length) sentences.push(current);
  const cues: T[][] = [];
  for (const sentence of sentences) {
    const last = cues.at(-1);
    if (
      last &&
      textLength(sentence) < 24 &&
      SENTENCE_END.test(last.at(-1)!.text) &&
      textLength(last) + 1 + textLength(sentence) <= CUE_CHARS
    )
      last.push(...sentence);
    else cues.push(...split(sentence));
  }
  return cues;
}

/** Delivery tags ("[warm]") are spoken as tone, never shown. */
const stripTags = (text: string) =>
  text
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export function cuesFromAlignment(alignment: Alignment): Cue[] {
  const words: { text: string; start: number; end: number }[] = [];
  let word: { text: string; start: number; end: number } | null = null;
  let tag = false;
  for (const [i, character] of alignment.characters.entries()) {
    if (character === "[") tag = true;
    if (tag) {
      if (character === "]") tag = false;
      continue;
    }
    if (/\s/.test(character)) {
      if (word) words.push(word);
      word = null;
      continue;
    }
    const start = alignment.starts[i] ?? 0;
    const end = alignment.ends[i] ?? start;
    if (word) {
      word.text += character;
      word.end = end;
    } else word = { text: character, start, end };
  }
  if (word) words.push(word);
  return group(words).map((cue) => ({
    startMs: Math.round(cue[0]!.start * 1000),
    endMs: Math.round(cue.at(-1)!.end * 1000),
    text: cue.map((w) => w.text).join(" "),
    words: cue.map((w) => ({
      startMs: Math.round(w.start * 1000),
      text: w.text,
    })),
  }));
}

/** Without a voice: the same subtitles, spread over the chapter by length. */
export function estimatedCues(text: string, durationMs: number): Cue[] {
  const cues = group(
    stripTags(text)
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => ({ text: w })),
  ).map((cue) => cue.map((w) => w.text).join(" "));
  const total = cues.reduce((sum, cue) => sum + cue.length, 0) || 1;
  let at = 0;
  return cues.map((cue) => {
    const length = Math.round((cue.length / total) * durationMs);
    const result = { startMs: at, endMs: at + length, text: cue, words: [] };
    at += length;
    return result;
  });
}

/** The subtitle on screen at `ms`: the last one started, so none flickers. */
export function cueAt(cues: Cue[], ms: number): Cue | null {
  let shown: Cue | null = null;
  for (const cue of cues) if (cue.startMs <= ms) shown = cue;
  return shown;
}

/** How many of the cue's words are said at `ms`: all of a cue without word times. */
export function wordsSaid(cue: Cue, ms: number): number {
  if (cue.words.length === 0) return Infinity;
  return cue.words.filter((word) => word.startMs <= ms).length;
}
