import { describe, expect, it } from "vitest";
import { gestureWords, parseGesture } from "../../src/runner/gestures";

function split(...deltas: string[]) {
  const out: (string | { beat: string[] })[] = [];
  const stream = gestureWords({
    words: (text) => out.push(text),
    beat: (actions) => out.push({ beat: actions.map((action) => action.do) }),
  });
  for (const delta of deltas) stream.write(delta);
  stream.end();
  return out.reduce<(string | { beat: string[] })[]>((kept, part) => {
    const last = kept.at(-1);
    if (typeof part === "string" && typeof last === "string")
      kept[kept.length - 1] = last + part;
    else if (part !== "") kept.push(part);
    return kept;
  }, []);
}

describe("the gestures in the agent's words", () => {
  it("reads a tag's fields", () => {
    expect(
      parseGesture(`<act do="fill" target="e14" text="Pain \\"frais\\""/>`),
    ).toEqual({ do: "fill", target: "e14", text: 'Pain "frais"' });
    expect(parseGesture(`<act do="scroll" y="300"/>`)).toEqual({
      do: "scroll",
      y: 300,
    });
    expect(
      parseGesture(`<act do="open" file="src/date.js" from="16" to="21"/>`),
    ).toEqual({ do: "open", file: "src/date.js", from: 16, to: 21 });
    expect(parseGesture(`<act do="click" target='e2'/>`)).toEqual({
      do: "click",
      target: "e2",
    });
  });

  it("takes nothing the page would evaluate, nor a gesture it does not know", () => {
    expect(parseGesture(`<act do="click" at="document.body"/>`)).toEqual({
      do: "click",
    });
    expect(parseGesture(`<act do="dance"/>`)).toBeNull();
  });

  it("puts a gesture right before the words it goes with", () => {
    expect(
      split(`Je l'ajoute, <act do="circle" target="e2"/>et la voilà.`),
    ).toEqual(["Je l'ajoute, ", { beat: ["circle"] }, "et la voilà."]);
  });

  it("finds a tag cut anywhere by the stream", () => {
    expect(
      split(`Regarde <`, `ac`, `t do="point" tar`, `get="e2"/`, `>ici.`),
    ).toEqual(["Regarde ", { beat: ["point"] }, "ici."]);
  });

  it("keeps gestures in a row together, the space after them in the voice", () => {
    expect(
      split(
        `<act do="fill" target="e1" text="a"/> <act do="click" target="e2"/> Fait.`,
      ),
    ).toEqual(["  ", { beat: ["fill", "click"] }, "Fait."]);
  });

  it("lets through what only looks like a tag", () => {
    expect(split(`a < b et <div> ou <active>.`)).toEqual([
      "a < b et <div> ou <active>.",
    ]);
  });

  it("never lets an ill-formed tag reach the voice", () => {
    expect(split(`Voilà <act do=click/>ici.`)).toEqual(["Voilà ici."]);
    expect(split(`Voilà <act do="click" target="e`)).toEqual(["Voilà "]);
    expect(split(`Voilà <act do="dance"/>ici.`)).toEqual(["Voilà ici."]);
  });

  it("gives gestures with no word after them when the words end", () => {
    expect(split(`C'est ici. <act do="circle" target="e2"/>`)).toEqual([
      "C'est ici. ",
      { beat: ["circle"] },
    ]);
  });
});
