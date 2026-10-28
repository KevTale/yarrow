import { parsePatch, pullRequestRisks, type DiffLine } from "../../core/diff";
import { appEnv } from "../env.server";
import { GitHubClient } from "./app";
import { forgetReadToken, readToken } from "./issues.server";

interface Project {
  repository: string;
  githubInstallationId: string | null;
  githubRepositoryId: string | null;
}

/** GitHub's side of a pull request, read live: never stored. */
export interface LivePull {
  draft: boolean;
  merged: boolean;
  open: boolean;
  additions: number;
  deletions: number;
  changedFiles: number;
  /** What the agents flagged, from the description's "Risks". */
  risks: string[];
}

export interface PullFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  /** Null when GitHub sends no patch: a binary or a very large file. */
  lines: DiffLine[] | null;
}

async function client(project: Project): Promise<GitHubClient | null> {
  const env = appEnv();
  if (
    !env.GITHUB_APP_ID ||
    !env.GITHUB_APP_PRIVATE_KEY ||
    !project.githubInstallationId ||
    !project.githubRepositoryId
  )
    return null;
  const token = await readToken(
    { appId: env.GITHUB_APP_ID, privateKey: env.GITHUB_APP_PRIVATE_KEY },
    project.githubInstallationId,
    Number(project.githubRepositoryId),
    "pulls",
  );
  return new GitHubClient(token);
}

async function read<T>(
  project: Project,
  work: (github: GitHubClient) => Promise<T>,
): Promise<T | null> {
  try {
    const github = await client(project);
    return github ? await work(github) : null;
  } catch (error) {
    if (project.githubInstallationId && project.githubRepositoryId)
      forgetReadToken(
        project.githubInstallationId,
        Number(project.githubRepositoryId),
        "pulls",
      );
    console.error("pull request", project.repository, error);
    return null;
  }
}

/** Null when GitHub cannot be reached: the panel shows Yarrow's side. */
export function livePull(
  project: Project,
  number: number,
): Promise<LivePull | null> {
  return read(project, async (github) => {
    const pull = await github.request<{
      draft: boolean;
      merged: boolean;
      state: "open" | "closed";
      additions: number;
      deletions: number;
      changed_files: number;
      body: string | null;
    }>("GET", `/repos/${project.repository}/pulls/${number}`);
    return {
      draft: pull.draft,
      merged: pull.merged,
      open: pull.state === "open",
      additions: pull.additions,
      deletions: pull.deletions,
      changedFiles: pull.changed_files,
      risks: pullRequestRisks(pull.body),
    };
  });
}

/** The changed files with their numbered lines, at most 300 files. */
export function pullFiles(
  project: Project,
  number: number,
): Promise<PullFile[] | null> {
  return read(project, async (github) => {
    const files: PullFile[] = [];
    for (let page = 1; page <= 3; page++) {
      const batch = await github.request<
        {
          filename: string;
          status: string;
          additions: number;
          deletions: number;
          patch?: string;
        }[]
      >(
        "GET",
        `/repos/${project.repository}/pulls/${number}/files?per_page=100&page=${page}`,
      );
      files.push(
        ...batch.map((file) => ({
          path: file.filename,
          status: file.status,
          additions: file.additions,
          deletions: file.deletions,
          lines: file.patch ? parsePatch(file.patch) : null,
        })),
      );
      if (batch.length < 100) break;
    }
    return files;
  });
}
