/**
 * A pull request's files, sorted the way a builder reads them: the code
 * first, then its tests, its documentation, what tools generated and the
 * assets. Paths only, no I/O.
 */
export type FileKind =
  "implementation" | "tests" | "documentation" | "generated" | "assets";

export const fileKinds: { kind: FileKind; label: string }[] = [
  { kind: "implementation", label: "Implementation" },
  { kind: "tests", label: "Tests" },
  { kind: "documentation", label: "Documentation" },
  { kind: "generated", label: "Generated" },
  { kind: "assets", label: "Assets" },
];

const generated = [
  /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?|Cargo\.lock|poetry\.lock|go\.sum|composer\.lock|Gemfile\.lock)$/,
  /\.gen\.[a-z]+$/i,
  /\.min\.(js|css)$/i,
  /\.snap$/i,
  /(^|\/)(dist|build|vendor|__generated__)\//,
  /(^|\/)drizzle\/meta\//,
];
const tests = [
  /(^|\/)(tests?|__tests__|spec|specs|e2e|cypress|playwright)\//i,
  /[._-](test|spec)\.[a-z0-9]+$/i,
  /(^|\/)test_[^/]+\.py$/,
];
const documentation = [
  /\.(md|mdx|markdown|rst|adoc|txt)$/i,
  /(^|\/)(docs?|documentation)\//i,
  /(^|\/)(LICENSE|CHANGELOG|AUTHORS)[^/]*$/,
];
const assets =
  /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp|tiff?|mp4|webm|mov|mp3|wav|ogg|woff2?|ttf|otf|eot|pdf|zip)$/i;

export function fileKind(path: string): FileKind {
  if (generated.some((pattern) => pattern.test(path))) return "generated";
  if (tests.some((pattern) => pattern.test(path))) return "tests";
  if (documentation.some((pattern) => pattern.test(path)))
    return "documentation";
  if (assets.test(path)) return "assets";
  return "implementation";
}

export interface FileGroup<F> {
  kind: FileKind;
  label: string;
  files: F[];
  additions: number;
  deletions: number;
}

/** The non-empty groups, in reading order, each keeping the files' order. */
export function groupFiles<
  F extends { path: string; additions: number; deletions: number },
>(files: F[]): FileGroup<F>[] {
  return fileKinds
    .map(({ kind, label }) => {
      const mine = files.filter((file) => fileKind(file.path) === kind);
      return {
        kind,
        label,
        files: mine,
        additions: mine.reduce((sum, file) => sum + file.additions, 0),
        deletions: mine.reduce((sum, file) => sum + file.deletions, 0),
      };
    })
    .filter((group) => group.files.length > 0);
}
