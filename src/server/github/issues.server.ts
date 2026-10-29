import { ticketIdentity, type OpenIssue } from "../../core/tickets";
import { appEnv } from "../env.server";
import { GitHubClient, installationToken, type TokenPermissions } from "./app";

/**
 * Read-only issue tokens, kept per repository while they have more than five
 * minutes left (GitHub gives them an hour). Saves a round trip to GitHub on
 * every dashboard load. Lives in the Worker isolate's memory only.
 */
const readTokens = new Map<string, { token: string; expiresAt: number }>();

/** What each read needs: issues for the table, pull requests for a panel. */
const READS = {
  issues: { issues: "read", metadata: "read" },
  pulls: { pull_requests: "read", contents: "read", metadata: "read" },
} as const satisfies Record<string, TokenPermissions>;

export async function readToken(
  credentials: { appId: string; privateKey: string },
  installationId: string,
  repositoryId: number,
  read: keyof typeof READS,
): Promise<string> {
  const key = `${installationId}:${repositoryId}:${read}`;
  const cached = readTokens.get(key);
  if (cached && cached.expiresAt - Date.now() > 5 * 60_000) return cached.token;
  const { token, expiresAt } = await installationToken(
    credentials,
    installationId,
    { repositoryIds: [repositoryId], permissions: READS[read] },
  );
  readTokens.set(key, { token, expiresAt: Date.parse(expiresAt) });
  return token;
}

/** A revoked install or a narrowed repository list: a new token next time. */
export function forgetReadToken(
  installationId: string,
  repositoryId: number,
  read: keyof typeof READS,
): void {
  readTokens.delete(`${installationId}:${repositoryId}:${read}`);
}

/**
 * A repository's open issues, read live with a read-only installation token.
 * They are shown, never stored: Yarrow only keeps the tickets it works on.
 * Null when GitHub cannot be reached; the table then shows Yarrow's tickets.
 */
export async function openIssues(project: {
  repository: string;
  githubInstallationId: string | null;
  githubRepositoryId: string | null;
}): Promise<OpenIssue[] | null> {
  const env = appEnv();
  if (
    !env.GITHUB_APP_ID ||
    !env.GITHUB_APP_PRIVATE_KEY ||
    !project.githubInstallationId ||
    !project.githubRepositoryId
  )
    return null;
  try {
    const token = await readToken(
      { appId: env.GITHUB_APP_ID, privateKey: env.GITHUB_APP_PRIVATE_KEY },
      project.githubInstallationId,
      Number(project.githubRepositoryId),
      "issues",
    );
    const items = await new GitHubClient(token).request<
      {
        number: number;
        title: string;
        html_url: string;
        created_at: string;
        updated_at: string;
        pull_request?: unknown;
      }[]
    >(
      "GET",
      `/repos/${project.repository}/issues?state=open&sort=updated&per_page=100`,
    );
    return items
      .filter((item) => !item.pull_request)
      .map((item) => ({
        ...ticketIdentity("github", String(item.number)),
        title: item.title,
        url: item.html_url,
        createdAt: new Date(item.created_at).toISOString(),
        updatedAt: new Date(item.updated_at).toISOString(),
      }));
  } catch (error) {
    forgetReadToken(
      project.githubInstallationId,
      Number(project.githubRepositoryId),
      "issues",
    );
    console.error("open issues", project.repository, error);
    return null;
  }
}

/** One issue as its opened row shows it: what it asks, when, by whom. */
export interface IssueDetail {
  body: string;
  createdAt: string | null;
  author: string | null;
  labels: string[];
  url: string;
}

/** A repository's issue, read live. Null when GitHub cannot be reached. */
export async function readIssue(
  project: {
    repository: string;
    githubInstallationId: string | null;
    githubRepositoryId: string | null;
  },
  number: number,
): Promise<IssueDetail | null> {
  const env = appEnv();
  if (
    !env.GITHUB_APP_ID ||
    !env.GITHUB_APP_PRIVATE_KEY ||
    !project.githubInstallationId ||
    !project.githubRepositoryId
  )
    return null;
  try {
    const token = await readToken(
      { appId: env.GITHUB_APP_ID, privateKey: env.GITHUB_APP_PRIVATE_KEY },
      project.githubInstallationId,
      Number(project.githubRepositoryId),
      "issues",
    );
    const issue = await new GitHubClient(token).request<{
      body: string | null;
      created_at: string;
      html_url: string;
      user: { login: string } | null;
      labels: ({ name?: string } | string)[];
    }>("GET", `/repos/${project.repository}/issues/${number}`);
    return {
      body: issue.body ?? "",
      createdAt: new Date(issue.created_at).toISOString(),
      author: issue.user?.login ?? null,
      labels: issue.labels
        .map((label) => (typeof label === "string" ? label : label.name))
        .filter((name): name is string => Boolean(name)),
      url: issue.html_url,
    };
  } catch (error) {
    console.error("issue", project.repository, number, error);
    return null;
  }
}
