import type { AbstentionReason } from "./contracts";

/**
 * The message as thrown, without the error's name that Workflows puts in
 * front of it ("NonRetryableError: GitHub POST …").
 */
const bare = (message: string) => message.replace(/^[A-Za-z]*Error: /, "");

/** "GitHub POST /repos/acme/app/git/trees failed (403): {…}" → 403. */
function githubStatus(message: string): number | null {
  const match = /^GitHub [A-Z]+ \S+ failed \((\d{3})\)/.exec(bare(message));
  return match ? Number(match[1]) : null;
}

/**
 * GitHub turned the request down for a reason a retry will not change: a
 * permission the app lacks, a repository it cannot see, a write it rejects.
 */
export function isGithubRefusal(message: string): boolean {
  const status = githubStatus(message);
  return status === 401 || status === 403 || status === 404 || status === 422;
}

/**
 * Why a run stopped, from the error it stopped on, in words a builder can act
 * on. `paths` are the files the run changed: a refused write under
 * `.github/workflows/` means the GitHub App lacks the Workflows permission.
 */
export function describeFailure(
  message: string,
  paths: readonly string[] = [],
): { reason: AbstentionReason; summary: string } {
  if (githubStatus(message) === 403) {
    const workflow = paths.find((path) =>
      path.startsWith(".github/workflows/"),
    );
    return {
      reason: "github_refused",
      summary: workflow
        ? `GitHub refused to write ${workflow}: the Yarrow app needs the Workflows permission on this repository.`
        : "GitHub refused the change: the Yarrow app is missing a permission on this repository.",
    };
  }
  if (isGithubRefusal(message))
    return {
      reason: "github_refused",
      summary:
        "GitHub refused the change: the repository or the branch is out of the Yarrow app's reach.",
    };
  if (/^(Anthropic|OpenAI) /.test(bare(message)))
    return { reason: "provider_error", summary: bare(message) };
  return {
    reason: "platform_error",
    summary:
      "Yarrow stopped on an internal error before the pull request could open.",
  };
}
