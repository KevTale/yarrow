import { eq } from "drizzle-orm";
import type { Database } from "../../db/client";
import { projects } from "../../db/schema";
import { signalIssues } from "../../db/tickets";
import { upsertTicket } from "../../db/workunits";
import type { AppCredentials, Fetch } from "./app";
import { splitRepository } from "./delivery";
import { reason, writeClient } from "./pull-actions";

export type NewIssueResult =
  { ok: true; key: string } | { ok: false; error: string };

/**
 * A ticket written on the dashboard, opened as an issue by the App (the one
 * GitHub write path, so the brain runs it), labeled when queued. Yarrow's
 * copy is kept at once; GitHub's webhook then says the same.
 */
export async function createIssue(
  db: Database,
  credentials: AppCredentials,
  input: { projectId: string; title: string; body: string; queue: boolean },
  fetcher?: Fetch,
): Promise<NewIssueResult> {
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, input.projectId));
  if (!project?.githubInstallationId || !project.githubRepositoryId)
    return { ok: false, error: "GitHub is not connected to this repository." };
  const { owner, repo } = splitRepository(project.repository);
  try {
    const client = await writeClient(credentials, project, fetcher);
    const issue = await client.request<{
      number: number;
      title: string;
      body: string | null;
      html_url: string;
    }>("POST", `/repos/${owner}/${repo}/issues`, {
      title: input.title,
      body: input.body,
      labels: input.queue ? [project.authorizationLabel] : [],
    });
    await upsertTicket(db, {
      projectId: project.id,
      source: "github",
      externalId: String(issue.number),
      title: issue.title,
      body: issue.body ?? "",
      url: issue.html_url,
      labeled: input.queue,
      closed: false,
    });
    await signalIssues(db, project.id);
    return { ok: true, key: String(issue.number) };
  } catch (error) {
    return { ok: false, error: reason(error) };
  }
}
