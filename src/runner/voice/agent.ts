import { DEFAULT_ELEVENLABS_VOICE } from "./elevenlabs";
import type { Fetch } from "./index";

/**
 * The live review's voice: an ElevenLabs agent hears the member and speaks
 * the brain's words (src/runner/talk.ts), which it asks for as a custom
 * LLM. One agent per environment, made by scripts/voice-agent.ts, never by
 * hand; private, so a call starts only with a token the brain asks for.
 * https://elevenlabs.io/docs/agents-platform/customization/llm/custom-llm
 */

const API = "https://api.elevenlabs.io/v1";

/** How long a call's pass is good for. */
export const TALK_GRANT_MS = 2 * 60 * 60_000;

/**
 * The page's tool: the film plays on once the voice has finished, where
 * the member paused it or from a chapter's start, and the call ends.
 */
export const RESUME_TOOL = {
  type: "client",
  name: "resume_presentation",
  description:
    "The film plays on and the call ends: where the member paused it, or from the start of a chapter.",
  expects_response: false,
  parameters: {
    type: "object",
    properties: {
      chapter: {
        type: "integer",
        description: "From this chapter's start, 1 for the beginning.",
      },
    },
    required: [],
  },
} as const;

/**
 * The agent: ElevenLabs' ears and voice, the brain's words. It waits for
 * the member (no first message, unless the page gives one: the call from
 * the film's player greets them), never speaks up on its own while a
 * presentation plays, never falls back to a model of its own.
 */
export function talkAgentConfig(input: {
  name: string;
  /** The brain's chat completions, through the web Worker. */
  llmUrl: string;
  /** ElevenLabs' secret holding talkKey(VOICE_SECRET). */
  secretId: string;
  toolId: string;
  voiceId?: string;
}) {
  return {
    name: input.name,
    tags: ["yarrow"],
    conversation_config: {
      agent: {
        first_message: "",
        language: "en",
        prompt: {
          // The brain writes its own: this one never reaches Claude.
          prompt: "Yarrow's live review. The custom LLM answers.",
          llm: "custom-llm",
          custom_llm: {
            url: input.llmUrl,
            model_id: "claude-opus-5-5",
            api_key: { secret_id: input.secretId },
            api_type: "chat_completions",
          },
          temperature: null,
          max_tokens: -1,
          tool_ids: [input.toolId],
          // A turn with no word in it (a noise heard as one) is skipped:
          // ElevenLabs drops a call whose LLM says nothing.
          built_in_tools: {
            skip_turn: {
              type: "system",
              name: "skip_turn",
              description: "",
              params: { system_tool_type: "skip_turn", wait_timeout_secs: -1 },
            },
          },
          backup_llm_config: { preference: "disabled" },
          cascade_timeout_seconds: 15,
        },
      },
      tts: {
        model_id: "eleven_v4_turbo",
        voice_id: input.voiceId || DEFAULT_ELEVENLABS_VOICE,
        // As the presentation's voice (src/runner/voice/elevenlabs.ts).
        stability: 0.4,
        similarity_boost: 0.8,
      },
      turn: {
        // The presentation plays for minutes: the agent waits for them, never
        // speaking up (-1; ElevenLabs takes at most 300 s otherwise).
        turn_timeout: -1,
        initial_wait_time: -1,
        silence_end_call_timeout: -1,
        turn_eagerness: "normal",
        soft_timeout_config: { timeout_seconds: -1 },
      },
      conversation: {
        max_duration_seconds: 1800,
        client_events: [
          "conversation_initiation_metadata",
          "ping",
          "audio",
          "interruption",
          "user_transcript",
          "tentative_user_transcript",
          "agent_response",
          "agent_response_correction",
          "agent_chat_response_part",
          "client_tool_call",
          "vad_score",
        ],
      },
    },
    platform_settings: {
      auth: { enable_auth: true },
      overrides: {
        custom_llm_extra_body: true,
        conversation_config_override: {
          agent: { language: true, first_message: true },
          conversation: { text_only: true },
        },
      },
    },
  };
}

const encoder = new TextEncoder();

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const unbase64url = (text: string) =>
  Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
    c.charCodeAt(0),
  );

async function hmac(secret: string, text: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(text)),
  );
}

/** What ElevenLabs sends the brain as its API key, from VOICE_SECRET. */
export async function talkKey(secret: string): Promise<string> {
  return base64url(await hmac(secret, "elevenlabs custom llm"));
}

export interface TalkGrant {
  workUnitId: string;
  userId: string;
  /** The member's language, as the page gave it (fr, en…). */
  language: string;
  expires: number;
}

/**
 * The call's pass: a member of the project may talk about this pull
 * request until it expires. The page hands it to ElevenLabs, which sends
 * it with every turn (custom_llm_extra_body).
 */
export async function signTalkGrant(
  secret: string,
  grant: Omit<TalkGrant, "expires">,
  now = Date.now(),
): Promise<string> {
  const body = base64url(
    encoder.encode(JSON.stringify({ ...grant, expires: now + TALK_GRANT_MS })),
  );
  return `${body}.${base64url(await hmac(secret, `grant ${body}`))}`;
}

export async function readTalkGrant(
  secret: string,
  grant: string,
  now = Date.now(),
): Promise<TalkGrant | null> {
  const [body, signature] = grant.split(".");
  if (!body || !signature) return null;
  const expected = base64url(await hmac(secret, `grant ${body}`));
  if (expected.length !== signature.length) return null;
  let same = 0;
  for (let i = 0; i < expected.length; i++)
    same |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  if (same !== 0) return null;
  try {
    const read = JSON.parse(new TextDecoder().decode(unbase64url(body)));
    if (
      typeof read.workUnitId !== "string" ||
      typeof read.userId !== "string" ||
      typeof read.expires !== "number" ||
      read.expires < now
    )
      return null;
    return {
      workUnitId: read.workUnitId,
      userId: read.userId,
      language: typeof read.language === "string" ? read.language : "en",
      expires: read.expires,
    };
  } catch {
    return null;
  }
}

/** A key's bearer header, compared without telling how much of it matched. */
export function sameKey(header: string | null, key: string): boolean {
  const given = header?.replace(/^Bearer\s+/i, "") ?? "";
  if (given.length !== key.length) return false;
  let same = 0;
  for (let i = 0; i < key.length; i++)
    same |= key.charCodeAt(i) ^ given.charCodeAt(i);
  return same === 0;
}

/** A WebRTC token for one call with the private agent. */
export async function conversationToken(
  apiKey: string,
  agentId: string,
  fetcher: Fetch = (input, init) => fetch(input, init),
): Promise<string> {
  const response = await fetcher(
    `${API}/convai/conversation/token?agent_id=${encodeURIComponent(agentId)}`,
    { headers: { "xi-api-key": apiKey } },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `ElevenLabs call token failed (${response.status}): ${detail.slice(0, 200)}`,
    );
  }
  const { token } = (await response.json()) as { token: string };
  return token;
}
