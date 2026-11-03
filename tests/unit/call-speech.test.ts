import { describe, expect, it } from "vitest";
import {
  CallSpeech,
  type SpeechTiming,
} from "../../src/components/call-speech";
import { beatMark } from "../../src/core/stage";

/** A piece of speech, each character 100 ms. */
const piece = (text: string): SpeechTiming => {
  const chars = [...text];
  return {
    chars,
    char_start_times_ms: chars.map((_, i) => i * 100),
    char_durations_ms: chars.map(() => 100),
  };
};

describe("the agent's speech as the voice's timing has it", () => {
  it("shows the words as they are said, a word as it starts", () => {
    const speech = new CallSpeech();
    speech.add(piece("Oui la tâche"), 1000);
    // Its sound comes 200 ms after its timing.
    expect(speech.textAt(1100)).toBe("");
    expect(speech.textAt(1200)).toBe("Oui");
    expect(speech.textAt(1590)).toBe("Oui ");
    expect(speech.textAt(1600)).toBe("Oui la");
    expect(speech.textAt(2000)).toBe("Oui la tâche");
    expect(speech.text()).toBe("Oui la tâche");
  });

  it("puts a piece after the last one, however ahead it comes", () => {
    const speech = new CallSpeech();
    speech.add(piece("abc"), 0);
    speech.add(piece("def"), 10);
    expect(speech.over(400)).toBe(false);
    expect(speech.textAt(500)).toBe("abcdef");
    expect(speech.over(800)).toBe(true);
  });

  it("starts a piece at once after a silence", () => {
    const speech = new CallSpeech();
    speech.add(piece("ab"), 0);
    speech.add(piece(" cd"), 5000);
    expect(speech.textAt(4000)).toBe("ab");
    expect(speech.textAt(5300)).toBe("ab cd");
  });

  it("says when each gesture's word comes, and never shows its mark", () => {
    const speech = new CallSpeech();
    const beats = speech.add(piece(`${beatMark(0)}Ici, ${beatMark(1)}là`), 0);
    expect(beats).toEqual([
      { n: 0, at: 200 },
      { n: 1, at: 800 },
    ]);
    expect(speech.text()).toBe("Ici, là");
  });

  it("has nothing left to hear before it was given anything", () => {
    const speech = new CallSpeech();
    expect(speech.over(0)).toBe(true);
    expect(speech.text()).toBe("");
  });
});
