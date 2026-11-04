import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  Check,
  ExternalLink,
  GitMerge,
  GitPullRequest,
  Sparkles,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { MorphSelect } from "@/components/arc/morph-select/morph-select";
import { MultiSelect } from "@/components/arc/multi-select/multi-select";
import { TrackerIcon } from "@/components/brand-icons";
import {
  SavedState,
  useSavedFades,
  type SaveState,
} from "@/components/saved-state";
import { BACK, type MoveEvent, type TrackerStatus } from "@/core/tracker-moves";
import {
  getTrackerBoardFn,
  listTrackerBoardsFn,
  setTrackerBoardsFn,
  setTrackerMovesFn,
} from "@/functions/connect.functions";
import type { getProjectFn } from "@/functions/owner.functions";

export type ProjectSetup = Extract<
  Awaited<ReturnType<typeof getProjectFn>>,
  { status: "ok" }
>;

const trackerCopy = {
  jira: {
    name: "Jira",
    boards: "Tickets from Jira projects",
    owner: "Atlassian",
    // Atlassian lists the apps each person allowed, and revokes them.
    manage: "https://id.atlassian.com/manage-profile/apps",
  },
  linear: {
    name: "Linear",
    boards: "Tickets from Linear teams",
    owner: "Linear",
    manage: "https://linear.app/settings",
  },
  trello: {
    name: "Trello",
    boards: "Tickets from Trello boards",
    owner: "Trello",
    manage: "https://trello.com/my/account",
  },
};

/** The setup's word for tickets that come in: its rows have no other state. */
export function Imported() {
  return (
    <span className="st-imported">
      <Check size={14} aria-hidden="true" />
      Imported
    </span>
  );
}

/**
 * Jira, Linear or Trello: Connect, Import in the setup, opens the tracker's
 * consent; once connected, the Jira projects, Linear teams or Trello boards
 * whose tickets this repository takes are chosen here and saved at once.
 */
export function TrackerConnection({
  data,
  tracker,
  setup = false,
}: {
  data: ProjectSetup;
  tracker: "jira" | "linear" | "trello";
  /** In the setup, which comes back here and shows the moves on their own. */
  setup?: boolean;
}) {
  const router = useRouter();
  const listProjects = useServerFn(listTrackerBoardsFn);
  const saveProjects = useServerFn(setTrackerBoardsFn);
  const copy = trackerCopy[tracker];
  const { project } = data;
  const boards = data.boards.filter((item) => item.tracker === tracker);
  const connection =
    data.connections.find((item) => item.id === boards[0]?.connectionId) ??
    data.connections.find((item) => item.tracker === tracker);
  const connectionId = connection?.id;
  const [options, setOptions] = useState<{ id: string; name: string }[] | null>(
    null,
  );
  const [revoked, setRevoked] = useState(false);
  // The tracker did not answer: the linked boards stay listed.
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState(boards.map((board) => board.key));
  const [state, setState] = useState<SaveState>("idle");
  useSavedFades(state, setState);

  useEffect(() => {
    if (!connectionId) return;
    let stopped = false;
    listProjects({ data: { connectionId } })
      .then((result) => {
        if (stopped) return;
        setRevoked(result.revoked);
        setOptions(result.boards);
      })
      .catch(() => !stopped && setFailed(true));
    return () => {
      stopped = true;
    };
  }, [connectionId, listProjects]);

  async function change(keys: string[]) {
    if (!connectionId) return;
    const before = selected;
    setSelected(keys);
    setState("saving");
    try {
      await saveProjects({
        data: { projectId: project.id, connectionId, keys },
      });
      await router.invalidate();
      setState("saved");
    } catch {
      setSelected(before);
      setState("error");
    }
  }

  const connected = Boolean(connection) && !revoked;
  const connect = `/integrations/${tracker}/connect?projectId=${project.id}${setup ? "&next=start" : ""}`;
  return (
    <div className="st-card-wrap">
      <div className="st-card">
        <span className="st-icon" aria-hidden="true">
          <TrackerIcon tracker={tracker} size={18} />
        </span>
        <span className="st-card-body">
          <strong>
            {copy.name} <SavedState state={state} />
          </strong>
          {connected ? (
            <span className="st-jira">
              <span className="mono muted">{connection!.name}</span>
              <BoardPicker
                tracker={copy.name}
                options={
                  options ??
                  boards.map((board) => ({ id: board.key, name: board.name }))
                }
                loading={options === null && !failed}
                selected={selected}
                onChange={(keys) => void change(keys)}
              />
            </span>
          ) : revoked ? (
            <span className="muted">
              Access removed in {copy.owner} · {connection!.name}
            </span>
          ) : (
            !setup && <span className="muted">{copy.boards}</span>
          )}
        </span>
        {revoked ? (
          <span className="st-state warn">Disconnected</span>
        ) : setup ? (
          boards.length > 0 && <Imported />
        ) : (
          connected && <span className="st-state on">Connected</span>
        )}
        {connected && connection!.webhookRefused ? (
          // An older consent, without webhooks: a new one adds them.
          <a className="bd-btn bd-btn-amber" href={connect}>
            Reconnect
          </a>
        ) : connected ? (
          !setup && (
            <a
              className="bd-btn bd-btn-line"
              href={copy.manage}
              target="_blank"
              rel="noopener"
            >
              Manage <ExternalLink size={13} />
            </a>
          )
        ) : revoked ? (
          <a className="bd-btn bd-btn-amber" href={connect}>
            Reconnect
          </a>
        ) : (
          <a
            className={`bd-btn ${setup ? "bd-btn-line" : "bd-btn-amber"}`}
            href={connect}
          >
            {setup ? "Import" : "Connect"}
          </a>
        )}
      </div>
      {!setup && connected && boards.length > 0 && (
        <div className="st-moves">
          {boards.map((board) => (
            <BoardMoves
              key={board.id}
              boardId={board.id}
              name={board.name}
              tracker={copy.name}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const moveRows: { event: MoveEvent; label: string; icon: ReactNode }[] = [
  { event: "started", label: "Yarrow starts", icon: <Sparkles size={14} /> },
  {
    event: "pullRequest",
    label: "Pull request opened",
    icon: <GitPullRequest size={14} />,
  },
  {
    event: "merged",
    label: "Pull request merged",
    icon: <GitMerge size={14} />,
  },
  { event: "stopped", label: "Yarrow stopped", icon: <Ban size={14} /> },
];

/**
 * Where a board's tickets move as Yarrow works: one status per event, or
 * "Don't move". The team's own status names, saved at once.
 */
export function BoardMoves({
  boardId,
  name,
  tracker,
}: {
  boardId: string;
  name: string;
  tracker: string;
}) {
  const load = useServerFn(getTrackerBoardFn);
  const save = useServerFn(setTrackerMovesFn);
  const [board, setBoard] = useState<Awaited<
    ReturnType<typeof getTrackerBoardFn>
  > | null>(null);
  const [failed, setFailed] = useState(false);
  const [state, setState] = useState<SaveState>("idle");
  useSavedFades(state, setState);

  useEffect(() => {
    let stopped = false;
    load({ data: { boardId } })
      .then((result) => !stopped && setBoard(result))
      .catch(() => !stopped && setFailed(true));
    return () => {
      stopped = true;
    };
  }, [boardId, load]);

  async function change(event: MoveEvent, statusId: string | null) {
    if (!board) return;
    const before = board;
    const moves = { ...board.moves, [event]: statusId };
    setBoard({ ...board, moves, chosen: true, warning: null });
    setState("saving");
    try {
      await save({ data: { boardId, moves } });
      setState("saved");
    } catch {
      setBoard(before);
      setState("error");
    }
  }

  const [key, title] = name.includes(" · ") ? name.split(" · ") : [name, ""];
  return (
    <div className="st-board">
      <div className="st-board-head">
        <span className="st-board-name">
          <b className="mono">{key}</b> {title}
        </span>
        <SavedState state={state} />
      </div>
      {failed ? (
        <p className="muted st-board-note">
          {tracker} did not answer. Reload the page in a moment.
        </p>
      ) : (
        <div className="st-move-list">
          {moveRows.map((row) => (
            <div className="st-move" key={row.event}>
              <span className="st-move-when">
                {row.icon}
                {row.label}
              </span>
              <ArrowRight size={14} className="st-move-arrow" />
              {board ? (
                <StatusSelect
                  tracker={tracker}
                  label={row.label}
                  statuses={board.statuses}
                  back={row.event === "stopped"}
                  value={board.moves[row.event] ?? null}
                  onChange={(statusId) => void change(row.event, statusId)}
                />
              ) : (
                <span className="sk st-move-sk" />
              )}
            </div>
          ))}
        </div>
      )}
      {board?.warning && (
        <p className="st-board-warning" role="status">
          <AlertTriangle size={14} />
          {board.warning}
        </p>
      )}
    </div>
  );
}

/**
 * The status a ticket moves to, or "Don't move" (or, when Yarrow stops,
 * back where it was): uiarc's morph select, each status marked with its
 * category's color as in its tracker.
 */
function StatusSelect({
  tracker,
  label,
  statuses,
  back = false,
  value,
  onChange,
}: {
  tracker: string;
  label: string;
  statuses: TrackerStatus[];
  back?: boolean;
  value: string | null;
  onChange: (statusId: string | null) => void;
}) {
  const none = "\u0000none";
  return (
    <div className="ss">
      <MorphSelect
        label={`${label}: ${tracker} status`}
        hideLabel
        value={value ?? none}
        onValueChange={(next) => {
          const statusId = next === none ? null : next;
          if (statusId !== value) onChange(statusId);
        }}
        items={[
          ...(back ? [{ value: BACK, label: "Back where it was" }] : []),
          { value: none, label: "Don't move" },
          ...statuses.map((status) => ({
            value: status.id,
            label: status.name,
            icon: (
              <span
                className={`ss-dot ${status.category}`}
                aria-hidden="true"
              />
            ),
          })),
        ]}
      />
    </div>
  );
}

/** Jira projects, Linear teams or Trello boards, ticked in a menu; each tick saves. */
function BoardPicker({
  tracker,
  options,
  loading,
  selected,
  onChange,
}: {
  tracker: string;
  options: { id: string; name: string }[];
  loading: boolean;
  selected: string[];
  onChange: (keys: string[]) => void;
}) {
  // "KAN · Démo" → key KAN, name Démo.
  const label = (option: { id: string; name: string }) =>
    option.name.startsWith(`${option.id} · `)
      ? option.name.slice(option.id.length + 3)
      : option.name;
  const trello = tracker === "Trello";
  const boards =
    tracker === "Linear"
      ? "Linear teams"
      : trello
        ? "Trello boards"
        : "Jira projects";
  // uiarc's multi select; no clear-all, each board unlinks on its own.
  return (
    <MultiSelect
      className="jp"
      label={boards}
      hideLabel
      clearable={false}
      placeholder={
        loading
          ? "Loading…"
          : options.length === 0
            ? `No ${boards.slice(0, -1)} here`
            : `Choose ${boards}`
      }
      options={options.map((option) => ({
        value: option.id,
        // A Trello board's key is a link's end, nothing to read.
        label: trello ? option.name : `${option.id} ${label(option)}`,
      }))}
      value={selected}
      onValueChange={onChange}
    />
  );
}
