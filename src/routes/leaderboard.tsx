import { createFileRoute, redirect } from "@tanstack/react-router";

/** The boards live on the landing; old links land on the section. */
export const Route = createFileRoute("/leaderboard")({
  beforeLoad: () => {
    throw redirect({ to: "/", hash: "sponsors" });
  },
});
