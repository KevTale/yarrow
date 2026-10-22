import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/** Request/Workflow-step scoped connection. Supabase transaction pooler: prepare=false. */
export function connectDatabase(url: string) {
  if (!url)
    throw new Error("DATABASE_URL is required for the persistent ledger");
  const client = postgres(url, { prepare: false, max: 1, connect_timeout: 10 });
  return {
    db: drizzle(client, { schema }),
    close: () => client.end({ timeout: 5 }),
  };
}
export type Database = ReturnType<typeof connectDatabase>["db"];
