import { createFileRoute } from "@tanstack/react-router";
import { SponsorBoards } from "@/components/boards";
import { NotConfigured } from "@/components/ui";
import { getBoardsFn } from "@/functions/public.functions";

export const Route = createFileRoute("/leaderboard")({
  loader: () => getBoardsFn(),
  head: () => ({ meta: [{ title: "Leaderboard · Yarrow" }] }),
  component: LeaderboardPage,
});

function LeaderboardPage() {
  const data = Route.useLoaderData();
  return (
    <main id="main" className="container page-main landing-boards">
      {data.configured ? (
        <SponsorBoards today={data.sponsors.today} all={data.sponsors.all} />
      ) : (
        <NotConfigured />
      )}
    </main>
  );
}
