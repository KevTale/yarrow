/**
 * What proves a pull request does what its ticket asks, chosen by the
 * implementer for the change at hand (decided 2026-10-29): images of a
 * screen before and after, a command or request and what it printed, a
 * measure, the document as its reader sees it, the app's page to try, and a
 * film only for a flow worth watching (src/core/presentation.ts). No I/O here.
 */

import { z } from "zod";

/** At most this much of an output is kept, its end first: where results print. */
export const OUTPUT_CHARS = 3000;

const text = (max: number) => z.string().trim().min(1).max(max);
/**
 * An app's page: a path of its own, never another site ("//host", and
 * "/\host", which browsers read the same).
 */
export const isAppPath = (path: string) =>
  path.length <= 500 && /^\/(?![/\\])[^\s\\]*$/.test(path);
const appPath = z.string().trim().refine(isAppPath);

export const storedProofSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("images"),
    label: text(120),
    /** The screen as it was, then as it is now: keys in the evidence store. */
    before: z.string().nullable(),
    after: z.string(),
    device: z.enum(["desktop", "phone"]).default("desktop"),
  }),
  z.object({
    kind: z.literal("output"),
    label: text(120),
    command: text(500),
    before: z.string().max(OUTPUT_CHARS).nullable(),
    after: z.string().max(OUTPUT_CHARS),
  }),
  z.object({
    kind: z.literal("measure"),
    label: text(120),
    unit: text(20),
    before: z.number().finite(),
    after: z.number().finite(),
    better: z.enum(["lower", "higher"]),
  }),
  z.object({
    kind: z.literal("document"),
    /** Its path in the repository, rendered on the pull request's branch. */
    file: text(300),
  }),
  z.object({ kind: z.literal("app"), path: appPath }),
]);
export type Proof = z.infer<typeof storedProofSchema>;
export type ProofKind = Proof["kind"];

/** How many of each a pull request shows: past that, the owner stops reading. */
const LIMITS: Record<ProofKind, number> = {
  images: 4,
  output: 4,
  measure: 4,
  document: 3,
  app: 1,
};

/** An output as kept: its last characters, where a run prints its result. */
const clip = (value: unknown) =>
  typeof value === "string"
    ? value.replace(/\r\n/g, "\n").trimEnd().slice(-OUTPUT_CHARS)
    : null;

/** An image as the agent names it: a file of its outputs. */
const imageFile = z
  .string()
  .trim()
  .regex(/^[\w./-]+\.(png|jpe?g)$/i);

/** One proof as the agent writes it in result.json, images still files. */
const agentProofSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("images"),
    label: text(120),
    before: imageFile.nullable().optional().catch(null),
    after: imageFile,
    device: z.enum(["desktop", "phone"]).catch("desktop").default("desktop"),
  }),
  z.object({
    kind: z.literal("output"),
    label: text(120),
    command: text(500),
    before: z.unknown().transform(clip),
    after: z.unknown().transform((value) => clip(value) ?? ""),
  }),
  storedProofSchema.options[2],
  storedProofSchema.options[3],
  storedProofSchema.options[4],
]);
export type AgentProof = z.infer<typeof agentProofSchema>;

/**
 * The proofs of result.json: each that parses, within the limits; one that
 * does not is dropped, never the run.
 */
export function parseAgentProofs(raw: unknown): AgentProof[] {
  if (!Array.isArray(raw)) return [];
  const counts: Partial<Record<ProofKind, number>> = {};
  const kept: AgentProof[] = [];
  for (const item of raw) {
    const parsed = agentProofSchema.safeParse(item);
    if (!parsed.success) continue;
    const proof = parsed.data;
    if (proof.kind === "output" && !proof.after.trim()) continue;
    const count = (counts[proof.kind] ?? 0) + 1;
    if (count > LIMITS[proof.kind]) continue;
    counts[proof.kind] = count;
    kept.push(proof);
  }
  return kept;
}

/**
 * A film proves a flow in the app, so it goes with the app's page: one
 * recorded for any other change (a document, an API) is noise, not voiced.
 */
export function filmFits(proofs: AgentProof[]): boolean {
  return proofs.some((proof) => proof.kind === "app");
}

/**
 * The image files a run's proofs name, each once: what the brain copies
 * to the evidence store.
 */
export function proofImages(proofs: AgentProof[]): string[] {
  const files = proofs.flatMap((proof) =>
    proof.kind === "images"
      ? [proof.before, proof.after].filter((file): file is string => !!file)
      : [],
  );
  return [...new Set(files)];
}

/**
 * The proofs as stored, their images by key. An image that could not be
 * copied drops its proof, or leaves an after alone.
 */
export function storedProofs(
  proofs: AgentProof[],
  keys: Map<string, string>,
): Proof[] {
  return proofs.flatMap((proof): Proof[] => {
    if (proof.kind !== "images") return [proof];
    const after = keys.get(proof.after);
    if (!after) return [];
    return [
      {
        ...proof,
        before: (proof.before && keys.get(proof.before)) || null,
        after,
      },
    ];
  });
}

/** How a measure moved, in words: "20× faster", "35% less". */
export function measureChange(
  proof: Extract<Proof, { kind: "measure" }>,
): string | null {
  const { before, after, better } = proof;
  if (before === after) return "unchanged";
  if (before <= 0 || after <= 0) return null;
  const improved = better === "lower" ? after < before : after > before;
  const ratio = Math.max(before, after) / Math.min(before, after);
  const amount =
    ratio >= 2
      ? `${ratio >= 10 ? Math.round(ratio) : Math.round(ratio * 10) / 10}×`
      : `${Math.round((Math.abs(after - before) / before) * 100)}%`;
  return `${amount} ${improved ? "better" : "worse"}`;
}

/** A line of what a command printed, beside the other side's. */
export interface OutputLine {
  /** Printed before and after, or only after (added), or only before. */
  kind: "same" | "added" | "removed";
  text: string;
}

/**
 * What a command printed before and after, line by line: the lines both
 * printed and those only one did, by their longest run in common (outputs
 * are a few dozen lines; past that, all of it counts as changed).
 */
export function outputDiff(before: string, after: string): OutputLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  if (a.length * b.length > 200_000)
    return [
      ...a.map((text) => ({ kind: "removed" as const, text })),
      ...b.map((text) => ({ kind: "added" as const, text })),
    ];
  const same = (i: number, j: number) => a[i]!.trimEnd() === b[j]!.trimEnd();
  // common[i][j]: how many lines a[i..] and b[j..] have in common.
  const common = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      common[i]![j] = same(i, j)
        ? common[i + 1]![j + 1]! + 1
        : Math.max(common[i + 1]![j]!, common[i]![j + 1]!);
  const lines: OutputLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && same(i, j)) {
      lines.push({ kind: "same", text: b[j]! });
      i++;
      j++;
    } else if (
      i < a.length &&
      (j === b.length || common[i + 1]![j]! >= common[i]![j + 1]!)
    ) {
      lines.push({ kind: "removed", text: a[i]! });
      i++;
    } else {
      lines.push({ kind: "added", text: b[j]! });
      j++;
    }
  }
  return lines;
}

/** A line shown, or a run of unchanged ones folded away. */
export type ShownLine = OutputLine | { folded: number };

/**
 * The lines worth reading: each changed one with `keep` lines around it,
 * longer runs of unchanged lines folded. Nothing changed: the first lines,
 * the rest folded.
 */
export function foldOutput(
  lines: OutputLine[],
  keep = 2,
  head = 10,
): ShownLine[] {
  const changed = lines.map((line) => line.kind !== "same");
  if (!changed.includes(true))
    return lines.length > head + 2
      ? [...lines.slice(0, head), { folded: lines.length - head }]
      : lines;
  const near = lines.map((_, index) =>
    changed.slice(Math.max(0, index - keep), index + keep + 1).includes(true),
  );
  const shown: ShownLine[] = [];
  for (let index = 0; index < lines.length;) {
    if (near[index]) {
      shown.push(lines[index]!);
      index++;
      continue;
    }
    let end = index;
    while (end < lines.length && !near[end]) end++;
    // One line takes no more room than its fold.
    if (end - index === 1) shown.push(lines[index]!);
    else shown.push({ folded: end - index });
    index = end;
  }
  return shown;
}

const fence = (body: string, language = "") => {
  const ticks = body.includes("```") ? "````" : "```";
  return `${ticks}${language}\n${body}\n${ticks}`;
};

/**
 * An output in the description: what changed in green and red, the rest
 * folded; printed once when there was nothing before or nothing moved.
 */
function outputMarkdown(before: string | null, after: string): string {
  const lines = before === null ? [] : outputDiff(before, after);
  if (!lines.some((line) => line.kind !== "same")) return fence(after);
  const sign = { same: " ", added: "+", removed: "-" } as const;
  return fence(
    foldOutput(lines)
      .map((line) =>
        "folded" in line
          ? `@@ ${line.folded} unchanged lines @@`
          : `${sign[line.kind]} ${line.text}`,
      )
      .join("\n"),
    "diff",
  );
}

/**
 * The proofs in the pull request's description, under What changed.
 * Images only where the project's evidence may show (public), else
 * counted, seen in Yarrow.
 */
export function proofsMarkdown(
  proofs: Proof[],
  input: {
    /** An image's address, or null when it stays in Yarrow. */
    image: (key: string) => string | null;
    /** A document on the pull request's branch. */
    document: (file: string) => string;
    /** The app at a page, for the project's members (src/routes/preview). */
    app: (path: string) => string;
    /** Where the images are, in Yarrow. */
    runUrl: string;
  },
): string {
  const parts: string[] = [];
  let hidden = 0;
  for (const proof of proofs) {
    // A mark per proof, read by the bench (bench/run.ts); a phone's screens
    // say so.
    const mark = `<!-- yarrow:proof ${proof.kind}${proof.kind === "images" && proof.device === "phone" ? " phone" : ""} -->`;
    if (proof.kind === "images") {
      const after = input.image(proof.after);
      if (!after) {
        hidden += proof.before ? 2 : 1;
        parts.push(mark);
        continue;
      }
      const before = proof.before ? input.image(proof.before) : null;
      parts.push(
        before
          ? `${mark}\n**${proof.label}**\n\n| Before | After |\n| --- | --- |\n| ![Before](${before}) | ![After](${after}) |`
          : `${mark}\n**${proof.label}**\n\n![${proof.label.replace(/[[\]]/g, "")}](${after})`,
      );
    } else if (proof.kind === "output") {
      parts.push(
        [
          mark,
          `**${proof.label}**`,
          "",
          `\`${proof.command.replace(/`/g, "'")}\``,
          "",
          outputMarkdown(proof.before, proof.after),
        ].join("\n"),
      );
    } else if (proof.kind === "measure") {
      const change = measureChange(proof);
      parts.push(
        `${mark}\n**${proof.label}**: ${proof.before} ${proof.unit} → ${proof.after} ${proof.unit}${change ? ` (${change})` : ""}`,
      );
    } else if (proof.kind === "document") {
      parts.push(
        `${mark}\n[${proof.file}](${input.document(proof.file)}), as it reads on this branch`,
      );
    } else {
      parts.push(`${mark}\n[Try it in the app](${input.app(proof.path)})`);
    }
  }
  if (hidden > 0)
    parts.push(
      `[${hidden} image${hidden === 1 ? "" : "s"}](${input.runUrl}), in Yarrow`,
    );
  return parts.join("\n\n");
}
