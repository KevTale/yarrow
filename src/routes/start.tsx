import {
  createFileRoute,
  Link,
  redirect,
  useRouter,
} from "@tanstack/react-router";
import { ArrowRight, ExternalLink, Github } from "lucide-react";
import { useEffect, useState } from "react";
import { z } from "zod";
import { RadioCards } from "@/components/arc/radio-cards/radio-cards";
import { Spinner } from "@/components/navigation-feedback";
import {
  BoardMoves,
  TrackerConnection,
  type ProjectSetup,
} from "@/components/project-connections";
import { NotConfigured } from "@/components/ui";
import { getStartFn } from "@/functions/owner.functions";

export const Route = createFileRoute("/start")({
  validateSearch: z.object({
    project: z.uuid().optional().catch(undefined),
    step: z.enum(["tickets", "board"]).optional().catch(undefined),
    /** Set by /connect/done: GitHub's webhook may not have landed yet. */
    installation: z.number().int().positive().optional().catch(undefined),
    error: z.string().optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => ({ project: search.project }),
  loader: async ({ deps }) => {
    const data = await getStartFn({ data: { projectId: deps.project } });
    if (data.status === "signed_out")
      throw redirect({ href: "/connect/github?start" });
    return data;
  },
  head: () => ({ meta: [{ title: "Set up · Yarrow" }] }),
  component: StartPage,
});

type Loaded = Extract<Awaited<ReturnType<typeof getStartFn>>, { status: "ok" }>;

/** After an install: up to 30 s for the first repositories to appear. */
const INSTALL_POLLS = 10;

function StartPage() {
  const data = Route.useLoaderData();
  if (data.status === "not_configured")
    return (
      <main id="main" className="container page-main">
        <NotConfigured />
      </main>
    );
  return <Setup data={data} />;
}

/**
 * From connecting GitHub to the first ticket, one step at a time: the code,
 * where the tickets are, and how a board's tickets move when there is one.
 * The step is in the address: a tracker's consent comes back to it.
 */
function Setup({ data }: { data: Loaded }) {
  const search = Route.useSearch();
  const router = useRouter();
  const [polls, setPolls] = useState(0);
  const count = data.repositories.length;
  const [before] = useState(count);
  // New repositories showed up, or the install only changed existing ones.
  const arrived = count > before || (count > 0 && polls >= 2);
  const waiting =
    search.installation !== undefined && polls < INSTALL_POLLS && !arrived;

  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(async () => {
      await router.invalidate();
      setPolls((current) => current + 1);
    }, 3_000);
    return () => clearTimeout(timer);
  }, [waiting, polls, router]);

  const { setup } = data;
  const boards = setup?.boards.length ?? 0;
  const step = setup ? (search.step ?? "code") : "code";
  return (
    <main id="main" className="container start">
      <ol className="start-steps" aria-label="Steps">
        <StepLink name="code" label="Code" step={step} project={setup} />
        <StepLink name="tickets" label="Tickets" step={step} project={setup} />
        {boards > 0 && (
          <StepLink name="board" label="Board" step={step} project={setup} />
        )}
      </ol>
      {search.error && (
        <p className="feedback feedback-error" role="alert">
          {search.error}
        </p>
      )}
      {step === "code" || !setup ? (
        <Code data={data} waiting={waiting} />
      ) : step === "tickets" ? (
        <Tickets setup={setup} />
      ) : (
        <Board setup={setup} />
      )}
    </main>
  );
}

function StepLink({
  name,
  label,
  step,
  project,
}: {
  name: "code" | "tickets" | "board";
  label: string;
  step: string;
  project: ProjectSetup | null;
}) {
  if (name === step) return <li aria-current="step">{label}</li>;
  if (!project) return <li>{label}</li>;
  return (
    <li>
      <Link
        to="/start"
        search={{
          project: project.project.id,
          step: name === "code" ? undefined : name,
        }}
      >
        {label}
      </Link>
    </li>
  );
}

function Code({ data, waiting }: { data: Loaded; waiting: boolean }) {
  const navigate = Route.useNavigate();
  const { repositories, setup } = data;
  return (
    <>
      <h1>Your code</h1>
      {repositories.length > 1 ? (
        <RadioCards
          aria-label="Repository"
          layout="list"
          name="repository"
          value={setup?.project.id ?? ""}
          onValueChange={(project) =>
            void navigate({ search: { project }, replace: true })
          }
          options={repositories.map((item) => ({
            value: item.id,
            label: item.repository,
          }))}
        />
      ) : setup ? (
        <div className="st-cards">
          <div className="st-card">
            <span className="st-icon" aria-hidden="true">
              <Github size={18} />
            </span>
            <span className="st-card-body">
              <strong>GitHub</strong>
              <span className="mono muted">{setup.project.repository}</span>
            </span>
            <span className="st-state on">Connected</span>
          </div>
        </div>
      ) : waiting ? (
        <p className="start-waiting" role="status">
          <Spinner /> Waiting for GitHub
        </p>
      ) : (
        <div className="start-foot">
          <a className="go" href="/connect/github">
            <Github size={16} /> Connect GitHub
            <i>
              <ArrowRight size={14} strokeWidth={2.2} />
            </i>
          </a>
        </div>
      )}
      {setup && (
        <div className="start-foot">
          <a className="start-add" href={data.githubInstallUrl}>
            Add a repository <ExternalLink size={13} />
          </a>
          <Link
            className="go"
            to="/start"
            search={{ project: setup.project.id, step: "tickets" }}
          >
            Continue
            <i>
              <ArrowRight size={14} strokeWidth={2.2} />
            </i>
          </Link>
        </div>
      )}
    </>
  );
}

function Tickets({ setup }: { setup: ProjectSetup }) {
  const { project, trackersAvailable } = setup;
  return (
    <>
      <h1>Your tickets</h1>
      <div className="st-cards">
        <div className="st-card">
          <span className="st-icon" aria-hidden="true">
            <Github size={18} />
          </span>
          <span className="st-card-body">
            <strong>GitHub Issues</strong>
            <span className="mono muted">{project.repository}</span>
          </span>
          <span className="st-state on">Connected</span>
        </div>
        {trackersAvailable.jira && (
          <TrackerConnection data={setup} tracker="jira" setup />
        )}
        {trackersAvailable.linear && (
          <TrackerConnection data={setup} tracker="linear" setup />
        )}
        {trackersAvailable.trello && (
          <TrackerConnection data={setup} tracker="trello" setup />
        )}
      </div>
      <div className="start-foot">
        {setup.boards.length > 0 ? (
          <Link
            className="go"
            to="/start"
            search={{ project: project.id, step: "board" }}
          >
            Continue
            <i>
              <ArrowRight size={14} strokeWidth={2.2} />
            </i>
          </Link>
        ) : (
          <Finish projectId={project.id} />
        )}
      </div>
    </>
  );
}

/** Where each board's tickets go as the work moves: at least one was linked. */
function Board({ setup }: { setup: ProjectSetup }) {
  const trackers = { jira: "Jira", linear: "Linear", trello: "Trello" };
  return (
    <>
      <h1>Your board</h1>
      <div className="st-moves">
        {setup.boards.map((board) => (
          <BoardMoves
            key={board.id}
            boardId={board.id}
            name={board.name}
            tracker={trackers[board.tracker as keyof typeof trackers]}
          />
        ))}
      </div>
      <div className="start-foot">
        <Finish projectId={setup.project.id} />
      </div>
    </>
  );
}

function Finish({ projectId }: { projectId: string }) {
  return (
    <Link
      className="go"
      to="/dashboard"
      search={{ tab: "builder", project: projectId }}
    >
      Open your tickets
      <i>
        <ArrowRight size={14} strokeWidth={2.2} />
      </i>
    </Link>
  );
}
