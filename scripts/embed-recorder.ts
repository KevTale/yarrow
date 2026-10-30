/**
 * Carries src/runner/recorder/present.mjs into the brain as a string: the
 * brain uploads it to each implementer session. Run after editing it:
 * pnpm recorder:embed (a unit test fails while they differ).
 */
import { readFileSync, writeFileSync } from "node:fs";

// LF whatever the checkout: the sandbox is Linux, and the test compares.
const source = readFileSync("src/runner/recorder/present.mjs", "utf8")
  .split("\r\n")
  .join("\n");
writeFileSync(
  "src/runner/recorder/source.ts",
  `// Generated from present.mjs by pnpm recorder:embed: never edit.
export const RECORDER_SOURCE = ${JSON.stringify(source)};
`,
);
