import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { saveTrelloTokenFn } from "@/functions/owner.functions";

/** Trello puts the token in the URL fragment, which only the browser sees. */
export const Route = createFileRoute("/integrations/trello-callback")({
  component: TrelloCallback,
});

function TrelloCallback() {
  const save = useServerFn(saveTrelloTokenFn);
  const navigate = useNavigate();
  const [error, setError] = useState("");
  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get(
      "token",
    );
    const state = new URLSearchParams(window.location.search).get("state");
    // Remove the token from the address bar and history right away.
    window.history.replaceState(null, "", window.location.pathname);
    const saved =
      token && state
        ? save({ data: { token, state } })
        : Promise.reject(new Error("Trello did not return a token."));
    saved
      .then(({ projectId }) =>
        navigate({
          to: "/projects/$projectId",
          params: { projectId },
          search: { connected: "trello" },
        }),
      )
      .catch((cause: Error) => setError(cause.message));
  }, [save, navigate]);
  return (
    <main id="main" className="container page-main">
      <p className={error ? "feedback feedback-error" : "muted"} role="status">
        {error || "Connecting Trello…"}
      </p>
    </main>
  );
}
