import type { Database } from "../../db/client";
import { keepGithubRepositories } from "../../db/projects";
import {
  GitHubClient,
  GitHubError,
  installationToken,
  type AppCredentials,
  type Fetch,
} from "./app";

/**
 * Lines an installation's projects up with the repositories GitHub lists for
 * it now, read-only. Its webhooks miss some changes: going from all
 * repositories to a few left every other one importable. Returns how many
 * were unlinked; an installation GitHub no longer knows loses them all.
 */
export async function syncInstallation(
  db: Database,
  credentials: AppCredentials,
  installationId: string,
  fetcher: Fetch = (input, init) => fetch(input, init),
): Promise<number> {
  let ids: string[];
  try {
    const { token } = await installationToken(
      credentials,
      installationId,
      { permissions: { metadata: "read" } },
      fetcher,
    );
    const client = new GitHubClient(token, fetcher);
    ids = [];
    for (let page = 1; ; page++) {
      const { repositories } = await client.request<{
        repositories: { id: number }[];
      }>("GET", `/installation/repositories?per_page=100&page=${page}`);
      ids.push(...repositories.map((repository) => String(repository.id)));
      if (repositories.length < 100) break;
    }
  } catch (error) {
    if (!(error instanceof GitHubError && error.status === 404)) throw error;
    ids = [];
  }
  return keepGithubRepositories(db, installationId, ids);
}
