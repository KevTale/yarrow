import { and, eq, sql } from "drizzle-orm";
import type { Database } from "./client";
import { recordEvent } from "./events";
import { accountMembers, accounts, projects } from "./schema";

export interface Identity {
  userId: string;
  githubLogin: string | null;
  name: string | null;
}

/** Every signed-in user owns one personal account (organization accounts come later). */
export async function ensureAccount(
  db: Database,
  identity: Identity,
): Promise<string> {
  const [membership] = await db
    .select({ accountId: accountMembers.accountId })
    .from(accountMembers)
    .where(eq(accountMembers.userId, identity.userId))
    .limit(1);
  if (membership) {
    if (identity.githubLogin)
      await db
        .update(accountMembers)
        .set({ githubLogin: identity.githubLogin })
        .where(eq(accountMembers.userId, identity.userId));
    return membership.accountId;
  }
  return db.transaction(async (tx) => {
    const [account] = await tx
      .insert(accounts)
      .values({ name: identity.githubLogin ?? identity.name ?? "My account" })
      .returning({ id: accounts.id });
    await tx.insert(accountMembers).values({
      accountId: account!.id,
      userId: identity.userId,
      githubLogin: identity.githubLogin,
      role: "owner",
    });
    await recordEvent(tx, {
      type: "account.created",
      accountId: account!.id,
      userId: identity.userId,
    });
    return account!.id;
  });
}

export async function accountIdsForUser(
  db: Database,
  userId: string,
): Promise<string[]> {
  const rows = await db
    .select({ accountId: accountMembers.accountId })
    .from(accountMembers)
    .where(eq(accountMembers.userId, userId));
  return rows.map((row) => row.accountId);
}

/** Accounts where this GitHub user is a member (case-insensitive login). */
export async function accountIdsForGithubLogin(
  db: Database,
  login: string,
): Promise<string[]> {
  const rows = await db
    .select({ accountId: accountMembers.accountId })
    .from(accountMembers)
    .where(sql`lower(${accountMembers.githubLogin}) = lower(${login})`);
  return rows.map((row) => row.accountId);
}

export class ForbiddenError extends Error {
  constructor() {
    super("You do not have access to this project.");
  }
}

/** The authorization boundary for every owner-side action on a project. */
export async function requireProjectMember(
  db: Database,
  userId: string,
  projectId: string,
) {
  const [row] = await db
    .select({ project: projects })
    .from(projects)
    .innerJoin(
      accountMembers,
      and(
        eq(accountMembers.accountId, projects.accountId),
        eq(accountMembers.userId, userId),
      ),
    )
    .where(eq(projects.id, projectId));
  if (!row) throw new ForbiddenError();
  return row.project;
}
