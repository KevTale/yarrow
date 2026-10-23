import {
  json,
  type Fetch,
  type TrackerAdapter,
  type TrackerTicket,
} from "./types";

const GRAPHQL = "https://api.linear.app/graphql";

interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  url: string;
  state: { type: string } | null;
  labels: { nodes: { name: string }[] };
}

const issueFields = `id identifier title description url state { type } labels { nodes { name } }`;

function toTicket(issue: LinearIssue): TrackerTicket {
  return {
    externalId: issue.id,
    title: `${issue.identifier} ${issue.title}`,
    body: issue.description ?? "",
    url: issue.url,
    labels: issue.labels.nodes.map((label) => label.name),
    closed: ["completed", "canceled"].includes(issue.state?.type ?? ""),
  };
}

export function linearAdapter(fetcher: Fetch = fetch): TrackerAdapter {
  async function query<T>(
    token: string,
    gql: string,
    variables: Record<string, unknown> = {},
  ): Promise<T> {
    const result = await json<{ data?: T; errors?: { message: string }[] }>(
      await fetcher(GRAPHQL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: gql, variables }),
      }),
      "Linear API",
    );
    if (result.errors?.length || !result.data)
      throw new Error(
        `Linear API: ${result.errors?.map((error) => error.message).join("; ")}`,
      );
    return result.data;
  }

  return {
    name: "linear",
    authorizeUrl({ credentials, redirectUri, state }) {
      const url = new URL("https://linear.app/oauth/authorize");
      url.search = new URLSearchParams({
        client_id: credentials.clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "read,write,comments:create",
        state,
        prompt: "consent",
      }).toString();
      return url.toString();
    },
    async exchangeCode({ credentials, code, redirectUri }) {
      const token = await json<{ access_token: string; expires_in?: number }>(
        await fetcher("https://api.linear.app/oauth/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: redirectUri,
            client_id: credentials.clientId,
            client_secret: credentials.clientSecret,
          }),
        }),
        "Linear token exchange",
      );
      return {
        accessToken: token.access_token,
        expiresAt: token.expires_in
          ? new Date(Date.now() + token.expires_in * 1000)
          : null,
      };
    },
    async describe(tokens) {
      const data = await query<{ organization: { id: string; name: string } }>(
        tokens.accessToken,
        `query { organization { id name } }`,
      );
      return [
        {
          ...tokens,
          externalId: data.organization.id,
          name: data.organization.name,
        },
      ];
    },
    async listBoards({ accessToken }) {
      const data = await query<{
        teams: { nodes: { id: string; name: string }[] };
      }>(accessToken, `query { teams(first: 100) { nodes { id name } } }`);
      return data.teams.nodes;
    },
    async labeledTickets({ accessToken }, _credentials, boardId, label) {
      const data = await query<{ issues: { nodes: LinearIssue[] } }>(
        accessToken,
        `query($team: ID!, $label: String!) {
          issues(first: 100, filter: {
            team: { id: { eq: $team } },
            labels: { name: { eqIgnoreCase: $label } },
            state: { type: { nin: ["completed", "canceled"] } }
          }) { nodes { ${issueFields} } }
        }`,
        { team: boardId, label },
      );
      return data.issues.nodes.map(toTicket);
    },
    async getTicket({ accessToken }, _credentials, externalId) {
      const data = await query<{ issue: LinearIssue | null }>(
        accessToken,
        `query($id: String!) { issue(id: $id) { ${issueFields} } }`,
        { id: externalId },
      );
      return data.issue ? toTicket(data.issue) : null;
    },
    async comment({ accessToken }, _credentials, externalId, body) {
      await query(
        accessToken,
        `mutation($input: CommentCreateInput!) { commentCreate(input: $input) { success } }`,
        { input: { issueId: externalId, body } },
      );
    },
  };
}
