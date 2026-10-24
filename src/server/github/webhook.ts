import { eq } from "drizzle-orm";
import { accountIdsForGithubLogin } from "../../db/accounts";
import type { Database } from "../../db/client";
import { PostgresLedger } from "../../db/ledger";
import {
  createProjectsFromInstallation,
  linkGithubRepositories,
  unlinkGithubRepositories,
} from "../../db/projects";
import { projects, pullRequests } from "../../db/schema";
import { queueCorrection, upsertTicket } from "../../db/workunits";

/* Minimal shapes of the GitHub webhook payloads we read. */
interface GitHubUser {
  login: string;
  type?: string;
}
interface GitHubRepository {
  id: number;
  full_name: string;
  private?: boolean;
  default_branch?: string;
}
interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: "open" | "closed";
  labels: { name: string }[];
  pull_request?: { html_url: string };
}
export interface GitHubPayload {
  action?: string;
  sender?: GitHubUser;
  installation?: { id: number };
  repository?: GitHubRepository;
  repositories?: GitHubRepository[];
  repositories_added?: GitHubRepository[];
  repositories_removed?: GitHubRepository[];
  issue?: GitHubIssue;
  comment?: {
    id: number;
    body: string;
    author_association: string;
    user: GitHubUser;
  };
  pull_request?: { html_url: string; merged: boolean };
}

const MENTION = /^\s*@yarrow-run\b[:,]?\s*/i;
const TRUSTED = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

async function projectForRepository(
  db: Database,
  repository?: GitHubRepository,
) {
  if (!repository) return null;
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.githubRepositoryId, String(repository.id)));
  return project ?? null;
}

/**
 * Installed repositories: the installer's existing projects get linked, the
 * others become new projects in the installer's account. GitHub signs the
 * payload, so `sender` really is who installed (repo admin rights).
 */
async function addRepositories(
  db: Database,
  installationId: string,
  sender: GitHubUser | undefined,
  repositories: GitHubRepository[],
): Promise<{ linked: number; created: number }> {
  const accounts = sender
    ? await accountIdsForGithubLogin(db, sender.login)
    : [];
  if (accounts.length === 0) return { linked: 0, created: 0 };
  const linked = await linkGithubRepositories(
    db,
    installationId,
    repositories.map((repository) => ({
      fullName: repository.full_name,
      id: String(repository.id),
    })),
    accounts,
  );
  const created = await createProjectsFromInstallation(
    db,
    accounts[0]!,
    installationId,
    repositories.map((repository) => ({
      id: String(repository.id),
      fullName: repository.full_name,
      private: repository.private ?? true,
    })),
  );
  return { linked: linked.length, created: created.length };
}

/**
 * Applies one verified GitHub App webhook. Returns a short description for
 * logs. Unknown events and repositories are ignored, never errors.
 */
export async function handleGitHubEvent(
  db: Database,
  event: string,
  payload: GitHubPayload,
): Promise<string> {
  const installationId = payload.installation
    ? String(payload.installation.id)
    : null;

  if (event === "installation" && installationId) {
    if (payload.action === "deleted" || payload.action === "suspend") {
      await unlinkGithubRepositories(db, installationId);
      return "installation removed";
    }
    if (payload.action === "created" || payload.action === "unsuspend") {
      const { linked, created } = await addRepositories(
        db,
        installationId,
        payload.sender,
        payload.repositories ?? [],
      );
      return `installation linked ${linked} project(s), created ${created}`;
    }
  }

  if (event === "installation_repositories" && installationId) {
    const removed = (payload.repositories_removed ?? []).map((repository) =>
      String(repository.id),
    );
    if (removed.length > 0)
      await unlinkGithubRepositories(db, installationId, removed);
    const { linked, created } = await addRepositories(
      db,
      installationId,
      payload.sender,
      payload.repositories_added ?? [],
    );
    return `repositories updated: +${linked + created} -${removed.length}`;
  }

  if (event === "repository" && payload.action === "renamed") {
    const project = await projectForRepository(db, payload.repository);
    if (project && payload.repository)
      await db
        .update(projects)
        .set({ repository: payload.repository.full_name })
        .where(eq(projects.id, project.id));
    return "repository renamed";
  }

  if (event === "issues" && payload.issue) {
    const project = await projectForRepository(db, payload.repository);
    if (!project) return "ignored: repository not listed";
    const label = project.authorizationLabel.toLowerCase();
    const result = await upsertTicket(db, {
      projectId: project.id,
      source: "github",
      externalId: String(payload.issue.number),
      title: payload.issue.title,
      body: payload.issue.body ?? "",
      url: payload.issue.html_url,
      labeled: payload.issue.labels.some(
        (issueLabel) => issueLabel.name.toLowerCase() === label,
      ),
      closed: payload.issue.state === "closed",
    });
    return result.queued ? "issue queued" : "issue updated";
  }

  if (
    event === "issue_comment" &&
    payload.action === "created" &&
    payload.issue?.pull_request &&
    payload.comment
  ) {
    const { comment } = payload;
    if (comment.user.type === "Bot") return "ignored: bot comment";
    if (!MENTION.test(comment.body)) return "ignored: no mention";
    if (!TRUSTED.has(comment.author_association))
      return "ignored: commenter is not a maintainer";
    const instruction = comment.body.replace(MENTION, "").trim();
    if (!instruction) return "ignored: empty request";
    const queued = await queueCorrection(db, {
      pullRequestUrl: payload.issue.pull_request.html_url,
      instruction: instruction.slice(0, 4000),
      requestedBy: comment.user.login,
      externalCommentId: String(comment.id),
    });
    return queued ? "correction queued" : "ignored: not an open Yarrow PR";
  }

  if (
    event === "pull_request" &&
    payload.action === "closed" &&
    payload.pull_request
  ) {
    const [ours] = await db
      .select({ id: pullRequests.id })
      .from(pullRequests)
      .where(eq(pullRequests.url, payload.pull_request.html_url));
    if (!ours) return "ignored: not an Yarrow PR";
    await new PostgresLedger(db).closePullRequest(
      payload.pull_request.html_url,
      payload.pull_request.merged ? "merged" : "closed",
    );
    return payload.pull_request.merged
      ? "pull request merged"
      : "pull request closed";
  }

  return `ignored: ${event}${payload.action ? `.${payload.action}` : ""}`;
}
