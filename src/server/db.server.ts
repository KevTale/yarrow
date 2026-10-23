import { connectDatabase, type Database } from "@/db/client";
import { appEnv, NotConfiguredError } from "./env.server";

/**
 * Runs `work` with a request-scoped connection. Workers cannot share sockets
 * across requests, so each call opens and closes its own connection (use
 * Hyperdrive in production to pool them).
 */
export async function withDb<T>(
  work: (db: Database) => Promise<T>,
): Promise<T> {
  const url = appEnv().DATABASE_URL;
  if (!url) throw new NotConfiguredError("The database (DATABASE_URL)");
  const connection = connectDatabase(url);
  try {
    return await work(connection.db);
  } finally {
    await connection.close();
  }
}

export function databaseConfigured(): boolean {
  return Boolean(appEnv().DATABASE_URL);
}
