import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, X } from "lucide-react";
import { useEffect, useState } from "react";
import { jiraProject } from "@/core/ticket-link";
import {
  dismissConnectFn,
  linkJiraFn,
  listJiraProjectsFn,
} from "@/functions/connect.functions";
import { Spinner } from "@/components/navigation-feedback";
import type { JiraStep } from "@/server/trackers/jira-flow";

/**
 * A Jira link pasted on the landing, or "Connect Jira": which repository
 * holds the code, then Jira's authorization (or the link, once Jira is
 * connected for that repository's account).
 */
export function JiraCard({
  step,
  onLinked,
  onClose,
}: {
  step: JiraStep;
  onLinked: (linked: { projectId: string; key: string | null }) => void;
  onClose: () => void;
}) {
  const link = useServerFn(linkJiraFn);
  const listProjects = useServerFn(listJiraProjectsFn);
  const dismiss = useServerFn(dismissConnectFn);
  const [projectId, setProjectId] = useState(step.projects[0]?.id ?? "");
  const [jiraKey, setJiraKey] = useState(
    step.ticket ? jiraProject(step.ticket) : "",
  );
  const [jiraProjects, setJiraProjects] = useState<
    { id: string; name: string }[] | null
  >(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const connectionId =
    step.projects.find((project) => project.id === projectId)?.connectionId ??
    null;

  // Without a pasted ticket, the builder picks the Jira project.
  useEffect(() => {
    if (step.ticket || !connectionId) return;
    let stopped = false;
    listProjects({ data: { connectionId } })
      .then((list) => {
        if (stopped) return;
        setJiraProjects(list);
        setJiraKey((current) => current || list[0]?.id || "");
      })
      .catch(() => !stopped && setError("Jira did not answer. Try again."));
    return () => {
      stopped = true;
    };
  }, [connectionId, step.ticket, listProjects]);

  async function submit() {
    if (!connectionId || !jiraKey) return;
    setPending(true);
    setError("");
    try {
      onLinked(
        await link({
          data: { projectId, connectionId, jiraKey, ticket: step.ticket },
        }),
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "That did not go through.",
      );
      setPending(false);
    }
  }

  return (
    <section className="bd-jira" aria-label="Jira">
      <span className="bd-jira-mark" aria-hidden="true" />
      <div className="bd-jira-what">
        <strong>{step.ticket ?? "Jira"}</strong>
        {step.site && <span className="mono muted">{step.site}</span>}
      </div>
      <div className="bd-jira-form">
        {!step.ticket && connectionId && (
          <select
            aria-label="Jira project"
            value={jiraKey}
            disabled={!jiraProjects}
            onChange={(event) => setJiraKey(event.target.value)}
          >
            {!jiraProjects && <option>Loading…</option>}
            {jiraProjects?.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        )}
        <label className="bd-jira-repo">
          <span className="muted">Code in</span>
          <select
            value={projectId}
            onChange={(event) =>
              event.target.value === "add"
                ? window.location.assign("/connect/github?source=jira")
                : setProjectId(event.target.value)
            }
          >
            {step.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.repository}
              </option>
            ))}
            <option value="add">+ Another repository</option>
          </select>
        </label>
        {connectionId ? (
          <button
            type="button"
            className="bd-btn bd-btn-amber"
            disabled={pending || !jiraKey}
            onClick={submit}
          >
            {pending ? <Spinner /> : null}
            {step.ticket ? "Queue it" : "Link"}
          </button>
        ) : (
          <a
            className="bd-btn bd-btn-amber"
            href={`/integrations/jira/connect?projectId=${projectId}&next=dashboard`}
          >
            Connect Jira <ArrowRight size={14} />
          </a>
        )}
      </div>
      <button
        type="button"
        className="bd-btn bd-btn-ghost bd-jira-close"
        aria-label="Not now"
        onClick={() => {
          void dismiss();
          onClose();
        }}
      >
        <X size={15} />
      </button>
      {error && (
        <p className="feedback feedback-error bd-jira-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
