import {
  createFileRoute,
  getRouteApi,
  Link,
  redirect,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import {
  ArrowRight,
  Ban,
  GitMerge,
  GitPullRequest,
  Github,
  Sparkles,
} from "lucide-react";
import { useEffect } from "react";
import { z } from "zod";
import { TrackerIcon } from "@/components/brand-icons";
import { LandingRoom } from "@/components/landing-room";
import { useLive } from "@/components/live";
import { SponsorBoard } from "@/components/sponsor-board";
import { TicketStack } from "@/components/ticket-stack";
import { PULL_REQUEST_COST_CENTS } from "@/core/pricing";
import { getBoardsFn } from "@/functions/public.functions";
import { getViewerFn } from "@/functions/viewer.functions";

export const Route = createFileRoute("/")({
  // Guests come back here from Stripe Checkout.
  // `edit`: from the dashboard, the viewer's row opens as its form.
  validateSearch: z.object({
    checkout: z.enum(["success"]).optional(),
    edit: z.boolean().optional(),
  }),
  // Signed in, the address opens the dashboard. A sponsor's row and the way
  // back from Stripe still land here.
  beforeLoad: async ({ search }) => {
    if (search.edit === undefined && !search.checkout && (await getViewerFn()))
      throw redirect({ to: "/dashboard" });
  },
  loader: () => getBoardsFn(),
  component: Landing,
});

const rootRoute = getRouteApi("__root__");

const steps = [
  {
    title: "Write it with the agent",
    text: "It reads your code and your tickets, asks what it needs and fills in the ticket. In writing or out loud.",
  },
  {
    title: "Start it",
    text: "One agent builds it in the cloud. Another reviews it. Nothing to set up.",
  },
  {
    title: "Watch the demo",
    text: "The change comes back working on screen. Stop it and ask anything.",
  },
  {
    title: "Merge",
    text: "Slide to merge. Or ask for a change and it comes back.",
  },
];

const moves = [
  {
    icon: <Sparkles size={15} />,
    when: "Yarrow starts",
    to: "In Progress",
    kind: "progress",
  },
  {
    icon: <GitPullRequest size={15} />,
    when: "Pull request opened",
    to: "In Review",
    kind: "progress",
  },
  {
    icon: <GitMerge size={15} />,
    when: "Pull request merged",
    to: "Done",
    kind: "done",
  },
  {
    icon: <Ban size={15} />,
    when: "Yarrow stopped",
    to: "Back where it was",
    kind: "todo",
  },
];

const empty = {
  sponsors: { today: [], all: [] },
  live: [],
  totals: { inProgress: 0, merged: 0, mergedToday: 0 },
  pullRequestCents: PULL_REQUEST_COST_CENTS,
  you: null,
};

function Landing() {
  const loaded = Route.useLoaderData();
  const boards = loaded.configured ? loaded : empty;
  const { checkout, edit } = Route.useSearch();
  const { viewer } = rootRoute.useLoaderData();
  const router = useRouter();
  const navigate = useNavigate();
  // The row opened once: a refresh does not open it again.
  useEffect(() => {
    if (edit)
      void navigate({
        to: "/",
        search: { checkout, edit: false },
        replace: true,
        resetScroll: false,
      });
  }, [edit, checkout, navigate]);
  // A payment or a merge anywhere moves the boards for every visitor.
  useLive(["boards"], () => router.invalidate(), 2_000);
  return (
    <main id="main" className="landing">
      {checkout === "success" && (
        <div className="container landing-notice">
          <p className="feedback" role="status">
            Payment received. Your sign-in link is on its way by email.
          </p>
        </div>
      )}
      <section className="landing-hero container">
        <h1>Every ticket comes back with a demo</h1>
        <p className="landing-sub">
          Write your tickets with an agent. Others build and review them. You
          watch the result work, ask anything and merge.
        </p>
        <div className="landing-go">
          {viewer && !("guest" in viewer) ? (
            <Link className="go" to="/dashboard" search={{ tab: "builder" }}>
              Open your tickets
              <i>
                <ArrowRight size={14} strokeWidth={2.2} />
              </i>
            </Link>
          ) : (
            <a className="go" href="/connect/github?start">
              Connect your backlog
              <i>
                <ArrowRight size={14} strokeWidth={2.2} />
              </i>
            </a>
          )}
          <Link className="landing-free" to="/" hash="sponsors">
            Free. Sponsors fund the compute
          </Link>
        </div>
        <ul className="landing-marks" aria-label="Works with">
          <li>
            <Github size={17} /> GitHub
          </li>
          <li>
            <TrackerIcon tracker="jira" size={16} /> Jira
          </li>
          <li>
            <TrackerIcon tracker="linear" size={16} /> Linear
          </li>
          <li>
            <TrackerIcon tracker="trello" size={16} /> Trello
          </li>
        </ul>
      </section>
      <div className="container landing-shot">
        <LandingRoom />
      </div>
      <ol className="container landing-steps">
        {steps.map((step) => (
          <li key={step.title}>
            <h2>{step.title}</h2>
            <p>{step.text}</p>
          </li>
        ))}
      </ol>
      <section className="container landing-work">
        <div className="landing-board">
          <h2>Your board keeps up</h2>
          <ul className="landing-moves">
            {moves.map((move) => (
              <li key={move.when}>
                <span className="landing-when">
                  {move.icon}
                  {move.when}
                </span>
                <ArrowRight size={14} className="st-move-arrow" />
                <span className="landing-to">
                  <span className={`ss-dot ${move.kind}`} aria-hidden="true" />
                  {move.to}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <TicketStack
          live={boards.live}
          totals={boards.totals}
          sponsors={boards.sponsors.all}
        />
      </section>
      <div className="container landing-boards">
        <SponsorBoard
          today={boards.sponsors.today}
          all={boards.sponsors.all}
          you={boards.you}
          pullRequestCents={boards.pullRequestCents}
          startEditing={edit === true}
        />
      </div>
    </main>
  );
}
