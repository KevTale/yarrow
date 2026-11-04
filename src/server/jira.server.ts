import { appEnv } from "./env.server";
import type { TrackerContext } from "./trackers/flow";
import { trackerSecretsFromEnv } from "./trackers/index";

export {
  answerTrackerTicket,
  closeTrackerTicket,
  createTrackerTicket,
  disconnectTracker,
  labelTrackerTickets,
  linkTrackerBoard,
  openTrackerTickets,
  removeProject,
  moveTrackerTicket,
  setTrackerBoards,
  setTrackerMoves,
  settleJira,
  TrackerAccessError,
  listTrackerBoards,
  trackerBoardSettings,
  trackerTicketDetail,
  type JiraStep,
} from "./trackers/flow";

/** The web Worker's tracker secrets and address, for the functions above. */
export function trackerContext(): TrackerContext {
  const env = appEnv();
  return { secrets: trackerSecretsFromEnv(env), appUrl: env.APP_URL };
}

/** Jira can be connected on this deployment (its OAuth app is set). */
export function jiraReady(): boolean {
  const { secrets } = trackerContext();
  return Boolean(secrets.jira && secrets.encryptionKey);
}
