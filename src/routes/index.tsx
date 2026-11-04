import { createFileRoute, redirect } from "@tanstack/react-router";
import { Github } from "lucide-react";
import { TrackerIcon } from "@/components/brand-icons";
import { DashboardShot, TicketSteps } from "@/components/landing-shots";
import { getViewerFn } from "@/functions/viewer.functions";

export const Route = createFileRoute("/")({
  // Signed in, the address opens the dashboard.
  beforeLoad: async () => {
    if (await getViewerFn()) throw redirect({ to: "/dashboard" });
  },
  component: Landing,
});

const getStarted = (
  <a className="lp-cta" href="/connect/github?start">
    Get started
  </a>
);

function Landing() {
  return (
    <main id="main" className="landing">
      <section className="lp-hero container">
        <h1>
          The best ticket harness <br />
          for your team
        </h1>
        <p>
          Coding is solved. Writing the right ticket and reviewing what agents
          ship are not. This is where Yarrow comes in.
        </p>
      </section>
      <div className="lp-stage">
        <div className="container">
          <DashboardShot cta={getStarted} />
        </div>
      </div>
      <section className="container lp-sources" aria-label="Works with">
        <ul>
          <li>
            <Github size={22} /> GitHub
          </li>
          <li>
            <TrackerIcon tracker="jira" size={20} /> Jira
          </li>
          <li>
            <TrackerIcon tracker="linear" size={20} /> Linear
          </li>
          <li>
            <TrackerIcon tracker="trello" size={20} /> Trello
          </li>
        </ul>
        <p className="mono">Import your tickets from your favorite tool</p>
      </section>
      <p className="container lp-statement">
        <b>Yarrow helps you shape your idea into a clear ticket</b> and, once it
        is built, walks you through a live demo and answers your questions.
      </p>
      <TicketSteps cta={getStarted} />
    </main>
  );
}
