// Keeps every render: copies out/yarrow-launch.mp4 to out/versions/, named
// by the time and the commit it was made from (-wip when the video's files
// had uncommitted changes), so no cut is ever lost to the next render.
// Usage: node scripts/keep.mjs (pnpm render runs it)
import { execSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import process from "node:process";

const git = (command) =>
  execSync(`git ${command}`, { encoding: "utf8" }).trim();
const commit = git("rev-parse --short HEAD");
const wip = git("status --porcelain -- .") ? "-wip" : "";
const now = new Date();
const stamp = [
  now.getFullYear(),
  String(now.getMonth() + 1).padStart(2, "0"),
  String(now.getDate()).padStart(2, "0"),
].join("-");
const time = `${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
const target = `out/versions/${stamp}-${time}-${commit}${wip}.mp4`;
mkdirSync("out/versions", { recursive: true });
copyFileSync("out/yarrow-launch.mp4", target);
process.stdout.write(`${target}\n`);
