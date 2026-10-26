import { appEnv } from "./env.server";
import type { TrackerContext } from "./trackers/jira-flow";
import { trackerSecretsFromEnv } from "./trackers/index";

export {
  jiraProjects,
  labelTrackerTickets,
  linkJiraProject,
  openTrackerTickets,
  setJiraProject,
  settleJira,
  type JiraStep,
} from "./trackers/jira-flow";

/** The web Worker's tracker secrets, for the functions above. */
export function trackerContext(): TrackerContext {
  return { secrets: trackerSecretsFromEnv(appEnv()) };
}

/** Jira can be connected on this deployment (its OAuth app is set). */
export function jiraReady(): boolean {
  const { secrets } = trackerContext();
  return Boolean(secrets.jira && secrets.encryptionKey);
}
