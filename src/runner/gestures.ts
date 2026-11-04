import { liveActionSchema, type LiveAction } from "../core/presentation";

/**
 * The agent's gestures written in its words, so they happen as it says them
 * (src/runner/talk.ts): `<act do="circle" target="e20"/>` before the words
 * they go with. They are cut out as the words stream, and never reach the
 * voice: only where they fell does (`beatMark`, src/core/stage.ts).
 */

const OPENING = "<act ";
const TAG = /^<act\s+((?:\w+=(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*)*)\/>/;
const ATTRIBUTE = /(\w+)=(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/g;
/** Past this, what looked like a tag is not one. */
const TAG_MAX = 800;

const NUMBERS = new Set(["y", "ms", "from", "to"]);

/** What act_on_screen takes, nothing the page would evaluate. */
const gestureSchema = liveActionSchema.omit({ at: true, times: true });

/** A tag's action, or null when it is not one. */
export function parseGesture(tag: string): LiveAction | null {
  const fields: Record<string, unknown> = {};
  for (const [, name, double, single] of tag.matchAll(ATTRIBUTE)) {
    const value = (double ?? single ?? "").replace(/\\(.)/g, "$1");
    fields[name!] = NUMBERS.has(name!) ? Number(value) : value;
  }
  const parsed = gestureSchema.safeParse(fields);
  return parsed.success ? parsed.data : null;
}

/**
 * The words as they stream, split: `words` gets what is spoken, `beat` the
 * gestures together right before the words they go with.
 */
export function gestureWords(out: {
  words: (text: string) => void;
  beat: (actions: LiveAction[]) => void;
}) {
  // What may yet be a tag.
  let held = "";
  let waiting: LiveAction[] = [];
  const emit = (text: string) => {
    if (!text) return;
    if (!waiting.length || !text.trim()) {
      out.words(text);
      return;
    }
    const space = text.length - text.trimStart().length;
    out.words(text.slice(0, space));
    out.beat(waiting);
    waiting = [];
    out.words(text.slice(space));
  };
  return {
    write(delta: string) {
      held += delta;
      while (held) {
        const open = held.indexOf("<");
        if (open < 0) {
          emit(held);
          held = "";
          return;
        }
        emit(held.slice(0, open));
        held = held.slice(open);
        const sure = held.startsWith(OPENING);
        if (!sure && !OPENING.startsWith(held)) {
          emit("<");
          held = held.slice(1);
          continue;
        }
        const tag = TAG.exec(held);
        if (tag) {
          const gesture = parseGesture(tag[0]);
          if (gesture) waiting.push(gesture);
          held = held.slice(tag[0].length);
          continue;
        }
        const end = held.indexOf("/>");
        const closed =
          end >= 0 && (held.slice(0, end).match(/"/g)?.length ?? 0) % 2 === 0;
        // Ill-formed, it goes all the same: a voice never reads a tag out.
        if (closed) held = held.slice(end + 2);
        else if (held.length > TAG_MAX) held = "";
        else return;
      }
    },
    /** The words stop here, for a tool or for good. */
    end() {
      const rest = held.startsWith(OPENING) ? "" : held;
      held = "";
      emit(rest);
      if (!waiting.length) return;
      out.beat(waiting);
      waiting = [];
    },
  };
}
