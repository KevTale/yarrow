import type { Database } from "../../db/client";
import type { getConnection } from "../../db/trackers";
import {
  accessTokenFor,
  trackerAdapter,
  type TrackerName,
  type TrackerSecrets,
} from "./index";
import type { Fetch } from "./types";

/**
 * The deployment's tracker secrets, its public address (where Jira sends
 * webhooks; none locally) and a fetch, for tests.
 */
export type TrackerContext = {
  secrets: TrackerSecrets;
  appUrl?: string;
  fetcher?: Fetch;
};

export type Connection = NonNullable<
  Awaited<ReturnType<typeof getConnection>>
>;

/** A connection's adapter, credentials and fresh token. */
export async function trackerApi(
  db: Database,
  ctx: TrackerContext,
  connection: Connection,
) {
  const name = connection.tracker as TrackerName;
  const credentials = ctx.secrets[name];
  if (!credentials || !ctx.secrets.encryptionKey)
    throw new Error(`${name} is not configured on this deployment`);
  return {
    name,
    credentials,
    adapter: trackerAdapter(name, ctx.fetcher),
    scope: {
      externalId: connection.externalId,
      accessToken: await accessTokenFor(
        db,
        connection,
        ctx.secrets,
        ctx.fetcher,
      ),
    },
  };
}
