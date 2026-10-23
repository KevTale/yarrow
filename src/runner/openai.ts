/**
 * Minimal client for the OpenAI Agents API (beta): the Codex harness with
 * an OpenAI-hosted sandbox. Fetch-based for Workers and tests.
 */
const API = "https://api.openai.com/v1/agents/sessions";

export type Fetch = typeof fetch;

export interface AgentsSession {
  id: string;
  status: "idle" | "in_progress" | "requires_action" | "failed";
}

export interface InlineFile {
  path: string;
  /** base64 */
  data: string;
}

/**
 * The Agents API reports tokens per turn, never a dollar amount, so the cost
 * of a review is tokens × list price. Prices in cents per million tokens.
 */
export interface TokenRates {
  inputCentsPerMTok: number;
  cachedInputCentsPerMTok: number;
  outputCentsPerMTok: number;
  /** Hosted container: 1 GB, billed per 20-minute block. */
  sandboxCentsPerSession: number;
}

/**
 * gpt-6-astra list prices, checked on 2026-10-06 against
 * https://developers.openai.com/api/docs/pricing. Known gaps, all small and
 * absorbed by the platform: turns don't expose cache writes ($12.50 instead
 * of $10), nor requests over 272K input tokens (2× input, 1.5× output), and
 * a review is counted as one 20-minute container block.
 */
export const defaultReviewerRates: TokenRates = {
  inputCentsPerMTok: 1_000,
  cachedInputCentsPerMTok: 100,
  outputCentsPerMTok: 5_000,
  sandboxCentsPerSession: 3,
};

export interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
}

/** List-price cost of a session's turns, rounded up to the cent. */
export function usageCostCents(usages: Usage[], rates: TokenRates): number {
  let cents = rates.sandboxCentsPerSession;
  for (const usage of usages) {
    const cached = usage.input_tokens_details?.cached_tokens ?? 0;
    const fresh = Math.max(0, (usage.input_tokens ?? 0) - cached);
    cents +=
      (fresh * rates.inputCentsPerMTok +
        cached * rates.cachedInputCentsPerMTok +
        (usage.output_tokens ?? 0) * rates.outputCentsPerMTok) /
      1_000_000;
  }
  return Math.ceil(cents);
}

interface Item {
  type: string;
  role?: string;
  content?: { type: string; text?: string }[];
}

/** The text of the last assistant message among session items. */
export function lastAssistantText(items: Item[]): string | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!;
    if (item.type !== "message" || item.role !== "assistant") continue;
    const text = (item.content ?? [])
      .filter((part) => part.type === "output_text" && part.text)
      .map((part) => part.text)
      .join("");
    if (text) return text;
  }
  return null;
}

export class AgentsClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetcher: Fetch = fetch,
  ) {}

  private async call<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const response = await this.fetcher(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "OpenAI-Beta": "agents=v1",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `OpenAI ${method} ${path || "/"} failed (${response.status}): ${detail.slice(0, 400)}`,
      );
    }
    return (await response.json()) as T;
  }

  /**
   * A session in an OpenAI-hosted sandbox. When `repository` is given, it is
   * cloned with a read-only token by a setup command (network restricted to
   * GitHub) and the remote is removed before the agent starts.
   */
  createSession(input: {
    model: string;
    instructions: string;
    task: string;
    repository?: { owner: string; repo: string; branch: string; token: string };
    files?: InlineFile[];
    setupCommands?: string[];
  }): Promise<AgentsSession> {
    const clone = input.repository
      ? [
          `git clone --depth 50 --branch ${input.repository.branch} https://x-access-token:${input.repository.token}@github.com/${input.repository.owner}/${input.repository.repo}.git /workspace/repo`,
          "git -C /workspace/repo remote remove origin",
        ]
      : [];
    return this.call("POST", "", {
      agent: { model: input.model, instructions: input.instructions },
      environment: {
        type: "openai_hosted",
        network: input.repository
          ? {
              access: "restricted",
              allowed_domains: ["github.com", "codeload.github.com"],
            }
          : { access: "disabled" },
        files: (input.files ?? []).map((file) => ({
          type: "inline",
          path: file.path,
          data: file.data,
        })),
        setup_commands: [...clone, ...(input.setupCommands ?? [])],
      },
      input: input.task,
    });
  }

  getSession(sessionId: string): Promise<AgentsSession> {
    return this.call("GET", `/${sessionId}`);
  }

  async finalText(sessionId: string): Promise<string | null> {
    const page = await this.call<{ data: Item[] }>(
      "GET",
      `/${sessionId}/items?order=asc&limit=100`,
    );
    return lastAssistantText(page.data);
  }

  async usage(sessionId: string): Promise<Usage[]> {
    const page = await this.call<{ data: { usage?: Usage }[] }>(
      "GET",
      `/${sessionId}/turns`,
    );
    return page.data.map((turn) => turn.usage ?? {});
  }
}
