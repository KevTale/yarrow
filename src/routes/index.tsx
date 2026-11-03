import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { Github } from "lucide-react";
import { useEffect } from "react";
import { z } from "zod";
import { TrackerIcon } from "@/components/brand-icons";
import { LandingRoom } from "@/components/landing-room";
import { BoardShot, DraftShot } from "@/components/landing-shots";
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

const CONNECT = "/connect/github?start";

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
      <section className="lp-hero container">
        <h1>
          Every ticket comes back <br />
          with a demo
        </h1>
        <div className="lp-hero-foot">
          <p>
            Agents write, build and review your tickets. <br />
            You watch the result work, ask anything and merge.
          </p>
          <div className="lp-hero-go">
            <Link className="lp-free" to="/" hash="sponsors">
              Free. Sponsors fund the compute
            </Link>
            <a className="lp-cta" href={CONNECT}>
              Connect your backlog
            </a>
          </div>
        </div>
      </section>
      <div className="container lp-room">
        <LandingRoom
          cta={
            <a className="lp-cta" href={CONNECT}>
              Connect your backlog
            </a>
          }
        />
      </div>
      <section className="container lp-sources" aria-label="Works with">
        <ul>
          <li>
            <Github size={22} /> GitHub
          </li>
          <li>
            <TrackerIcon tracker="jira" size={20} /> Jira
          </li>
          <li>
            <TrackerIcon tracker="linear" size={20} /> Linear
          </li>
          <li>
            <TrackerIcon tracker="trello" size={20} /> Trello
          </li>
        </ul>
        <p className="mono">Your tickets stay where they are</p>
      </section>
      <p className="container lp-statement">
        <b>Software now starts with a ticket.</b> Yarrow takes each one from its
        first sentence to the merge, and shows you the result working before you
        decide.
      </p>
      <section className="lp-part">
        <div className="container lp-part-head">
          <h2>
            Write it
            <br />
            with the agent
          </h2>
          <p>
            It reads your code and every ticket, says what already exists and
            asks what it cannot know. You talk, in writing or out loud. The
            ticket writes itself.
          </p>
        </div>
        <div className="container">
          <DraftShot />
        </div>
      </section>
      <section className="lp-part">
        <div className="container lp-part-head">
          <h2>
            Built and reviewed
            <br />
            in the cloud
          </h2>
          <p>
            One agent builds it. Another reviews it, runs it and records the
            demo. Nothing to install and nothing to keep open.
          </p>
        </div>
        <div className="container lp-live">
          <TicketStack
            live={boards.live}
            totals={boards.totals}
            sponsors={boards.sponsors.all}
          />
        </div>
      </section>
      <section className="lp-part">
        <div className="container lp-part-head">
          <h2>
            Your board
            <br />
            keeps up
          </h2>
          <p>
            Tickets stay in GitHub, Jira, Linear or Trello. They move through
            your own columns as the work moves.
          </p>
        </div>
        <div className="container">
          <BoardShot />
        </div>
      </section>
      <section className="lp-end">
        <h2>Start with your next ticket</h2>
        <a className="lp-cta" href={CONNECT}>
          Connect your backlog
        </a>
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
