/**
 * A ticket written in Yarrow, created in GitHub or a linked Jira project.
 * GitHub shows the App as its author and Jira the person who connected it,
 * so the body ends with who wrote it.
 */

export const TITLE_MAX = 250;
export const BODY_MAX = 20_000;

/** A ticket's form, as it stands in the new ticket dialog. */
export interface DraftText {
  title: string;
  body: string;
}

/** One line of the conversation that writes a ticket with the agent. */
export interface DraftLine {
  author: "builder" | "agent";
  body: string;
}

/** Where a new ticket goes: "github", or a linked board's key. */
/** The agent's words end on a question: the ticket waits for the answer. */
export const asksBack = (words: string) => /[?？]\s*$/.test(words);

export const DESTINATION = /^(github|[A-Za-z0-9_]{1,10})$/;

export const openedFromYarrow = (body: string, login: string) => {
  const text = body.trim();
  return `${text}${text ? "\n\n" : ""}_Opened from Yarrow by **${login}**_`;
};

/** That line, its italics lost in Jira. */
const OPENED_LINE = /\n*_?Opened from Yarrow by \*\*([^*\n]+)\*\*_?\s*$/;

/**
 * Who wrote a ticket: the person the line above names, else its tracker's
 * author. An app (Yarrow's own) is no one's name.
 */
export function ticketAuthor(
  author: string | null | undefined,
  body: string,
): string | null {
  const named = OPENED_LINE.exec(body)?.[1];
  return named ?? (author && !author.endsWith("[bot]") ? author : null);
}

/**
 * A ticket's text as Yarrow shows it: without the line saying who wrote it
 * here, and empty when all it says is the title again.
 */
export function ticketText(body: string, title: string): string {
  const text = body.replace(OPENED_LINE, "").trim();
  const plain = (value: string) =>
    value
      .trim()
      .toLowerCase()
      .replace(/[.!]+$/, "");
  return plain(text) === plain(title) ? "" : text;
}
