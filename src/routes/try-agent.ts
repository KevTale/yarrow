import Anthropic from "@anthropic-ai/sdk";
import { createFileRoute } from "@tanstack/react-router";
import { tryInstructions, tryTurnSchema } from "@/core/try-ticket";
import { appEnv } from "@/server/env.server";
import { talkStep } from "@/runner/talk-models";

/**
 * The agent of the sample ticket on the landing, for anyone: nothing to read
 * or write but the words, on Yarrow's own key, held to a few turns a minute
 * per visitor and a ceiling for everyone. Its words stream as plain text.
 */
export const Route = createFileRoute("/try-agent")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const env = appEnv();
        const origin = request.headers.get("origin");
        if (!env.ANTHROPIC_API_KEY || origin !== new URL(request.url).origin)
          return new Response("Not found", { status: 404 });
        const turn = tryTurnSchema.safeParse(
          await request.json().catch(() => null),
        );
        if (!turn.success) return new Response("Bad request", { status: 400 });
        const visitor = request.headers.get("cf-connecting-ip") ?? "local";
        const [mine, all] = await Promise.all([
          env.TRY_LIMIT?.limit({ key: visitor }),
          env.TRY_CEILING?.limit({ key: "all" }),
        ]);
        if (mine?.success === false || all?.success === false)
          return new Response("Enough", { status: 429 });

        const { said, moment, look } = turn.data;
        // A conversation starts with the visitor, not the agent's first words.
        const first = said.findIndex((line) => line.author === "builder");
        const started = Date.now();
        const encoder = new TextEncoder();
        const body = new ReadableStream<Uint8Array>({
          async start(controller) {
            let firstWord = 0;
            try {
              await talkStep({
                model: "haiku",
                clients: {
                  anthropic: new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }),
                },
                maxTokens: 300,
                system: [{ type: "text", text: tryInstructions(moment, look) }],
                tools: [],
                messages: said.slice(first).map((line) => ({
                  role: line.author === "builder" ? "user" : "assistant",
                  content: line.body,
                })),
                last: true,
                onText: (words) => {
                  firstWord ||= Date.now() - started;
                  controller.enqueue(encoder.encode(words));
                },
              });
              console.log("try-agent", {
                firstWord,
                ms: Date.now() - started,
              });
              controller.close();
            } catch (failed) {
              console.warn("try-agent", (failed as Error).message);
              controller.error(failed);
            }
          },
        });
        return new Response(body, {
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "no-cache, no-transform",
          },
        });
      },
    },
  },
});
