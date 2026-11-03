import { stageVoiceFn } from "@/functions/stage.functions";

/** The answer being said; only one at a time. */
let saying: {
  audio: HTMLAudioElement | null;
  end: (heard: boolean) => void;
} | null = null;

/** The answer stops where it is: someone else has the word. */
export function hushAnswer(): void {
  saying?.audio?.pause();
  saying?.end(false);
  saying = null;
}

/**
 * An answer of the conversation said aloud, in the demo's voice. True once
 * it was said, or could not be: the demo need not wait for a voice that
 * never comes; false when it was stopped.
 */
export function sayAnswer(
  projectId: string,
  key: string,
  messageId: string,
): Promise<boolean> {
  hushAnswer();
  return new Promise((resolve) => {
    const now = { audio: null as HTMLAudioElement | null, end: resolve };
    saying = now;
    const said = () => {
      if (saying !== now) return;
      saying = null;
      resolve(true);
    };
    void stageVoiceFn({ data: { projectId, key, messageId } })
      .then((voice) => {
        if (saying !== now) return;
        if (!voice) return said();
        const audio = new Audio(
          `data:${voice.contentType};base64,${voice.audio}`,
        );
        now.audio = audio;
        audio.onended = said;
        audio.onerror = said;
        void audio.play().catch(said);
      })
      .catch(said);
  });
}
