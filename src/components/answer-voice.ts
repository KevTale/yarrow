import { stageVoiceFn } from "@/functions/stage.functions";

/** The answer being said; only one at a time. */
let saying: { key: string; audio: HTMLAudioElement | null } | null = null;

/**
 * The answer stops where it is: someone else has the word. With a `key`, only
 * that ticket's: another row closing leaves this one's alone.
 */
export function hushAnswer(key?: string): void {
  if (key !== undefined && saying?.key !== key) return;
  saying?.audio?.pause();
  saying = null;
}

/** An answer of the conversation said aloud, in the demo's voice. */
export function sayAnswer(input: {
  projectId: string;
  key: string;
  messageId: string;
}): void {
  hushAnswer();
  const now = { key: input.key, audio: null as HTMLAudioElement | null };
  saying = now;
  void stageVoiceFn({ data: input })
    .then((voice) => {
      if (saying !== now || !voice) return;
      now.audio = new Audio(`data:${voice.contentType};base64,${voice.audio}`);
      void now.audio.play().catch(() => {});
    })
    .catch(() => {});
}
