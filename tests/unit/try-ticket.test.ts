import { describe, expect, it } from "vitest";
import { changeLook, LOOK, readTags, tryTurnSchema } from "@/core/try-ticket";

describe("the sample agent's tags", () => {
  it("takes them out of the words, in order", () => {
    expect(readTags("[show:form]Here it is. [set:theme=light]Done.")).toEqual({
      text: "Here it is. Done.",
      acts: [
        { kind: "show", moment: "form" },
        { kind: "set", change: "theme=light" },
      ],
    });
  });

  it("holds back a tag still arriving", () => {
    expect(readTags("Here it is [sho")).toEqual({
      text: "Here it is",
      acts: [],
    });
  });

  it("drops a moment that does not exist", () => {
    expect(readTags("[show:settings]Sorry.")).toEqual({
      text: "Sorry.",
      acts: [],
    });
  });

  it("leaves no space before punctuation", () => {
    expect(readTags("Sorted [show:sorted].").text).toBe("Sorted.");
  });
});

describe("a change on the sample app", () => {
  it("changes what is asked and nothing else", () => {
    expect(
      changeLook(LOOK, "urgentColor=#2563eb, hideDone=true, sort=added"),
    ).toEqual({
      ...LOOK,
      urgentColor: "#2563eb",
      hideDone: true,
      sort: "added",
    });
  });

  it("ignores what it cannot mean", () => {
    expect(
      changeLook(
        LOOK,
        "urgentColor=red,shape=star,urgentName=a name far too long,price=9,x",
      ),
    ).toEqual(LOOK);
  });
});

describe("a turn on the sample ticket", () => {
  const turn = {
    said: [{ author: "builder", body: "Make urgent blue" }],
    moment: "sorted",
    look: LOOK,
  };

  it("takes a visitor's line", () => {
    expect(tryTurnSchema.safeParse(turn).success).toBe(true);
  });

  it("refuses a look it would have to trust", () => {
    expect(
      tryTurnSchema.safeParse({
        ...turn,
        look: { ...LOOK, urgentColor: "red;}" },
      }).success,
    ).toBe(false);
  });

  it("refuses a line too long, or a turn the agent ends", () => {
    expect(
      tryTurnSchema.safeParse({
        ...turn,
        said: [{ author: "builder", body: "x".repeat(301) }],
      }).success,
    ).toBe(false);
    expect(
      tryTurnSchema.safeParse({
        ...turn,
        said: [{ author: "agent", body: "Hello" }],
      }).success,
    ).toBe(false);
  });
});
