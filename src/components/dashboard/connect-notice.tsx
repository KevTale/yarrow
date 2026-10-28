import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, Github, X } from "lucide-react";
import { dismissConnectFn } from "@/functions/connect.functions";

/**
 * Back from GitHub without the pasted ticket's repository: it was not
 * picked, or it is not the visitor's to install (only its admins can). Or
 * a member of an organization asked its admins to install the App.
 */
export function ConnectNotice({
  repository,
  issue,
  requested,
  onClose,
}: {
  repository: string | null;
  issue: number | null;
  requested: boolean;
  onClose: () => void;
}) {
  const dismiss = useServerFn(dismissConnectFn);
  const owner = repository?.split("/")[0];
  const again = new URLSearchParams();
  if (repository) again.set("repository", repository);
  if (issue) again.set("issue", String(issue));

  return (
    <section className="bd-jira bd-connect" aria-label="GitHub" role="status">
      <span className="bd-jira-mark" aria-hidden="true">
        <Github size={20} />
      </span>
      <div className="bd-jira-what">
        {requested ? (
          <>
            <strong>Request sent</strong>
            <span className="muted">
              {owner ? (
                <>
                  <span className="mono">{owner}</span>&apos;s admins
                </>
              ) : (
                "The admins"
              )}{" "}
              approve it on GitHub
            </span>
          </>
        ) : (
          <>
            <strong>
              <span className="mono">{repository}</span> is not connected
            </strong>
            <span className="muted">Only its admins can add it</span>
          </>
        )}
      </div>
      {!requested && repository && (
        <div className="bd-jira-form">
          <a
            className="bd-btn bd-btn-amber"
            href={`/connect/github?${again.toString()}`}
          >
            Add it on GitHub <ArrowRight size={14} />
          </a>
        </div>
      )}
      <button
        type="button"
        className="bd-btn bd-btn-ghost bd-jira-close"
        aria-label="Close"
        onClick={() => {
          void dismiss();
          onClose();
        }}
      >
        <X size={15} />
      </button>
    </section>
  );
}
