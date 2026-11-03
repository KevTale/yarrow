import { z } from "zod";

/**
 * The sample ticket on the landing: a small app drawn in the page, and what
 * its agent knows of it. No repository, no run: the agent's words carry tags
 * that move the drawing, read as they stream.
 */

export const MOMENTS = ["list", "form", "added", "sorted"] as const;
export type Moment = (typeof MOMENTS)[number];

export const lookSchema = z.object({
  urgentColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  highColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  urgentName: z.string().min(1).max(14),
  highName: z.string().min(1).max(14),
  sort: z.enum(["added", "priority"]),
  hideDone: z.boolean(),
  shape: z.enum(["pill", "dot"]),
  theme: z.enum(["dark", "light"]),
});
export type Look = z.infer<typeof lookSchema>;

/**
 * The demo, its moments as the voice reaches them. `at` and the length are
 * measured by `scripts/landing-voice.mts`, which reads these words.
 */
export const TRY_FILM: { moment: Moment; at: number; say: string }[] = [
  {
    moment: "list",
    at: 0,
    say: "Here's the list before the change. Nothing tells you what comes first.",
  },
  {
    moment: "form",
    at: 5.2,
    say: "Now a new task asks for a priority. Normal, unless you pick another one.",
  },
  {
    moment: "added",
    at: 11.7,
    say: "I'll add this one as urgent, and it lands in the list with its tag.",
  },
  {
    moment: "sorted",
    at: 16.8,
    say: "Sort by priority, and the urgent work comes first.",
  },
];
export const TRY_FILM_LENGTH = 20.6;

/** How the app looks once the ticket is done, before anyone asks for more. */
export const LOOK: Look = {
  urgentColor: "#ee7b6e",
  highColor: "#f2b544",
  urgentName: "Urgent",
  highName: "High",
  sort: "priority",
  hideDone: false,
  shape: "pill",
  theme: "light",
};

/** A visitor's words, the turns of a visit, and of a day for everyone. */
export const TRY_WORDS = 300;
export const TRY_TURNS = 12;
export const TRY_TURNS_A_DAY = 5000;

export const tryTurnSchema = z.object({
  said: z
    .array(
      z.object({
        author: z.enum(["builder", "agent"]),
        body: z.string().trim().min(1).max(600),
      }),
    )
    .min(1)
    .max(TRY_TURNS * 2 + 1)
    .refine((said) => {
      const last = said.at(-1)!;
      return last.author === "builder" && last.body.length <= TRY_WORDS;
    }),
  moment: z.enum(MOMENTS),
  look: lookSchema,
});

export type TryAct =
  { kind: "show"; moment: Moment } | { kind: "set"; change: string };

const TAG = /\[(show|set):([^\]\n]{1,200})\]/g;
/** A tag still arriving: its start stays out of the words. */
const OPEN_TAG = /\[[^\]\n]{0,200}$/;

/** What an answer says so far, and what it asked the drawing to do. */
export function readTags(raw: string): { text: string; acts: TryAct[] } {
  const acts: TryAct[] = [];
  const text = raw.replace(TAG, (_, kind: string, value: string) => {
    const wanted = value.trim();
    if (kind === "set") acts.push({ kind: "set", change: wanted });
    else if (MOMENTS.includes(wanted as Moment))
      acts.push({ kind: "show", moment: wanted as Moment });
    return "";
  });
  return {
    text: text
      .replace(OPEN_TAG, "")
      .replace(/[ \t]+([.,!?])/g, "$1")
      .replace(/[ \t]{2,}/g, " ")
      .trim(),
    acts,
  };
}

/** A `set` tag's change on the look; what it cannot mean is left out. */
export function changeLook(look: Look, change: string): Look {
  const asked: Record<string, unknown> = {};
  for (const pair of change.split(",")) {
    const at = pair.indexOf("=");
    const key = pair.slice(0, at).trim();
    const value = pair.slice(at + 1).trim();
    if (at < 0) continue;
    if (key === "hideDone") asked.hideDone = value === "true";
    else asked[key] = value;
  }
  const next = { ...look };
  const fields = lookSchema.partial();
  for (const [key, value] of Object.entries(asked)) {
    const one = fields.safeParse({ [key]: value });
    if (one.success) Object.assign(next, one.data);
  }
  return next;
}

export const TRY_FIRST_WORDS =
  "Tasks now have a priority, from the new task form to the list. Urgent and high show a tag, normal shows nothing so the list stays quiet.";

/** What the agent is told, the screen as the visitor sees it now. */
export function tryInstructions(moment: Moment, look: Look): string {
  return `You are the agent on Yarrow's website, beside a sample ticket. A visitor is trying Yarrow: talk to them as you would to a colleague reviewing this ticket.

What Yarrow is: builders write tickets with an agent that knows their code and their other tickets. Agents build and review each ticket in the cloud and it comes back with a demo of the result, beside this conversation. The builder asks anything, asks for a change, then merges. It connects to GitHub, Jira, Linear and Trello. Free for builders: sponsors fund the compute, their card ships in the pull requests they fund.

The sample ticket, on a small task app called Acme:
#137 Tasks need a priority. People could not tell what mattered first in a long list.

The change, 6 files, +44 −6:
- db/migrations/012_task_priority.sql: a priority column, low, normal, high or urgent, normal by default, so existing tasks stay normal
- src/api/tasks.ts: reads and writes the priority, orders by it when asked
- src/components/task-form.tsx: a priority picker, normal selected
- src/components/task-row.tsx: a tag for urgent and high, nothing for normal and low, to keep the list quiet
- src/components/task-list.tsx: a sort by priority
- tests/tasks.test.ts: five new tests, all passing
The reviewer ran the app and found nothing to change.

The demo on the screen has four moments: list (the list before the change), form (the new task form with its picker), added (a new urgent task lands in the list with its tag), sorted (the list sorted, urgent first). It is at: ${moment}.
The app as it looks now: ${JSON.stringify(look)}.

You move the screen by writing tags in your words, the visitor never sees them:
- [show:list], [show:form], [show:added] or [show:sorted] goes to that moment. Write it when you talk about what it shows.
- [set:key=value,key=value] changes the app at once. Keys: urgentColor and highColor (#rrggbb), urgentName and highName (a word), sort (added or priority), hideDone (true or false), shape (pill or dot), theme (dark or light).

When they ask for a change those keys can make, make it now with a [set:...] tag and say it is done, in a few words. Anything else they ask to change: on a real ticket you would push a commit, on this sample you can only change what those keys do, so say that plainly and offer what comes closest.

At most two short sentences and thirty words, plain words, in the language of the visitor's last message. A tag is not a word: every sentence reads whole without it, so write tags between sentences, never in place of a word. No lists, no headings, no Markdown. Never invent anything about this ticket or about Yarrow. Other subjects: say in a few words that you are here for this ticket.`;
}
