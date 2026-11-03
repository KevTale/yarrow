import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Conversation, usePullPanel } from "@/components/dashboard/pull-panel";
import { LiveCaption, useLiveStage } from "@/components/live-stage";
import { stageFn } from "@/functions/stage.functions";

/**
 * A pull request's stage on its own page, as the dashboard's panel plays it
 * (src/components/live-stage.tsx), with how it came up and what each cue
 * did: started, stopped or started fresh by hand.
 */
export const Route = createFileRoute("/stage/$projectId/$key")({
  loader: ({ params }) => stageFn({ data: { ...params, action: "status" } }),
  head: () => ({ meta: [{ title: "Stage · Yarrow" }] }),
  component: StagePage,
});

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

function StagePage() {
  const { projectId, key } = Route.useParams();
  const initial = Route.useLoaderData();
  const [asking, setAsking] = useState(false);
  const [draft, setDraft] = useState("");
  const { panel, setPanel, refresh } = usePullPanel(projectId, key);
  const stage = useLiveStage({
    projectId,
    rowKey: key,
    initial,
    messages: panel?.messages.length ?? 0,
    refresh,
  });
  const { phase, problems, notes, held, talk, chapter, setScreen } = stage;
  const { control, flipControl } = stage;
  const status = stage.status ?? initial;

  const act = async (action: "open" | "close", fresh = false) => {
    setAsking(true);
    try {
      await stage.call(action, fresh);
    } finally {
      setAsking(false);
    }
  };

  const up = phase === "ready" || phase === "booting";
  return (
    <main id="main" className="container page-main stage-page">
      <header className="stage-head">
        <h1>{chapter ? chapter.title : "Stage"}</h1>
        <div className="stage-actions">
          {phase === "ready" && location.hostname.startsWith("dev.") && (
            <button
              type="button"
              className="button button-secondary button-small"
              onClick={flipControl}
            >
              {control ? "Give back" : "Take control"}
            </button>
          )}
          {phase === "ready" && held && (
            <button
              type="button"
              className="button button-primary button-small"
              onClick={() => void stage.goOn()}
            >
              Resume
            </button>
          )}
          {phase === "ready" &&
            status.live &&
            stage.timeline &&
            (stage.presenting ? (
              <button
                type="button"
                className="button button-secondary button-small"
                onClick={stage.stop}
              >
                Stop presenting
              </button>
            ) : (
              <button
                type="button"
                className="button button-primary button-small"
                onClick={() => void stage.play()}
              >
                Present
              </button>
            ))}
          {phase === "ready" &&
            (talk === "off" ? (
              <button
                type="button"
                className="button button-secondary button-small"
                onClick={() => void stage.startTalk()}
              >
                Talk
              </button>
            ) : (
              <button
                type="button"
                className="button button-secondary button-small"
                disabled={talk === "starting"}
                onClick={stage.endTalk}
              >
                Hang up
              </button>
            ))}
          {up ? (
            <button
              type="button"
              className="button button-secondary button-small"
              disabled={asking}
              onClick={() => {
                stage.stop();
                stage.endTalk();
                void act("close");
              }}
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
      <div className="stage-body">
        <div className="stage-main">
          <div className="stage-view">
            <div
              className="stage-screen"
              ref={setScreen}
              data-phase={phase}
              data-control={control || undefined}
            />
            <LiveCaption stage={stage} className="pv-caption stage-caption" />
          </div>
          {problems.length > 0 && (
            <pre className="stage-error">{problems.join("\n")}</pre>
          )}
          {notes.length > 0 && (
            <ol className="stage-events">
              {notes.map((note, i) => (
                <li key={i}>{note}</li>
              ))}
            </ol>
          )}
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
        </div>
        {panel && (
          <Conversation
            panel={panel}
            projectId={projectId}
            rowKey={key}
            draft={draft}
            onDraft={setDraft}
            onPanel={setPanel}
            onRefresh={refresh}
            onSeek={null}
            onMade={() => void refresh()}
            stage={phase === "ready"}
            turn={stage.turn}
            onAsking={stage.hold}
          />
        )}
      </div>
    </main>
  );
}
