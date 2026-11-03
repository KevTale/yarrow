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

/** Where a new ticket goes: "github", or a linked Jira project's key. */
export const DESTINATION = /^(github|[A-Z][A-Z0-9_]{0,9})$/;

export const openedFromYarrow = (body: string, login: string) => {
  const text = body.trim();
  return `${text}${text ? "\n\n" : ""}_Opened from Yarrow by **${login}**_`;
};

/**
 * A ticket's text as Yarrow shows it: without the line saying who wrote it
 * here, and empty when all it says is the title again.
 */
export function ticketText(body: string, title: string): string {
  const text = body
    .replace(/\n*_Opened from Yarrow by \*\*[^*\n]+\*\*_\s*$/, "")
    .trim();
  const plain = (value: string) =>
    value
      .trim()
      .toLowerCase()
      .replace(/[.!]+$/, "");
  return plain(text) === plain(title) ? "" : text;
}
