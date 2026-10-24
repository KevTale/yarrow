import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { SignInPrompt } from "@/components/ui";

export const Route = createFileRoute("/sign-in")({
  validateSearch: z.object({
    next: z.string().optional(),
    error: z.string().optional(),
  }),
  head: () => ({ meta: [{ title: "Sign in · Yarrow" }] }),
  component: SignIn,
});

function SignIn() {
  const search = Route.useSearch();
  return (
    <main id="main" className="container page-main">
      {search.error && (
        <p className="feedback feedback-error" role="alert">
          {search.error}
        </p>
      )}
      <SignInPrompt
        next={search.next?.startsWith("/") ? search.next : "/dashboard"}
        reason="Sponsor the work, or bring your backlog."
      />
    </main>
  );
}
