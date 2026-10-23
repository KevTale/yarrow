import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  CheckCircle2,
  ExternalLink,
  Github,
  KeyRound,
  Trash2,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { z } from "zod";
import type { ProjectForm, RunConfig } from "@/core/forms";
import {
  addBoardFn,
  addSecretFn,
  deleteSecretFn,
  getProjectFn,
  listTrackerBoardsFn,
  removeBoardFn,
  saveRunConfigFn,
  updateProjectFn,
} from "@/functions/owner.functions";
import { parseStacks, ProjectFields } from "@/components/project-fields";
import {
  capitalize,
  EmptyState,
  NotConfigured,
  PageHeading,
  SignInPrompt,
  TicketStatus,
  timeAgo,
} from "@/components/ui";

export const Route = createFileRoute("/projects/$projectId")({
  validateSearch: z.object({
    created: z.boolean().optional(),
    connected: z.string().optional(),
    error: z.string().optional(),
  }),
  loader: ({ params }) =>
    getProjectFn({ data: { projectId: params.projectId } }),
  head: () => ({ meta: [{ title: "Project · Agent Commons" }] }),
  component: ProjectPage,
});

type Loaded = Extract<
  Awaited<ReturnType<typeof getProjectFn>>,
  { status: "ok" }
>;

function ProjectPage() {
  const data = Route.useLoaderData();
  const { projectId } = Route.useParams();
  if (data.status === "signed_out")
    return (
      <main id="main" className="container page-main">
        <SignInPrompt
          next={`/projects/${projectId}`}
          reason="Sign in to manage this project."
        />
      </main>
    );
  if (data.status === "not_configured")
    return (
      <main id="main" className="container page-main">
        <NotConfigured />
      </main>
    );
  return <ProjectSettings data={data} />;
}

function useAction() {
  const router = useRouter();
  const [message, setMessage] = useState<{
    text: string;
    error: boolean;
  } | null>(null);
  async function run(action: () => Promise<unknown>, success: string) {
    setMessage(null);
    try {
      await action();
      setMessage({ text: success, error: false });
      await router.invalidate();
    } catch (cause) {
      setMessage({
        text: cause instanceof Error ? cause.message : "Something went wrong.",
        error: true,
      });
    }
  }
  const feedback = message && (
    <p
      className={`feedback ${message.error ? "feedback-error" : ""}`}
      role="status"
    >
      {message.text}
    </p>
  );
  return { run, feedback };
}

function ProjectSettings({ data }: { data: Loaded }) {
  const search = Route.useSearch();
  const { project } = data;
  const linked = Boolean(project.githubInstallationId);
  return (
    <main id="main" className="container page-main">
      <PageHeading
        eyebrow="PROJECT"
        title={project.name}
        description={`${project.repository} · ${capitalize(project.visibility)}`}
      >
        <Link to="/dashboard" className="text-link">
          My activity
        </Link>
      </PageHeading>
      {search.created && (
        <p className="feedback" role="status">
          Project created. Next: install the GitHub App on {project.repository}.
        </p>
      )}
      {search.connected && (
        <p className="feedback" role="status">
          {capitalize(search.connected)} connected. Map a board below.
        </p>
      )}
      {search.error && (
        <p className="feedback feedback-error" role="alert">
          {search.error}
        </p>
      )}
      {project.suspendedAt && (
        <p className="feedback feedback-error" role="alert">
          This project is suspended under the acceptable use policy. Contact us.
        </p>
      )}

      <section className="panel">
        <div className="row spread">
          <div>
            <p className="eyebrow">01 / GITHUB APP</p>
            {linked ? (
              <p>
                <CheckCircle2 size={15} className="ok" /> Installed on{" "}
                <strong>{project.repository}</strong>. Tag issues with{" "}
                <code>{project.authorizationLabel}</code> and they join the
                queue.
              </p>
            ) : (
              <p className="muted">
                Install the app on <strong>{project.repository}</strong> with
                the GitHub account you signed in with. It needs admin rights on
                the repository, which proves the project is yours.
              </p>
            )}
          </div>
          <a
            className={`button ${linked ? "button-secondary" : "button-primary"} button-small`}
            href={data.githubInstallUrl}
          >
            <Github size={15} />{" "}
            {linked ? "Manage the installation" : "Install the GitHub App"}
          </a>
        </div>
      </section>

      <Tickets data={data} />
      <Trackers data={data} />
      <Settings data={data} />
      <RunConfiguration data={data} />
      <Secrets data={data} />
    </main>
  );
}

function Tickets({ data }: { data: Loaded }) {
  return (
    <section className="section">
      <p className="eyebrow">02 / TICKETS</p>
      {data.tickets.length === 0 ? (
        <EmptyState title="No ticket yet">
          Add the <code>{data.project.authorizationLabel}</code> label to an
          issue or a tracker ticket. Synced tickets appear here.
        </EmptyState>
      ) : (
        <ol className="work-list">
          {data.tickets.map((ticket) => (
            <li key={ticket.id} className="work-row">
              <span className="work-row-title">
                <a href={ticket.url} target="_blank" rel="noreferrer">
                  <strong>{ticket.title}</strong>
                </a>
                <span className="muted small">
                  {capitalize(ticket.source)} · queued{" "}
                  {timeAgo(ticket.queuedAt)}
                  {!ticket.authorized && " · label removed"}
                  {ticket.pendingCorrections > 0 &&
                    ` · ${ticket.pendingCorrections} correction(s) queued`}
                </span>
              </span>
              <span className="row small">
                {ticket.pullRequestUrl && (
                  <a
                    className="text-link"
                    href={ticket.pullRequestUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    PR <ExternalLink size={12} />
                  </a>
                )}
                {ticket.lastRunId && (
                  <Link
                    className="text-link"
                    to="/runs/$runId"
                    params={{ runId: ticket.lastRunId }}
                  >
                    Last run
                  </Link>
                )}
              </span>
              <TicketStatus
                status={
                  ticket.pullRequestState === "merged"
                    ? "merged"
                    : ticket.status
                }
              />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Trackers({ data }: { data: Loaded }) {
  const { run, feedback } = useAction();
  const listBoards = useServerFn(listTrackerBoardsFn);
  const addBoard = useServerFn(addBoardFn);
  const removeBoard = useServerFn(removeBoardFn);
  const [connectionId, setConnectionId] = useState(
    data.connections[0]?.id ?? "",
  );
  const [boards, setBoards] = useState<{ id: string; name: string }[] | null>(
    null,
  );
  const projectId = data.project.id;

  async function loadBoards(id: string) {
    setConnectionId(id);
    setBoards(null);
    if (!id) return;
    await run(
      async () =>
        setBoards(await listBoards({ data: { projectId, connectionId: id } })),
      "Boards loaded.",
    );
  }

  return (
    <section className="section">
      <p className="eyebrow">03 / LINEAR, JIRA, TRELLO (OPTIONAL)</p>
      <p className="muted small">
        Tickets tagged <code>{data.project.authorizationLabel}</code> on a
        mapped board are synced every 5 minutes. The code still lives in{" "}
        {data.project.repository}.
      </p>
      <div className="integration-grid">
        {(["linear", "jira", "trello"] as const).map((tracker) => (
          <div className="integration-card" key={tracker}>
            <strong>{capitalize(tracker)}</strong>
            {data.trackersAvailable[tracker] ? (
              <a
                className="button button-secondary button-small"
                href={`/integrations/${tracker}/connect?projectId=${projectId}`}
              >
                Connect
              </a>
            ) : (
              <span className="muted small">Not available yet</span>
            )}
          </div>
        ))}
      </div>
      {data.boards.length > 0 && (
        <ul className="stack">
          {data.boards.map((board) => (
            <li key={board.id} className="row spread">
              <span>
                {capitalize(board.tracker)} · {board.connection} ·{" "}
                <strong>{board.name}</strong>
              </span>
              <button
                type="button"
                className="icon-button"
                aria-label={`Unmap ${board.name}`}
                onClick={() =>
                  run(
                    () =>
                      removeBoard({ data: { projectId, boardId: board.id } }),
                    "Board unmapped.",
                  )
                }
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {data.connections.length > 0 && (
        <div className="field-grid">
          <label className="field">
            Connection
            <select
              value={connectionId}
              onChange={(event) => loadBoards(event.target.value)}
            >
              <option value="">Choose…</option>
              {data.connections.map((connection) => (
                <option key={connection.id} value={connection.id}>
                  {capitalize(connection.tracker)} · {connection.name}
                </option>
              ))}
            </select>
          </label>
          {boards && (
            <label className="field">
              Board to map to this project
              <select
                defaultValue=""
                onChange={(event) => {
                  const board = boards.find(
                    (item) => item.id === event.target.value,
                  );
                  if (board)
                    void run(
                      () =>
                        addBoard({
                          data: {
                            projectId,
                            connectionId,
                            externalBoardId: board.id,
                            name: board.name,
                          },
                        }),
                      `${board.name} mapped.`,
                    );
                }}
              >
                <option value="">Choose…</option>
                {boards.map((board) => (
                  <option key={board.id} value={board.id}>
                    {board.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
      {feedback}
    </section>
  );
}

function Settings({ data }: { data: Loaded }) {
  const { run, feedback } = useAction();
  const update = useServerFn(updateProjectFn);
  const { project } = data;
  const [form, setForm] = useState<ProjectForm>({
    name: project.name,
    description: project.description,
    productUrl: project.productUrl ?? "",
    repository: project.repository,
    visibility: project.visibility,
    categories: project.categories as ProjectForm["categories"],
    stacks: project.stacks,
    authorizationLabel: project.authorizationLabel,
  });
  const [stacks, setStacks] = useState(project.stacks.join(", "));
  function submit(event: FormEvent) {
    event.preventDefault();
    void run(
      () =>
        update({
          data: { ...form, stacks: parseStacks(stacks), projectId: project.id },
        }),
      "Project saved.",
    );
  }
  return (
    <section className="section">
      <p className="eyebrow">04 / SETTINGS</p>
      <form onSubmit={submit} className="form-main">
        <ProjectFields
          value={form}
          onChange={(patch) => setForm((current) => ({ ...current, ...patch }))}
          stacksText={stacks}
          onStacksText={setStacks}
        />
        <button className="button button-primary">Save settings</button>
        {feedback}
      </form>
    </section>
  );
}

function RunConfiguration({ data }: { data: Loaded }) {
  const { run, feedback } = useAction();
  const save = useServerFn(saveRunConfigFn);
  const current = data.runConfig;
  const [config, setConfig] = useState<RunConfig>({
    setupCommand: current?.setupCommand ?? "",
    seedCommand: current?.seedCommand ?? "",
    startCommand: current?.startCommand ?? "",
    appPort: current?.appPort ?? null,
    env: current?.env ?? {},
  });
  const [envText, setEnvText] = useState(
    Object.entries(current?.env ?? {})
      .map(([key, value]) => `${key}=${value}`)
      .join("\n"),
  );
  function submit(event: FormEvent) {
    event.preventDefault();
    const env = Object.fromEntries(
      envText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const index = line.indexOf("=");
          return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
        }),
    );
    void run(
      () => save({ data: { ...config, env, projectId: data.project.id } }),
      "Run configuration saved.",
    );
  }
  const field = (
    key: "setupCommand" | "seedCommand" | "startCommand",
    label: string,
    placeholder: string,
  ) => (
    <label className="field">
      {label}
      <input
        value={config[key]}
        placeholder={placeholder}
        onChange={(event) =>
          setConfig((value) => ({ ...value, [key]: event.target.value }))
        }
      />
    </label>
  );
  return (
    <section className="section">
      <p className="eyebrow">
        05 / RUN CONFIGURATION (FOR SCREENSHOTS AND VIDEO)
      </p>
      <p className="muted small">
        Optional. Tells the agent how to start your app in its sandbox so UI
        changes come with screenshots and a short video. A local PostgreSQL is
        available. Without it, PRs simply come without visuals.
      </p>
      <form onSubmit={submit} className="form-main">
        <div className="field-grid">
          {field("setupCommand", "Setup", "pnpm install")}
          {field("seedCommand", "Seed", "pnpm db:seed")}
          {field("startCommand", "Start", "pnpm dev")}
          <label className="field">
            App port
            <input
              type="number"
              value={config.appPort ?? ""}
              onChange={(event) =>
                setConfig((value) => ({
                  ...value,
                  appPort: event.target.value
                    ? Number(event.target.value)
                    : null,
                }))
              }
            />
          </label>
        </div>
        <label className="field">
          Development variables, one KEY=value per line (no secrets here)
          <textarea
            rows={4}
            value={envText}
            onChange={(event) => setEnvText(event.target.value)}
          />
        </label>
        <button className="button button-secondary">
          Save run configuration
        </button>
        {feedback}
      </form>
    </section>
  );
}

function Secrets({ data }: { data: Loaded }) {
  const { run, feedback } = useAction();
  const add = useServerFn(addSecretFn);
  const remove = useServerFn(deleteSecretFn);
  const [secret, setSecret] = useState({
    name: "",
    value: "",
    allowedHost: "",
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      await add({ data: { ...secret, projectId: data.project.id } });
      setSecret({ name: "", value: "", allowedHost: "" });
    }, "Secret stored in the provider vault.");
  }
  return (
    <section className="section">
      <p className="eyebrow">
        <KeyRound size={13} /> 06 / TEST SECRETS
      </p>
      <p className="muted small">
        <strong>Test or staging keys only, never production.</strong> Values go
        straight to the AI provider's vault: we never store them, and the agent
        never sees them. Each secret is only sent to the host you allow.
      </p>
      {data.secrets.length > 0 && (
        <ul className="stack">
          {data.secrets.map((item) => (
            <li key={item.name} className="row spread mono small">
              <span>
                {item.name} → {item.allowedHost}
              </span>
              <button
                type="button"
                className="icon-button"
                aria-label={`Delete ${item.name}`}
                onClick={() =>
                  run(
                    () =>
                      remove({
                        data: { projectId: data.project.id, name: item.name },
                      }),
                    "Secret deleted.",
                  )
                }
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {data.secretsAvailable ? (
        <form onSubmit={submit} className="field-grid">
          <label className="field">
            Name
            <input
              required
              value={secret.name}
              placeholder="STRIPE_SECRET_KEY"
              onChange={(event) =>
                setSecret((value) => ({
                  ...value,
                  name: event.target.value.toUpperCase(),
                }))
              }
            />
          </label>
          <label className="field">
            Value
            <input
              required
              type="password"
              autoComplete="off"
              value={secret.value}
              onChange={(event) =>
                setSecret((value) => ({ ...value, value: event.target.value }))
              }
            />
          </label>
          <label className="field">
            Allowed host
            <input
              required
              value={secret.allowedHost}
              placeholder="api.stripe.com"
              onChange={(event) =>
                setSecret((value) => ({
                  ...value,
                  allowedHost: event.target.value,
                }))
              }
            />
          </label>
          <button className="button button-secondary">Add secret</button>
        </form>
      ) : (
        <p className="muted small">
          Test secrets are not available on this deployment yet.
        </p>
      )}
      {feedback}
    </section>
  );
}
