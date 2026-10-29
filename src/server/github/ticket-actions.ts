import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "../../db/client";
import { recordEvent } from "../../db/events";
import { PostgresLedger } from "../../db/ledger";
import { projects, pullRequests, workUnits } from "../../db/schema";
import { retryTicket, signalIssues } from "../../db/tickets";
import type { AppCredentials, Fetch } from "./app";
import { splitRepository } from "./delivery";
import { reason, writeClient, type ActionResult } from "./pull-actions";

/**
 * What the builder does to a ticket itself from the dashboard, beyond its
 * pull request: answer the agents' questions, close it. Only the brain runs
 * the GitHub writes (the one GitHub write path); a Jira ticket's own write
 * is done by the web Worker before it asks the brain for the rest.
 */

/** The comment that keeps an answer given in Yarrow in the ticket's history. */
export const answeredFromYarrow = (login: string, answer: string) =>
  `**${login}** answered from Yarrow:\n\n${answer
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n")}`;

/** Why a pull request was closed, when the builder closed it in Yarrow. */
export const CLOSED_FROM_YARROW = "Closed from Yarrow";

async function projectFor(db: Database, projectId: string) {
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId));
  return project?.githubInstallationId && project.githubRepositoryId
    ? project
    : null;
}

async function unitFor(db: Database, projectId: string, key: string) {
  const [unit] = await db
    .select()
    .from(workUnits)
    .where(
      and(eq(workUnits.projectId, projectId), eq(workUnits.externalId, key)),
    );
  return unit ?? null;
}

/**
 * The agents stopped on a GitHub issue and asked: the answer goes on the
 * issue as a comment (the agents read the issue's comments), then the
 * ticket is queued again.
 */
export async function answerIssue(
  db: Database,
  credentials: AppCredentials,
  input: { projectId: string; key: string; answer: string; login: string },
  fetcher?: Fetch,
): Promise<ActionResult> {
  const project = await projectFor(db, input.projectId);
  const unit = await unitFor(db, input.projectId, input.key);
  if (!project || unit?.source !== "github" || unit.status !== "abstained")
    return { ok: false, error: "This ticket is not waiting for an answer." };
  const { owner, repo } = splitRepository(project.repository);
  try {
    const client = await writeClient(credentials, project, fetcher);
    await client.request(
      "POST",
      `/repos/${owner}/${repo}/issues/${input.key}/comments`,
      { body: answeredFromYarrow(input.login, input.answer) },
    );
  } catch (error) {
    return { ok: false, error: reason(error) };
  }
  return (await retryTicket(db, input.projectId, input.key))
    ? { ok: true }
    : { ok: false, error: "This ticket is not waiting for an answer." };
}

/** Closes a Yarrow pull request on GitHub, recorded as closed at once. */
export async function closePull(
  db: Database,
  credentials: AppCredentials,
  pull: { number: number; url: string },
  project: {
    repository: string;
    githubInstallationId: string | null;
    githubRepositoryId: string | null;
  },
  fetcher?: Fetch,
): Promise<void> {
  const { owner, repo } = splitRepository(project.repository);
  const client = await writeClient(credentials, project, fetcher);
  await client.request(
    "PATCH",
    `/repos/${owner}/${repo}/pulls/${pull.number}`,
    {
      state: "closed",
    },
  );
  // The webhook says so too; recording it now moves the row at once.
  await new PostgresLedger(db).closePullRequest(
    pull.url,
    "closed",
    CLOSED_FROM_YARROW,
  );
}

/**
 * Closes a ticket from the dashboard: a GitHub issue is closed as not
 * planned (a Jira ticket was moved to done by the web Worker already), its
 * open pull request is closed, and Yarrow stops waiting on it. Work at run
 * is never interrupted.
 */
export async function closeTicket(
  db: Database,
  credentials: AppCredentials,
  input: { projectId: string; key: string; source: "github" | "jira" },
  fetcher?: Fetch,
): Promise<ActionResult> {
  const project = await projectFor(db, input.projectId);
  if (!project)
    return { ok: false, error: "GitHub is not connected to this repository." };
  const unit = await unitFor(db, input.projectId, input.key);
  if (unit?.status === "running")
    return { ok: false, error: "The agents are working on it. Wait for them." };
  const [pull] = unit
    ? await db
        .select()
        .from(pullRequests)
        .where(
          and(
            eq(pullRequests.workUnitId, unit.id),
            eq(pullRequests.state, "open"),
          ),
        )
    : [];
  try {
    if (input.source === "github") {
      const { owner, repo } = splitRepository(project.repository);
      const client = await writeClient(credentials, project, fetcher);
      await client.request(
        "PATCH",
        `/repos/${owner}/${repo}/issues/${input.key}`,
        { state: "closed", state_reason: "not_planned" },
      );
    }
    if (pull) await closePull(db, credentials, pull, project, fetcher);
  } catch (error) {
    return { ok: false, error: reason(error) };
  }
  if (unit && !pull) {
    const [closed] = await db
      .update(workUnits)
      .set({ status: "closed" })
      .where(
        and(
          eq(workUnits.id, unit.id),
          inArray(workUnits.status, ["queued", "abstained"]),
        ),
      )
      .returning({ id: workUnits.id });
    if (closed)
      await recordEvent(db, {
        type: "work_unit.unqueued",
        projectId: input.projectId,
        workUnitId: unit.id,
        payload: { closed: true, fromYarrow: true },
      });
  }
  await signalIssues(db, input.projectId);
  return { ok: true };
}

/** Closes a ticket's pull request alone: the ticket stays open. */
export async function closePullRequest(
  db: Database,
  credentials: AppCredentials,
  input: { workUnitId: string },
  fetcher?: Fetch,
): Promise<ActionResult> {
  const [row] = await db
    .select({ project: projects, pull: pullRequests })
    .from(pullRequests)
    .innerJoin(workUnits, eq(workUnits.id, pullRequests.workUnitId))
    .innerJoin(projects, eq(projects.id, workUnits.projectId))
    .where(eq(pullRequests.workUnitId, input.workUnitId));
  if (!row?.project.githubInstallationId)
    return { ok: false, error: "This pull request is not Yarrow's." };
  if (row.pull.state !== "open")
    return { ok: false, error: "This pull request is already closed." };
  try {
    await closePull(db, credentials, row.pull, row.project, fetcher);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: reason(error) };
  }
}
