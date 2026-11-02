/**
 * The live call's bench: the same spoken questions on a pull request's
 * stage on Yarrow dev, answered by each model the call can use
 * (src/runner/talk-models.ts), timed and checked.
 *
 *   pnpm bench:talk [variant…] [--runs 3]
 *   pnpm bench:talk list
 *
 * The stage must be up (Start on its page). Each turn reaches the brain as
 * ElevenLabs sends one, signed with dev's VOICE_SECRET (workers/.dev.vars,
 * put by pnpm voice:agent), and stays out of the pull request's thread.
 * Real models answer: a few cents a turn. Reports land in bench/reports/.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ChatUsage } from "../src/core/chat";
import type { TalkBench } from "../src/runner/talk";
import { signTalkGrant, talkKey } from "../src/runner/voice/agent";

const LLM_URL = "https://dev.yarrow.run/voice/llm/chat/completions";
const REPORTS = join(import.meta.dirname, "reports");
/** PR #51 of the bench app: status filters, kept in the address. */
const CALL = {
  workUnitId: "af23af70-9959-4740-91b2-d41bf099fbf6",
  userId: "3e69e3c3-14d6-4194-8c80-d1c1dc139281",
  language: "fr",
};

const VARIANTS: Record<string, Omit<TalkBench, "reset">> = {
  "opus-blind": { model: "opus", screen: false },
  opus: { model: "opus", screen: true },
  "opus-fast": { model: "opus-fast", screen: true },
  sonnet: { model: "sonnet", screen: true },
  haiku: { model: "haiku", screen: true },
  wonder: { model: "wonder", screen: true },
  spark: { model: "spark", screen: true },
};

interface Turn {
  model: string;
  screenMs: number | null;
  firstWordMs: number | null;
  ms: number;
  steps: { what: string; ms: number }[];
  usage: ChatUsage;
  cents: number;
  words: string;
  change: string | null;
  resume: boolean;
  screen: string | null;
}

const count = (screen: string, filter: string) =>
  Number(new RegExp(`link "${filter} (\\d+)"`).exec(screen)?.[1] ?? NaN);
const address = (screen: string) => /^Address: (.*)$/m.exec(screen)?.[1] ?? "";
const onBranch = (screen: string) =>
  screen.includes("the app as it is on the branch");

const NUMBERS = [
  "z[ée]ro|aucune?",
  "une?",
  "deux",
  "trois",
  "quatre",
  "cinq",
  "six",
  "sept",
  "huit",
  "neuf",
];
const says = (words: string, n: number) =>
  new RegExp(`\\b(${n}|${NUMBERS[n] ?? n})\\b`, "i").test(words);

/** The questions, in order: the last one goes on from the one before. */
const QUESTIONS: {
  name: string;
  say: string;
  reset?: string;
  right: (turn: Turn) => boolean;
}[] = [
  {
    name: "plain",
    say: "En une phrase, qu'est-ce que cette pull request change ?",
    reset: "/",
    right: (turn) => /filtr/i.test(turn.words),
  },
  {
    name: "read",
    say: "Combien de tâches sont dans Doing en ce moment ?",
    reset: "/",
    right: (turn) =>
      !!turn.screen && says(turn.words, count(turn.screen, "Doing")),
  },
  {
    name: "click",
    say: "Clique sur le filtre Done dans l'app avec le changement.",
    reset: "/",
    right: (turn) =>
      !!turn.screen &&
      onBranch(turn.screen) &&
      address(turn.screen).includes("status=done"),
  },
  {
    name: "gestures",
    say: "Passe sur To do, puis recharge la page pour voir si le filtre reste.",
    right: (turn) =>
      !!turn.screen &&
      address(turn.screen).includes("status=todo") &&
      turn.steps.some((step) => step.what.includes("reload")),
  },
];

function voiceSecret(): string {
  if (process.env.VOICE_SECRET) return process.env.VOICE_SECRET;
  const file = "workers/.dev.vars";
  const line = existsSync(file)
    ? readFileSync(file, "utf8")
        .split("\n")
        .find((row) => row.startsWith("VOICE_SECRET="))
    : undefined;
  const secret = line?.slice("VOICE_SECRET=".length).trim();
  if (!secret)
    throw new Error("VOICE_SECRET: in workers/.dev.vars (pnpm voice:agent)");
  return secret;
}

async function ask(
  key: string,
  grant: string,
  bench: TalkBench,
  say: string,
): Promise<Turn> {
  const response = await fetch(LLM_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      messages: [
        { role: "system", content: "Yarrow's live review." },
        { role: "user", content: say },
      ],
      elevenlabs_extra_body: { yarrow: grant },
      yarrow_bench: bench,
    }),
  });
  if (!response.ok)
    throw new Error(`${response.status} ${await response.text()}`);
  const text = await response.text();
  const rows = text.split("\n");
  const failed = rows.find((row) => row.startsWith(": yarrow-error "));
  if (failed)
    throw new Error(JSON.parse(failed.slice(": yarrow-error ".length)));
  const line = rows.find((row) => row.startsWith(": yarrow "));
  if (!line) throw new Error(`no bench line: ${text.slice(0, 400)}`);
  return JSON.parse(line.slice(": yarrow ".length)) as Turn;
}

const median = (values: number[]) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return NaN;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
};
const seconds = (ms: number) =>
  Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)} s` : "—";

const args = process.argv.slice(2);
if (args[0] === "list") {
  for (const [name, variant] of Object.entries(VARIANTS))
    console.log(
      `${name}: ${variant.model}${variant.screen ? ", screen first" : ""}`,
    );
  process.exit(0);
}
const runsAt = args.indexOf("--runs");
const runs = runsAt >= 0 ? Number(args[runsAt + 1]) : 3;
const named = args.filter(
  (arg, index) => !arg.startsWith("--") && index !== runsAt + 1,
);
const unknown = named.filter((name) => !(name in VARIANTS));
if (unknown.length) throw new Error(`unknown variant: ${unknown.join(", ")}`);
const variants = named.length ? named : Object.keys(VARIANTS);

const secret = voiceSecret();
const key = await talkKey(secret);
const grant = await signTalkGrant(secret, CALL);
const results: {
  variant: string;
  run: number;
  question: string;
  right: boolean;
  turn?: Turn;
  error?: string;
}[] = [];

for (let run = 1; run <= runs; run++)
  for (const variant of variants)
    for (const question of QUESTIONS) {
      const bench: TalkBench = {
        ...VARIANTS[variant]!,
        ...(question.reset ? { reset: question.reset } : {}),
      };
      try {
        const turn = await ask(key, grant, bench, question.say);
        const right = question.right(turn);
        results.push({
          variant,
          run,
          question: question.name,
          right,
          turn,
        });
        console.log(
          `${run} ${variant.padEnd(10)} ${question.name.padEnd(8)} ${right ? "ok " : "NO "} screen ${seconds(turn.screenMs ?? NaN)} first ${seconds(turn.firstWordMs ?? NaN)} total ${seconds(turn.ms)} ${turn.steps.map((step) => step.what).join(" ")} ${turn.cents.toFixed(2)}¢ — ${turn.words.replace(/\s+/g, " ").slice(0, 120)}`,
        );
      } catch (error) {
        results.push({
          variant,
          run,
          question: question.name,
          right: false,
          error: String(error),
        });
        console.log(
          `${run} ${variant} ${question.name} failed: ${String(error).slice(0, 200)}`,
        );
      }
    }

console.log(
  "\nvariant     right  first words (med)  turn (med)  rounds (med)  cents/turn",
);
for (const variant of variants) {
  const mine = results.filter((result) => result.variant === variant);
  const turns = mine.flatMap((result) => (result.turn ? [result.turn] : []));
  const rounds = turns.map(
    (turn) =>
      turn.steps.filter(
        (step) => step.what === "claude" || step.what === "muse",
      ).length,
  );
  const cents =
    turns.reduce((sum, turn) => sum + turn.cents, 0) /
    Math.max(turns.length, 1);
  console.log(
    `${variant.padEnd(11)} ${`${mine.filter((result) => result.right).length}/${mine.length}`.padEnd(6)} ${seconds(median(turns.map((turn) => turn.firstWordMs ?? NaN))).padEnd(18)} ${seconds(median(turns.map((turn) => turn.ms))).padEnd(11)} ${String(median(rounds)).padEnd(13)} ${cents.toFixed(2)}`,
  );
  for (const question of QUESTIONS) {
    const asked = mine.filter((result) => result.question === question.name);
    console.log(
      `  ${question.name.padEnd(9)} ${asked.filter((result) => result.right).length}/${asked.length}  first ${seconds(median(asked.map((result) => result.turn?.firstWordMs ?? NaN)))}  turn ${seconds(median(asked.map((result) => result.turn?.ms ?? NaN)))}`,
    );
  }
}

mkdirSync(REPORTS, { recursive: true });
const report = join(
  REPORTS,
  `talk-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
);
writeFileSync(report, JSON.stringify(results, null, 2));
console.log(`\n${report}`);
