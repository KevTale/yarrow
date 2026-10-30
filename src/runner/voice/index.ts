import type { Cue } from "../../core/presentation";
import { ElevenLabsVoice } from "./elevenlabs";

export type Fetch = typeof fetch;

/** A line spoken: the audio and when each subtitle is said. */
export interface Speech {
  audio: Uint8Array;
  contentType: string;
  durationMs: number;
  cues: Cue[];
}

/**
 * Who voices the presentations. A provider is one class here; the brain
 * picks it by VOICE_PROVIDER, and the presentation keeps its id and voice
 * so a live talk later speaks with the same one.
 */
export interface VoiceProvider {
  readonly id: string;
  readonly voice: string;
  readonly model: string | null;
  /** `before` and `after` are the lines around it: it runs on from them. */
  speak(input: {
    text: string;
    language: string;
    before?: string;
    after?: string;
  }): Promise<Speech>;
}

export interface VoiceSettings {
  /** "elevenlabs" when absent; "off" for subtitles only. */
  VOICE_PROVIDER?: string;
  ELEVENLABS_API_KEY?: string;
  ELEVENLABS_VOICE_ID?: string;
  ELEVENLABS_MODEL?: string;
}

/** The configured provider, or null: the presentation then has subtitles only. */
export function voiceProvider(
  settings: VoiceSettings,
  fetcher?: Fetch,
): VoiceProvider | null {
  const id = settings.VOICE_PROVIDER ?? "elevenlabs";
  switch (id) {
    case "elevenlabs":
      return settings.ELEVENLABS_API_KEY
        ? new ElevenLabsVoice(
            {
              apiKey: settings.ELEVENLABS_API_KEY,
              voice: settings.ELEVENLABS_VOICE_ID,
              model: settings.ELEVENLABS_MODEL,
            },
            fetcher,
          )
        : null;
    case "off":
      return null;
    default:
      console.warn(`voice: unknown provider "${id}", subtitles only`);
      return null;
  }
}
