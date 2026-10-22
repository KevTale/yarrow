import { projectSchema } from "@/core/forms";

export async function POST(request: Request) {
  const parsed = projectSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid project." },
      { status: 400 },
    );
  // The browser stores this draft locally. No claims of GitHub installation,
  // OAuth authorization, persistent project creation or queue intake.
  return Response.json({
    mode: "demo",
    project: parsed.data,
    message: "Draft validated. No repository or Jira site is connected.",
  });
}
