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
    updated?: string;
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
          fields: ["summary", "description", "labels", "status", "updated"],
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
        .filter((resource) => resource.scopes?.some((scope) => scope.includes("jira")) ?? true)
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
        `${base(externalId)}/issue/${encodeURIComponent(key)}?fields=summary,description,labels,status,updated`,
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
