import { afterAll, describe, expect, it } from "vitest";
import { asksBack } from "@/core/new-ticket";
import {
  plainWords,
  readAnswer,
  readTicket,
  tryInstructions,
  tryTurnSchema,
  type TryTurn,
} from "@/core/try-ticket";
import { tryDays } from "@/db/schema";
import { countTryTurn } from "@/db/try-days";
import { createTestDatabase } from "./helpers/pglite";

const { db, raw, pg } = await createTestDatabase();
afterAll(() => pg.close());

describe("the agent's last words on a ticket", () => {
  it("wait for an answer when they end on a question", () => {
    expect(asksBack("Who can archive a task?")).toBe(true);
    expect(asksBack("誰がアーカイブできますか？\n")).toBe(true);
  });

  it("leave the go-ahead to the member otherwise", () => {
    expect(asksBack("Done, the ticket is written. Ready to start.")).toBe(
      false,
    );
  });
});

describe("an answer on the ticket to review", () => {
  it("keeps its moments and takes the change apart", () => {
    expect(
      readAnswer("Blue it is [at 0:12]. [change:Urgent turns blue]"),
    ).toEqual({ text: "Blue it is [at 0:12].", change: "Urgent turns blue" });
  });

  it("holds back a tag still arriving", () => {
    expect(readAnswer("Here it is [at 0:")).toEqual({
      text: "Here it is",
      change: null,
    });
  });
});

describe("an answer made into a ticket", () => {
  it("keeps the words and leaves the moments", () => {
    expect(
      plainWords("Done tasks can drop down [at 1:04]. I'd sort them last."),
    ).toBe("Done tasks can drop down. I'd sort them last.");
  });
});

describe("an answer on the new ticket", () => {
  const whole =
    "<ticket>\nArchive old tasks\n---\nLists get long.\n\n**Done when**\n- A task can be archived\n</ticket>\nShould archived tasks come back?";

  it("reads the ticket and the words after it", () => {
    expect(readTicket(whole)).toEqual({
      ticket: {
        title: "Archive old tasks",
        body: "Lists get long.\n\n**Done when**\n- A task can be archived",
      },
      words: "Should archived tasks come back?",
    });
  });

  it("writes the form as it arrives, a closing tag held back", () => {
    expect(readTicket("<ticket>\nArchive old")).toEqual({
      ticket: { title: "Archive old", body: "" },
      words: "",
    });
    expect(readTicket("<ticket>\nArchive old tasks\n--")).toEqual({
      ticket: { title: "Archive old tasks", body: "" },
      words: "",
    });
    expect(readTicket("<ticket>\nA\n---\nLists get long.</tick")).toEqual({
      ticket: { title: "A", body: "Lists get long." },
      words: "",
    });
  });

  it("leaves the form alone when there is no ticket", () => {
    expect(readTicket("I am here to write a ticket. <tic")).toEqual({
      ticket: null,
      words: "I am here to write a ticket.",
    });
  });
});

describe("a turn of the sample agent", () => {
  const turn = {
    kind: "review",
    sample: "priority",
    said: [{ author: "builder", body: "Make urgent blue" }],
    chapter: 1,
  };

  it("knows the film of the ticket it is on", () => {
    const told = tryInstructions({
      kind: "review",
      sample: "archive",
      said: [{ author: "builder", body: "Can I restore one?" }],
      chapter: 3,
    });
    expect(told).toContain("Restoring (on the screen now)");
    expect(told).toContain("The tasks API still returns archived tasks");
    expect(told).not.toContain("Urgent");
  });

  it("says nothing of its first words on a sample that opened with none", () => {
    const told = tryInstructions({ ...turn, sample: "filter" } as TryTurn);
    expect(told).toContain("Picking Doing");
    expect(told).not.toContain("before they asked anything");
  });

  it("takes a visitor's line, on any sample", () => {
    expect(tryTurnSchema.safeParse(turn).success).toBe(true);
    expect(tryTurnSchema.safeParse({ ...turn, sample: "filter" }).success).toBe(
      true,
    );
    expect(
      tryTurnSchema.safeParse({
        kind: "ticket",
        said: turn.said,
        title: "",
        body: "",
      }).success,
    ).toBe(true);
  });

  it("refuses a sample it does not know", () => {
    expect(tryTurnSchema.safeParse({ ...turn, kind: "other" }).success).toBe(
      false,
    );
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

  it("tells the agent the form as it stands", () => {
    expect(
      tryInstructions({
        kind: "ticket",
        said: [{ author: "builder", body: "Go on" }],
        title: "Archive old tasks",
        body: "",
      }),
    ).toContain("Archive old tasks");
  });
});

describe("the day's ceiling", () => {
  it("counts every turn of the day in one row", async () => {
    expect(await countTryTurn(db)).toBe(1);
    expect(await countTryTurn(db)).toBe(2);
    expect(await raw.select().from(tryDays)).toHaveLength(1);
  });
});
