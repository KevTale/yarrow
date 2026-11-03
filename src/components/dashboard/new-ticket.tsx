import { useServerFn } from "@tanstack/react-start";
import { ChevronRight, Github, Play, X } from "lucide-react";
import { createContext, useEffect, useRef, useState } from "react";
import { MorphSelect } from "@/components/arc/morph-select/morph-select";
import { TrackerIcon } from "@/components/brand-icons";
import { Spinner } from "@/components/navigation-feedback";
import { BODY_MAX, TITLE_MAX } from "@/core/new-ticket";
import { createTicketFn } from "@/functions/builder.functions";

type Board = { tracker: string; key: string; site: string };

/**
 * A ticket written for the builder, to read, change and send; from a pull
 * request (its row's key): a suggestion (the note as written), which leaves
 * that list once the ticket is made, or a card in its conversation, which
 * then links to it.
 */
export type TicketDraft = {
  title: string;
  body: string;
  from?: { key: string; note?: string; messageId?: string };
};

/** Tickets from a pull request. Only the builder's dashboard provides it. */
export const DraftTicket = createContext<{
  /** The new ticket dialog in a project, filled in; says when each is made. */
  open: (
    projectId: string,
    drafts: TicketDraft[],
    onMade?: (draft: TicketDraft) => void,
  ) => void;
  /** Made as it stands, where the project's tickets go, not started. */
  create: (
    projectId: string,
    draft: TicketDraft,
  ) => Promise<{ ok: true; key: string } | { ok: false; error: string }>;
  /** Opens a ticket's row in the list. */
  show: (projectId: string, key: string) => void;
} | null>(null);

/** The dialog only opens on a click, so the browser is there to ask. */
const shortcut = () =>
  /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘↵" : "Ctrl ↵";

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

const trackedBoards = (boards: Board[]) =>
  boards.filter(
    (board) => board.tracker === "jira" || board.tracker === "linear",
  );

/** Where a project's tickets go: the last chosen, else its tracker, else GitHub. */
export function ticketDestination(projectId: string, boards: Board[]): string {
  const tracked = trackedBoards(boards);
  const last = remembered(projectId);
  return last &&
    (last === "github" || tracked.some((board) => board.key === last))
    ? last
    : (tracked[0]?.key ?? "github");
}

/**
 * A ticket written in Yarrow, in a dialog over the list: a GitHub issue, or
 * a ticket in one of the project's linked Jira projects. Start sends it to
 * the agents at once; Create leaves it in To do. Opened from In progress's
 * "+", Start is the main action (⌘↵ or Ctrl ↵); from To do's, Create is.
 * Several drafts at once are listed on its left, as the files changed are:
 * each made leaves the list, the dialog closing with the last.
 */
export function NewTicket({
  projectId,
  projectName,
  boards,
  start,
  drafts,
  onCreated,
  onClose,
}: {
  projectId: string;
  projectName: string;
  boards: Board[];
  /** Opened from In progress: starting is what the builder came for. */
  start: boolean;
  /** Written already, from a pull request's notes. */
  drafts?: TicketDraft[];
  /** Made; `more` when other drafts wait, the dialog staying open. */
  onCreated: (
    key: string,
    started: boolean,
    draft: TicketDraft,
    more: boolean,
  ) => void;
  onClose: () => void;
}) {
  const create = useServerFn(createTicketFn);
  const tracked = trackedBoards(boards);
  // A team that links Jira or Linear files its tickets there.
  const [destination, setDestination] = useState(() =>
    ticketDestination(projectId, boards),
  );
  const many = (drafts?.length ?? 0) > 1;
  const [left, setLeft] = useState(drafts ?? [{ title: "", body: "" }]);
  const [at, setAt] = useState(0);
  const draft = left[at]!;
  const { title, body } = draft;
  const edit = (change: Partial<TicketDraft>) =>
    setLeft((all) =>
      all.map((one, i) => (i === at ? { ...one, ...change } : one)),
    );
  const [pending, setPending] = useState<"start" | "create" | null>(null);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const titleField = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // The browser's modal dialog: focus kept inside, Escape closes it.
    dialog.current?.showModal();
    titleField.current?.focus();
  }, []);

  async function submit(started: boolean) {
    if (!title.trim() || pending) return;
    setError("");
    setPending(started ? "start" : "create");
    try {
      const result = await create({
        data: {
          projectId,
          destination,
          title: title.trim(),
          body,
          queue: started,
          from: draft.from,
        },
      });
      if (result.ok) {
        remember(projectId, destination);
        const more = left.length > 1;
        onCreated(result.key, started, draft, more);
        if (more) {
          setLeft((all) => all.filter((one) => one !== draft));
          setAt(Math.min(at, left.length - 2));
        }
      } else setError(result.error);
    } catch {
      setError("That did not go through. Try again.");
    } finally {
      setPending(null);
    }
  }

  const keys = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submit(start);
    }
  };
  const disabled = !title.trim() || pending !== null;
  const hint = <kbd>{shortcut()}</kbd>;
  const startButton = (
    <button
      key="start"
      type="button"
      className={`tix-btn ${start ? "tix-btn-amber" : "tix-btn-line"}`}
      disabled={disabled}
      onClick={() => void submit(true)}
    >
      {pending === "start" ? (
        <Spinner />
      ) : (
        <Play size={11} fill="currentColor" aria-hidden="true" />
      )}
      Start
      {start && hint}
    </button>
  );
  const createButton = (
    <button
      key="create"
      type="button"
      className={`tix-btn ${start ? "tix-btn-line" : "tix-btn-amber"}`}
      disabled={disabled}
      onClick={() => void submit(false)}
    >
      {pending === "create" && <Spinner />}
      Create
      {!start && hint}
    </button>
  );

  return (
    <dialog
      ref={dialog}
      className={many ? "nt nt-many" : "nt"}
      aria-label="New ticket"
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onClose();
      }}
      // A click on the dim around the card closes it.
      onClick={(event) => {
        if (event.target === dialog.current && !pending) onClose();
      }}
      onKeyDown={keys}
    >
      {many && (
        <nav className="pp-rail" aria-label="Suggested tickets">
          <p className="pp-rail-title">Suggested tickets</p>
          {left.map((one, i) => (
            <button
              key={one.from?.note ?? i}
              type="button"
              className={i === at ? "pp-rail-file on" : "pp-rail-file"}
              title={one.title}
              aria-current={i === at}
              onClick={() => setAt(i)}
            >
              <span className="pp-rail-name">
                <b>{one.title}</b>
              </span>
            </button>
          ))}
        </nav>
      )}
      <form
        className="nt-card"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(start);
        }}
      >
        <div className="nt-head">
          {tracked.length > 0 ? (
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
                ...tracked.map((board) => ({
                  value: board.key,
                  label: board.key,
                  icon: <TrackerIcon tracker={board.tracker} size={14} />,
                  meta: board.site,
                })),
              ]}
            />
          ) : (
            <span className="nt-where">
              <Github size={14} /> GitHub
            </span>
          )}
          <ChevronRight size={13} className="nt-sep" aria-hidden="true" />
          <span className="nt-crumb">{projectName}</span>
          <button
            type="button"
            className="tix-icon-btn nt-close"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>
        <input
          ref={titleField}
          className="nt-title"
          aria-label="Title"
          placeholder="Ticket title"
          value={title}
          maxLength={TITLE_MAX}
          onChange={(event) => edit({ title: event.target.value })}
        />
        <textarea
          className="nt-body"
          aria-label="Description"
          placeholder="Description, in Markdown"
          rows={7}
          value={body}
          maxLength={BODY_MAX}
          onChange={(event) => edit({ body: event.target.value })}
        />
        <div className="nt-foot">
          {error && (
            <span className="pp-error" role="alert">
              {error}
            </span>
          )}
          {start ? [createButton, startButton] : [startButton, createButton]}
        </div>
      </form>
    </dialog>
  );
}
