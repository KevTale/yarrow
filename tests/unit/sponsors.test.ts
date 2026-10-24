import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { sponsorBoard } from "../../src/db/boards";
import * as schema from "../../src/db/schema";
import {
  claimGuestSponsorships,
  getSponsorProfile,
  recordGuestEmail,
  saveSponsorProfile,
} from "../../src/db/sponsors";
import { createTestDatabase } from "./helpers/pglite";

const test = await createTestDatabase();
const { db, raw } = test;
const now = new Date();

const profile = (
  publicName: string | null,
  websiteUrl: string | null = null,
) => ({
  publicName,
  tagline: null,
  description: null,
  websiteUrl,
});

/** What startCheckoutFn and the webhook do for one guest payment. */
async function guestPays(
  publicName: string | null,
  amountCents: number,
  websiteUrl: string | null = null,
) {
  const userId = crypto.randomUUID();
  const checkout = `cs_${crypto.randomUUID()}`;
  await saveSponsorProfile(db, userId, profile(publicName, websiteUrl), {
    guest: true,
  });
  await raw.insert(schema.contributions).values({
    userId,
    amountCents,
    creditCents: amountCents,
    paymentStatus: "settled",
    stripeCheckoutId: checkout,
  });
  return { userId, checkout };
}

const profiles = () => raw.select().from(schema.sponsorProfiles);

afterAll(async () => {
  await test.pg.close();
});
beforeEach(async () => {
  await test.reset();
});

describe("guest sponsors", () => {
  it("store the Stripe email once, so retries send no second link", async () => {
    const { checkout } = await guestPays("Northwind", 2500);
    expect(await recordGuestEmail(db, checkout, " Ops@Northwind.dev ")).toBe(
      true,
    );
    expect(await recordGuestEmail(db, checkout, "ops@northwind.dev")).toBe(
      false,
    );
    expect((await profiles())[0]).toMatchObject({
      guest: true,
      email: "ops@northwind.dev",
    });
  });

  it("send no link for a signed-in sponsor's payment", async () => {
    const userId = crypto.randomUUID();
    await saveSponsorProfile(db, userId, profile("Ada"));
    await raw.insert(schema.contributions).values({
      userId,
      amountCents: 1000,
      creditCents: 1000,
      paymentStatus: "settled",
      stripeCheckoutId: "cs_signed_in",
    });
    expect(await recordGuestEmail(db, "cs_signed_in", "ada@x.dev")).toBe(false);
  });

  it("keep one board row when a guest pays twice", async () => {
    const first = await guestPays("Northwind", 2500);
    await recordGuestEmail(db, first.checkout, "ops@northwind.dev");
    const second = await guestPays(
      "Northwind Inc",
      1000,
      "https://northwind.dev",
    );
    expect(
      await recordGuestEmail(db, second.checkout, "OPS@northwind.dev"),
    ).toBe(true);
    const rows = await profiles();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: first.userId,
      publicName: "Northwind Inc",
      websiteUrl: "https://northwind.dev",
    });
    expect(
      (await sponsorBoard(db, "all", now)).map((row) => row.paidCents),
    ).toEqual([3500]);
    // A webhook retry for the merged payment changes nothing.
    expect(
      await recordGuestEmail(db, second.checkout, "ops@northwind.dev"),
    ).toBe(false);
  });

  it("move to the account that signs in with the same email", async () => {
    const guest = await guestPays("Northwind", 2500);
    await recordGuestEmail(db, guest.checkout, "ops@northwind.dev");
    const [before] = await profiles();
    await raw
      .insert(schema.events)
      .values({ type: "sponsor.clicked", userId: guest.userId });

    const userId = crypto.randomUUID();
    expect(await claimGuestSponsorships(db, userId, "Ops@Northwind.dev")).toBe(
      1,
    );
    expect(await claimGuestSponsorships(db, userId, "ops@northwind.dev")).toBe(
      0,
    );
    const [after] = await profiles();
    expect(after).toMatchObject({
      userId,
      guest: false,
      publicId: before!.publicId,
    });
    const contributions = await raw
      .select()
      .from(schema.contributions)
      .where(eq(schema.contributions.userId, userId));
    expect(contributions).toHaveLength(1);
    expect(await sponsorBoard(db, "all", now)).toMatchObject([
      { name: "Northwind", paidCents: 2500, clicks: 1 },
    ]);
  });

  it("merge into an existing profile, keeping what the user already set", async () => {
    const userId = crypto.randomUUID();
    await saveSponsorProfile(db, userId, profile("Ada", null));
    const guest = await guestPays("Ada L.", 2500, "https://ada.dev");
    await recordGuestEmail(db, guest.checkout, "ada@x.dev");

    expect(await claimGuestSponsorships(db, userId, "ada@x.dev")).toBe(1);
    expect(await profiles()).toHaveLength(1);
    expect(await getSponsorProfile(db, userId)).toMatchObject({
      publicName: "Ada",
      websiteUrl: "https://ada.dev",
    });
  });

  it("never claim a guest payment whose email is not yet known", async () => {
    await guestPays("Northwind", 2500);
    expect(
      await claimGuestSponsorships(
        db,
        crypto.randomUUID(),
        "ops@northwind.dev",
      ),
    ).toBe(0);
  });
});
