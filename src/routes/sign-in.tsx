import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { SignInPrompt } from "@/components/email-sign-in";

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
    <SignInPrompt
      next={search.next?.startsWith("/") ? search.next : "/dashboard"}
      error={search.error}
    />
  );
}
