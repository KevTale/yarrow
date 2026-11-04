import { ArrowRight, Github } from "lucide-react";

/** First visit of a signed-in account with no project: the way in. */
export function WelcomeView() {
  return (
    <div className="welcome">
      <h1>Welcome to Yarrow</h1>
      <section className="welcome-card" aria-labelledby="welcome-builder">
        <h2 id="welcome-builder">Pull requests on your tickets</h2>
        <div className="wf" aria-hidden="true">
          <div className="wf-ticket">
            <span className="mono">#12</span> Fix the login redirect
          </div>
          <div className="wf-step">
            <span className="wf-dot writing" /> Muse Wonder writes
          </div>
          <div className="wf-step">
            <span className="wf-dot reviewing" /> Claude Opus 5.5 reviews
          </div>
          <div className="wf-pr">
            <span className="wf-dot done" /> Pull request #13
            <span className="mono">draft</span>
          </div>
        </div>
        <a className="go welcome-go" href="/connect/github">
          <Github size={16} /> Connect GitHub
          <i>
            <ArrowRight size={14} strokeWidth={2.2} />
          </i>
        </a>
      </section>
    </div>
  );
}
