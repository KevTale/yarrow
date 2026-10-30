import { z } from "zod";
import {
  estimatedCues,
  presentationSchema,
  type Presentation,
  type PresentationChapter,
} from "../core/presentation";
import type { StoredArtifact } from "../core/review";
import type { ManagedAgentsClient, SessionFile } from "./anthropic";
import type { EvidenceStore } from "./pipeline";
import type { VoiceProvider } from "./voice/index";

/** Where each implementer session finds the recorder (src/runner/recorder). */
export const RECORDER_MOUNT = "/yarrow/present.mjs";
export const RECORDER_PATH = "/mnt/session/uploads/yarrow/present.mjs";

const clipped = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .transform((text) => text.slice(0, max));

/** What the recorder writes: presentation/presentation.json and its files. */
export const recordedSchema = z.object({
  version: z.literal(1),
  title: clipped(200),
  ticket: z.object({
    source: z.string().default("ticket"),
    title: z.string(),
    url: z.string().default(""),
  }),
  poster: z.string().nullable().default(null),
  chapters: z
    .array(
      z.object({
        title: clipped(80),
        tab: z.enum(["app", "ticket", "terminal"]),
        url: z
          .string()
          .nullable()
          .default(null)
          .transform((url) => url?.slice(0, 500) ?? null),
        page: z
          .string()
          .nullable()
          .default(null)
          .transform((page) => page?.slice(0, 120) || null),
        before: z.boolean().default(false),
        say: clipped(2000),
        clip: z.string().min(1),
        startMs: z.number().nonnegative(),
        durationMs: z.number().positive(),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        marks: z
          .array(
            z.object({
              atMs: z.number().nonnegative(),
              kind: z.enum(["point", "click", "type"]),
              box: z.object({
                x: z.number(),
                y: z.number(),
                width: z.number(),
                height: z.number(),
              }),
            }),
          )
          .default([]),
        urls: z
          .array(z.object({ atMs: z.number().nonnegative(), url: z.string() }))
          .default([])
          .transform((urls) => urls.slice(0, 50)),
      }),
    )
    .min(1)
    .transform((chapters) => chapters.slice(0, 12)),
});

const basename = (name: string) => name.split("/").at(-1)!;

/** The newest session output with this name, wherever the agent put it. */
function newest(files: SessionFile[], name: string): SessionFile | undefined {
  const base = basename(name);
  return files
    .filter(
      (file) => file.filename === base || file.filename.endsWith(`/${base}`),
    )
    .at(-1);
}

/**
 * Copies the recorded presentation to the evidence store and voices it:
 * each chapter's words, the last one followed by the credits. Without a
 * voice (none configured, or it failed), the subtitles carry it alone.
 * Null when the session recorded none.
 */
export async function publishPresentation(
  deps: {
    anthropic: ManagedAgentsClient;
    evidence: EvidenceStore;
    voice: VoiceProvider | null;
  },
  input: {
    runId: string;
    sessionId: string;
    /** Spoken after the last chapter's words: who wrote and reviewed it. */
    closing: string;
    language?: string;
  },
): Promise<StoredArtifact | null> {
  const files = await deps.anthropic.listFiles(input.sessionId);
  const plan = newest(files, "presentation.json");
  if (!plan) return null;
  const recorded = recordedSchema.parse(
    JSON.parse(
      new TextDecoder().decode(await deps.anthropic.download(plan.id)),
    ),
  );
  const language = input.language ?? "en";
  const store = async (name: string, data: Uint8Array, contentType: string) => {
    const key = `runs/${input.runId}/${crypto.randomUUID().slice(0, 8)}-${basename(name).replace(/[^\w.-]/g, "-")}`;
    await deps.evidence.put(key, data, { httpMetadata: { contentType } });
    return key;
  };

  let voice = deps.voice;
  let voiced = false;
  // A chapter without its clip would show nothing: it is left out.
  const recordedChapters = recorded.chapters.flatMap((chapter) => {
    const clip = newest(files, chapter.clip);
    return clip ? [{ chapter, clip }] : [];
  });
  const lines = recordedChapters.map(({ chapter }, index) =>
    index === recordedChapters.length - 1
      ? `${chapter.say} ${input.closing}`
      : chapter.say,
  );
  const chapters: PresentationChapter[] = [];
  for (const [index, { chapter, clip }] of recordedChapters.entries()) {
    const videoKey = await store(
      chapter.clip,
      await deps.anthropic.download(clip.id),
      "video/webm",
    );
    const say = lines[index]!;
    let audio: PresentationChapter["audio"] = null;
    let cues: PresentationChapter["cues"] = [];
    if (voice) {
      try {
        const speech = await voice.speak({
          text: say,
          language,
          before: lines.slice(0, index).join(" ").slice(-1000),
          after: lines[index + 1],
        });
        audio = {
          key: await store(
            `${String(index + 1).padStart(2, "0")}.mp3`,
            speech.audio,
            speech.contentType,
          ),
          durationMs: speech.durationMs,
        };
        cues = speech.cues;
        voiced = true;
      } catch (error) {
        // Quota, outage: the rest goes on with subtitles only.
        console.warn("voice:", (error as Error).message);
        voice = null;
      }
    }
    const durationMs = Math.round(chapter.durationMs);
    if (cues.length === 0)
      cues = estimatedCues(say, Math.max(durationMs, audio?.durationMs ?? 0));
    chapters.push({
      title: chapter.title,
      tab: chapter.tab,
      url: chapter.url,
      page: chapter.page,
      before: chapter.before,
      say,
      video: {
        key: videoKey,
        startMs: Math.round(chapter.startMs),
        durationMs,
        width: chapter.width,
        height: chapter.height,
      },
      audio,
      cues,
      marks: chapter.marks.map((mark) => ({
        ...mark,
        atMs: Math.round(mark.atMs),
      })),
      urls: chapter.urls.map((step) => ({
        atMs: Math.round(step.atMs),
        url: step.url.slice(0, 500),
      })),
    });
  }
  if (chapters.length === 0) return null;

  const posterFile = recorded.poster ? newest(files, recorded.poster) : null;
  const poster = posterFile
    ? await store(
        recorded.poster!,
        await deps.anthropic.download(posterFile.id),
        "image/jpeg",
      )
    : null;
  const timeline: Presentation = presentationSchema.parse({
    version: 1,
    title: recorded.title,
    language,
    voice:
      voiced && deps.voice
        ? {
            provider: deps.voice.id,
            voice: deps.voice.voice,
            model: deps.voice.model,
          }
        : null,
    ticket: recorded.ticket,
    poster,
    chapters,
  });
  const key = await store(
    "presentation.json",
    new TextEncoder().encode(JSON.stringify(timeline)),
    "application/json",
  );
  return {
    kind: "presentation",
    key,
    label: recorded.title,
    contentType: "application/json",
    ...(poster ? { poster } : {}),
  };
}
