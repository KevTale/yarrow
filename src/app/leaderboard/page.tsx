import type { Metadata } from "next";
import { DemoNotice, PageHeading } from "@/components/ui";
import { Leaderboard } from "@/components/leaderboard";

export const metadata: Metadata = { title: "Leaderboard" };
export default function LeaderboardPage() {
  return (
    <main id="main" className="container page-main">
      <PageHeading
        eyebrow="THE PEOPLE BEHIND THE COMPUTE"
        title="Ranked by dollars funded."
        description="A little recognition for the people who make the work possible."
      />
      <DemoNotice />
      <Leaderboard />
    </main>
  );
}
