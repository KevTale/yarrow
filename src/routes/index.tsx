import { createFileRoute, useRouter } from "@tanstack/react-router";
import { z } from "zod";
import { LiveBoard, SponsorBoards } from "@/components/boards";
import { useLive } from "@/components/live";
import { ShipForm } from "@/components/ship-form";
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
        <h1>Frontier AI for free</h1>
        <p className="landing-sub">
          Paste an issue: Claude Opus and GPT Astra turn it into a pull request
          in minutes. Sponsors pay for the compute, and their names ship with
          every pull request.
        </p>
        <ShipForm />
      </section>
      <div className="container landing-boards">
        <SponsorBoards
          today={boards.sponsors.today}
          all={boards.sponsors.all}
        />
        <LiveBoard live={boards.live} />
      </div>
    </main>
  );
}
