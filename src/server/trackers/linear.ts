import { categoryRank, type TrackerStatus } from "../../core/tracker-moves";
import {
  json,
  type Fetch,
  type TrackerAdapter,
  type TrackerTicket,
  type TrackerTokens,
} from "./types";

const GRAPHQL = "https://api.linear.app/graphql";

/**
 * Linear for builders, as Jira: a team is a board, named by its key
 * ("ENG"), and a ticket by its identifier ("ENG-42"), which the API reads
 * as well as its id. The identifier in the branch and the pull request's
 * title is how Linear's GitHub integration links them.
 */
interface LinearIssue {
  identifier: string;
  title: string;
  description: string | null;
  url: string;
  createdAt: string;
  updatedAt: string;
  creator: { name: string } | null;
  state: { type: string } | null;
  labels: { nodes: { name: string }[] };
}

const issueFields = `identifier title description url createdAt updatedAt creator { name } state { type } labels { nodes { name } }`;

function toTicket(issue: LinearIssue): TrackerTicket {
  return {
    externalId: issue.identifier,
    title: `${issue.identifier} ${issue.title}`,
    body: issue.description ?? "",
    url: issue.url,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    ...(issue.creator ? { author: issue.creator.name } : {}),
    labels: issue.labels.nodes.map((label) => label.name),
    closed: ["completed", "canceled", "duplicate"].includes(
      issue.state?.type ?? "",
    ),
  };
}

/** Linear's state types, in the order a ticket goes through them. */
const typeOrder = [
  "triage",
  "backlog",
  "unstarted",
  "started",
  "completed",
  "canceled",
];

function categoryOf(type: string): TrackerStatus["category"] {
  if (type === "started") return "progress";
  if (type === "completed" || type === "canceled") return "done";
  return "todo";
}

/** Linear answers an unknown issue with an error, not with null. */
const notFound = (error: unknown) =>
  error instanceof Error && /not found|could not find/i.test(error.message);

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

  // Tokens last 24 hours; each refresh brings a new refresh token.
  async function tokenRequest(
    body: Record<string, string>,
  ): Promise<TrackerTokens> {
    const token = await json<{
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    }>(
      await fetcher("https://api.linear.app/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(body),
      }),
      "Linear token",
    );
    return {
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? null,
      expiresAt: token.expires_in
        ? new Date(Date.now() + token.expires_in * 1000)
        : null,
    };
  }

  async function issues(
    token: string,
    filter: string,
    variables: Record<string, unknown>,
  ): Promise<TrackerTicket[]> {
    const data = await query<{ issues: { nodes: LinearIssue[] } }>(
      token,
      `query($team: String!${"label" in variables ? ", $label: String!" : ""}) {
        issues(first: 100, orderBy: updatedAt, filter: {
          team: { key: { eq: $team } },
          state: { type: { nin: ["completed", "canceled", "duplicate"] } }
          ${filter}
        }) { nodes { ${issueFields} } }
      }`,
      variables,
    );
    return data.issues.nodes.map(toTicket);
  }

  /** A team's id, from its key. */
  async function teamId(token: string, key: string): Promise<string> {
    const data = await query<{ teams: { nodes: { id: string }[] } }>(
      token,
      `query($key: String!) { teams(filter: { key: { eq: $key } }) { nodes { id } } }`,
      { key },
    );
    const team = data.teams.nodes[0];
    if (!team) throw new Error(`${key} is not a Linear team.`);
    return team.id;
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
    exchangeCode({ credentials, code, redirectUri }) {
      return tokenRequest({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
      });
    },
    refresh({ credentials, refreshToken }) {
      return tokenRequest({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
      });
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
        teams: { nodes: { key: string; name: string }[] };
      }>(accessToken, `query { teams(first: 100) { nodes { key name } } }`);
      return data.teams.nodes.map((team) => ({
        id: team.key,
        name: `${team.key} · ${team.name}`,
      }));
    },
    labeledTickets({ accessToken }, _credentials, boardId, label) {
      return issues(accessToken, `labels: { name: { eqIgnoreCase: $label } }`, {
        team: boardId,
        label,
      });
    },
    openTickets({ accessToken }, _credentials, boardId) {
      return issues(accessToken, "", { team: boardId });
    },
    async getTicket({ accessToken }, _credentials, key) {
      try {
        const data = await query<{
          issue: LinearIssue & {
            comments: {
              nodes: {
                body: string;
                createdAt: string;
                user: { name: string } | null;
              }[];
            };
          };
        }>(
          accessToken,
          `query($id: String!) { issue(id: $id) {
            ${issueFields}
            comments(last: 20) { nodes { body createdAt user { name } } }
          } }`,
          { id: key },
        );
        const discussion = [...data.issue.comments.nodes]
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
          .map(
            (comment) =>
              `${comment.user?.name ?? "Someone"}: ${comment.body.trim()}`,
          )
          .join("\n\n");
        return {
          ...toTicket(data.issue),
          ...(discussion ? { discussion } : {}),
        };
      } catch (error) {
        if (notFound(error)) return null;
        throw error;
      }
    },
    async statuses({ accessToken }, _credentials, boardId) {
      const data = await query<{
        teams: {
          nodes: {
            states: {
              nodes: {
                id: string;
                name: string;
                type: string;
                position: number;
              }[];
            };
          }[];
        };
      }>(
        accessToken,
        `query($key: String!) { teams(filter: { key: { eq: $key } }) {
          nodes { states(first: 100) { nodes { id name type position } } }
        } }`,
        { key: boardId },
      );
      const states = data.teams.nodes[0]?.states.nodes ?? [];
      // As the board shows them: by type, then the team's own order.
      return states
        .filter((state) => typeOrder.includes(state.type))
        .sort(
          (a, b) =>
            typeOrder.indexOf(a.type) - typeOrder.indexOf(b.type) ||
            a.position - b.position,
        )
        .map((state) => ({
          id: state.id,
          name: state.name,
          category: categoryOf(state.type),
        }));
    },
    async currentStatus({ accessToken }, _credentials, key) {
      try {
        const data = await query<{ issue: { state: { id: string } } }>(
          accessToken,
          `query($id: String!) { issue(id: $id) { state { id } } }`,
          { id: key },
        );
        return data.issue.state.id;
      } catch (error) {
        if (notFound(error)) return null;
        throw error;
      }
    },
    async moveTo(
      { accessToken },
      _credentials,
      key,
      statusId,
      backwards = false,
    ) {
      const data = await query<{
        issue: { id: string; state: { id: string; type: string } };
        workflowState: { type: string };
      }>(
        accessToken,
        `query($id: String!, $state: String!) {
          issue(id: $id) { id state { id type } }
          workflowState(id: $state) { type }
        }`,
        { id: key, state: statusId },
      );
      if (data.issue.state.id === statusId) return "already";
      // Never backwards: a ticket already further stays where it is.
      if (
        !backwards &&
        categoryRank[categoryOf(data.issue.state.type)] >
          categoryRank[categoryOf(data.workflowState.type)]
      )
        return "already";
      // Linear's workflows let a ticket go to any status of its team.
      const result = await query<{ issueUpdate: { success: boolean } }>(
        accessToken,
        `mutation($id: String!, $state: String!) {
          issueUpdate(id: $id, input: { stateId: $state }) { success }
        }`,
        { id: data.issue.id, state: statusId },
      );
      return result.issueUpdate.success ? "moved" : "blocked";
    },
    async setLabel({ accessToken }, _credentials, key, label, on) {
      const data = await query<{
        issue: {
          id: string;
          team: { id: string };
          labels: { nodes: { id: string; name: string }[] };
        };
        issueLabels: { nodes: { id: string; team: { id: string } | null }[] };
      }>(
        accessToken,
        `query($id: String!, $label: String!) {
          issue(id: $id) { id team { id } labels { nodes { id name } } }
          issueLabels(first: 50, filter: { name: { eqIgnoreCase: $label } }) {
            nodes { id team { id } }
          }
        }`,
        { id: key, label },
      );
      const { issue } = data;
      const lower = label.toLowerCase();
      if (!on) {
        for (const held of issue.labels.nodes)
          if (held.name.toLowerCase() === lower)
            await query(
              accessToken,
              `mutation($id: String!, $label: String!) { issueRemoveLabel(id: $id, labelId: $label) { success } }`,
              { id: issue.id, label: held.id },
            );
        return;
      }
      if (issue.labels.nodes.some((held) => held.name.toLowerCase() === lower))
        return;
      // The workspace's label, else the team's, else a new one for the team.
      const usable = data.issueLabels.nodes;
      let labelId =
        usable.find((item) => !item.team)?.id ??
        usable.find((item) => item.team?.id === issue.team.id)?.id;
      if (!labelId) {
        const created = await query<{
          issueLabelCreate: { issueLabel: { id: string } };
        }>(
          accessToken,
          `mutation($name: String!, $team: String!) {
            issueLabelCreate(input: { name: $name, teamId: $team }) { issueLabel { id } }
          }`,
          { name: label, team: issue.team.id },
        );
        labelId = created.issueLabelCreate.issueLabel.id;
      }
      await query(
        accessToken,
        `mutation($id: String!, $label: String!) { issueAddLabel(id: $id, labelId: $label) { success } }`,
        { id: issue.id, label: labelId },
      );
    },
    async createTicket(
      { accessToken },
      _credentials,
      boardId,
      { title, body },
    ) {
      // Linear writes Markdown: the description goes as written.
      const data = await query<{
        issueCreate: { issue: { identifier: string } | null };
      }>(
        accessToken,
        `mutation($input: IssueCreateInput!) {
          issueCreate(input: $input) { issue { identifier } }
        }`,
        {
          input: {
            teamId: await teamId(accessToken, boardId),
            title,
            ...(body.trim() ? { description: body } : {}),
          },
        },
      );
      if (!data.issueCreate.issue)
        throw new Error(`${boardId} took no new ticket.`);
      return data.issueCreate.issue.identifier;
    },
    async comment({ accessToken }, _credentials, key, body) {
      const { issue } = await query<{ issue: { id: string } }>(
        accessToken,
        `query($id: String!) { issue(id: $id) { id } }`,
        { id: key },
      );
      await query(
        accessToken,
        `mutation($input: CommentCreateInput!) { commentCreate(input: $input) { success } }`,
        { input: { issueId: issue.id, body } },
      );
    },
  };
}
