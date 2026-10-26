import { createFileRoute, useRouter } from "@tanstack/react-router";
import { z } from "zod";
import { useLive } from "@/components/live";
import { ShipForm } from "@/components/ship-form";
import { SponsorBoard } from "@/components/sponsor-board";
import { TicketStack } from "@/components/ticket-stack";
import { getBoardsFn } from "@/functions/public.functions";

export const Route = createFileRoute("/")({
  // Guests come back here from Stripe Checkout.
  validateSearch: z.object({ checkout: z.enum(["success"]).optional() }),
  loader: () => getBoardsFn(),
  component: Landing,
});

const empty = {
  sponsors: { today: [], all: [] },
  live: [],
  totals: { inProgress: 0, merged: 0 },
  you: null,
};

function Landing() {
  const loaded = Route.useLoaderData();
  const boards = loaded.configured ? loaded : empty;
  const { checkout } = Route.useSearch();
  const router = useRouter();
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
          <h1>Frontier AI for free</h1>
          <p className="landing-sub">
            Paste an issue:{" "}
            <span className="model model-claude">Claude Opus</span> and{" "}
            <span className="model model-gpt">GPT Astra</span> turn it into a{" "}
            <b>pull request</b> in minutes. Free because sponsors pay for the
            compute, and their names ship with every pull request.
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
        />
      </div>
    </main>
  );
}
