export async function POST(
  _request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  if (!["stripe", "github", "jira"].includes(provider))
    return Response.json({ error: "Unknown webhook." }, { status: 404 });
  // Fail closed until raw-body signature verification, idempotency, auth and
  // event handling are implemented. Never trust a checkout redirect as payment.
  return Response.json(
    {
      error: "Webhook not implemented; no events accepted or credit issued.",
      provider,
    },
    { status: 501 },
  );
}
