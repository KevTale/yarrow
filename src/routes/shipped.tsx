import { createFileRoute } from "@tanstack/react-router";
import { ShippedBoards } from "@/components/boards";
import { NotConfigured } from "@/components/ui";
import { getBoardsFn } from "@/functions/public.functions";

export const Route = createFileRoute("/shipped")({
  loader: () => getBoardsFn(),
  head: () => ({ meta: [{ title: "Shipped · Yarrow" }] }),
  component: ShippedPage,
});

function ShippedPage() {
  const data = Route.useLoaderData();
  return (
    <main id="main" className="container page-main landing-boards">
      {data.configured ? (
        <ShippedBoards
          today={data.shipped.today}
          projects={data.shipped.projects}
          totals={data.shipped.totals}
        />
      ) : (
        <NotConfigured />
      )}
    </main>
  );
}
