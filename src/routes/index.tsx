import {
  createFileRoute,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { z } from "zod";
import { useLive } from "@/components/live";
import { ShipForm } from "@/components/ship-form";
import { SponsorBoard } from "@/components/sponsor-board";
import { TicketStack } from "@/components/ticket-stack";
import { PULL_REQUEST_COST_CENTS } from "@/core/pricing";
import { getBoardsFn } from "@/functions/public.functions";

export const Route = createFileRoute("/")({
  // Guests come back here from Stripe Checkout.
  // `edit`: from the dashboard, the viewer's row opens as its form.
  validateSearch: z.object({
    checkout: z.enum(["success"]).optional(),
    edit: z.boolean().optional(),
  }),
  loader: () => getBoardsFn(),
  component: Landing,
});

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
        search: { checkout },
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
        <div className="landing-pitch">
          <h1>Free pull requests from frontier AI</h1>
          <p className="landing-sub">
            Paste an issue:{" "}
            <span className="model model-plain">Claude Opus</span> and{" "}
            <span className="model model-plain late">GPT Astra</span> turn it
            into a reviewed pull request in minutes,{" "}
            <em className="gold">paid for by sponsors</em> whose names ship with
            every PR.
          </p>
          <ShipForm jira={loaded.sources.jira} />
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
