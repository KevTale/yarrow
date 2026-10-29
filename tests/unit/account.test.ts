import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { deleteAccount, ensureAccount } from "../../src/db/accounts";
import { createProject } from "../../src/db/projects";
import * as schema from "../../src/db/schema";
import {
  emailChangeToken,
  readEmailChangeToken,
} from "../../src/server/email-change";
import { createTestDatabase } from "./helpers/pglite";

describe("deleting an account", async () => {
  const t = await createTestDatabase();
  const { db, raw } = t;
  afterAll(() => t.pg.close());
  beforeEach(() => t.reset());

  const lea = { userId: crypto.randomUUID(), githubLogin: "lea", name: null };

  it("takes the person out, keeps the payments, frees the repository", async () => {
    const accountId = await ensureAccount(db, lea);
    const projectId = await createProject(db, accountId, lea.userId, {
      repository: "lea/app",
      description: "",
      productUrl: "",
      visibility: "public",
      categories: ["saas"],
      stacks: [],
      authorizationLabel: "yarrow",
    });
    const [connection] = await raw
      .insert(schema.trackerConnections)
      .values({
        accountId,
        tracker: "jira",
        externalId: "cloud-1",
        name: "lea.atlassian.net",
        encryptedAccessToken: "sealed",
      })
      .returning();
    await raw.insert(schema.trackerBoards).values({
      connectionId: connection!.id,
      projectId,
      externalBoardId: "KAN",
      name: "KAN · App",
    });
    await raw.insert(schema.sponsorProfiles).values({
      userId: lea.userId,
      publicName: "Léa",
      tagline: "Builds things",
      websiteUrl: "https://lea.dev/",
      email: "lea@example.com",
      mode: "only",
    });
    await raw
      .insert(schema.sponsorProjectSelections)
      .values({ userId: lea.userId, projectId });
    await raw.insert(schema.contributions).values({
      userId: lea.userId,
      paymentStatus: "settled",
      amountCents: 2500,
      creditCents: 2000,
    });

    await deleteAccount(db, lea.userId);

    const [project] = await raw
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId));
    expect(project).toMatchObject({
      visibility: "hidden",
      repository: `deleted/${projectId}`,
      githubInstallationId: null,
    });
    expect(project!.suspendedAt).not.toBeNull();
    expect(await raw.select().from(schema.trackerConnections)).toHaveLength(0);
    expect(await raw.select().from(schema.trackerBoards)).toHaveLength(0);
    expect(await raw.select().from(schema.accountMembers)).toHaveLength(0);
    expect(
      await raw.select().from(schema.sponsorProjectSelections),
    ).toHaveLength(0);
    const [card] = await raw.select().from(schema.sponsorProfiles);
    expect(card).toMatchObject({
      publicName: null,
      tagline: null,
      websiteUrl: null,
      email: null,
      mode: "all_except",
    });
    // The payment stays, for the accounts and the credit it still holds.
    expect(await raw.select().from(schema.contributions)).toHaveLength(1);
    // The repository can come back with a new install.
    const next = await ensureAccount(db, {
      ...lea,
      userId: crypto.randomUUID(),
    });
    await expect(
      createProject(db, next, lea.userId, {
        repository: "lea/app",
        description: "",
        productUrl: "",
        visibility: "public",
        categories: ["saas"],
        stacks: [],
        authorizationLabel: "yarrow",
      }),
    ).resolves.toBeTruthy();
  });

  it("leaves a shared account and its projects to the others", async () => {
    const accountId = await ensureAccount(db, lea);
    const sam = crypto.randomUUID();
    await raw
      .insert(schema.accountMembers)
      .values({ accountId, userId: sam, role: "member" });
    const projectId = await createProject(db, accountId, lea.userId, {
      repository: "team/app",
      description: "",
      productUrl: "",
      visibility: "public",
      categories: ["saas"],
      stacks: [],
      authorizationLabel: "yarrow",
    });
    await deleteAccount(db, lea.userId);
    const [project] = await raw
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId));
    expect(project).toMatchObject({
      repository: "team/app",
      suspendedAt: null,
    });
    expect(await raw.select().from(schema.accountMembers)).toEqual([
      expect.objectContaining({ userId: sam }),
    ]);
  });
});

describe("an email change link", () => {
  const key = "test-key";
  it("holds who asked and the new address, for a day, unforgeable", async () => {
    const token = await emailChangeToken(key, "user-1", "new@example.com", 0);
    expect(await readEmailChangeToken(key, token, 1000)).toMatchObject({
      userId: "user-1",
      email: "new@example.com",
    });
    // Expired the next day; another key, or a changed address, fails.
    expect(await readEmailChangeToken(key, token, 25 * 3600 * 1000)).toBeNull();
    expect(await readEmailChangeToken("other", token, 1000)).toBeNull();
    const [, signed] = token.split(".");
    const forged = `${btoa(JSON.stringify({ userId: "user-1", email: "evil@example.com", expiresAt: 9e12 })).replace(/=+$/, "")}.${signed}`;
    expect(await readEmailChangeToken(key, forged, 1000)).toBeNull();
  });
});
