import { z } from "zod";

/**
 * The landing's samples, a ticket being written and the tickets to review, and
 * what their agent knows. No repository behind them: a ticket to review is a
 * real run's, on the bench's task app, its film served with the site
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
    sample: z.enum(["priority", "archive"]),
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

export type TrySampleName = "priority" | "archive";

/** A real run: what it was asked and what came of it. */
interface TrySample {
  ticket: string;
  /** What the run said it changed. */
  changed: string;
  /** What the run left the owner to know: the chat's first words. */
  notes: string[];
  files: string;
  /** The question ready in the box, on a choice the film itself flags. */
  ask: string;
  /** The film's chapters, each line with its moment: the run's own words. */
  film: { title: string; said: string }[];
}

export const TRY_SAMPLES: Record<TrySampleName, TrySample> = {
  priority: {
    ticket:
      "Tasks need a priority. Everything in the task list looks equally important. Add a priority to tasks: Low, Normal or Urgent, chosen when a task is created, Normal by default. The list shows a badge on each task that is not Normal, red for Urgent, and urgent tasks come first.",
    changed:
      "The new-task form has a priority picker (Low, Normal, Urgent) that starts on Normal, and existing tasks become Normal. The list shows a grey Low badge or a red Urgent badge, and urgent tasks sit at the top. They stay there even once they're done, because the ticket says urgent comes first.",
    notes: [
      "An urgent task stays at the top even after it's marked Done. Say if you'd rather finished tasks drop down",
      "Run the new database migration when you deploy. Existing tasks become Normal",
    ],
    files:
      "db/migrations/004_task_priority.sql, public/style.css, src/db.js, src/server.js, src/views.js, test/views.test.js",
    ask: "Can urgent tasks drop down once they're done?",
    film: [
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
    ],
  },
  archive: {
    ticket:
      "Archive old tasks. The task list keeps every finished task forever and they crowd out what people are working on. Add an Archive button on done tasks: an archived task leaves the list. A Show archived link under the list shows them, each with a Restore button.",
    changed:
      "Each done task now has an Archive button that takes it off the list. A Show archived link below the list opens an Archived section with a Restore button on each task. Only done tasks can be archived, and archiving applies to the whole team.",
    notes: [
      "A database update has to run when this ships, or the task list won't load",
      "The tasks API still returns archived tasks, so tools using it see the full list",
    ],
    files:
      "db/migrations/004_archive.sql, public/style.css, src/db.js, src/server.js, src/views.js, test/views.test.js",
    ask: "Can I archive a task that isn't done yet?",
    film: [
      {
        title: "Before",
        said: "0:00 Okay, so this is the team's task list as it is today.\n0:04 You'll notice the finished tasks just sit here at the bottom,\n0:07 like Renew the domain... and they stay forever,\n0:10 so over time they crowd out what people are actually working on.\n0:13 So the ticket asks for a way to archive done tasks,\n0:16 and a way to see them again and restore them.",
      },
      {
        title: "Archive button",
        said: "0:19 And here it is with the change.\n0:21 Every done task now gets an Archive button on the right,\n0:24 and only done tasks, so you can't hide something that's still in progress.\n0:29 Then under the list there's a new Show archived link.",
      },
      {
        title: "Archiving",
        said: "0:33 So let me archive Renew the domain...\n0:36 I click Archive... and it's gone from the list.\n0:38 And it's saved for the whole team, so if I reload... it stays gone.",
      },
      {
        title: "Restoring",
        said: "0:45 Now I click Show archived...\n0:47 and the archived tasks show up underneath, each with a Restore button.\n0:51 Let me click Restore... and Renew the domain is back in the main list, nothing lost.\n0:56 So done work can be tucked away without ever being deleted.",
      },
    ],
  },
};

/** What the agent says when the ticket is not the one the film answers. */
export const TRY_NOT_BUILT =
  "I can't build your ticket from here, so here is one I built on the same app.";

const YARROW =
  "What Yarrow is: builders write tickets with an agent that knows their code and their other tickets. Agents build and review each ticket in the cloud and it comes back with a demo of the result, beside this conversation. The builder asks anything, asks for a change, then merges. It connects to GitHub, Jira, Linear and Trello. Free for builders: sponsors fund the compute, their card ships in the pull requests they fund.";

const ACME =
  "Acme is a small team task app: tasks with a title, a status (to do, doing or done), an assignee and a due date, a settings page, a weekly email.";

function reviewInstructions(name: TrySampleName, chapter: number): string {
  const { ticket, changed, notes, files, film: chapters } = TRY_SAMPLES[name];
  const film = chapters
    .map(
      (part, i) =>
        `${part.title}${i === chapter ? " (on the screen now)" : ""}:\n${part.said}`,
    )
    .join("\n\n");
  return `You are the agent on Yarrow's website, in the room of a ticket to review. A visitor is trying Yarrow: talk to them as you would to a colleague reviewing this ticket.

${YARROW}

${ACME}

The ticket: ${ticket}

What changed: ${changed}
The files: ${files}. The tests pass.
What you wrote in the conversation before they asked anything: ${notes.join(". ")}.

The demo beside you is a recording of the real app, made and narrated by the agent who built the change:
${film}

Every answer points at the one moment of the demo closest to what you say, written as [at 0:12] right after the sentence about it, the time of the line that shows it: the screen goes there and the visitor can play it from there.

When they ask for a change, or ask whether something could work differently, say what you would change in one sentence, then write [change:what the app will do, in a few words]. That puts a card under your words: never mention a card, a tag or a sample, and never offer or ask whether they want it. You never change the app from here.

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
    : reviewInstructions(turn.sample, turn.chapter);
