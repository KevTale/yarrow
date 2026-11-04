import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { liveActionSchema } from "../core/presentation";
import type { StageCueResult, StageHand, StageState } from "../core/stage";

/**
 * The stage's tools (workers/stage.ts): the agent looks at the pull
 * request's app running live and acts on it with the pointer the member
 * sees, by voice (src/runner/talk.ts) or in writing beside the stage
 * (src/runner/chat.ts).
 */

/** The presenter on the stage, which plays each move. */
export type StageHands = (hand: StageHand) => Promise<StageCueResult>;

export const STAGE_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "look_at_screen",
    description:
      "What the stage shows now: the window in front (the app as it is, the app as it was, the terminal, or the code editor), its address, and the page's elements with their refs, the terminal's last lines, or what changed and the file the editor shows, with its line numbers.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "act_on_screen",
    description:
      "Do these one after the other, with the pointer the member sees, as a person would: on the browser window in front, or, for open and changes, in the code editor, which comes in front. Returns the screen after. Stops at the first that fails.",
    input_schema: {
      type: "object",
      properties: {
        actions: {
          type: "array",
          minItems: 1,
          maxItems: 12,
          items: {
            type: "object",
            properties: {
              do: {
                type: "string",
                enum: [
                  "point",
                  "circle",
                  "click",
                  "fill",
                  "select",
                  "press",
                  "scroll",
                  "goto",
                  "reload",
                  "wait",
                  "open",
                  "changes",
                ],
                description:
                  "point at or circle an element to show it; click; fill a field with text; select an option's value; press a key; scroll (an element into view, or the page by y pixels); goto a path of the app; reload; wait ms. In the code editor: open a file of the repository, as its changes when it changed, lines from to to selected and pointed at; changes, the list of what changed.",
              },
              target: {
                type: "string",
                description:
                  "The element: its ref from the latest look (e12, f5e16), else a Playwright selector.",
              },
              text: {
                type: "string",
                description: "For fill; a date field takes YYYY-MM-DD.",
              },
              value: { type: "string", description: "For select." },
              key: { type: "string", description: "For press, e.g. Enter." },
              path: { type: "string", description: "For goto, e.g. /tasks." },
              y: { type: "number", description: "For scroll without target." },
              ms: { type: "number", description: "For wait, at most 8000." },
              file: {
                type: "string",
                description:
                  "For open, from the repository's root: src/date.js.",
              },
              from: { type: "number", description: "For open: first line." },
              to: {
                type: "number",
                description:
                  "For open: last line, at most 30 lines after from.",
              },
            },
            required: ["do"],
            additionalProperties: false,
          },
        },
      },
      required: ["actions"],
      additionalProperties: false,
    },
  },
  {
    name: "show_window",
    description:
      "Bring a window in front: the app as it is on the branch (after), the app as it was before the change (before, when the stage has it), the terminal, or the code editor (code). Returns the screen after.",
    input_schema: {
      type: "object",
      properties: {
        window: {
          type: "string",
          enum: ["after", "before", "terminal", "code"],
        },
      },
      required: ["window"],
      additionalProperties: false,
    },
  },
  {
    name: "run_in_terminal",
    description:
      "Type a command in the stage's terminal, which comes in front by itself, and run it, as the member watches (the tests, a script). Returns its output. Stopped after two minutes.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string" },
        cwd: {
          type: "string",
          description: "Where to run it; the branch's checkout when absent.",
        },
      },
      required: ["command"],
      additionalProperties: false,
    },
  },
];

const stageInputs = {
  look_at_screen: z.object({}),
  act_on_screen: z.object({
    actions: z.array(liveActionSchema).min(1).max(12),
  }),
  show_window: z.object({
    window: z.enum(["after", "before", "terminal", "code"]),
  }),
  run_in_terminal: z.object({
    command: z.string().min(1).max(2000),
    cwd: z.string().max(500).optional(),
  }),
};

export const isStageTool = (name: string) => name in stageInputs;

/** A tool call in a turn's log: its name, and what it did on the stage. */
export function stageStepName(call: Anthropic.Beta.BetaToolUseBlock): string {
  const input = call.input as {
    actions?: { do?: unknown }[];
    window?: unknown;
  } | null;
  if (call.name === "act_on_screen" && Array.isArray(input?.actions))
    return `${call.name}[${input.actions.map((action) => String(action?.do)).join(" ")}]`;
  if (call.name === "show_window")
    return `${call.name}[${String(input?.window)}]`;
  return call.name;
}

/** A stage tool's call, played by the presenter on the stage. */
export async function runStageTool(
  call: Anthropic.Beta.BetaToolUseBlock,
  stage: StageHands,
): Promise<{ text: string; error?: boolean }> {
  const parsed = stageInputs[call.name as keyof typeof stageInputs].safeParse(
    call.input,
  );
  if (!parsed.success)
    return { text: `Invalid call to ${call.name}.`, error: true };
  const hand: StageHand =
    call.name === "act_on_screen"
      ? {
          action: "act",
          actions: (parsed.data as z.infer<typeof stageInputs.act_on_screen>)
            .actions,
        }
      : call.name === "show_window"
        ? {
            action: "window",
            window: (parsed.data as z.infer<typeof stageInputs.show_window>)
              .window,
          }
        : call.name === "run_in_terminal"
          ? {
              action: "run",
              ...(parsed.data as z.infer<typeof stageInputs.run_in_terminal>),
            }
          : { action: "look" };
  const result = await stage(hand);
  const problems = result.problems.length
    ? `Failed: ${result.problems.join("; ")}\n`
    : "";
  return {
    text: `${problems}${result.screen ?? ""}`.trim() || "Done.",
    error: !result.ok || (result.problems.length > 0 && !result.screen),
  };
}

/** Where the presentation stands, said to the agent with the member's turn. */
export function stageNote(state: StageState | null): string {
  if (!state) return "[The stage does not answer right now.]";
  if (state.control)
    return "[The member has taken control of the app and is using it themselves. Look at the screen to see what they do; you cannot act on it until they give it back.]";
  if (state.film !== null && state.film !== undefined)
    return `[The demo is paused in chapter ${state.film + 1} of ${state.chapters}; the stage shows it as the demo had it there.]`;
  if (state.over)
    return `[On the stage: the presentation stopped${state.cut === null || state.cut === undefined ? "" : ` in chapter ${state.cut + 1} of ${state.chapters}`} when they spoke.]`;
  if (state.chapter)
    return `[On the stage: the presentation is ${state.held ? "stopped" : "playing"} in chapter ${state.chapter.index + 1} of ${state.chapters}, "${state.chapter.title}".]`;
  return state.held
    ? "[On the stage: the presentation is stopped between two chapters.]"
    : "[On the stage: the presentation is not playing.]";
}
