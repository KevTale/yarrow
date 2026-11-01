/**
 * Who implements the runs Yarrow dev prepares from now on:
 *
 *   pnpm implementer claude    # Claude Opus (also when nothing is set)
 *   pnpm implementer meta      # Muse Wonder, in Yarrow's own containers
 *
 * The choice is a secret of the dev brain, not a variable of its config, so
 * a deploy keeps it and changing it takes seconds, with no push. A run
 * under way finishes with the implementer it began with. Production always
 * runs Claude: it reads nothing here. Needs CLOUDFLARE_API_TOKEN, as any
 * wrangler command outside an interactive login.
 */
import { execFileSync } from "node:child_process";

const choice = process.argv[2];
if (choice !== "claude" && choice !== "meta") {
  console.error("Usage: pnpm implementer <claude|meta>");
  process.exit(1);
}
execFileSync(
  "pnpm",
  [
    "exec",
    "wrangler",
    "secret",
    "put",
    "IMPLEMENTER",
    "--config",
    "workers/wrangler.jsonc",
    "--env",
    "dev",
  ],
  { input: choice, stdio: ["pipe", "inherit", "inherit"], shell: true },
);
console.log(
  `Yarrow dev: ${choice === "meta" ? "Muse Wonder" : "Claude Opus"} implements the next runs.`,
);
