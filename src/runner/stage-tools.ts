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
      "What the stage shows now: the window in front (the app as it is, the app as it was, or the terminal), its address, and the page's elements with their refs, or the terminal's last lines.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "act_on_screen",
    description:
      "Do these on the browser window in front, one after the other, with the pointer the member sees, as a person would. Returns the screen after. Stops at the first that fails.",
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
                ],
                description:
                  "point at or circle an element to show it; click; fill a field with text; select an option's value; press a key; scroll (an element into view, or the page by y pixels); goto a path of the app; reload; wait ms.",
              },
              target: {
                type: "string",
                description:
                  "The element: its ref from the latest look (e12, f5e16), else a Playwright selector.",
              },
              text: { type: "string", description: "For fill." },
              value: { type: "string", description: "For select." },
              key: { type: "string", description: "For press, e.g. Enter." },
              path: { type: "string", description: "For goto, e.g. /tasks." },
              y: { type: "number", description: "For scroll without target." },
              ms: { type: "number", description: "For wait, at most 8000." },
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
      "Bring a window in front: the app as it is on the branch (after), the app as it was before the change (before, when the stage has it), or the terminal. Returns the screen after.",
    input_schema: {
      type: "object",
      properties: {
        window: { type: "string", enum: ["after", "before", "terminal"] },
      },
      required: ["window"],
      additionalProperties: false,
    },
  },
  {
    name: "run_in_terminal",
    description:
      "Type a command in the stage's terminal and run it, as the member watches (the tests, a script). Returns its output. Stopped after two minutes.",
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

/**
 * The voice's agent leads the presentation once the member spoke
 * (src/runner/talk.ts): a chapter's gestures again, its words its own.
 */
export const SHOW_CHAPTER: Anthropic.Beta.BetaTool = {
  name: "show_chapter",
  description:
    "Play a chapter of the presentation on the stage again, its gestures without the recorded voice, while you say it in your own words. Its number, from the presentation's chapters. Returns the screen after.",
  input_schema: {
    type: "object",
    properties: {
      chapter: { type: "integer", minimum: 1, description: "From 1." },
    },
    required: ["chapter"],
    additionalProperties: false,
  },
};

const stageInputs = {
  look_at_screen: z.object({}),
  act_on_screen: z.object({
    actions: z.array(liveActionSchema).min(1).max(12),
  }),
  show_window: z.object({ window: z.enum(["after", "before", "terminal"]) }),
  run_in_terminal: z.object({
    command: z.string().min(1).max(2000),
    cwd: z.string().max(500).optional(),
  }),
  show_chapter: z.object({ chapter: z.number().int().min(1).max(12) }),
};

export const isStageTool = (name: string) => name in stageInputs;

/** A tool call in a turn's log: its name, and what it did on the stage. */
export function stageStepName(call: Anthropic.Beta.BetaToolUseBlock): string {
  const input = call.input as {
    actions?: { do?: unknown }[];
    window?: unknown;
    chapter?: unknown;
  } | null;
  if (call.name === "act_on_screen" && Array.isArray(input?.actions))
    return `${call.name}[${input.actions.map((action) => String(action?.do)).join(" ")}]`;
  if (call.name === "show_window")
    return `${call.name}[${String(input?.window)}]`;
  if (call.name === "show_chapter")
    return `${call.name}[${String(input?.chapter)}]`;
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
          : call.name === "show_chapter"
            ? {
                action: "point",
                index:
                  (parsed.data as z.infer<typeof stageInputs.show_chapter>)
                    .chapter - 1,
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

/** Chapters by number, from 1. */
const numbered = (indexes: number[]) =>
  indexes.map((index) => index + 1).join(", ") || "none";

/** Where the presentation stands, said to the agent with the member's turn. */
export function stageNote(state: StageState | null): string {
  if (!state) return "[The stage does not answer right now.]";
  if (state.over) {
    const shown = state.shown ?? [];
    const left = Array.from({ length: state.chapters }, (_, i) => i).filter(
      (index) => !shown.includes(index),
    );
    return `[On the stage: the recorded presentation stopped${state.cut === null || state.cut === undefined ? "" : ` during chapter ${state.cut + 1}`} when they spoke; you lead the rest. Shown in full: ${numbered(shown)}. Not shown yet: ${numbered(left)}.]`;
  }
  if (state.chapter)
    return `[On the stage: the presentation is ${state.held ? "stopped" : "playing"} in chapter ${state.chapter.index + 1} of ${state.chapters}, "${state.chapter.title}".]`;
  return state.held
    ? "[On the stage: the presentation is stopped between two chapters.]"
    : "[On the stage: the presentation is not playing.]";
}
