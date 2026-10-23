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

interface JiraIssue {
  id: string;
  key: string;
  fields: {
    summary: string;
    description: unknown;
    labels: string[];
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

  return {
    name: "jira",
    authorizeUrl({ credentials, redirectUri, state }) {
      const url = new URL("https://auth.atlassian.com/authorize");
      url.search = new URLSearchParams({
        audience: "api.atlassian.com",
        client_id: credentials.clientId,
        scope: "read:jira-work write:jira-work offline_access",
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
      const resources = await json<{ id: string; name: string; url: string }[]>(
        await fetcher(
          "https://api.atlassian.com/oauth/token/accessible-resources",
          {
            headers: headers(tokens.accessToken),
          },
        ),
        "Jira resources",
      );
      return resources.map((resource) => ({
        ...tokens,
        externalId: resource.id,
        name: resource.name,
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
    async labeledTickets(
      { externalId, accessToken },
      _credentials,
      boardId,
      label,
    ) {
      const jql = `project = "${boardId.replace(/"/g, "")}" AND labels = "${label.replace(/"/g, "")}" AND statusCategory != Done ORDER BY updated DESC`;
      const page = await json<{ issues: JiraIssue[] }>(
        await fetcher(`${base(externalId)}/search/jql`, {
          method: "POST",
          headers: headers(accessToken),
          body: JSON.stringify({
            jql,
            maxResults: 100,
            fields: ["summary", "description", "labels", "status"],
          }),
        }),
        "Jira search",
      );
      return Promise.all(
        page.issues.map((issue) => toTicket(issue, externalId, accessToken)),
      );
    },
    async getTicket({ externalId, accessToken }, _credentials, key) {
      const response = await fetcher(
        `${base(externalId)}/issue/${encodeURIComponent(key)}?fields=summary,description,labels,status`,
        { headers: headers(accessToken) },
      );
      if (response.status === 404) return null;
      return toTicket(
        await json<JiraIssue>(response, "Jira issue"),
        externalId,
        accessToken,
      );
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
