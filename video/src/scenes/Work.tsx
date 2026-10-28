import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { LiveDot, ModelName } from "../components/kit";
import { checks, files, issue, runSeconds } from "../story";
import { c, clamp, ease, font } from "../theme";

/** The scene's beats, in frames. */
const WRITE = 14;
const REVIEW = 150;
const APPROVED = 222;
const DELIVER = 236;

const CODE = [
  'export type Theme = "light" | "dark" | "system";',
  "",
  "export function applyTheme(theme: Theme) {",
  "  const dark =",
  '    theme === "dark" ||',
  '    (theme === "system" && prefersDark());',
  "  document.documentElement.dataset.theme =",
  '    dark ? "dark" : "light";',
  '  localStorage.setItem("theme", theme);',
  "}",
];

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

/** A check mark in a green disc, drawn in as it lands. */
const Check: React.FC<{ at: number }> = ({ at }) => {
  const frame = useCurrentFrame();
  const draw = interpolate(frame, [at, at + 10], [1, 0], {
    ...clamp,
    easing: ease.enter,
  });
  return (
    <svg width={34} height={34} viewBox="0 0 34 34" style={{ flex: "none" }}>
      <circle cx={17} cy={17} r={16} fill="#5ccb9524" />
      <path
        d="M10 17.5l4.6 4.6L24 12.6"
        stroke={c.green}
        strokeWidth={3}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={24}
        strokeDashoffset={24 * draw}
      />
    </svg>
  );
};

/** One of the three steps on the left: waiting, at work, or done. */
const Step: React.FC<{
  from: number;
  to: number;
  children: React.ReactNode;
}> = ({ from, to, children }) => {
  const frame = useCurrentFrame();
  const on = interpolate(frame, [from, from + 10], [0, 1], clamp);
  const done = frame >= to;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 22,
        fontFamily: font.display,
        fontWeight: 500,
        fontSize: 58,
        letterSpacing: "-0.015em",
        color: c.text,
        opacity: interpolate(on, [0, 1], [0.28, 1]),
      }}
    >
      <span style={{ width: 34, display: "grid", placeItems: "center" }}>
        {done ? (
          <Check at={to} />
        ) : frame >= from ? (
          <LiveDot size={14} />
        ) : (
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              background: c.line,
            }}
          />
        )}
      </span>
      {children}
    </div>
  );
};

/**
 * The run: Claude Opus writes the change, GPT Astra reviews it, the pull
 * request opens. Steps on the left, the run's own card on the right.
 */
export const Work: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cardIn = spring({
    frame,
    fps,
    config: { damping: 200 },
    durationInFrames: 24,
  });
  const reviewing = frame >= REVIEW && frame < DELIVER;
  const writing = frame < REVIEW;
  const elapsed = interpolate(frame, [WRITE, 250], [0, runSeconds], clamp);
  const lines = interpolate(
    frame,
    [WRITE + 10, REVIEW - 14],
    [0, CODE.length],
    clamp,
  );
  const codeAway = interpolate(frame, [REVIEW, REVIEW + 14], [0, 1], {
    ...clamp,
    easing: ease.inOut,
  });
  // The status's shimmer: a light band crossing the verb every second.
  const shimmer = ((frame % 36) / 36) * 300 - 100;

  return (
    <AbsoluteFill
      style={{ background: c.bg, fontFamily: font.sans, color: c.text }}
    >
      <div
        style={{
          position: "absolute",
          left: 130,
          top: 330,
          display: "grid",
          gap: 44,
        }}
      >
        <Step from={WRITE} to={REVIEW}>
          <span>
            <ModelName model="claude" sheenAt={WRITE + 6}>
              Claude Opus
            </ModelName>{" "}
            writes it
          </span>
        </Step>
        <Step from={REVIEW} to={APPROVED}>
          <span>
            <ModelName model="gpt" sheenAt={REVIEW + 6}>
              GPT Astra
            </ModelName>{" "}
            reviews it
          </span>
        </Step>
        <Step from={DELIVER} to={9999}>
          <span>The pull request opens</span>
        </Step>
      </div>

      {/* The run's card. */}
      <div
        style={{
          position: "absolute",
          left: 1000,
          top: 170,
          width: 800,
          height: 740,
          boxSizing: "border-box",
          background: c.surface,
          border: `1px solid ${c.line}`,
          borderRadius: 30,
          boxShadow: "0 40px 90px #00000080",
          padding: 40,
          opacity: cardIn,
          translate: `${interpolate(cardIn, [0, 1], [80, 0])}px 0`,
          display: "flex",
          flexDirection: "column",
          gap: 26,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: 23,
            color: c.muted,
          }}
        >
          <span>
            <span style={{ color: c.secondary }}>{issue.repo}</span> · #
            {issue.number}
          </span>
          <span
            style={{ fontFamily: font.mono, fontSize: 24, color: c.secondary }}
          >
            {clock(elapsed)}
          </span>
        </div>
        <div style={{ fontSize: 38, fontWeight: 600, lineHeight: 1.2 }}>
          {issue.title}
        </div>
        <div
          style={{
            alignSelf: "flex-start",
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "8px 20px 8px 16px",
            borderRadius: 99,
            border: `1px solid ${c.line}`,
            background: c.elevated,
            fontSize: 22,
            color: c.secondary,
          }}
        >
          <LiveDot size={9} />
          {frame < DELIVER && (
            <ModelName
              model={writing ? "claude" : "gpt"}
              sheenAt={writing ? WRITE + 6 : REVIEW + 6}
            >
              {writing ? "Claude Opus" : "GPT Astra"}
            </ModelName>
          )}
          <span
            style={{
              backgroundImage: `linear-gradient(100deg, ${c.secondary} 0 40%, #fff 50%, ${c.secondary} 60% 100%)`,
              backgroundPosition: `${shimmer}% 0`,
              backgroundSize: "250% 100%",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            {writing
              ? "is writing"
              : reviewing
                ? "is reviewing"
                : "Opening the PR"}
          </span>
        </div>

        <div style={{ position: "relative", flex: 1 }}>
          {/* Writing: the files it touches, then the code arriving. */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              opacity: 1 - codeAway,
              translate: `0 ${-30 * codeAway}px`,
            }}
          >
            <div style={{ display: "grid", gap: 10, marginBottom: 24 }}>
              {files.map((file, i) => {
                const t = interpolate(
                  frame,
                  [WRITE + 8 + i * 22, WRITE + 20 + i * 22],
                  [0, 1],
                  clamp,
                );
                return (
                  <div
                    key={file.path}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontFamily: font.mono,
                      fontSize: 22,
                      opacity: t,
                      translate: `${(1 - t) * 20}px 0`,
                    }}
                  >
                    <span style={{ color: c.secondary }}>{file.path}</span>
                    <span>
                      <span style={{ color: c.green }}>+{file.added}</span>
                      {file.removed > 0 && (
                        <span style={{ color: c.red, marginLeft: 12 }}>
                          −{file.removed}
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
            <div
              style={{
                background: "#0e0f12",
                border: `1px solid ${c.lineSoft}`,
                borderRadius: 18,
                padding: "20px 0",
                fontFamily: font.mono,
                fontSize: 19.5,
                lineHeight: 1.6,
              }}
            >
              {CODE.map((line, i) => {
                const shown = Math.max(0, Math.min(1, lines - i));
                if (shown <= 0)
                  return <div key={i} style={{ height: "1.6em" }} />;
                return (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      background: "#5ccb950d",
                      whiteSpace: "pre",
                    }}
                  >
                    <span
                      style={{
                        width: 44,
                        textAlign: "center",
                        color: c.green,
                        opacity: 0.8,
                      }}
                    >
                      +
                    </span>
                    <span style={{ color: "#d6d9de" }}>
                      {line.slice(0, Math.ceil(line.length * shown))}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Reviewing: the checks, then the verdict. */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              opacity: codeAway,
              translate: `0 ${30 * (1 - codeAway)}px`,
              display: "grid",
              alignContent: "start",
              gap: 26,
              paddingTop: 10,
            }}
          >
            {checks.map((check, i) => {
              const at = REVIEW + 18 + i * 18;
              const t = interpolate(frame, [at, at + 10], [0, 1], clamp);
              return (
                <div
                  key={check}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 18,
                    fontSize: 30,
                    opacity: t,
                  }}
                >
                  <Check at={at} />
                  <span style={{ color: c.text }}>{check}</span>
                </div>
              );
            })}
            <div
              style={{
                marginTop: 18,
                alignSelf: "start",
                justifySelf: "start",
                padding: "12px 26px",
                borderRadius: 99,
                background: "#5ccb9529",
                color: c.green,
                fontSize: 30,
                fontWeight: 600,
                opacity: interpolate(
                  frame,
                  [APPROVED, APPROVED + 6],
                  [0, 1],
                  clamp,
                ),
                scale: `${spring({ frame: frame - APPROVED, fps, config: { damping: 11, stiffness: 160 } })}`,
              }}
            >
              Approved
            </div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
