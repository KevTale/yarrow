import { appEnv } from "./env.server";

/**
 * Wakes the brain now: a ticket was queued or money arrived, so it starts
 * in seconds instead of at the next minute. Best effort: the brain's
 * minute pass catches anything a failed kick misses.
 */
export async function kickBrain(): Promise<void> {
  const brain = appEnv().BRAIN;
  if (!brain) return;
  await brain
    .kick()
    .catch((error: Error) => console.warn("brain kick:", error.message));
}
