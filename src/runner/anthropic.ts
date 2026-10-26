import type { SessionEvent } from "../core/activity";

/**
 * Minimal client for Claude Managed Agents (beta). Fetch-based so it runs in
 * Workers and tests. Only the calls the platform needs.
 */
const API = "https://api.anthropic.com/v1";
const BETA = "managed-agents-2026-04-01";

export type Fetch = typeof fetch;

export interface ManagedSession {
  id: string;
  status: "idle" | "running" | "rescheduling" | "terminated";
  stop_reason?: string | null;
  usage?: {
    list_cost?: unknown;
    active_seconds?: number;
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation?: {
      ephemeral_1h_input_tokens?: number;
      ephemeral_5m_input_tokens?: number;
    };
  } | null;
  /** Snapshot of the agent: the model and the effort it actually ran with. */
  agent?: { model?: { id?: string; effort?: { type?: string } | string } };
}

export interface SessionFile {
  id: string;
  filename: string;
  size_bytes?: number;
  mime_type?: string;
}

/**
 * The provider prices the session itself (tokens at list price, web searches,
 * $0.08 per running hour) and reports `usage.list_cost` in whole US cents,
 * like `max_list_cost`: `{ amount: "53", currency: "USD" }`. A bare number or
 * string is accepted too while the API is in beta.
 */
export function listCostCents(session: ManagedSession): number {
  const cost = session.usage?.list_cost;
  if (typeof cost === "number") return Math.ceil(cost);
  if (typeof cost === "string") return Math.ceil(Number(cost) || 0);
  if (cost && typeof cost === "object" && "amount" in cost)
    return Math.ceil(Number((cost as { amount: unknown }).amount) || 0);
  return 0;
}

export class ManagedAgentsClient {
  constructor(
    private readonly apiKey: string,
    // Wrapped: Workers reject fetch called as a method ("Illegal invocation").
    private readonly fetcher: Fetch = (input, init) => fetch(input, init),
  ) {}

  private async call<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const response = await this.fetcher(`${API}${path}`, {
      method,
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": BETA,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Anthropic ${method} ${path} failed (${response.status}): ${detail.slice(0, 400)}`,
      );
    }
    return (await response.json()) as T;
  }

  createAgent(input: {
    name: string;
    model: string;
    effort?: string;
    system: string;
  }): Promise<{ id: string; version: number }> {
    return this.call("POST", "/agents", {
      name: input.name,
      model: input.effort
        ? { id: input.model, effort: input.effort }
        : input.model,
      system: input.system,
      tools: [{ type: "agent_toolset_20260401" }],
    });
  }

  createEnvironment(input: {
    name: string;
    allowedHosts: string[];
    packages?: Record<string, string[]>;
  }): Promise<{ id: string }> {
    return this.call("POST", "/environments", {
      name: input.name,
      config: {
        type: "cloud",
        ...(input.packages ? { packages: input.packages } : {}),
        networking: {
          type: "limited",
          allow_package_managers: true,
          allowed_hosts: input.allowedHosts,
        },
      },
    });
  }

  createVault(displayName: string): Promise<{ id: string }> {
    return this.call("POST", "/vaults", { display_name: displayName });
  }

  /** A test secret, substituted at egress for `allowedHost` only. */
  createSecret(
    vaultId: string,
    input: { name: string; value: string; allowedHost: string },
  ): Promise<{ id: string }> {
    return this.call("POST", `/vaults/${vaultId}/credentials`, {
      display_name: input.name,
      auth: {
        type: "environment_variable",
        secret_name: input.name,
        secret_value: input.value,
        networking: { type: "limited", allowed_hosts: [input.allowedHost] },
        injection_location: { header: true },
      },
    });
  }

  deleteSecret(vaultId: string, credentialId: string): Promise<unknown> {
    return this.call(
      "DELETE",
      `/vaults/${vaultId}/credentials/${credentialId}`,
    );
  }

  createSession(input: {
    agentId: string;
    environmentId: string;
    title: string;
    repository: { url: string; token: string; branch: string };
    vaultIds?: string[];
    message: string;
  }): Promise<ManagedSession> {
    return this.call("POST", "/sessions", {
      agent: input.agentId,
      environment_id: input.environmentId,
      title: input.title.slice(0, 200),
      resources: [
        {
          type: "github_repository",
          url: input.repository.url,
          mount_path: "/workspace/repo",
          authorization_token: input.repository.token,
          checkout: { type: "branch", name: input.repository.branch },
        },
      ],
      ...(input.vaultIds?.length ? { vault_ids: input.vaultIds } : {}),
      initial_events: [
        {
          type: "user.message",
          content: [{ type: "text", text: input.message }],
        },
      ],
    });
  }

  sendMessage(sessionId: string, text: string): Promise<unknown> {
    return this.call("POST", `/sessions/${sessionId}/events`, {
      events: [{ type: "user.message", content: [{ type: "text", text }] }],
    });
  }

  getSession(sessionId: string): Promise<ManagedSession> {
    return this.call("GET", `/sessions/${sessionId}`);
  }

  /**
   * The session's actions after `after` (its processed_at), oldest first:
   * tool calls and results, the agent's messages, errors. At most `pages`
   * pages; the next read picks up from the last line kept.
   */
  async listEvents(
    sessionId: string,
    after: string | null,
    pages = 5,
  ): Promise<SessionEvent[]> {
    const events: SessionEvent[] = [];
    let page: string | null = null;
    for (let i = 0; i < pages; i++) {
      const query = new URLSearchParams({ limit: "100", order: "asc" });
      for (const type of [
        "agent.tool_use",
        "agent.tool_result",
        "agent.message",
        "session.error",
      ])
        query.append("types[]", type);
      if (after) query.set("created_at[gt]", after);
      if (page) query.set("page", page);
      const result: { data: SessionEvent[]; next_page?: string | null } =
        await this.call("GET", `/sessions/${sessionId}/events?${query}`);
      events.push(...result.data);
      page = result.next_page ?? null;
      if (!page) break;
    }
    return events;
  }

  async listFiles(sessionId: string): Promise<SessionFile[]> {
    const page = await this.call<{ data: SessionFile[] }>(
      "GET",
      `/files?scope_id=${encodeURIComponent(sessionId)}&limit=1000`,
    );
    return page.data;
  }

  async download(fileId: string): Promise<Uint8Array> {
    const response = await this.fetcher(`${API}/files/${fileId}/content`, {
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": BETA,
      },
    });
    if (!response.ok)
      throw new Error(`Anthropic file download failed (${response.status})`);
    return new Uint8Array(await response.arrayBuffer());
  }

  /** The newest session output whose name ends with `name`. */
  async readOutput(
    sessionId: string,
    name: string,
  ): Promise<Uint8Array | null> {
    const files = await this.listFiles(sessionId);
    const match = files
      .filter(
        (file) => file.filename === name || file.filename.endsWith(`/${name}`),
      )
      .at(-1);
    return match ? this.download(match.id) : null;
  }
}
