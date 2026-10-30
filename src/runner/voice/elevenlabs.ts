import { cuesFromAlignment } from "../../core/presentation";
import type { Fetch, Speech, VoiceProvider } from "./index";

const API = "https://api.elevenlabs.io/v1";

/**
 * Josh, "Warm, Smooth and Steady" in the voice library: a colleague
 * talking, not a narrator (chosen 2026-10-21; Chris, the promo film's,
 * read as a voice-over).
 */
export const DEFAULT_ELEVENLABS_VOICE = "ZoiZ8fuDWInAcwPXaVeq";
/** Multilingual; eleven_v4_turbo answers faster, for live talk. */
export const DEFAULT_ELEVENLABS_MODEL = "eleven_v4";

interface WithTimestamps {
  audio_base64: string;
  alignment: {
    characters: string[];
    character_start_times_seconds: number[];
    character_end_times_seconds: number[];
  } | null;
}

/**
 * ElevenLabs text-to-speech, with the time of every character: the
 * subtitles follow the voice. https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps
 */
export class ElevenLabsVoice implements VoiceProvider {
  readonly id = "elevenlabs";
  readonly voice: string;
  readonly model: string;
  private readonly apiKey: string;

  constructor(
    config: { apiKey: string; voice?: string; model?: string },
    // Wrapped: Workers reject fetch called as a method ("Illegal invocation").
    private readonly fetcher: Fetch = (input, init) => fetch(input, init),
  ) {
    this.apiKey = config.apiKey;
    this.voice = config.voice || DEFAULT_ELEVENLABS_VOICE;
    this.model = config.model || DEFAULT_ELEVENLABS_MODEL;
  }

  async speak(input: {
    text: string;
    language: string;
    before?: string;
    after?: string;
  }): Promise<Speech> {
    const response = await this.fetcher(
      `${API}/text-to-speech/${this.voice}/with-timestamps?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key": this.apiKey,
          "content-type": "application/json",
        },
        // The model reads the language from the text: no language_code,
        // which not every model accepts.
        body: JSON.stringify({
          text: input.text,
          model_id: this.model,
          // One talk, not separate lines: the tone carries across chapters.
          previous_text: input.before || undefined,
          next_text: input.after || undefined,
          // Below the default 0.5: livelier, as people talk.
          voice_settings: {
            stability: 0.4,
            similarity_boost: 0.8,
            use_speaker_boost: true,
          },
        }),
      },
    );
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `ElevenLabs speech failed (${response.status}): ${detail.slice(0, 300)}`,
      );
    }
    const result = (await response.json()) as WithTimestamps;
    const audio = Uint8Array.from(atob(result.audio_base64), (c) =>
      c.charCodeAt(0),
    );
    const alignment = result.alignment && {
      characters: result.alignment.characters,
      starts: result.alignment.character_start_times_seconds,
      ends: result.alignment.character_end_times_seconds,
    };
    // The last character's end, and the breath after it.
    const spoken = alignment?.ends.at(-1);
    return {
      audio,
      contentType: "audio/mpeg",
      durationMs:
        spoken === undefined
          ? // 128 kb/s: 16 bytes a millisecond.
            Math.round(audio.length / 16)
          : Math.round(spoken * 1000) + 250,
      cues: alignment ? cuesFromAlignment(alignment) : [],
    };
  }
}
