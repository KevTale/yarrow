import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { TERMS_VERSION } from "../../src/core/terms";
import { recordEvent, termsAccepted } from "../../src/db/events";
import { createTestDatabase } from "./helpers/pglite";

describe("builder consent to the Terms", async () => {
  const t = await createTestDatabase();
  const { db } = t;
  afterAll(() => t.pg.close());
  beforeEach(() => t.reset());

  const userId = crypto.randomUUID();

  it("holds once ticked in the current version", async () => {
    expect(await termsAccepted(db, userId)).toBe(false);
    await recordEvent(db, {
      type: "builder.terms_accepted",
      userId,
      payload: { terms: TERMS_VERSION },
    });
    expect(await termsAccepted(db, userId)).toBe(true);
    expect(await termsAccepted(db, crypto.randomUUID())).toBe(false);
  });

  it("asks again when the Terms change", async () => {
    await recordEvent(db, {
      type: "builder.terms_accepted",
      userId,
      payload: { terms: "2020-01-01" },
    });
    expect(await termsAccepted(db, userId)).toBe(false);
  });
});
