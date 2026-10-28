import { eq } from "drizzle-orm";
import type { Database } from "../../db/client";
import { PostgresLedger } from "../../db/ledger";
import { projects, pullRequests, workUnits } from "../../db/schema";
import { queueCorrection } from "../../db/workunits";
import {
  GitHubClient,
  GitHubError,
  installationToken,
  type AppCredentials,
  type Fetch,
} from "./app";
import { splitRepository } from "./delivery";

/**
 * What the builder does on a Yarrow pull request from the dashboard: mark it
 * ready, merge it, ask for a change. Only the brain runs these (the one
 * GitHub write path), through the App's installation on the repository.
 */
export type PullRequestAction = "ready" | "merge";
export type ActionResult = { ok: true } | { ok: false; error: string };

async function target(db: Database, workUnitId: string) {
  const [row] = await db
    .select({ project: projects, pull: pullRequests })
    .from(pullRequests)
    .innerJoin(workUnits, eq(workUnits.id, pullRequests.workUnitId))
    .innerJoin(projects, eq(projects.id, workUnits.projectId))
    .where(eq(pullRequests.workUnitId, workUnitId));
  if (!row?.project.githubInstallationId || !row.project.githubRepositoryId)
    return null;
  return row;
}

async function writeClient(
  credentials: AppCredentials,
  project: {
    githubInstallationId: string | null;
    githubRepositoryId: string | null;
  },
  fetcher?: Fetch,
): Promise<GitHubClient> {
  const { token } = await installationToken(
    credentials,
    project.githubInstallationId!,
    {
      repositoryIds: [Number(project.githubRepositoryId)],
      permissions: {
        contents: "write",
        pull_requests: "write",
        issues: "write",
      },
    },
    fetcher,
  );
  return new GitHubClient(token, fetcher);
}

/** GitHub's own words for a refusal ("Pull Request is not mergeable"). */
function reason(error: unknown): string {
  if (error instanceof GitHubError) {
    const json = /\{.*\}$/s.exec(error.message)?.[0];
    try {
      const message = json
        ? (JSON.parse(json) as { message?: string }).message
        : null;
      if (message) return message;
    } catch {
      // Not JSON: the status line says enough.
    }
    return `GitHub refused (${error.status}).`;
  }
  return error instanceof Error ? error.message : String(error);
}

interface PullState {
  node_id: string;
  draft: boolean;
  merged: boolean;
  state: "open" | "closed";
}

async function markReady(client: GitHubClient, nodeId: string): Promise<void> {
  // REST cannot take a pull request out of draft; GraphQL can.
  const result = await client.request<{ errors?: { message: string }[] }>(
    "POST",
    "/graphql",
    {
      query:
        "mutation($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { pullRequest { isDraft } } }",
      variables: { id: nodeId },
    },
  );
  if (result.errors?.length) throw new Error(result.errors[0]!.message);
}

/**
 * Ready for review: the draft becomes a pull request people are asked to
 * review, CI set to wait for it starts, and it can be merged. Merge marks
 * it ready first, then merges with the first method the repository allows
 * (squash, merge commit, rebase).
 */
export async function pullRequestAction(
  db: Database,
  credentials: AppCredentials,
  input: { workUnitId: string; action: PullRequestAction },
  fetcher?: Fetch,
): Promise<ActionResult> {
  const row = await target(db, input.workUnitId);
  if (!row) return { ok: false, error: "This pull request is not Yarrow's." };
  if (row.pull.state !== "open")
    return { ok: false, error: "This pull request is already closed." };
  const { owner, repo } = splitRepository(row.project.repository);
  try {
    const client = await writeClient(credentials, row.project, fetcher);
    const path = `/repos/${owner}/${repo}/pulls/${row.pull.number}`;
    const pull = await client.request<PullState>("GET", path);
    if (pull.merged || pull.state !== "open")
      return { ok: false, error: "This pull request is already closed." };
    if (pull.draft) await markReady(client, pull.node_id);
    if (input.action === "ready") return { ok: true };
    const settings = await client.request<{
      allow_squash_merge?: boolean;
      allow_merge_commit?: boolean;
      allow_rebase_merge?: boolean;
    }>("GET", `/repos/${owner}/${repo}`);
    const method =
      settings.allow_squash_merge !== false
        ? "squash"
        : settings.allow_merge_commit !== false
          ? "merge"
          : "rebase";
    await client.request("PUT", `${path}/merge`, { merge_method: method });
    // The webhook says so too; recording it now updates the table at once.
    await new PostgresLedger(db)
      .closePullRequest(row.pull.url, "merged")
      .catch((error: Error) => console.warn("merged:", error.message));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: reason(error) };
  }
}

/** The comment that keeps a request made from Yarrow in the PR's history. */
export const askedFromYarrow = (login: string, instruction: string) =>
  `**${login}** asked from Yarrow:\n\n${instruction
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n")}`;

/**
 * A change asked from the dashboard: the App writes it on the pull request
 * (who asked, what), then it is queued like an `@yarrow-run` comment, the
 * comment's id keeping it from being queued twice.
 */
export async function requestCorrection(
  db: Database,
  credentials: AppCredentials,
  input: { workUnitId: string; instruction: string; login: string },
  fetcher?: Fetch,
): Promise<ActionResult> {
  const row = await target(db, input.workUnitId);
  if (!row) return { ok: false, error: "This pull request is not Yarrow's." };
  if (row.pull.state !== "open")
    return { ok: false, error: "This pull request is already closed." };
  const { owner, repo } = splitRepository(row.project.repository);
  try {
    const client = await writeClient(credentials, row.project, fetcher);
    const comment = await client.request<{ id: number }>(
      "POST",
      `/repos/${owner}/${repo}/issues/${row.pull.number}/comments`,
      { body: askedFromYarrow(input.login, input.instruction) },
    );
    const queued = await queueCorrection(db, {
      pullRequestUrl: row.pull.url,
      instruction: input.instruction,
      requestedBy: input.login,
      externalCommentId: String(comment.id),
    });
    return queued
      ? { ok: true }
      : { ok: false, error: "This pull request is already closed." };
  } catch (error) {
    return { ok: false, error: reason(error) };
  }
}
