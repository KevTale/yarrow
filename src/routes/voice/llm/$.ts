import { createFileRoute } from "@tanstack/react-router";
import { appEnv } from "@/server/env.server";

/**
 * The live call's turns: ElevenLabs asks for the agent's words as a chat
 * completion (src/runner/voice/agent.ts), here under its own path. The
 * brain checks ElevenLabs' key and the call's pass, and answers.
 */
export const Route = createFileRoute("/voice/llm/$")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const brain = appEnv().BRAIN;
        if (!brain) return new Response("Not found", { status: 404 });
        return brain.fetch(new Request("https://brain/voice/llm", request));
      },
    },
  },
});
