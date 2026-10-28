/** One line of a unified diff, as the dashboard draws it. */
export type DiffLine =
  | { kind: "hunk"; text: string }
  | { kind: "add"; new: number; text: string }
  | { kind: "del"; old: number; text: string }
  | { kind: "ctx"; old: number; new: number; text: string };

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/;

/**
 * GitHub's `patch` for one file (hunks only, no file header) as numbered
 * lines. "\ No newline at end of file" markers are dropped.
 */
export function parsePatch(patch: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  for (const raw of patch.split("\n")) {
    const hunk = HUNK.exec(raw);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      lines.push({ kind: "hunk", text: raw });
      continue;
    }
    if (raw.startsWith("\\")) continue;
    const sign = raw[0];
    const text = raw.slice(1);
    if (sign === "+") lines.push({ kind: "add", new: newLine++, text });
    else if (sign === "-") lines.push({ kind: "del", old: oldLine++, text });
    else if (lines.length > 0)
      lines.push({ kind: "ctx", old: oldLine++, new: newLine++, text });
  }
  return lines;
}

/**
 * The "## Risks" bullets of a Yarrow pull request's description: what the
 * agents flagged for the maintainer to watch. Empty when there are none or
 * the description was rewritten without them.
 */
export function pullRequestRisks(body: string | null): string[] {
  if (!body) return [];
  const section =
    /(?:^|\n)## Risks\s*\n([\s\S]*?)(?=\n## |\n---|\nNeed a change\?|\nImplemented by |$)/.exec(
      body.replace(/\r\n/g, "\n"),
    );
  if (!section) return [];
  return section[1]!
    .split("\n")
    .map((line) => /^\s*[-*]\s+(.+)$/.exec(line)?.[1]?.trim())
    .filter((line): line is string => Boolean(line));
}
