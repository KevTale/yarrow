import { createFileRoute } from "@tanstack/react-router";
import { ShippedBoards, SponsorBoards } from "@/components/boards";
import { ShipForm } from "@/components/ship-form";
import { getBoardsFn } from "@/functions/public.functions";

export const Route = createFileRoute("/")({
  loader: () => getBoardsFn(),
  component: Landing,
});

const empty = {
  sponsors: { today: [], all: [] },
  shipped: { today: [], projects: [], totals: { today: 0, all: 0 } },
};

function Landing() {
  const loaded = Route.useLoaderData();
  const boards = loaded.configured ? loaded : empty;
  return (
    <main id="main" className="landing">
      <section className="landing-hero container">
        <h1>Frontier AI for free</h1>
        <p className="landing-sub">
          Paste a ticket and get a pull request back, written and reviewed by
          the best AI models in the world. Sponsors pay for the compute, and
          their names ship with every pull request.
        </p>
        <ShipForm />
      </section>
      <div className="container landing-boards">
        <SponsorBoards
          today={boards.sponsors.today}
          all={boards.sponsors.all}
        />
        <ShippedBoards
          today={boards.shipped.today}
          projects={boards.shipped.projects}
          totals={boards.shipped.totals}
        />
      </div>
    </main>
  );
}
