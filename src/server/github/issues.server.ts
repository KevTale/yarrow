import type { OpenIssue } from "../../core/tickets";
import { appEnv } from "../env.server";
import { GitHubClient, installationToken } from "./app";

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
    const { token } = await installationToken(
      { appId: env.GITHUB_APP_ID, privateKey: env.GITHUB_APP_PRIVATE_KEY },
      project.githubInstallationId,
      {
        repositoryIds: [Number(project.githubRepositoryId)],
        permissions: { issues: "read", metadata: "read" },
      },
    );
    const items = await new GitHubClient(token).request<
      {
        number: number;
        title: string;
        html_url: string;
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
        number: item.number,
        title: item.title,
        url: item.html_url,
        updatedAt: new Date(item.updated_at).toISOString(),
      }));
  } catch (error) {
    console.error("open issues", project.repository, error);
    return null;
  }
}
