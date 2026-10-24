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
    soon: true,
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
};

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
  if (/^[\w-]+\.atlassian\.net\//i.test(text))
    return { source: bySource("jira") };
  if (/^linear\.app\//i.test(text)) return { source: bySource("linear") };
  if (/^trello\.com\/c\//i.test(text)) return { source: bySource("trello") };
  if (/^gitlab\.com\//i.test(text)) return { source: bySource("gitlab") };
  if (/^(dev\.azure\.com|[\w-]+\.visualstudio\.com)\//i.test(text))
    return { source: bySource("azure") };
  return null;
}
