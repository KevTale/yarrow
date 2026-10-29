import { categoryRank, type TrackerStatus } from "../../core/tracker-moves";
import {
  json,
  type Fetch,
  type TrackerAdapter,
  type TrackerTicket,
} from "./types";

/** Atlassian Document Format → plain text (paragraphs, lists, code). */
export function adfToText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const { type, text, content } = node as {
    type?: string;
    text?: string;
    content?: unknown[];
  };
  if (type === "text") return text ?? "";
  if (type === "hardBreak") return "\n";
  const inner = (content ?? []).map(adfToText).join("");
  if (type === "listItem") return `- ${inner.trim()}\n`;
  if (["paragraph", "heading", "codeBlock", "blockquote"].includes(type ?? ""))
    return `${inner}\n\n`;
  return inner;
}

/** Jira's status categories: new, indeterminate, done. */
function categoryOf(key: string): TrackerStatus["category"] {
  return key === "done"
    ? "done"
    : key === "indeterminate"
      ? "progress"
      : "todo";
}

function adfDocument(body: string) {
  return {
    type: "doc",
    version: 1,
    content: body.split(/\n{2,}/).map((paragraph) => ({
      type: "paragraph",
      content: [{ type: "text", text: paragraph }],
    })),
  };
}

type AdfNode = Record<string, unknown>;

/** Inline Markdown: `code`, **strong**, _em_, [links](url), bare URLs. */
function adfInline(text: string): AdfNode[] {
  const nodes: AdfNode[] = [];
  const pattern =
    /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)\s]+\))|((?<!\w)_[^_]+_(?!\w))|((?<![\w*])\*[^*]+\*(?![\w*]))|(https?:\/\/[^\s)]+)/g;
  let last = 0;
  const plain = (value: string) => {
    if (value) nodes.push({ type: "text", text: value });
  };
  for (const match of text.matchAll(pattern)) {
    const [token] = match;
    plain(text.slice(last, match.index));
    last = match.index + token.length;
    const marked = (value: string, mark: AdfNode) =>
      value
        ? nodes.push({ type: "text", text: value, marks: [mark] })
        : undefined;
    if (match[1]) marked(token.slice(1, -1), { type: "code" });
    else if (match[2]) marked(token.slice(2, -2), { type: "strong" });
    else if (match[3]) {
      const [, label, href] = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token)!;
      marked(label!, { type: "link", attrs: { href } });
    } else if (match[4] || match[5]) marked(token.slice(1, -1), { type: "em" });
    else marked(token, { type: "link", attrs: { href: token } });
  }
  plain(text.slice(last));
  return nodes;
}

const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s+(.*)$/;
const BLOCK_START = /^(```|#{1,6}\s|>\s?)/;

/**
 * Markdown → Atlassian Document Format, for what a builder writes in
 * Yarrow: paragraphs, headings, lists, quotes, fenced code, inline marks.
 */
export function markdownToAdf(markdown: string) {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const content: AdfNode[] = [];
  const paragraph = (block: string[]): AdfNode => ({
    type: "paragraph",
    content: block.flatMap((line, index) => [
      ...(index ? [{ type: "hardBreak" }] : []),
      ...adfInline(line),
    ]),
  });
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = /^```\s*([\w+-]*)/.exec(line);
    if (fence) {
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i]!.startsWith("```"); i++)
        code.push(lines[i]!);
      i++;
      content.push({
        type: "codeBlock",
        ...(fence[1] ? { attrs: { language: fence[1] } } : {}),
        content: code.length ? [{ type: "text", text: code.join("\n") }] : [],
      });
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      content.push({
        type: "heading",
        attrs: { level: heading[1]!.length },
        content: adfInline(heading[2]!),
      });
      i++;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quoted: string[] = [];
      for (; i < lines.length && /^>\s?/.test(lines[i]!); i++)
        quoted.push(lines[i]!.replace(/^>\s?/, ""));
      content.push({
        type: "blockquote",
        content: [paragraph(quoted)],
      });
      continue;
    }
    if (LIST_ITEM.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items: AdfNode[] = [];
      for (
        ;
        i < lines.length &&
        LIST_ITEM.test(lines[i]!) &&
        /^\s*\d/.test(lines[i]!) === ordered;
        i++
      )
        items.push({
          type: "listItem",
          content: [paragraph([LIST_ITEM.exec(lines[i]!)![2]!])],
        });
      content.push({
        type: ordered ? "orderedList" : "bulletList",
        content: items,
      });
      continue;
    }
    const block: string[] = [];
    for (
      ;
      i < lines.length &&
      lines[i]!.trim() &&
      !BLOCK_START.test(lines[i]!) &&
      !LIST_ITEM.test(lines[i]!);
      i++
    )
      block.push(lines[i]!);
    content.push(paragraph(block));
  }
  return { type: "doc", version: 1, content };
}

/** Jira's own words for a refusal: its error messages and field errors. */
async function jiraRefusal(response: Response, what: string): Promise<Error> {
  const text = await response.text().catch(() => "");
  try {
    const body = JSON.parse(text) as {
      errorMessages?: string[];
      errors?: Record<string, string>;
    };
    const reasons = [
      ...(body.errorMessages ?? []),
      ...Object.values(body.errors ?? {}),
    ];
    if (reasons.length) return new Error(reasons.join(" "));
  } catch {
    // Not JSON: the status says enough.
  }
  return new Error(`${what} failed (${response.status})`);
}

interface JiraIssue {
  id: string;
  key: string;
  fields: {
    summary: string;
    description: unknown;
    labels: string[];
    updated?: string;
    created?: string;
    reporter?: { displayName?: string } | null;
    comment?: {
      comments?: { author?: { displayName?: string }; body: unknown }[];
    };
    statusCategory?: { key: string };
    status?: { statusCategory?: { key: string } };
  };
}

export function jiraAdapter(fetcher: Fetch = fetch): TrackerAdapter {
  const base = (cloudId: string) =>
    `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3`;
  const headers = (token: string) => ({
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  });
  const sites = new Map<string, string>();

  async function siteUrl(cloudId: string, token: string): Promise<string> {
    if (!sites.has(cloudId)) {
      const resources = await json<{ id: string; url: string }[]>(
        await fetcher(
          "https://api.atlassian.com/oauth/token/accessible-resources",
          {
            headers: headers(token),
          },
        ),
        "Jira resources",
      );
      for (const resource of resources) sites.set(resource.id, resource.url);
    }
    return sites.get(cloudId) ?? "";
  }

  async function toTicket(
    issue: JiraIssue,
    cloudId: string,
    token: string,
  ): Promise<TrackerTicket> {
    const category =
      issue.fields.status?.statusCategory?.key ??
      issue.fields.statusCategory?.key;
    return {
      externalId: issue.key,
      title: `${issue.key} ${issue.fields.summary}`,
      ...(issue.fields.updated
        ? { updatedAt: new Date(issue.fields.updated).toISOString() }
        : {}),
      ...(issue.fields.created
        ? { createdAt: new Date(issue.fields.created).toISOString() }
        : {}),
      ...(issue.fields.reporter?.displayName
        ? { author: issue.fields.reporter.displayName }
        : {}),
      body: adfToText(issue.fields.description).trim(),
      url: `${await siteUrl(cloudId, token)}/browse/${issue.key}`,
      labels: issue.fields.labels ?? [],
      closed: category === "done",
    };
  }

  async function tokenRequest(body: Record<string, string>) {
    const token = await json<{
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    }>(
      await fetcher("https://auth.atlassian.com/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      "Atlassian token",
    );
    return {
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? null,
      expiresAt: new Date(Date.now() + token.expires_in * 1000),
    };
  }

  // JQL string values: quotes and backslashes could end the string early.
  const quote = (value: string) => value.replace(/["\\]/g, "");
  async function search(
    cloudId: string,
    token: string,
    jql: string,
  ): Promise<TrackerTicket[]> {
    const page = await json<{ issues: JiraIssue[] }>(
      await fetcher(`${base(cloudId)}/search/jql`, {
        method: "POST",
        headers: headers(token),
        body: JSON.stringify({
          jql,
          maxResults: 100,
          fields: [
            "summary",
            "description",
            "labels",
            "status",
            "updated",
            "created",
          ],
        }),
      }),
      "Jira search",
    );
    return Promise.all(
      page.issues.map((issue) => toTicket(issue, cloudId, token)),
    );
  }

  return {
    name: "jira",
    authorizeUrl({ credentials, redirectUri, state }) {
      const url = new URL("https://auth.atlassian.com/authorize");
      url.search = new URLSearchParams({
        audience: "api.atlassian.com",
        client_id: credentials.clientId,
        // manage:jira-webhook: a label set in Jira reaches Yarrow in seconds.
        scope:
          "read:jira-work write:jira-work manage:jira-webhook offline_access",
        redirect_uri: redirectUri,
        state,
        response_type: "code",
        prompt: "consent",
      }).toString();
      return url.toString();
    },
    exchangeCode({ credentials, code, redirectUri }) {
      return tokenRequest({
        grant_type: "authorization_code",
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        code,
        redirect_uri: redirectUri,
      });
    },
    refresh({ credentials, refreshToken }) {
      return tokenRequest({
        grant_type: "refresh_token",
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        refresh_token: refreshToken,
      });
    },
    async describe(tokens) {
      const resources = await json<
        { id: string; name: string; url: string; scopes?: string[] }[]
      >(
        await fetcher(
          "https://api.atlassian.com/oauth/token/accessible-resources",
          {
            headers: headers(tokens.accessToken),
          },
        ),
        "Jira resources",
      );
      // Named by their address (acme.atlassian.net): what builders paste.
      return resources
        .filter(
          (resource) =>
            resource.scopes?.some((scope) => scope.includes("jira")) ?? true,
        )
        .map((resource) => ({
          ...tokens,
          externalId: resource.id,
          name: new URL(resource.url).host,
        }));
    },
    async listBoards({ externalId, accessToken }) {
      const page = await json<{ values: { key: string; name: string }[] }>(
        await fetcher(`${base(externalId)}/project/search?maxResults=100`, {
          headers: headers(accessToken),
        }),
        "Jira projects",
      );
      return page.values.map((project) => ({
        id: project.key,
        name: `${project.key} · ${project.name}`,
      }));
    },
    labeledTickets({ externalId, accessToken }, _credentials, boardId, label) {
      return search(
        externalId,
        accessToken,
        `project = "${quote(boardId)}" AND labels = "${quote(label)}" AND statusCategory != Done ORDER BY updated DESC`,
      );
    },
    openTickets({ externalId, accessToken }, _credentials, boardId) {
      return search(
        externalId,
        accessToken,
        `project = "${quote(boardId)}" AND statusCategory != Done ORDER BY updated DESC`,
      );
    },
    async statuses({ externalId, accessToken }, _credentials, boardId) {
      // Statuses per issue type; one list, in the order Jira gives them.
      const types = await json<
        {
          statuses: {
            id: string;
            name: string;
            statusCategory: { key: string };
          }[];
        }[]
      >(
        await fetcher(
          `${base(externalId)}/project/${encodeURIComponent(boardId)}/statuses`,
          { headers: headers(accessToken) },
        ),
        "Jira statuses",
      );
      const seen = new Map<string, TrackerStatus>();
      for (const type of types)
        for (const status of type.statuses)
          if (!seen.has(status.id))
            seen.set(status.id, {
              id: status.id,
              name: status.name,
              category: categoryOf(status.statusCategory.key),
            });
      return [...seen.values()].sort(
        (a, b) => categoryRank[a.category] - categoryRank[b.category],
      );
    },
    async moveTo(
      { externalId, accessToken },
      _credentials,
      key,
      statusId,
      backwards = false,
    ) {
      const issue = `${base(externalId)}/issue/${encodeURIComponent(key)}`;
      const current = await json<{
        fields: {
          status: { id: string; statusCategory: { key: string } };
        };
      }>(
        await fetcher(`${issue}?fields=status`, {
          headers: headers(accessToken),
        }),
        "Jira issue",
      );
      if (current.fields.status.id === statusId) return "already";
      const { transitions } = await json<{
        transitions: {
          id: string;
          to: { id: string; statusCategory: { key: string } };
        }[];
      }>(
        await fetcher(`${issue}/transitions`, {
          headers: headers(accessToken),
        }),
        "Jira transitions",
      );
      const transition = transitions.find((item) => item.to.id === statusId);
      if (!transition) return "blocked";
      // Never backwards: a ticket already further stays where it is.
      if (
        !backwards &&
        categoryRank[categoryOf(current.fields.status.statusCategory.key)] >
          categoryRank[categoryOf(transition.to.statusCategory.key)]
      )
        return "already";
      const response = await fetcher(`${issue}/transitions`, {
        method: "POST",
        headers: headers(accessToken),
        body: JSON.stringify({ transition: { id: transition.id } }),
      });
      // 400: the transition needs fields its screen asks for.
      if (response.status === 400) return "blocked";
      if (!response.ok) await json(response, "Jira transition");
      return "moved";
    },
    async setLabel({ externalId, accessToken }, _credentials, key, label, on) {
      const response = await fetcher(
        `${base(externalId)}/issue/${encodeURIComponent(key)}`,
        {
          method: "PUT",
          headers: headers(accessToken),
          body: JSON.stringify({
            update: { labels: [on ? { add: label } : { remove: label }] },
          }),
        },
      );
      // 204 No Content on success.
      if (!response.ok) await json(response, "Jira label");
    },
    async getTicket({ externalId, accessToken }, _credentials, key) {
      const response = await fetcher(
        `${base(externalId)}/issue/${encodeURIComponent(key)}?fields=summary,description,labels,status,updated,created,reporter,comment`,
        { headers: headers(accessToken) },
      );
      if (response.status === 404) return null;
      const issue = await json<JiraIssue>(response, "Jira issue");
      const discussion = (issue.fields.comment?.comments ?? [])
        .slice(-20)
        .map(
          (comment) =>
            `${comment.author?.displayName ?? "Someone"}: ${adfToText(comment.body).trim()}`,
        )
        .join("\n\n");
      return {
        ...(await toTicket(issue, externalId, accessToken)),
        ...(discussion ? { discussion } : {}),
      };
    },
    async createTicket(
      { externalId, accessToken },
      _credentials,
      projectKey,
      { title, body },
    ) {
      const project = encodeURIComponent(projectKey);
      type IssueType = { id: string; name: string; subtask?: boolean };
      const page = await json<{
        issueTypes?: IssueType[];
        createMetaIssueType?: IssueType[];
      }>(
        await fetcher(
          `${base(externalId)}/issue/createmeta/${project}/issuetypes?maxResults=100`,
          { headers: headers(accessToken) },
        ),
        "Jira issue types",
      );
      const types = (page.issueTypes ?? page.createMetaIssueType ?? []).filter(
        (type) => !type.subtask,
      );
      // A plain task when the project has one, as people file them.
      const type =
        ["task", "story", "bug"]
          .map((name) => types.find((item) => item.name.toLowerCase() === name))
          .find(Boolean) ?? types[0];
      if (!type) throw new Error(`${projectKey} takes no new tickets.`);
      type Field = {
        fieldId: string;
        name: string;
        required: boolean;
        hasDefaultValue?: boolean;
      };
      const meta = await json<{ fields?: Field[]; results?: Field[] }>(
        await fetcher(
          `${base(externalId)}/issue/createmeta/${project}/issuetypes/${type.id}?maxResults=200`,
          { headers: headers(accessToken) },
        ),
        "Jira fields",
      );
      const fields = meta.fields ?? meta.results ?? [];
      const filled = [
        "summary",
        "description",
        "project",
        "issuetype",
        "reporter",
      ];
      const missing = fields
        .filter(
          (field) =>
            field.required &&
            !field.hasDefaultValue &&
            !filled.includes(field.fieldId),
        )
        .map((field) => field.name);
      if (missing.length)
        throw new Error(
          `${projectKey} requires ${missing.join(", ")}: create this ticket in Jira.`,
        );
      const described =
        body.trim() && fields.some((field) => field.fieldId === "description");
      const response = await fetcher(`${base(externalId)}/issue`, {
        method: "POST",
        headers: headers(accessToken),
        body: JSON.stringify({
          fields: {
            project: { key: projectKey },
            issuetype: { id: type.id },
            summary: title,
            ...(described ? { description: markdownToAdf(body) } : {}),
          },
        }),
      });
      if (!response.ok) throw await jiraRefusal(response, "Jira new ticket");
      return ((await response.json()) as { key: string }).key;
    },
    async comment({ externalId, accessToken }, _credentials, key, body) {
      await json(
        await fetcher(
          `${base(externalId)}/issue/${encodeURIComponent(key)}/comment`,
          {
            method: "POST",
            headers: headers(accessToken),
            body: JSON.stringify({ body: adfDocument(body) }),
          },
        ),
        "Jira comment",
      );
    },
  };
}
