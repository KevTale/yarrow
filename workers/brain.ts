import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { runRequestSchema, type RunRequest } from "../src/core/contracts";
import { connectDatabase } from "../src/db/client";
import { PostgresLedger } from "../src/db/ledger";
import { CloudflareSandboxRunner } from "../src/runner/cloudflare-sandbox-runner";

export interface BrainEnv {
  WORKFLOW: Workflow<RunRequest>;
  DATABASE_URL?: string;
}

export class AgentWorkWorkflow extends WorkflowEntrypoint<
  BrainEnv,
  RunRequest
> {
  async run(event: WorkflowEvent<RunRequest>, step: WorkflowStep) {
    const run = runRequestSchema.parse(event.payload);
    const databaseUrl = this.env.DATABASE_URL;
    if (!databaseUrl) {
      // A locally testable, zero-cost outcome. No fake persistent reservation.
      return step.do("unconfigured-workshop", async () => ({
        mode: "stub",
        ledger: "not_connected",
        result: await new CloudflareSandboxRunner().execute(run),
      }));
    }
    await step.do("reserve-budget", async () => {
      const connection = connectDatabase(databaseUrl);
      try {
        await new PostgresLedger(connection.db).reserve(run);
      } finally {
        await connection.close();
      }
    });
    const result = await step.do(
      "execute-in-sandbox",
      {
        // Do not retry paid execution until the real runner implements durable deduplication.
        retries: { limit: 0, delay: "1 second", backoff: "constant" },
        timeout: "25 minutes",
      },
      () => new CloudflareSandboxRunner().execute(run),
    );
    await step.do("settle-and-release", async () => {
      const connection = connectDatabase(databaseUrl);
      try {
        await new PostgresLedger(connection.db).settle(run.runId, result);
      } finally {
        await connection.close();
      }
    });
    return result;
  }
}

export default {
  fetch() {
    return Response.json({
      service: "agent-commons-brain",
      runner: "cloudflare-sandbox",
      mode: "stub",
      intake: "queue-only",
    });
  },
  async queue(batch: MessageBatch<unknown>, env: BrainEnv) {
    for (const message of batch.messages) {
      const parsed = runRequestSchema.safeParse(message.body);
      if (!parsed.success) {
        // Malformed messages exhaust retries into the configured dead-letter queue.
        message.retry();
        continue;
      }
      try {
        await env.WORKFLOW.create({
          id: parsed.data.runId,
          params: parsed.data,
        });
        message.ack();
      } catch {
        // Queue delivery is at least once. Verify that the same workflow exists
        // before acknowledging; unrelated create failures must be retried.
        try {
          const instance = await env.WORKFLOW.get(parsed.data.runId);
          await instance.status();
          message.ack();
        } catch {
          message.retry();
        }
      }
    }
  },
} satisfies ExportedHandler<BrainEnv>;
