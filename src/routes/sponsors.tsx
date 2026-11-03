import {
  createFileRoute,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { z } from "zod";
import { useLive } from "@/components/live";
import { SponsorBoard } from "@/components/sponsor-board";
import { TicketStack } from "@/components/ticket-stack";
import { PULL_REQUEST_COST_CENTS } from "@/core/pricing";
import { getBoardsFn } from "@/functions/public.functions";

export const Route = createFileRoute("/sponsors")({
  // Guests come back here from Stripe Checkout.
  // `edit`: from the dashboard, the viewer's row opens as its form.
  validateSearch: z.object({
    checkout: z.enum(["success"]).optional(),
    edit: z.boolean().optional(),
  }),
  head: () => ({ meta: [{ title: "Sponsors · Yarrow" }] }),
  loader: () => getBoardsFn(),
  component: Sponsors,
});

const empty = {
  sponsors: { today: [], all: [] },
  live: [],
  totals: { inProgress: 0, merged: 0, mergedToday: 0 },
  pullRequestCents: PULL_REQUEST_COST_CENTS,
  you: null,
};

function Sponsors() {
  const loaded = Route.useLoaderData();
  const boards = loaded.configured ? loaded : empty;
  const { checkout, edit } = Route.useSearch();
  const router = useRouter();
  const navigate = useNavigate();
  // The row opened once: a refresh does not open it again.
  useEffect(() => {
    if (edit)
      void navigate({
        to: "/sponsors",
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
      <div className="container landing-boards">
        <SponsorBoard
          today={boards.sponsors.today}
          all={boards.sponsors.all}
          you={boards.you}
          pullRequestCents={boards.pullRequestCents}
          startEditing={edit === true}
        />
      </div>
      <div className="container sponsors-live">
        <TicketStack
          live={boards.live}
          totals={boards.totals}
          sponsors={boards.sponsors.all}
        />
      </div>
    </main>
  );
}
