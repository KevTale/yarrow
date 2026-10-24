import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight, Award } from "lucide-react";
import { money } from "@/core/packs";
import { getLeaderboardFn } from "@/functions/public.functions";
import {
  EmptyState,
  initials,
  NotConfigured,
  PageHeading,
} from "@/components/ui";

export const Route = createFileRoute("/leaderboard")({
  loader: () => getLeaderboardFn(),
  head: () => ({ meta: [{ title: "Leaderboard · Yarrow" }] }),
  component: LeaderboardPage,
});

function LeaderboardPage() {
  const data = Route.useLoaderData();
  return (
    <main id="main" className="container page-main">
      <PageHeading
        eyebrow="LEADERBOARD"
        title="The sponsors behind the work."
        description="Ranked by compute actually consumed on builders' tickets. Credit paid but not yet used shows as committed."
      >
        <Link to="/fund" className="button button-primary">
          Take a spot <ArrowUpRight size={16} />
        </Link>
      </PageHeading>
      {!data.configured ? (
        <NotConfigured />
      ) : data.leaders.length === 0 ? (
        <EmptyState title="The board is open">
          The first sponsor takes the top spot.
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Rank</th>
                <th scope="col">Sponsor</th>
                <th scope="col" className="right">
                  Consumed
                </th>
                <th scope="col" className="right">
                  Committed
                </th>
              </tr>
            </thead>
            <tbody>
              {data.leaders.map((leader, i) => (
                <tr
                  key={`${leader.name}-${i}`}
                  className={i === 0 ? "pinned-row" : undefined}
                >
                  <td className={`mono rank rank-${i + 1}`}>
                    {String(i + 1).padStart(2, "0")}
                  </td>
                  <td>
                    <span className="table-person">
                      <span className="avatar">
                        {initials(leader.name ?? "?")}
                      </span>
                      {leader.name}
                      {leader.foundingSponsor && (
                        <span className="badge" title="Founding sponsor">
                          <Award size={12} /> Founding
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="right mono">
                    {money(leader.consumedCents, false)}
                  </td>
                  <td className="right mono muted">
                    {money(Math.max(0, leader.committedCents), false)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="small muted section-note">
        Promo credits, refunds and anonymous sponsors are not ranked. Merged PRs
        are tracked separately on each project.
      </p>
    </main>
  );
}
