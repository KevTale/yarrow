import { stageVoiceFn } from "@/functions/stage.functions";

/** The answer being said; only one at a time. */
let saying: {
  key: string;
  audio: HTMLAudioElement | null;
  timer: ReturnType<typeof setInterval> | null;
  end: (heard: boolean) => void;
} | null = null;

/**
 * The answer stops where it is: someone else has the word. With a `key`, only
 * that ticket's: another row closing leaves this one's alone.
 */
export function hushAnswer(key?: string): void {
  if (key !== undefined && saying?.key !== key) return;
  saying?.audio?.pause();
  if (saying?.timer) clearInterval(saying.timer);
  saying?.end(false);
  saying = null;
}

/**
 * An answer of the conversation said aloud, in the demo's voice, `onPart`
 * following it (0 to 1). True once it was said, or could not be: the demo
 * need not wait for a voice that never comes; false when it was stopped.
 */
export function sayAnswer(input: {
  projectId: string;
  key: string;
  messageId: string;
  onPart: (part: number) => void;
}): Promise<boolean> {
  hushAnswer();
  const { onPart, ...answer } = input;
  return new Promise((resolve) => {
    const now = {
      key: input.key,
      audio: null as HTMLAudioElement | null,
      timer: null,
      end: resolve,
    };
    saying = now;
    const said = () => {
      if (saying !== now) return;
      saying = null;
      resolve(true);
    };
    void stageVoiceFn({ data: answer })
      .then((voice) => {
        if (saying !== now) return;
        if (!voice) return said();
        const audio = new Audio(
          `data:${voice.contentType};base64,${voice.audio}`,
        );
        now.audio = audio;
        audio.onended = said;
        audio.onerror = said;
        audio.ontimeupdate = () =>
          onPart(audio.currentTime / (audio.duration || 1));
        onPart(0);
        void audio.play().catch(said);
      })
      .catch(said);
  });
}

/** The same with the sound off: the time to read it, `onPart` following. */
export function readAnswer(
  key: string,
  ms: number,
  onPart: (part: number) => void,
): Promise<boolean> {
  hushAnswer();
  return new Promise((resolve) => {
    const started = Date.now();
    onPart(0);
    const timer = setInterval(() => {
      const part = (Date.now() - started) / ms;
      if (part < 1) return onPart(part);
      clearInterval(timer);
      saying = null;
      resolve(true);
    }, 200);
    saying = { key, audio: null, timer, end: resolve };
  });
}
