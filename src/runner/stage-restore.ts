import Anthropic from "@anthropic-ai/sdk";
import { addUsage, type ChatUsage } from "../core/chat";
import type { StageChange } from "../core/stage";
import { runStageTool, STAGE_TOOLS, type StageHands } from "./stage-tools";
import { TALK_EFFORT, TALK_MODEL } from "./talk";

/**
 * The stage put back before its presentation goes on (workers/brain.ts).
 * While it was held, the member's talk may have changed the app: another
 * page, signed out, a filter, a task. The voice would go on about a screen
 * that is no longer there, so an agent compares each window with how the
 * presentation left it and acts on the app until they read the same. The
 * presenter reads the windows (src/runner/recorder/present.mjs); nothing
 * here knows one app from another.
 */

/** Rounds it may take before the presentation goes on as the stage is. */
export const RESTORE_MAX_STEPS = 6;

const SIGN_IN_TOOL: Anthropic.Beta.BetaTool = {
  name: "sign_in",
  description:
    "Sign the app's test user in again on the window in front, with the sign-in form the project's recipe names. Returns the screen after.",
  input_schema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
};

const TOOLS: Anthropic.Beta.BetaToolUnion[] = [
  ...STAGE_TOOLS.filter((tool) => tool.name !== "run_in_terminal"),
  SIGN_IN_TOOL,
];

const INSTRUCTIONS = `A pull request's presentation plays live on a stage: its app runs in a browser, and the presentation's voice says what the screen shows. It stopped while a member of the project talked with an agent, who may have acted on the app. Before the voice goes on, put each window below back as it was when the presentation stopped, so that what the voice says next is true of the screen: the same page, signed in as then, the same filters, tabs, menus and dialogs, the same data.

- Act on the app as a person would: show_window brings a window in front, act_on_screen acts on the one in front, look_at_screen reads it.
- Where the app shows its sign-in form and did not then: sign_in.
- Data the talk changed: set it back through the app when it takes a click or two (a status, a box ticked). Never delete what was there then, never create an account.
- What moves by itself (a time, a counter, the focus) is no difference.
- Once the windows read as they did, or nothing more can be done, stop: no tool, one word.`;

/** A window's two readings, said to the agent. */
function told(change: StageChange): string {
  const clip = (screen: string) =>
    screen.length > 12000 ? `${screen.slice(0, 12000)}\n[…cut]` : screen;
  const name =
    change.window === "before"
      ? 'Window "before" (the app as it was before the change)'
      : 'Window "after" (the app as it is on the branch)';
  return `${name}.\nWhen the presentation stopped, at ${change.then.url}:\n${clip(change.then.screen)}\n\nNow, at ${change.now.url}:\n${clip(change.now.screen)}`;
}

export interface Restored {
  problems: string[];
  usage: ChatUsage;
  /** Each round: what it did, how long it took. */
  steps: { what: string; ms: number }[];
}

export async function restoreStage(input: {
  client: Anthropic;
  changes: StageChange[];
  stage: StageHands;
}): Promise<Restored> {
  const { client, stage } = input;
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: "user",
      content: input.changes.map(told).join("\n\n---\n\n"),
    },
  ];
  let usage: ChatUsage = {
    model: TALK_MODEL,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  };
  const steps: Restored["steps"] = [];
  for (let step = 0; step < RESTORE_MAX_STEPS; step++) {
    const asked = Date.now();
    const response = await client.beta.messages.create({
      model: TALK_MODEL,
      max_tokens: 2000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: TALK_EFFORT },
      system: INSTRUCTIONS,
      tools: TOOLS,
      messages,
    });
    steps.push({ what: "claude", ms: Date.now() - asked });
    usage = addUsage(usage, {
      model: response.model,
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
      cacheRead: response.usage.cache_read_input_tokens ?? 0,
      cacheWrite: response.usage.cache_creation_input_tokens ?? 0,
    });
    const calls = response.content.filter(
      (block): block is Anthropic.Beta.BetaToolUseBlock =>
        block.type === "tool_use",
    );
    if (response.stop_reason !== "tool_use" || calls.length === 0)
      return { problems: [], usage, steps };
    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const call of calls) {
      const ran = Date.now();
      const result = await (
        call.name === SIGN_IN_TOOL.name
          ? stage({ action: "sign-in" }).then((done) => ({
              text: [...done.problems, done.screen ?? ""].join("\n").trim(),
              error: !done.ok || done.problems.length > 0,
            }))
          : runStageTool(call, stage)
      ).catch((error: Error) => ({
        text: `That failed: ${error.message.slice(0, 200)}`,
        error: true,
      }));
      steps.push({ what: call.name, ms: Date.now() - ran });
      results.push({
        type: "tool_result",
        tool_use_id: call.id,
        content: result.text || "Done.",
        ...(result.error ? { is_error: true } : {}),
      });
    }
    messages.push({ role: "user", content: results });
  }
  return {
    problems: ["the stage was not put back in time: it goes on as it is"],
    usage,
    steps,
  };
}
