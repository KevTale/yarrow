import { boardOfKey } from "../../core/ticket-link";
import type { Database } from "../../db/client";
import { boardsOfConnection, ticketKnown } from "../../db/trackers";
import { signalIssues } from "../../db/tickets";
import { upsertTicket } from "../../db/workunits";
import { trackerApi, type Connection, type TrackerContext } from "./context";

/**
 * A tracker's webhook said a ticket changed: it is read again (the payload
 * only says which one) and Yarrow's copy follows on every board of the
 * connection that holds it, as the sync would do it. Returns whether a
 * ticket entered the queue, so the brain is kicked.
 */
export async function followTicket(
  db: Database,
  ctx: TrackerContext,
  connection: Connection,
  key: string,
): Promise<{ queued: boolean; log: string[] }> {
  const log: string[] = [];
  let queued = false;
  const boards = (await boardsOfConnection(db, connection.id)).filter(
    ({ board, project }) =>
      board.externalBoardId === boardOfKey(key) && !project.suspendedAt,
  );
  if (boards.length === 0) return { queued, log };
  // Created, renamed or closed: the dashboards' open tickets read again.
  for (const { project } of boards) await signalIssues(db, project.id);
  const tracker = await trackerApi(db, ctx, connection);
  const ticket = await tracker.adapter.getTicket(
    tracker.scope,
    tracker.credentials,
    key,
  );
  for (const { board, project } of boards) {
    const label = project.authorizationLabel.toLowerCase();
    const labeled = Boolean(
      ticket?.labels.some((value) => value.toLowerCase() === label),
    );
    // An unlabeled ticket Yarrow never held stays out of its tables.
    if (!labeled && !(await ticketKnown(db, project.id, tracker.name, key)))
      continue;
    const result = await upsertTicket(db, {
      projectId: project.id,
      source: tracker.name,
      boardId: board.id,
      externalId: key,
      title: ticket?.title ?? "(deleted ticket)",
      body: ticket?.body ?? "",
      url: ticket?.url ?? "",
      labeled,
      closed: !ticket || ticket.closed,
    });
    queued ||= result.queued;
    log.push(`${key} ${labeled ? "labeled" : "unlabeled"}`);
  }
  return { queued, log };
}
