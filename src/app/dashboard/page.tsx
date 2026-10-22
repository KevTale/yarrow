import Link from "next/link";
import type { Metadata } from "next";
import { ArrowUpRight } from "lucide-react";
import { DemoNotice, PageHeading } from "@/components/ui";
import { Dashboard } from "@/components/dashboard";

export const metadata: Metadata = { title: "My activity" };
export default function DashboardPage() {
  return (
    <main id="main" className="container page-main">
      <PageHeading
        eyebrow="MY ACTIVITY"
        title="Your compute. In motion."
        description="From a contribution to a line of code. Here’s the whole trail."
      >
        <Link href="/fund" className="button button-primary">
          Fund more work <ArrowUpRight size={15} />
        </Link>
      </PageHeading>
      <DemoNotice>
        Your demo workspace · projects you save stay in this browser.
      </DemoNotice>
      <Dashboard />
    </main>
  );
}
