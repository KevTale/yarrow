import { useServerFn } from "@tanstack/react-start";
import { Github, X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { motionTokens } from "@/components/arc/lib/motion-tokens";
import { MorphSelect } from "@/components/arc/morph-select/morph-select";
import { JiraIcon } from "@/components/brand-icons";
import { Spinner } from "@/components/navigation-feedback";
import { BODY_MAX, TITLE_MAX } from "@/core/new-ticket";
import { createTicketFn } from "@/functions/builder.functions";

type Board = { tracker: string; key: string; site: string };

/** The destination last chosen for each project, on this browser only. */
const remembered = (projectId: string) => {
  try {
    return localStorage.getItem(`yarrow:new-ticket:${projectId}`);
  } catch {
    return null;
  }
};
const remember = (projectId: string, destination: string) => {
  try {
    localStorage.setItem(`yarrow:new-ticket:${projectId}`, destination);
  } catch {
    // Private window: the default comes back next time.
  }
};

/**
 * A ticket written in Yarrow: a GitHub issue, or a ticket in one of the
 * project's linked Jira projects. Queue it sends it to the agents at once;
 * Add leaves it in To queue.
 */
export function NewTicket({
  projectId,
  boards,
  onCreated,
  onClose,
}: {
  projectId: string;
  boards: Board[];
  onCreated: (key: string, queued: boolean) => void;
  onClose: () => void;
}) {
  const create = useServerFn(createTicketFn);
  const reduced = useReducedMotion();
  const jira = boards.filter((board) => board.tracker === "jira");
  const destinations = ["github", ...jira.map((board) => board.key)];
  const [destination, setDestination] = useState(() => {
    const last = remembered(projectId);
    // A team that links Jira files its tickets there.
    return last && destinations.includes(last)
      ? last
      : (jira[0]?.key ?? "github");
  });
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [pending, setPending] = useState<"queue" | "add" | null>(null);
  const [error, setError] = useState("");
  const titleField = useRef<HTMLInputElement>(null);
  useEffect(() => titleField.current?.focus(), []);

  async function submit(queue: boolean) {
    if (!title.trim() || pending) return;
    setError("");
    setPending(queue ? "queue" : "add");
    try {
      const result = await create({
        data: { projectId, destination, title: title.trim(), body, queue },
      });
      if (result.ok) {
        remember(projectId, destination);
        onCreated(result.key, queue);
      } else setError(result.error);
    } catch {
      setError("That did not go through. Try again.");
    } finally {
      setPending(null);
    }
  }

  const keys = (event: React.KeyboardEvent) => {
    if (event.key === "Escape" && !pending) onClose();
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submit(true);
    }
  };

  return (
    <motion.form
      className="nt"
      aria-label="New ticket"
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={
        reduced
          ? { duration: motionTokens.duration.instant }
          : motionTokens.spring.smooth
      }
      onSubmit={(event) => {
        event.preventDefault();
        void submit(true);
      }}
      onKeyDown={keys}
    >
      <div className="nt-head">
        {jira.length > 0 ? (
          <MorphSelect
            label="Create in"
            hideLabel
            value={destination}
            onValueChange={setDestination}
            items={[
              {
                value: "github",
                label: "GitHub",
                icon: <Github size={14} />,
              },
              ...jira.map((board) => ({
                value: board.key,
                label: board.key,
                icon: <JiraIcon size={14} />,
                meta: board.site,
              })),
            ]}
          />
        ) : (
          <span className="nt-where">
            <Github size={14} /> GitHub
          </span>
        )}
        <button
          type="button"
          className="bd-btn bd-btn-ghost nt-close"
          aria-label="Close"
          onClick={onClose}
        >
          <X size={15} />
        </button>
      </div>
      <input
        ref={titleField}
        className="nt-title"
        aria-label="Title"
        placeholder="Title"
        value={title}
        maxLength={TITLE_MAX}
        onChange={(event) => setTitle(event.target.value)}
      />
      <textarea
        className="nt-body"
        aria-label="Description"
        placeholder="Description"
        rows={5}
        value={body}
        maxLength={BODY_MAX}
        onChange={(event) => setBody(event.target.value)}
      />
      <div className="nt-foot">
        {error && (
          <span className="pp-error" role="alert">
            {error}
          </span>
        )}
        <button
          type="button"
          className="bd-btn bd-btn-line"
          disabled={!title.trim() || pending !== null}
          onClick={() => void submit(false)}
        >
          Add {pending === "add" && <Spinner />}
        </button>
        <button
          type="submit"
          className="bd-btn bd-btn-amber"
          disabled={!title.trim() || pending !== null}
        >
          Queue it {pending === "queue" && <Spinner />}
        </button>
      </div>
    </motion.form>
  );
}
