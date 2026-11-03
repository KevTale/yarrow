// A film of the landing: a real run's, on the bench's task app, served with the
// site so it plays for anyone on any environment. Copies the run's timeline,
// clips, voices and still into public/demo/<sample>/, and its pull request's
// files.
//   npx tsx scripts/landing-film.mts <sample> <timeline key> <still key> <pull request>
// The keys are in the run's `results.artifacts`, its project must be public.
// Prints what the sample's film in TRY_SAMPLES needs.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { parsePatch } from "../src/core/diff";
import { chapterMs, presentationSchema } from "../src/core/presentation";
import { clockLabel } from "../src/core/chat";

const SITE = "https://dev.yarrow.run";
const REPOSITORY = "KevTale/yarrow-bench-app";

const [sample, timelineKey, posterKey, number] = process.argv.slice(2);
if (!sample || !timelineKey || !posterKey || !number)
  throw new Error(
    "landing-film <sample> <timeline key> <still key> <pull request>",
  );
const OUT = `public/demo/${sample}`;

const gotten = async (key: string) => {
  const response = await fetch(`${SITE}/evidence/${key}`);
  if (!response.ok) throw new Error(`${key}: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
};

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const copied = new Map<string, string>();
async function copy(key: string) {
  const kept = copied.get(key);
  if (kept) return kept;
  const name = basename(key);
  writeFileSync(`${OUT}/${name}`, await gotten(key));
  copied.set(key, `/demo/${sample}/${name}`);
  return `/demo/${sample}/${name}`;
}

const timeline = presentationSchema.parse(
  JSON.parse((await gotten(timelineKey)).toString("utf8")),
);
for (const chapter of timeline.chapters) {
  if (chapter.video) chapter.video.key = await copy(chapter.video.key);
  if (chapter.audio) chapter.audio.key = await copy(chapter.audio.key);
}
timeline.poster = `/demo/${sample}/poster.jpg`;
writeFileSync(`${OUT}/presentation.json`, JSON.stringify(timeline));
writeFileSync(`${OUT}/poster.jpg`, await gotten(posterKey));

const files = JSON.parse(
  execFileSync(
    "gh",
    ["api", `repos/${REPOSITORY}/pulls/${number}/files?per_page=100`],
    { encoding: "utf8", maxBuffer: 1 << 26 },
  ),
) as {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}[];
writeFileSync(
  `${OUT}/files.json`,
  JSON.stringify(
    files.map((file) => ({
      path: file.filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      lines: file.patch ? parsePatch(file.patch) : null,
    })),
  ),
);

let at = 0;
for (const chapter of timeline.chapters) {
  const start = at;
  console.log(
    JSON.stringify({
      title: chapter.title,
      said: chapter.cues
        .map((cue) => `${clockLabel(start + cue.startMs)} ${cue.text}`)
        .join("\n"),
    }),
  );
  at += chapterMs(chapter);
}
console.log(`length ${clockLabel(at)}, ${files.length} files`);
