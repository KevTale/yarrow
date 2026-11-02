import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import type { StageStatus } from "@/core/stage";
import { stageFn } from "@/functions/stage.functions";

/**
 * A pull request's stage, its app live on Yarrow's desktop (workers/stage.ts).
 * Not linked from the dashboard yet: the first step of the live review,
 * to see it run and time how long it takes to come up.
 */
export const Route = createFileRoute("/stage/$projectId/$key")({
  loader: ({ params }) => stageFn({ data: { ...params, action: "status" } }),
  head: () => ({ meta: [{ title: "Stage · Yarrow" }] }),
  component: StagePage,
});

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

function StagePage() {
  const { projectId, key } = Route.useParams();
  const [status, setStatus] = useState<StageStatus>(Route.useLoaderData());
  const [asking, setAsking] = useState(false);
  const screen = useRef<HTMLDivElement>(null);

  const call = useCallback(
    (action: "open" | "status" | "close", fresh = false) =>
      stageFn({ data: { projectId, key, action, fresh } }).then(setStatus),
    [projectId, key],
  );

  // Looked at every second while it comes up.
  const phase = status.phase;
  useEffect(() => {
    if (phase !== "booting") return;
    const timer = setInterval(() => void call("status"), 1000);
    return () => clearInterval(timer);
  }, [phase, call]);

  // The screen, once up: VNC over the page's WebSocket, watched only.
  useEffect(() => {
    if (phase !== "ready" || !screen.current) return;
    let rfb: { disconnect(): void } | null = null;
    let gone = false;
    void import("@novnc/novnc").then(({ default: RFB }) => {
      if (gone || !screen.current) return;
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const client = new RFB(
        screen.current,
        `${protocol}//${location.host}/stage-screen/${projectId}/${key}`,
        { wsProtocols: ["binary"] },
      );
      client.viewOnly = true;
      client.scaleViewport = true;
      client.background = "transparent";
      client.addEventListener("disconnect", () => {
        if (!gone) void call("status");
      });
      rfb = client;
    });
    return () => {
      gone = true;
      rfb?.disconnect();
    };
  }, [phase, projectId, key, call]);

  const act = async (action: "open" | "close", fresh = false) => {
    setAsking(true);
    try {
      await call(action, fresh);
    } finally {
      setAsking(false);
    }
  };

  const up = phase === "ready" || phase === "booting";
  return (
    <main id="main" className="container page-main stage-page">
      <header className="stage-head">
        <h1>Stage</h1>
        <div className="stage-actions">
          {up ? (
            <button
              type="button"
              className="button button-secondary button-small"
              disabled={asking}
              onClick={() => void act("close")}
            >
              Stop
            </button>
          ) : (
            <>
              <button
                type="button"
                className="button button-primary button-small"
                disabled={asking}
                onClick={() => void act("open")}
              >
                Start
              </button>
              <button
                type="button"
                className="button button-secondary button-small"
                disabled={asking}
                onClick={() => void act("open", true)}
              >
                Start fresh
              </button>
            </>
          )}
        </div>
      </header>
      <div className="stage-screen" ref={screen} data-phase={phase ?? "off"} />
      {status.events.length > 0 && (
        <ol className="stage-events">
          {status.events.map((event, i) => (
            <li key={i}>
              <span>{seconds(event.ms)}</span>
              {event.label}
            </li>
          ))}
          {status.warm && <li className="stage-warm">From the snapshot</li>}
        </ol>
      )}
      {status.error && <pre className="stage-error">{status.error}</pre>}
    </main>
  );
}
