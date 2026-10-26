import { and, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "./client";
import { recordEvent } from "./events";
import {
  accountMembers,
  accounts,
  projects,
  sponsorProfiles,
  sponsorProjectSelections,
  trackerBoards,
  trackerConnections,
} from "./schema";

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

/**
 * Deletes a person from Yarrow (decided 2026-10-09). What the law keeps
 * stays: payments and their invoices, the runs they paid for. Everything
 * that points at the person goes:
 * - accounts they were alone in: their projects leave every board and the
 *   queue, free their repository for a new install, and lose their tracker
 *   connections (the encrypted tokens are deleted);
 * - their sponsor card turns anonymous, and what is left of their credit
 *   keeps funding every project;
 * - their memberships.
 * The Supabase auth user is deleted by the caller, after this.
 */
export async function deleteAccount(db: Database, userId: string) {
  await db.transaction(async (tx) => {
    const memberships = await tx
      .select({ accountId: accountMembers.accountId })
      .from(accountMembers)
      .where(eq(accountMembers.userId, userId));
    const alone: string[] = [];
    for (const { accountId } of memberships) {
      const [others] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(accountMembers)
        .where(eq(accountMembers.accountId, accountId));
      if (others!.count === 1) alone.push(accountId);
    }
    if (alone.length) {
      const owned = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(inArray(projects.accountId, alone));
      const ids = owned.map((project) => project.id);
      if (ids.length) {
        await tx.delete(trackerBoards).where(inArray(trackerBoards.projectId, ids));
        for (const id of ids)
          await tx
            .update(projects)
            .set({
              suspendedAt: new Date(),
              visibility: "hidden",
              // A later install of the GitHub App starts afresh.
              repository: `deleted/${id}`,
              githubRepositoryId: null,
              githubInstallationId: null,
              logoUrl: null,
            })
            .where(eq(projects.id, id));
      }
      const connections = await tx
        .select({ id: trackerConnections.id })
        .from(trackerConnections)
        .where(inArray(trackerConnections.accountId, alone));
      if (connections.length) {
        await tx.delete(trackerBoards).where(
          inArray(
            trackerBoards.connectionId,
            connections.map((connection) => connection.id),
          ),
        );
        await tx
          .delete(trackerConnections)
          .where(inArray(trackerConnections.accountId, alone));
      }
    }
    await tx
      .delete(sponsorProjectSelections)
      .where(eq(sponsorProjectSelections.userId, userId));
    await tx
      .update(sponsorProfiles)
      .set({
        publicName: null,
        tagline: null,
        description: null,
        websiteUrl: null,
        logoUrl: null,
        email: null,
        mode: "all_except",
        updatedAt: new Date(),
      })
      .where(eq(sponsorProfiles.userId, userId));
    await tx.delete(accountMembers).where(eq(accountMembers.userId, userId));
    await recordEvent(tx, {
      type: "account.deleted",
      userId,
      payload: { accounts: memberships.length, emptied: alone.length },
    });
  });
}
