import { GitHubError, type GitHubClient } from "./app";

/** A file the implementer changed. `content: null` deletes the file. */
export interface FileChange {
  path: string;
  content: string | null;
  encoding?: "utf-8" | "base64";
  /** "100755" for executables. Defaults to a regular file. */
  mode?: "100644" | "100755";
}

export interface Repository {
  owner: string;
  repo: string;
}

export function splitRepository(fullName: string): Repository {
  const [owner, repo] = fullName.split("/");
  if (!owner || !repo) throw new Error(`Invalid repository ${fullName}`);
  return { owner, repo };
}

/**
 * yarrow/fix-the-export-button-1a2b3c4d. A Jira key in front of the title
 * stays in capitals ("yarrow/APP-42-fix-…"): Jira links the branch to the
 * ticket by it.
 */
export function branchName(title: string, workUnitId: string): string {
  const key = /^([A-Z][A-Z0-9_]+-\d+)\s+/.exec(title)?.[1];
  const slug = (key ? title.slice(key.length) : title)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  const name = [key, slug].filter(Boolean).join("-") || "ticket";
  return `yarrow/${name}-${workUnitId.slice(0, 8)}`;
}

async function branchHead(
  client: GitHubClient,
  { owner, repo }: Repository,
  branch: string,
): Promise<string | null> {
  try {
    const ref = await client.request<{ object: { sha: string } }>(
      "GET",
      `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch).replace(/%2F/g, "/")}`,
    );
    return ref.object.sha;
  } catch (error) {
    if (error instanceof GitHubError && error.status === 404) return null;
    throw error;
  }
}

/**
 * A repository with no commit has no branch to clone and none to open a pull
 * request against: its default branch gets a first commit, a README with its
 * name, as GitHub's own first page offers. The contents API is the one write
 * an empty repository accepts (the Git Database answers 409). Two runs may
 * start together on it: the second finds the first one's commit.
 */
export async function ensureFirstCommit(
  client: GitHubClient,
  { owner, repo }: Repository,
): Promise<void> {
  try {
    await client.request("GET", `/repos/${owner}/${repo}/commits?per_page=1`);
    return;
  } catch (error) {
    if (!(error instanceof GitHubError) || error.status !== 409) throw error;
  }
  try {
    await client.request("PUT", `/repos/${owner}/${repo}/contents/README.md`, {
      message: "Initial commit",
      content: btoa(`# ${repo}\n`),
    });
  } catch (error) {
    if (
      !(error instanceof GitHubError) ||
      (error.status !== 409 && error.status !== 422)
    )
      throw error;
  }
}

/**
 * One commit with every change, on `branch`. The branch is created from
 * `baseBranch` the first time; corrections add a commit on top of it.
 * Returns the new commit SHA.
 */
export async function commitChanges(
  client: GitHubClient,
  repository: Repository,
  input: {
    baseBranch: string;
    branch: string;
    files: FileChange[];
    message: string;
  },
): Promise<string> {
  if (input.files.length === 0) throw new Error("Nothing to commit");
  const { owner, repo } = repository;
  const existing = await branchHead(client, repository, input.branch);
  const parent =
    existing ?? (await branchHead(client, repository, input.baseBranch));
  if (!parent) throw new Error(`Base branch ${input.baseBranch} not found`);
  const parentCommit = await client.request<{ tree: { sha: string } }>(
    "GET",
    `/repos/${owner}/${repo}/git/commits/${parent}`,
  );
  // Text goes inline in the tree request: one call to GitHub whatever the
  // number of files (a Worker invocation has a subrequest limit). Only
  // binary files need a blob of their own.
  const tree = [];
  for (const file of input.files) {
    if (file.content === null) {
      tree.push({ path: file.path, mode: "100644", type: "blob", sha: null });
      continue;
    }
    if ((file.encoding ?? "utf-8") === "utf-8") {
      tree.push({
        path: file.path,
        mode: file.mode ?? "100644",
        type: "blob",
        content: file.content,
      });
      continue;
    }
    const blob = await client.request<{ sha: string }>(
      "POST",
      `/repos/${owner}/${repo}/git/blobs`,
      { content: file.content, encoding: file.encoding ?? "utf-8" },
    );
    tree.push({
      path: file.path,
      mode: file.mode ?? "100644",
      type: "blob",
      sha: blob.sha,
    });
  }
  const newTree = await client.request<{ sha: string }>(
    "POST",
    `/repos/${owner}/${repo}/git/trees`,
    { base_tree: parentCommit.tree.sha, tree },
  );
  const commit = await client.request<{ sha: string }>(
    "POST",
    `/repos/${owner}/${repo}/git/commits`,
    { message: input.message, tree: newTree.sha, parents: [parent] },
  );
  if (existing)
    await client.request(
      "PATCH",
      `/repos/${owner}/${repo}/git/refs/heads/${input.branch}`,
      { sha: commit.sha, force: false },
    );
  else
    await client.request("POST", `/repos/${owner}/${repo}/git/refs`, {
      ref: `refs/heads/${input.branch}`,
      sha: commit.sha,
    });
  return commit.sha;
}

/** Opens the draft PR, or returns the one already open for `head` (retry-safe). */
export async function openDraftPullRequest(
  client: GitHubClient,
  { owner, repo }: Repository,
  input: { head: string; base: string; title: string; body: string },
): Promise<{ number: number; url: string }> {
  try {
    const pull = await client.request<{ number: number; html_url: string }>(
      "POST",
      `/repos/${owner}/${repo}/pulls`,
      { ...input, draft: true, maintainer_can_modify: true },
    );
    return { number: pull.number, url: pull.html_url };
  } catch (error) {
    if (!(error instanceof GitHubError) || error.status !== 422) throw error;
    const open = await client.request<{ number: number; html_url: string }[]>(
      "GET",
      `/repos/${owner}/${repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${input.head}`)}`,
    );
    if (!open[0]) throw error;
    return { number: open[0].number, url: open[0].html_url };
  }
}

export async function commentOnIssue(
  client: GitHubClient,
  { owner, repo }: Repository,
  number: number,
  body: string,
): Promise<void> {
  await client.request(
    "POST",
    `/repos/${owner}/${repo}/issues/${number}/comments`,
    {
      body,
    },
  );
}

/** Adds a correction note to the PR body so the history stays readable. */
export async function updatePullRequestBody(
  client: GitHubClient,
  { owner, repo }: Repository,
  number: number,
  body: string,
): Promise<void> {
  await client.request("PATCH", `/repos/${owner}/${repo}/pulls/${number}`, {
    body,
  });
}
