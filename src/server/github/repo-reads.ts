import {
  GitHubClient,
  GitHubError,
  installationToken,
  type AppCredentials,
  type Fetch,
} from "./app";

/**
 * What the chat's agent reads on GitHub, with a read-only token on the one
 * repository: files, the tree, code search, issues, the pull request's diff.
 */
export interface RepoReader {
  /** The file's text at `ref`; a directory's entries; null when absent. */
  readFile(
    path: string,
    ref: string,
  ): Promise<
    | { kind: "file"; text: string }
    | { kind: "directory"; entries: string[] }
    | { kind: "binary" }
    | null
  >;
  /** Every file path at `ref`, and whether GitHub cut the list. */
  listFiles(ref: string): Promise<{ paths: string[]; truncated: boolean }>;
  /** GitHub's code search: the default branch only. */
  searchCode(query: string): Promise<string[]>;
  openIssues(): Promise<{ number: number; title: string; url: string }[]>;
  readIssue(
    number: number,
  ): Promise<{
    title: string;
    body: string;
    url: string;
    state: string;
  } | null>;
  pullDiff(number: number): Promise<
    {
      path: string;
      status: string;
      additions: number;
      deletions: number;
      patch: string | null;
    }[]
  >;
}

const decode = (base64: string) =>
  new TextDecoder().decode(
    Uint8Array.from(atob(base64.replace(/\n/g, "")), (c) => c.charCodeAt(0)),
  );

const missing = (error: unknown) =>
  error instanceof GitHubError &&
  (error.status === 404 || error.status === 422);

export async function repoReader(
  credentials: AppCredentials,
  project: {
    repository: string;
    githubInstallationId: string | null;
    githubRepositoryId: string | null;
  },
  fetcher?: Fetch,
): Promise<RepoReader | null> {
  if (!project.githubInstallationId || !project.githubRepositoryId) return null;
  const { token } = await installationToken(
    credentials,
    project.githubInstallationId,
    {
      repositoryIds: [Number(project.githubRepositoryId)],
      permissions: {
        contents: "read",
        pull_requests: "read",
        issues: "read",
        metadata: "read",
      },
    },
    fetcher,
  );
  const github = new GitHubClient(token, fetcher);
  const repo = `/repos/${project.repository}`;
  const path = (value: string) =>
    value.replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/");

  return {
    async readFile(file, ref) {
      try {
        const found = await github.request<
          | { type: string; encoding?: string; content?: string; size: number }
          | { path: string; type: string }[]
        >(
          "GET",
          `${repo}/contents/${path(file)}?ref=${encodeURIComponent(ref)}`,
        );
        if (Array.isArray(found))
          return {
            kind: "directory",
            entries: found.map(
              (entry) => `${entry.path}${entry.type === "dir" ? "/" : ""}`,
            ),
          };
        if (found.encoding !== "base64" || found.content === undefined)
          return { kind: "binary" };
        const text = decode(found.content);
        return text.includes("\u0000")
          ? { kind: "binary" }
          : { kind: "file", text };
      } catch (error) {
        if (missing(error)) return null;
        throw error;
      }
    },

    async listFiles(ref) {
      const tree = await github.request<{
        tree: { path: string; type: string }[];
        truncated: boolean;
      }>("GET", `${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`);
      return {
        paths: tree.tree
          .filter((entry) => entry.type === "blob")
          .map((entry) => entry.path),
        truncated: tree.truncated,
      };
    },

    async searchCode(query) {
      try {
        const found = await github.request<{ items: { path: string }[] }>(
          "GET",
          `/search/code?q=${encodeURIComponent(`${query} repo:${project.repository}`)}&per_page=30`,
        );
        return [...new Set(found.items.map((item) => item.path))];
      } catch (error) {
        if (missing(error)) return [];
        throw error;
      }
    },

    async openIssues() {
      const items = await github.request<
        {
          number: number;
          title: string;
          html_url: string;
          pull_request?: unknown;
        }[]
      >("GET", `${repo}/issues?state=open&sort=updated&per_page=100`);
      return items
        .filter((item) => !item.pull_request)
        .map((item) => ({
          number: item.number,
          title: item.title,
          url: item.html_url,
        }));
    },

    async readIssue(number) {
      try {
        const issue = await github.request<{
          title: string;
          body: string | null;
          html_url: string;
          state: string;
        }>("GET", `${repo}/issues/${number}`);
        return {
          title: issue.title,
          body: issue.body ?? "",
          url: issue.html_url,
          state: issue.state,
        };
      } catch (error) {
        if (missing(error)) return null;
        throw error;
      }
    },

    async pullDiff(number) {
      const files: Awaited<ReturnType<RepoReader["pullDiff"]>> = [];
      for (let page = 1; page <= 3; page++) {
        const batch = await github.request<
          {
            filename: string;
            status: string;
            additions: number;
            deletions: number;
            patch?: string;
          }[]
        >("GET", `${repo}/pulls/${number}/files?per_page=100&page=${page}`);
        files.push(
          ...batch.map((file) => ({
            path: file.filename,
            status: file.status,
            additions: file.additions,
            deletions: file.deletions,
            patch: file.patch ?? null,
          })),
        );
        if (batch.length < 100) break;
      }
      return files;
    },
  };
}
