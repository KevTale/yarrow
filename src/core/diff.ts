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
