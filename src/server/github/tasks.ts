import type { Database } from "../../db/client";
import {
  applyRepositoryDetails,
  finishGithubTask,
  pendingGithubTasks,
  type PendingGithubTask,
} from "../../db/github-tasks";
import {
  GitHubClient,
  GitHubError,
  installationToken,
  type AppCredentials,
  type Fetch,
} from "./app";

const LABEL = {
  color: "E6AE38",
  description: "Yarrow turns this ticket into a pull request",
};

async function setupProject(
  client: GitHubClient,
  db: Database,
  task: PendingGithubTask,
): Promise<void> {
  const repo = await client.request<{
    description: string | null;
    homepage: string | null;
    default_branch: string;
  }>("GET", `/repos/${task.repository}`);
  const languages = await client.request<Record<string, number>>(
    "GET",
    `/repos/${task.repository}/languages`,
  );
  await applyRepositoryDetails(db, task.projectId, {
    description: repo.description,
    homepage: repo.homepage,
    defaultBranch: repo.default_branch,
    languages: Object.entries(languages)
      .sort(([, a], [, b]) => b - a)
      .map(([language]) => language),
  });
  try {
    await client.request("POST", `/repos/${task.repository}/labels`, {
      name: task.label,
      ...LABEL,
    });
  } catch (error) {
    // 422: the label already exists, which is all we wanted.
    if (!(error instanceof GitHubError && error.status === 422)) throw error;
  }
}

/**
 * Carries out the GitHub writes the web app asked for. Runs in the brain:
 * the only GitHub write path. Returns one log line per task.
 */
export async function runGithubTasks(
  db: Database,
  credentials: AppCredentials,
  fetcher?: Fetch,
): Promise<string[]> {
  const log: string[] = [];
  for (const task of await pendingGithubTasks(db)) {
    try {
      const { token } = await installationToken(
        credentials,
        task.installationId,
        { repositoryIds: [Number(task.githubRepositoryId)] },
        fetcher,
      );
      const client = new GitHubClient(token, fetcher);
      if (task.kind === "setup_project") await setupProject(client, db, task);
      else
        // Labeling is the owner's authorization: the issues webhook queues it.
        await client.request(
          "POST",
          `/repos/${task.repository}/issues/${task.issueNumber}/labels`,
          { labels: [task.label] },
        );
      await finishGithubTask(db, task.id);
      log.push(`${task.kind} ${task.repository} done`);
    } catch (error) {
      await finishGithubTask(db, task.id, (error as Error).message);
      log.push(`${task.kind} ${task.repository}: ${(error as Error).message}`);
    }
  }
  return log;
}
