import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  chapterMs,
  cueAt,
  cuesFromAlignment,
  estimatedCues,
  estimateSpeechMs,
  posterChapter,
  urlAt,
  wordsSaid,
} from "../../src/core/presentation";
import { ManagedAgentsClient } from "../../src/runner/anthropic";
import { publishPresentation } from "../../src/runner/presentation";
import { RECORDER_SOURCE } from "../../src/runner/recorder/source";
import { ElevenLabsVoice } from "../../src/runner/voice/elevenlabs";
import { voiceProvider } from "../../src/runner/voice/index";

/** Character times as ElevenLabs reports them: here 50 ms a character. */
function alignment(text: string) {
  const characters = [...text];
  return {
    characters,
    starts: characters.map((_, i) => i * 0.05),
    ends: characters.map((_, i) => (i + 1) * 0.05),
  };
}

describe("subtitles", () => {
  it("follow the voice, a sentence at a time, without delivery tags", () => {
    const cues = cuesFromAlignment(
      alignment(
        "[warm] Tasks now has an Export CSV button. One click, and the file downloads.",
      ),
    );
    expect(cues.map((cue) => cue.text)).toEqual([
      "Tasks now has an Export CSV button.",
      "One click, and the file downloads.",
    ]);
    // "Tasks" starts after "[warm] " (7 characters).
    expect(cues[0]!.startMs).toBe(350);
    expect(cues[1]!.startMs).toBeGreaterThan(cues[0]!.endMs);
  });

  it("show each word as it is said, like a video's captions", () => {
    const [cue] = cuesFromAlignment(alignment("[relaxed] So I click Doing..."));
    expect(cue!.words).toEqual([
      { startMs: 500, text: "So" },
      { startMs: 650, text: "I" },
      { startMs: 750, text: "click" },
      { startMs: 1050, text: "Doing..." },
    ]);
    expect(wordsSaid(cue!, 0)).toBe(0);
    expect(wordsSaid(cue!, 760)).toBe(3);
    expect(wordsSaid(cue!, 5000)).toBe(4);
    // Without a voice the words have no times: the cue shows whole.
    const [estimated] = estimatedCues("So I click Doing.", 2000);
    expect(estimated!.words).toEqual([]);
    expect(wordsSaid(estimated!, 0)).toBe(Infinity);
  });

  it("break a long sentence before two lines' worth", () => {
    const text =
      "The export keeps the filters the manager picked, the assignee and the status, and the done date of every finished task in its own column";
    const cues = cuesFromAlignment(alignment(text));
    expect(cues.length).toBe(2);
    for (const cue of cues) expect(cue.text.length).toBeLessThanOrEqual(84);
    expect(cues.map((cue) => cue.text).join(" ")).toBe(text);
  });

  it("cut where the voice pauses, never leaving a word behind", () => {
    // From the first live presentation (2026-10-21).
    const cues = cuesFromAlignment(
      alignment(
        "This pull request makes the Save button on the Settings page green, so saving stands out. Every other button keeps the purple brand colour. In the browser, Save renders in the exact green asked for, while Add and Sign in stay purple. Written by Claude Opus 5.5 and reviewed by GPT Astra, who approved it.",
      ),
    );
    expect(cues.map((cue) => cue.text)).toEqual([
      "This pull request makes the Save button on the Settings page green,",
      "so saving stands out.",
      "Every other button keeps the purple brand colour.",
      "In the browser, Save renders in the exact green asked for,",
      "while Add and Sign in stay purple.",
      "Written by Claude Opus 5.5 and reviewed by GPT Astra, who approved it.",
    ]);
  });

  it("keep a beat inside its sentence", () => {
    expect(
      estimatedCues(
        "So I click Doing... and only the two tasks in progress are left. Each one tells you how many tasks it holds... eight, four, two and two, and the total.",
        6000,
      ).map((cue) => cue.text),
    ).toEqual([
      "So I click Doing... and only the two tasks in progress are left.",
      "Each one tells you how many tasks it holds...",
      "eight, four, two and two, and the total.",
    ]);
  });

  it("join a short sentence to the one before", () => {
    expect(
      estimatedCues("Two of the three criteria hold. That's all.", 3000).map(
        (cue) => cue.text,
      ),
    ).toEqual(["Two of the three criteria hold. That's all."]);
  });

  it("are spread over the chapter without a voice", () => {
    const cues = estimatedCues(
      "Two of the three criteria hold. The speed was not measured.",
      4000,
    );
    expect(cues).toEqual([
      {
        startMs: 0,
        endMs: 2138,
        text: "Two of the three criteria hold.",
        words: [],
      },
      {
        startMs: 2138,
        endMs: 4000,
        text: "The speed was not measured.",
        words: [],
      },
    ]);
    // The last one started stays: nothing flickers between two.
    expect(cueAt(cues, 2137)?.text).toBe("Two of the three criteria hold.");
    expect(cueAt(cues, 9000)?.text).toBe("The speed was not measured.");
    expect(cueAt([], 10)).toBeNull();
  });
});

describe("chapter length", () => {
  const base = {
    title: "Export",
    tab: "app" as const,
    url: null,
    page: null,
    before: false,
    beforeMs: 0,
    desktop: false,
    say: "One click, and the file downloads.",
    cues: [],
    marks: [],
    urls: [],
  };
  it("ends with its voice once the last thing done has shown", () => {
    const video = {
      key: "k",
      startMs: 0,
      durationMs: 5000,
      width: 1280,
      height: 720,
    };
    expect(chapterMs({ ...base, video, audio: null })).toBe(5000);
    // A voice longer than the clip: the clip holds its last frame.
    expect(
      chapterMs({ ...base, video, audio: { key: "a", durationMs: 6200 } }),
    ).toBe(6200);
    expect(chapterMs({ ...base, video: null, audio: null })).toBe(
      estimateSpeechMs(base.say),
    );
    // Filmed to a guess at the words, 22.5 s, said in 17.3: the silence goes.
    const long = { ...video, durationMs: 22525 };
    const click = (atMs: number) => ({
      atMs,
      kind: "click" as const,
      box: { x: 0, y: 0, width: 10, height: 10 },
    });
    const voiced = {
      ...base,
      video: long,
      audio: { key: "a", durationMs: 17290 },
    };
    expect(chapterMs({ ...voiced, marks: [click(8160)] })).toBe(17740);
    // A click right at the end still shows what it did, within the clip.
    expect(chapterMs({ ...voiced, marks: [click(16900)] })).toBe(18400);
    expect(chapterMs({ ...voiced, marks: [click(22000)] })).toBe(22525);
  });
});

describe("the window", () => {
  const chapter = {
    title: "Pick one",
    tab: "app" as const,
    url: "localhost:3000/",
    page: null,
    before: false,
    beforeMs: 0,
    desktop: false,
    say: "So I click Doing.",
    video: null,
    audio: null,
    cues: [],
    marks: [],
    urls: [
      { atMs: 1800, url: "localhost:3000/?status=doing" },
      { atMs: 4200, url: "localhost:3000/?status=done" },
    ],
  };
  it("shows the address the page was at", () => {
    expect(urlAt(chapter, 0)).toBe("localhost:3000/");
    expect(urlAt(chapter, 1800)).toBe("localhost:3000/?status=doing");
    expect(urlAt(chapter, 9000)).toBe("localhost:3000/?status=done");
  });

  it("frames the poster where it was taken: the app after the change", () => {
    const timeline = {
      version: 1 as const,
      title: "Filters",
      language: "en",
      voice: null,
      ticket: { source: "github", title: "Filters", url: "" },
      poster: null,
      chapters: [
        { ...chapter, title: "Before", before: true },
        { ...chapter, title: "Run", tab: "terminal" as const },
        chapter,
      ],
    };
    expect(posterChapter(timeline).title).toBe("Pick one");
    const proof = { ...timeline, chapters: timeline.chapters.slice(0, 2) };
    expect(posterChapter(proof).title).toBe("Run");
    expect(
      posterChapter({ ...timeline, chapters: [timeline.chapters[0]!] }).title,
    ).toBe("Before");
  });
});

describe("ElevenLabs", () => {
  it("speaks with timestamps and returns subtitles", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const text = "The two new tests pass.";
    const fetcher = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const times = alignment(text);
      // Shape from the convert-with-timestamps reference.
      return new Response(
        JSON.stringify({
          audio_base64: Buffer.from([73, 68, 51, 4]).toString("base64"),
          alignment: {
            characters: times.characters,
            character_start_times_seconds: times.starts,
            character_end_times_seconds: times.ends,
          },
        }),
      );
    }) as typeof fetch;
    const voice = new ElevenLabsVoice({ apiKey: "xi_test" }, fetcher);
    const speech = await voice.speak({
      text,
      language: "en",
      before: "Here it is now.",
      after: "And that's it.",
    });
    expect(calls[0]!.url).toBe(
      "https://api.elevenlabs.io/v1/text-to-speech/ZoiZ8fuDWInAcwPXaVeq/with-timestamps?output_format=mp3_44100_128",
    );
    expect(calls[0]!.init.headers).toMatchObject({ "xi-api-key": "xi_test" });
    // The lines around it keep one tone across the chapters.
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({
      text,
      model_id: "eleven_v4",
      previous_text: "Here it is now.",
      next_text: "And that's it.",
    });
    expect([...speech.audio]).toEqual([73, 68, 51, 4]);
    expect(speech.contentType).toBe("audio/mpeg");
    // The last character ends at 1.15 s; the breath after it.
    expect(speech.durationMs).toBe(1400);
    expect(speech.cues).toMatchObject([{ startMs: 0, endMs: 1150, text }]);
    expect(speech.cues[0]!.words.map((word) => word.startMs)).toEqual([
      0, 200, 400, 600, 900,
    ]);
  });

  it("says why it failed", async () => {
    const fetcher = (async () =>
      new Response('{"detail":"quota_exceeded"}', {
        status: 401,
      })) as unknown as typeof fetch;
    await expect(
      new ElevenLabsVoice({ apiKey: "xi" }, fetcher).speak({
        text: "Hi.",
        language: "en",
      }),
    ).rejects.toThrow(
      'ElevenLabs speech failed (401): {"detail":"quota_exceeded"}',
    );
  });

  it("is picked by the settings, or none: subtitles only", () => {
    expect(voiceProvider({})).toBeNull();
    expect(
      voiceProvider({ ELEVENLABS_API_KEY: "xi", VOICE_PROVIDER: "off" }),
    ).toBeNull();
    expect(
      voiceProvider({ ELEVENLABS_API_KEY: "xi", VOICE_PROVIDER: "nobody" }),
    ).toBeNull();
    const voice = voiceProvider({
      ELEVENLABS_API_KEY: "xi",
      ELEVENLABS_VOICE_ID: "v1",
      ELEVENLABS_MODEL: "eleven_v4_turbo",
    });
    expect(voice).toMatchObject({
      id: "elevenlabs",
      voice: "v1",
      model: "eleven_v4_turbo",
    });
  });
});

describe("publishing a presentation", () => {
  const recorded = {
    version: 1,
    title: "Done date",
    ticket: {
      source: "jira",
      title: "Add a done date",
      url: "https://x/APP-4",
    },
    poster: null,
    chapters: [
      {
        title: "Checked",
        tab: "ticket",
        say: "It holds.",
        clip: "presentation/a-01-checked.webm",
        startMs: 50,
        durationMs: 2000,
        width: 1280,
        height: 720,
        urls: [{ atMs: 812.4, url: "localhost:3000/?status=doing" }],
      },
      {
        title: "Lost",
        tab: "terminal",
        url: "npm test",
        say: "Never recorded.",
        clip: "presentation/a-02-lost.webm",
        startMs: 50,
        durationMs: 2000,
        width: 1280,
        height: 800,
      },
    ],
  };
  const outputs: Record<string, Uint8Array> = {
    "presentation.json": new TextEncoder().encode(JSON.stringify(recorded)),
    "a-01-checked.webm": new Uint8Array([1]),
  };
  const fetcher = (async (url: string) => {
    if (url.includes("/v1/files?scope_id="))
      return new Response(
        JSON.stringify({
          data: Object.keys(outputs).map((name) => ({
            id: `file_${name}`,
            filename: name,
          })),
        }),
      );
    const id = url.match(/\/files\/file_(.+)\/content$/)?.[1];
    return new Response(outputs[id!] as BodyInit);
  }) as typeof fetch;

  it("goes on with subtitles when the voice fails, and drops clips it lacks", async () => {
    const objects = new Map<string, Uint8Array>();
    const artifact = await publishPresentation(
      {
        files: new ManagedAgentsClient("sk", fetcher),
        evidence: {
          put: async (key, data) => {
            objects.set(key, data);
          },
        },
        voice: {
          id: "down",
          voice: "v",
          model: null,
          speak: async () => {
            throw new Error("quota");
          },
        },
      },
      {
        runId: "00000000-0000-4000-8000-000000000001",
        sessionId: "sesn_1",
      },
    );
    expect(artifact).toMatchObject({
      kind: "presentation",
      label: "Done date",
    });
    expect(artifact!.poster).toBeUndefined();
    const timeline = JSON.parse(
      new TextDecoder().decode(objects.get(artifact!.key)),
    );
    expect(timeline.voice).toBeNull();
    expect(timeline.chapters).toHaveLength(1);
    // Its own words, nothing added: no credits at the end.
    expect(timeline.chapters[0]).toMatchObject({
      say: "It holds.",
      audio: null,
      urls: [{ atMs: 812, url: "localhost:3000/?status=doing" }],
      cues: [{ startMs: 0, text: "It holds." }],
    });
  });

  it("keeps a desktop film whole-screen and stored as mp4", async () => {
    const filmed = {
      ...recorded,
      chapters: [
        {
          ...recorded.chapters[0]!,
          tab: "app",
          desktop: true,
          clip: "presentation/a-01-filters.mp4",
          startMs: 0,
          width: 1440,
          height: 900,
        },
      ],
    };
    const files: Record<string, Uint8Array> = {
      "presentation.json": new TextEncoder().encode(JSON.stringify(filmed)),
      "a-01-filters.mp4": new Uint8Array([1]),
    };
    const types = new Map<string, string | undefined>();
    const objects = new Map<string, Uint8Array>();
    const artifact = await publishPresentation(
      {
        files: new ManagedAgentsClient("sk", (async (url: string) => {
          if (url.includes("/v1/files?scope_id="))
            return new Response(
              JSON.stringify({
                data: Object.keys(files).map((name) => ({
                  id: `file_${name}`,
                  filename: name,
                })),
              }),
            );
          const id = url.match(/\/files\/file_(.+)\/content$/)?.[1];
          return new Response(files[id!] as BodyInit);
        }) as typeof fetch),
        evidence: {
          put: async (key, data, options) => {
            objects.set(key, data);
            types.set(key, options?.httpMetadata?.contentType);
          },
        },
        voice: null,
      },
      { runId: "r", sessionId: "s" },
    );
    const timeline = JSON.parse(
      new TextDecoder().decode(objects.get(artifact!.key)),
    );
    expect(timeline.chapters[0]).toMatchObject({
      desktop: true,
      video: { startMs: 0, width: 1440, height: 900 },
    });
    expect(types.get(timeline.chapters[0].video.key)).toBe("video/mp4");
  });

  it("is none when the session recorded none", async () => {
    const empty = (async () =>
      new Response(JSON.stringify({ data: [] }))) as unknown as typeof fetch;
    expect(
      await publishPresentation(
        {
          files: new ManagedAgentsClient("sk", empty),
          evidence: { put: async () => undefined },
          voice: null,
        },
        { runId: "r", sessionId: "s" },
      ),
    ).toBeNull();
  });
});

describe("the recorder", () => {
  it("is carried as written (pnpm recorder:embed after an edit)", () => {
    const source = readFileSync("src/runner/recorder/present.mjs", "utf8")
      .split("\r\n")
      .join("\n");
    expect(RECORDER_SOURCE).toBe(source);
  });
});
