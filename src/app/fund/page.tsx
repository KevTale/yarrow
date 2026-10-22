import type { Metadata } from "next";
import { DemoNotice, PageHeading } from "@/components/ui";
import { FundForm } from "@/components/fund-form";
import { packs } from "@/core/packs";

export const metadata: Metadata = { title: "Fund AI work" };

export default async function FundPage({
  searchParams,
}: {
  searchParams: Promise<{ pack?: string }>;
}) {
  const { pack } = await searchParams;
  const initialPack = packs.find((item) => item.id === pack)?.id ?? "builder";
  return (
    <main id="main" className="container page-main">
      <PageHeading
        eyebrow="Fund AI work"
        title="Good work starts here."
        description="One-time credit for platform API compute. No subscription, no personal keys."
      />
      <DemoNotice>
        Checkout preview · Stripe is not connected. You won’t be charged.
      </DemoNotice>
      <FundForm initialPack={initialPack} />
    </main>
  );
}
