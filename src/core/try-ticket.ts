import { z } from "zod";

/**
 * The landing's two samples, a ticket being written and a ticket to review,
 * and what their agent knows. No repository behind them: the ticket to review
 * is a real run's, on the bench's task app, its film served with the site
 * (`scripts/landing-film.mts`), and a change asked of it stays a card.
 */

/** A visitor's words, the turns of a visit, and of a day for everyone. */
export const TRY_WORDS = 300;
export const TRY_TURNS = 12;
export const TRY_TURNS_A_DAY = 5000;

const said = z
  .array(
    z.object({
      author: z.enum(["builder", "agent"]),
      body: z.string().trim().min(1).max(600),
    }),
  )
  .min(1)
  .max(TRY_TURNS * 2 + 1)
  .refine((lines) => {
    const last = lines.at(-1)!;
    return last.author === "builder" && last.body.length <= TRY_WORDS;
  });

export const tryTurnSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("review"),
    said,
    /** The chapter on the screen. */
    chapter: z.number().int().min(0).max(12),
  }),
  z.object({
    kind: z.literal("ticket"),
    said,
    /** The form as it stands: the visitor may have edited it. */
    title: z.string().max(200),
    body: z.string().max(2000),
  }),
]);
export type TryTurn = z.infer<typeof tryTurnSchema>;

/** The film's chapters, each line with its moment: the run's own words. */
export const TRY_FILM: { title: string; said: string }[] = [
  {
    title: "Before",
    said: "0:00 Okay, so this is the team's task list as it is today...\n0:04 every task looks exactly the same, so there's no way to tell that,\n0:08 say, Update the team page is the one that really can't wait.\n0:11 It just sits down here in the middle.\n0:14 So the ticket asks for a priority on each task, Low,\n0:17 Normal or Urgent, picked when you create it,\n0:19 with a badge on the ones that aren't Normal and urgent ones at the top.",
  },
  {
    title: "The change",
    said: "0:24 And here it is with the change.\n0:26 Update the team page is marked urgent, so it's jumped to the top with a red Urgent\n0:30 badge, and Sam's design review is low priority, so it gets a quiet grey Low badge.\n0:36 Everything that's Normal looks just like before,\n0:38 and down in the add form there's a new priority picker that starts on Normal.",
  },
  {
    title: "Add urgent task",
    said: "0:43 Let's try it for real.\n0:45 I type Call the client back, pick Urgent priority,\n0:48 and click Add... and there it is, right up top with the other urgent one,\n0:52 ahead of the tasks people are already doing.",
  },
  {
    title: "Normal by default",
    said: "0:55 And if you don't touch the picker, you get Normal.\n0:58 So I type Order new chairs and just click Add...\n1:01 it lands in the usual spot with no badge at all.\n1:04 One thing to know, an urgent task stays on top even once it's done,\n1:08 because the ticket says urgent comes first,\n1:10 so that's easy to change if you'd rather it drop down.",
  },
];

const CHANGE = /\[change:([^\]\n]{1,200})\]/;
/** A tag still arriving: its start stays out of the words. */
const OPEN_TAG = /\[[^\]\n]{0,200}$/;

/**
 * What an answer on the ticket to review says so far, its moments (`[at 0:12]`)
 * left in for the chat, and the change it proposes.
 */
export function readAnswer(raw: string): {
  text: string;
  change: string | null;
} {
  return {
    text: raw
      .replace(CHANGE, "")
      .replace(OPEN_TAG, "")
      .replace(/[ \t]+([.,!?])/g, "$1")
      .replace(/[ \t]{2,}/g, " ")
      .trim(),
    change: CHANGE.exec(raw)?.[1]?.trim() ?? null,
  };
}

const OPENS = "<ticket>";
const CLOSES = "</ticket>";

/**
 * What an answer on the new ticket says so far: the ticket it is writing,
 * title and body as they arrive, null until it starts, then its words.
 */
export function readTicket(raw: string): {
  ticket: { title: string; body: string } | null;
  words: string;
} {
  const from = raw.indexOf(OPENS);
  if (from === -1)
    return { ticket: null, words: raw.replace(/<[^>\n]*$/, "").trim() };
  const start = from + OPENS.length;
  const end = raw.indexOf(CLOSES, start);
  const inside = raw
    .slice(start, end === -1 ? undefined : end)
    .replace(/<[^>\n]*$/, "");
  const cut = inside.indexOf("---");
  return {
    ticket: {
      title: (cut === -1 ? inside : inside.slice(0, cut))
        .replace(/-+\s*$/, "")
        .trim(),
      body: cut === -1 ? "" : inside.slice(cut + 3).trim(),
    },
    words: end === -1 ? "" : raw.slice(end + CLOSES.length).trim(),
  };
}

/** What the run said it changed: the chat's first words. */
export const TRY_FIRST_WORDS =
  "The new-task form has a priority picker (Low, Normal, Urgent) that starts on Normal, and existing tasks become Normal. The list shows a grey Low badge or a red Urgent badge, and urgent tasks sit at the top. They stay there even once they're done, because the ticket says urgent comes first.";

const YARROW =
  "What Yarrow is: builders write tickets with an agent that knows their code and their other tickets. Agents build and review each ticket in the cloud and it comes back with a demo of the result, beside this conversation. The builder asks anything, asks for a change, then merges. It connects to GitHub, Jira, Linear and Trello. Free for builders: sponsors fund the compute, their card ships in the pull requests they fund.";

const ACME =
  "Acme is a small team task app: tasks with a title, a status (to do, doing or done), an assignee and a due date, a settings page, a weekly email.";

function reviewInstructions(chapter: number): string {
  const film = TRY_FILM.map(
    (part, i) =>
      `${part.title}${i === chapter ? " (on the screen now)" : ""}:\n${part.said}`,
  ).join("\n\n");
  return `You are the agent on Yarrow's website, in the room of a ticket to review. A visitor is trying Yarrow: talk to them as you would to a colleague reviewing this ticket.

${YARROW}

${ACME}

The ticket: Tasks need a priority. Everything in the task list looks equally important. Add a priority to tasks: Low, Normal or Urgent, chosen when a task is created, Normal by default. The list shows a badge on each task that is not Normal, red for Urgent, and urgent tasks come first.

What changed: ${TRY_FIRST_WORDS}
The files: db/migrations/004_task_priority.sql, public/style.css, src/db.js, src/server.js, src/views.js, test/views.test.js. The tests pass.

The demo beside you is a recording of the real app, made and narrated by the agent who built the change:
${film}

Point at a moment by writing it as [at 0:12]: the screen goes there and the visitor can play it from there. Do it each time you talk about something the demo shows, at the line that shows it.

When they ask for a change, say in a few words what you would do, then write [change:what the app will do, in a few words]: it shows a card they can accept. You never change the app from here.

At most two short sentences and thirty words, plain words, in the language of the visitor's last message. No lists, no headings. Never invent anything about this ticket or about Yarrow. Other subjects: say in a few words that you are here for this ticket.`;
}

function ticketInstructions(title: string, body: string): string {
  return `You write tickets with a builder on Yarrow's website. A visitor is trying it on a sample project.

${YARROW}

${ACME}

The ticket so far: ${title || body ? `${title}\n${body}` : "nothing yet."}

Every turn, write the whole ticket again from everything said, in exactly this shape, then one short line:
<ticket>
A title of at most 60 characters, no period
---
One or two sentences on what people cannot do today.

**Done when**
- what must be true, three or four lines at most
</ticket>
The one question whose answer would change the ticket most, in one short sentence. When nothing is left to ask, say in a few words that it is ready to start.

Write about what people see and do, never about files or code. Never invent a number or a fact about Acme. Everything in the language of the visitor's last message. Other subjects: no ticket, say in a few words that you are here to write a ticket.`;
}

/** What the agent is told, the screen or the form as the visitor sees it. */
export const tryInstructions = (turn: TryTurn): string =>
  turn.kind === "ticket"
    ? ticketInstructions(turn.title, turn.body)
    : reviewInstructions(turn.chapter);
