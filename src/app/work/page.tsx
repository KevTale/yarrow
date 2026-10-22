import type { Metadata } from "next";
import { DemoNotice, PageHeading } from "@/components/ui";
import { WorkList } from "@/components/work-list";

export const metadata: Metadata = { title: "Explore work" };
export default async function WorkPage({
  searchParams,
}: {
  searchParams: Promise<{ pool?: string }>;
}) {
  const { pool } = await searchParams;
  return (
    <main id="main" className="container page-main">
      <PageHeading
        eyebrow="WORK LEDGER"
        title="Every outcome has a story."
        description="Issues from GitHub and Jira. A pull request or a reason to stop."
      />
      <DemoNotice />
      <WorkList
        directory
        initialPool={pool === "commons" || pool === "commercial" ? pool : "All"}
      />
    </main>
  );
}
