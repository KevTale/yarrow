/** Where a pasted ticket link comes from. `soon` sources are not supported yet. */
export type TicketSource = {
  id: "github" | "jira" | "linear" | "trello" | "gitlab" | "azure";
  name: string;
  example: string;
  soon?: true;
};

export const ticketSources: TicketSource[] = [
  { id: "github", name: "GitHub", example: "github.com/you/app/issues/42" },
  {
    id: "jira",
    name: "Jira",
    example: "your-site.atlassian.net/browse/APP-42",
  },
  {
    id: "linear",
    name: "Linear",
    example: "linear.app/your-team/issue/ENG-42",
    soon: true,
  },
  {
    id: "trello",
    name: "Trello",
    example: "trello.com/c/AbCd1234",
    soon: true,
  },
  {
    id: "gitlab",
    name: "GitLab",
    example: "gitlab.com/you/app/-/issues/42",
    soon: true,
  },
  {
    id: "azure",
    name: "Azure DevOps",
    example: "dev.azure.com/you/app/_workitems/edit/42",
    soon: true,
  },
];

export type TicketLink = {
  source: TicketSource;
  /** `owner/repo` for GitHub links. */
  repository?: string;
  /** The issue number for GitHub issue links. */
  issue?: number;
  /** Jira: the cloud site (`acme.atlassian.net`) and the issue key. */
  site?: string;
  ticket?: string;
};

/** A Jira issue key: project key, dash, number ("APP-42"). */
export const jiraKeyPattern = /^[A-Z][A-Z0-9_]{0,9}-\d{1,9}$/;
/** The board of a ticket key: "APP-42" → "APP" (a Jira project, a Linear team). */
export const boardOfKey = (key: string) => key.replace(/-\d+$/, "");

const bySource = (id: TicketSource["id"]) =>
  ticketSources.find((source) => source.id === id)!;

/** Recognises a pasted link. Null when it is not a known ticket source. */
export function parseTicketLink(input: string): TicketLink | null {
  const text = input
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "");
  const github =
    /^github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/issues\/(\d+))?\/?(?:[?#].*)?$/i.exec(
      text,
    );
  if (github)
    return {
      source: bySource("github"),
      repository: `${github[1]}/${github[2]}`,
      ...(github[3] ? { issue: Number(github[3]) } : {}),
    };
  const jira = /^([\w-]+\.atlassian\.net)(\/.*)?$/i.exec(text);
  if (jira) {
    // /browse/APP-42, /issues/APP-42, ?selectedIssue=APP-42…
    const key = /(?:^|[/=])([A-Z][A-Z0-9_]{0,9}-\d{1,9})(?:$|[/?&#])/.exec(
      jira[2] ?? "",
    )?.[1];
    return {
      source: bySource("jira"),
      site: jira[1]!.toLowerCase(),
      ...(key ? { ticket: key } : {}),
    };
  }
  if (/^linear\.app\//i.test(text)) return { source: bySource("linear") };
  if (/^trello\.com\/c\//i.test(text)) return { source: bySource("trello") };
  if (/^gitlab\.com\//i.test(text)) return { source: bySource("gitlab") };
  if (/^(dev\.azure\.com|[\w-]+\.visualstudio\.com)\//i.test(text))
    return { source: bySource("azure") };
  return null;
}
