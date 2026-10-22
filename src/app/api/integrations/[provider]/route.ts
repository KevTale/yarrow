export async function POST(
  _request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  if (!["github", "jira"].includes(provider))
    return Response.json({ error: "Unknown integration." }, { status: 404 });
  return Response.json(
    {
      mode: "stub",
      error: `${provider === "github" ? "GitHub App" : "Jira OAuth"} is not connected in this preview. You can still save a local project draft.`,
    },
    { status: 501 },
  );
}
