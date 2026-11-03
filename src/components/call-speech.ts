import { beatOf, withoutBeats } from "@/core/stage";

/** ElevenLabs' timing of a piece of the agent's speech, from the piece's start. */
export interface SpeechTiming {
  chars: string[];
  char_start_times_ms: number[];
  char_durations_ms: number[];
}

/** A piece's timing reaches the page this long before its sound (2026-10-31). */
const SOUND_AFTER_MS = 200;

/**
 * What the agent is saying, each character at the moment it is heard, from
 * ElevenLabs' timing, which comes well ahead of the voice: its words show as
 * they are said, its gestures leave in time for their word.
 */
export class CallSpeech {
  #said: { char: string; at: number }[] = [];
  #end = 0;
  /** When a piece last came. */
  last = 0;

  /** A piece of speech, after the last one: the gestures marked in it. */
  add(timing: SpeechTiming, now: number): { n: number; at: number }[] {
    const start = Math.max(this.#end, now + SOUND_AFTER_MS);
    const beats: { n: number; at: number }[] = [];
    for (const [i, char] of timing.chars.entries()) {
      const at = start + (timing.char_start_times_ms[i] ?? 0);
      const n = beatOf(char);
      if (n !== null) beats.push({ n, at });
      this.#said.push({ char, at });
    }
    const end = timing.chars.length - 1;
    if (end >= 0)
      this.#end =
        start +
        (timing.char_start_times_ms[end] ?? 0) +
        (timing.char_durations_ms[end] ?? 0);
    this.last = now;
    return beats;
  }

  /** What was said by `now`, whole words: a word shows as it starts. */
  textAt(now: number): string {
    let end = 0;
    while (end < this.#said.length && this.#said[end]!.at <= now) end++;
    if (end === 0) return "";
    if (!/\s/.test(this.#said[end - 1]!.char))
      while (end < this.#said.length && !/\s/.test(this.#said[end]!.char))
        end++;
    return withoutBeats(
      this.#said
        .slice(0, end)
        .map(({ char }) => char)
        .join(""),
    );
  }

  /** All it was given to say. */
  text(): string {
    return this.textAt(Infinity);
  }

  /** Nothing left to hear of what it was given. */
  over(now: number): boolean {
    return now >= this.#end;
  }
}
