import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({ component: Landing });

function Landing() {
  return (
    <main id="main" className="container">
      <h1>Agent Commons</h1>
    </main>
  );
}
