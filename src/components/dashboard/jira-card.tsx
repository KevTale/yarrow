import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { boardOfKey } from "@/core/ticket-link";
import {
  dismissConnectFn,
  linkJiraFn,
  listTrackerBoardsFn,
} from "@/functions/connect.functions";
import { MorphSelect } from "@/components/arc/morph-select/morph-select";
import { JiraIcon } from "@/components/brand-icons";
import { Spinner } from "@/components/navigation-feedback";
import type { JiraStep } from "@/server/trackers/flow";

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
  const listProjects = useServerFn(listTrackerBoardsFn);
  const dismiss = useServerFn(dismissConnectFn);
  const [projectId, setProjectId] = useState(step.projects[0]?.id ?? "");
  const [jiraKey, setJiraKey] = useState(
    step.ticket ? boardOfKey(step.ticket) : "",
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
      .then(({ boards: projects, revoked }) => {
        if (stopped) return;
        if (revoked)
          return setError("Jira access was removed. Connect Jira again.");
        setJiraProjects(projects);
        setJiraKey((current) => current || projects[0]?.id || "");
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
      <span className="bd-jira-mark" aria-hidden="true">
        <JiraIcon size={20} />
      </span>
      <div className="bd-jira-what">
        <strong>{step.ticket ?? "Jira"}</strong>
        {step.site && <span className="mono muted">{step.site}</span>}
      </div>
      <div className="bd-jira-form">
        {!step.ticket && connectionId && (
          <MorphSelect
            label="Jira project"
            hideLabel
            placeholder="Loading…"
            value={jiraKey || null}
            disabled={!jiraProjects}
            onValueChange={setJiraKey}
            items={(jiraProjects ?? []).map((item) => ({
              value: item.id,
              label: item.name,
            }))}
          />
        )}
        <div className="bd-jira-repo">
          <span className="muted" aria-hidden="true">
            Code in
          </span>
          <MorphSelect
            label="Code in"
            hideLabel
            value={projectId}
            onValueChange={(value) =>
              value === "add"
                ? window.location.assign("/connect/github?source=jira")
                : setProjectId(value)
            }
            items={[
              ...step.projects.map((project) => ({
                value: project.id,
                label: project.repository,
              })),
              {
                value: "add",
                label: "Another repository",
                icon: <Plus size={14} />,
              },
            ]}
          />
        </div>
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
