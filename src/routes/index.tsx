import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { Github } from "lucide-react";
import { useEffect } from "react";
import { z } from "zod";
import { TrackerIcon } from "@/components/brand-icons";
import { DashboardShot, TicketShot } from "@/components/landing-shots";
import { getViewerFn } from "@/functions/viewer.functions";

export const Route = createFileRoute("/")({
  // Older links to the sponsors' board carry these.
  validateSearch: z.object({
    checkout: z.enum(["success"]).optional(),
    edit: z.boolean().optional(),
  }),
  // Signed in, the address opens the dashboard.
  beforeLoad: async ({ search }) => {
    if (search.edit !== undefined || search.checkout)
      throw redirect({ to: "/sponsors", search });
    if (await getViewerFn()) throw redirect({ to: "/dashboard" });
  },
  component: Landing,
});

function Landing() {
  const navigate = useNavigate();
  // Pull requests already out link to the board's old place on this page.
  useEffect(() => {
    if (window.location.hash === "#sponsors")
      void navigate({ to: "/sponsors", replace: true });
  }, [navigate]);
  return (
    <main id="main" className="landing">
      <section className="lp-hero container">
        <h1>
          The best ticket harness <br />
          for your team
        </h1>
        <p>
          Our agents write and build your tickets. There is no better way to
          review them.
        </p>
      </section>
      <div className="container">
        <DashboardShot
          cta={
            <a className="lp-cta" href="/connect/github?start">
              Get started
            </a>
          }
        />
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
        <b>Coding is solved.</b> Writing the right ticket and reviewing what
        agents ship are not. That is where Yarrow comes in.
      </p>
      <section className="lp-part">
        <div className="container lp-part-head">
          <h2>
            Write your tickets
            <br />
            with our agents
          </h2>
          <p>
            Bring a rough idea. Think it through with the agent, push back,
            change your mind. When it feels right the ticket is written.
          </p>
        </div>
        <div className="container">
          <TicketShot />
        </div>
      </section>
    </main>
  );
}
