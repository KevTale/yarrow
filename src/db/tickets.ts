import { and, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import {
  bareTitle,
  phaseStatus,
  runModelsView,
  ticketIdentity,
  type ReviewRow,
  type TicketModel,
  type TicketRow,
  type TicketStatus,
} from "../core/tickets";
import type { Database } from "./client";
import { recordEvent } from "./events";
import { MAX_GITHUB_TASK_ATTEMPTS } from "./github-tasks";
import {
  agentRuns,
  githubTasks,
  pullRequests,
  results,
  runModels,
  workUnits,
} from "./schema";

const iso = (date: Date | string | null | undefined) =>
  date ? new Date(date).toISOString() : "";
const latest = (...dates: (Date | string | null | undefined)[]) =>
  dates.map(iso).sort().at(-1) ?? "";

/**
 * The tickets Yarrow knows for a project (GitHub issues and tracker
 * tickets), with their status, pull request, models and pending label
 * changes. Open tickets Yarrow never touched come from GitHub or the
 * tracker and are merged in by `mergeTickets`.
 */
export async function projectTickets(
  db: Database,
  projectId: string,
): Promise<TicketRow[]> {
  const units = await db
    .select()
    .from(workUnits)
    .where(eq(workUnits.projectId, projectId));
  const unitIds = units.map((unit) => unit.id);
  const runs = unitIds.length
    ? await db
        .select({
          id: agentRuns.id,
          workUnitId: agentRuns.workUnitId,
          status: agentRuns.status,
          phase: agentRuns.phase,
          implementer: agentRuns.implementer,
          reviewer: agentRuns.reviewer,
          createdAt: agentRuns.createdAt,
          finishedAt: agentRuns.finishedAt,
          abstentionReason: results.abstentionReason,
          summary: results.summary,
        })
        .from(agentRuns)
        .leftJoin(results, eq(results.agentRunId, agentRuns.id))
        .where(inArray(agentRuns.workUnitId, unitIds))
        .orderBy(desc(agentRuns.createdAt))
    : [];
  const lastRun = new Map<string, (typeof runs)[number]>();
  for (const run of runs)
    if (!lastRun.has(run.workUnitId)) lastRun.set(run.workUnitId, run);
  const runIds = [...lastRun.values()].map((run) => run.id);
  const models = runIds.length
    ? await db
        .select()
        .from(runModels)
        .where(inArray(runModels.agentRunId, runIds))
    : [];
  const pulls = unitIds.length
    ? await db
        .select()
        .from(pullRequests)
        .where(inArray(pullRequests.workUnitId, unitIds))
    : [];
  const tasks = await db
    .select()
    .from(githubTasks)
    .where(
      and(
        eq(githubTasks.projectId, projectId),
        isNull(githubTasks.doneAt),
        lt(githubTasks.attempts, MAX_GITHUB_TASK_ATTEMPTS),
      ),
    );
  const pendingLabel = new Map<number, "label_issue" | "unlabel_issue">();
  for (const task of tasks)
    if (task.kind === "label_issue" || task.kind === "unlabel_issue")
      pendingLabel.set(task.issueNumber, task.kind);

  // A ticket closed on GitHub before Yarrow shipped anything is gone.
  const shown = units.filter(
    (unit) =>
      unit.status !== "closed" ||
      pulls.some((pull) => pull.workUnitId === unit.id),
  );
  const rows: TicketRow[] = shown.map((unit) => {
    const identity = ticketIdentity(unit.source, unit.externalId);
    const run = lastRun.get(unit.id);
    const pull = pulls.find((row) => row.workUnitId === unit.id);
    // Label changes go through the brain on GitHub only; Jira's are direct.
    const pending =
      unit.source === "github"
        ? pendingLabel.get(Number(unit.externalId))
        : undefined;
    let status: TicketStatus;
    if (unit.status === "running") status = phaseStatus(run?.phase ?? null);
    else if (unit.status === "delivered") status = "pull_request";
    else if (unit.status === "closed")
      status =
        pull?.state === "merged"
          ? "merged"
          : pull?.state === "closed"
            ? "pr_closed"
            : "none";
    else if (unit.status === "abstained")
      status = unit.authorized ? "abstained" : "none";
    else status = unit.authorized ? "queued" : "none";
    // The brain has not changed the label on GitHub yet.
    const settled = ["none", "queued", "abstained"].includes(status);
    if (settled && pending === "label_issue") status = "queued";
    if (settled && pending === "unlabel_issue") status = "none";

    const ticketModels: TicketModel[] = run
      ? runModelsView(
          models.filter((model) => model.agentRunId === run.id),
          run,
          status,
        )
      : [];
    return {
      ...identity,
      title: bareTitle(unit.title, unit.externalId),
      url: unit.url,
      status,
      pending: settled && pending !== undefined,
      pullRequest: pull ? { number: pull.number, url: pull.url } : null,
      reason:
        status === "abstained"
          ? (run?.abstentionReason ?? run?.summary ?? null)
          : null,
      models: status === "none" || status === "queued" ? [] : ticketModels,
      updatedAt: latest(
        unit.status === "queued" ? unit.queuedAt : unit.createdAt,
        run?.createdAt,
        run?.finishedAt,
        pull?.closedAt,
      ),
    };
  });
  // Tickets created by the brain's labeling are not mirrored yet: show them queued.
  for (const [number, kind] of pendingLabel)
    if (
      kind === "label_issue" &&
      !rows.some((row) => row.source === "github" && row.number === number)
    )
      rows.push({
        ...ticketIdentity("github", String(number)),
        title: `#${number}`,
        url: "",
        status: "queued",
        pending: true,
        pullRequest: null,
        reason: null,
        models: [],
        updatedAt: new Date().toISOString(),
      });
  return rows;
}

/**
 * Draft pull requests waiting for their builder, across projects, newest
 * first. Only projects with a delivered ticket are read in full.
 */
export async function reviewQueue(
  db: Database,
  projects: { id: string; name: string; logoUrl: string | null }[],
): Promise<ReviewRow[]> {
  if (projects.length === 0) return [];
  const withPulls = await db
    .selectDistinct({ projectId: workUnits.projectId })
    .from(workUnits)
    .where(
      and(
        inArray(
          workUnits.projectId,
          projects.map((project) => project.id),
        ),
        eq(workUnits.status, "delivered"),
      ),
    );
  const rows: ReviewRow[] = [];
  for (const { projectId } of withPulls) {
    const project = projects.find((item) => item.id === projectId)!;
    for (const row of await projectTickets(db, projectId))
      if (row.status === "pull_request") rows.push({ ...row, project });
  }
  return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * An abstained ticket, queued again at the owner's request. The label is
 * still on GitHub, so nothing else changes.
 */
export async function retryTicket(
  db: Database,
  projectId: string,
  key: string,
): Promise<boolean> {
  const [unit] = await db
    .update(workUnits)
    .set({ status: "queued", queuedAt: new Date() })
    .where(
      and(
        eq(workUnits.projectId, projectId),
        eq(workUnits.externalId, key),
        eq(workUnits.status, "abstained"),
        eq(workUnits.authorized, true),
      ),
    )
    .returning({ id: workUnits.id });
  if (!unit) return false;
  await recordEvent(db, {
    type: "work_unit.queued",
    projectId,
    workUnitId: unit.id,
    payload: { retried: true },
  });
  return true;
}
