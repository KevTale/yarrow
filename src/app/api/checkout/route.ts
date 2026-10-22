import { checkoutSchema } from "@/core/forms";
import { packs } from "@/core/packs";

export async function POST(request: Request) {
  const parsed = checkoutSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return Response.json(
      { error: "Choose a valid pack and matching project pool." },
      { status: 400 },
    );
  const pack = packs.find((item) => item.id === parsed.data.packId)!;
  // Deliberately never creates a Stripe session or a settled Contribution.
  // Real checkout requires Supabase auth, server-side prices and a signed webhook.
  return Response.json({
    mode: "demo",
    amountCents: pack.amountCents,
    charged: false,
    message:
      "Checkout preview ready. Stripe is not connected; no payment or compute credit was created.",
  });
}
