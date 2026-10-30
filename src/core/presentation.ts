import { z } from "zod";
import { modelDisplayName, type PipelineRoles } from "./pipeline";

/**
 * The presentation of a pull request: the agent's screen, recorded in the
 * sandbox one chapter at a time, with its voice over it. The brain voices
 * each chapter and stores this timeline; the player reads it.
 */

/** Speech rate the recorder pads each chapter to before the voice exists. */
const WORDS_PER_SECOND = 2.6;

export function estimateSpeechMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.round((words / WORDS_PER_SECOND) * 1000) + 600;
}

/** One subtitle: at most two short lines. */
export const cueSchema = z.object({
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  text: z.string(),
});
export type Cue = z.infer<typeof cueSchema>;

const boxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
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
  chapters: z.array(presentationChapterSchema).min(1).max(12),
});
export type Presentation = z.infer<typeof presentationSchema>;

/** A chapter lasts as long as its clip or its voice, whichever is longer. */
export function chapterMs(chapter: PresentationChapter): number {
  const media = Math.max(
    chapter.video?.durationMs ?? 0,
    chapter.audio?.durationMs ?? 0,
  );
  return media || estimateSpeechMs(chapter.say);
}

/** Per character, as text-to-speech providers report it, in seconds. */
export interface Alignment {
  characters: string[];
  starts: number[];
  ends: number[];
}

const CUE_CHARS = 84;

/** Words grouped into subtitles that end at a sentence when they can. */
function group<T extends { text: string }>(words: T[]): T[][] {
  const cues: T[][] = [];
  let current: T[] = [];
  let length = 0;
  for (const word of words) {
    if (current.length && length + 1 + word.text.length > CUE_CHARS) {
      cues.push(current);
      current = [];
      length = 0;
    }
    current.push(word);
    length += (length ? 1 : 0) + word.text.length;
    if (/[.!?]["')]?$/.test(word.text) && length > 24) {
      cues.push(current);
      current = [];
      length = 0;
    }
  }
  if (current.length) cues.push(current);
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
    const result = { startMs: at, endMs: at + length, text: cue };
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

/**
 * Who did the work, spoken at the end: the agent's own closing says what
 * was checked and what was not. Never "ready to merge": the owner decides.
 */
export function closingCredits(input: {
  roles: PipelineRoles;
  review: { approved: boolean; rounds: number } | null;
}): string {
  const implementer = modelDisplayName(input.roles.implementer);
  const reviewer = modelDisplayName(input.roles.reviewer);
  if (!input.review) return `Written by ${implementer}.`;
  if (!input.review.approved)
    return `Written by ${implementer} and reviewed by ${reviewer}, whose remaining concerns are in the review.`;
  return input.review.rounds > 1
    ? `Written by ${implementer} and reviewed by ${reviewer}, who approved it after one fix round.`
    : `Written by ${implementer} and reviewed by ${reviewer}, who approved it.`;
}
