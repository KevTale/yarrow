import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { LiveDot, ModelName } from "../components/kit";
import { checks, issue, runSeconds } from "../story";
import { c, clamp, ease, font } from "../theme";

/** The scene's beats (local frames): the voice names each model on its phase. */
const WRITE = 8;
const REVIEW = 116;
const APPROVED = 186;
const DELIVER = 200;

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
export const Check: React.FC<{ at: number; size?: number }> = ({
  at,
  size = 34,
}) => {
  const frame = useCurrentFrame();
  const draw = interpolate(frame, [at, at + 10], [1, 0], {
    ...clamp,
    easing: ease.enter,
  });
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 34 34"
      style={{ flex: "none" }}
    >
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

/** One of the three steps: waiting, at work, or done. */
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
        fontSize: 60,
        letterSpacing: "-0.015em",
        color: c.text,
        opacity: interpolate(on, [0, 1], [0.24, 1]),
        translate: `${interpolate(on, [0, 1], [-10, 0])}px 0`,
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
 * request opens. The run's card on the left, the three steps on the right.
 * One thing moves at a time: the code while it is written, the checks
 * while it is reviewed.
 */
export const Work: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cardIn = spring({
    frame,
    fps,
    config: { damping: 200 },
    durationInFrames: 18,
  });
  const writing = frame < REVIEW;
  const elapsed = interpolate(
    frame,
    [WRITE, DELIVER + 20],
    [0, runSeconds],
    clamp,
  );
  const lines = interpolate(
    frame,
    [WRITE + 8, REVIEW - 14],
    [0, CODE.length],
    clamp,
  );
  const swap = interpolate(frame, [REVIEW, REVIEW + 12], [0, 1], {
    ...clamp,
    easing: ease.inOut,
  });
  // The status's shimmer: a light band crossing the verb every second.
  const shimmer = ((frame % 36) / 36) * 300 - 100;

  return (
    <AbsoluteFill
      style={{ background: c.bg, fontFamily: font.sans, color: c.text }}
    >
      {/* The run's card. */}
      <div
        style={{
          position: "absolute",
          left: 110,
          top: 190,
          width: 900,
          height: 700,
          boxSizing: "border-box",
          background: c.surface,
          border: `1px solid ${c.line}`,
          borderRadius: 30,
          boxShadow: "0 40px 90px #00000080",
          padding: 44,
          opacity: cardIn,
          translate: `${interpolate(cardIn, [0, 1], [-60, 0])}px 0`,
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
            fontSize: 24,
            color: c.muted,
          }}
        >
          <span>
            <span style={{ color: c.secondary }}>{issue.repo}</span> · #
            {issue.number}
          </span>
          <span
            style={{ fontFamily: font.mono, fontSize: 25, color: c.secondary }}
          >
            {clock(elapsed)}
          </span>
        </div>
        <div style={{ fontSize: 42, fontWeight: 600, lineHeight: 1.2 }}>
          {issue.title}
        </div>
        <div
          style={{
            alignSelf: "flex-start",
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "9px 22px 9px 18px",
            borderRadius: 99,
            border: `1px solid ${c.line}`,
            background: c.elevated,
            fontSize: 24,
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
              : frame < DELIVER
                ? "is reviewing"
                : "Opening the PR"}
          </span>
        </div>

        <div style={{ position: "relative", flex: 1 }}>
          {/* Writing: the code arriving, line by line. */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              opacity: 1 - swap,
              translate: `0 ${-30 * swap}px`,
              background: "#0e0f12",
              border: `1px solid ${c.lineSoft}`,
              borderRadius: 18,
              padding: "22px 0",
              fontFamily: font.mono,
              fontSize: 22,
              lineHeight: 1.62,
            }}
          >
            {CODE.map((line, i) => {
              const shown = Math.max(0, Math.min(1, lines - i));
              if (shown <= 0)
                return <div key={i} style={{ height: "1.62em" }} />;
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
                      width: 50,
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

          {/* Reviewing: the checks, then the verdict. */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              opacity: swap,
              translate: `0 ${30 * (1 - swap)}px`,
              display: "grid",
              alignContent: "start",
              gap: 28,
              paddingTop: 12,
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
                    fontSize: 33,
                    opacity: t,
                  }}
                >
                  <Check at={at} />
                  <span>{check}</span>
                </div>
              );
            })}
            <div
              style={{
                marginTop: 16,
                justifySelf: "start",
                padding: "13px 28px",
                borderRadius: 99,
                background: "#5ccb9529",
                color: c.green,
                fontSize: 33,
                fontWeight: 600,
                opacity: interpolate(
                  frame,
                  [APPROVED, APPROVED + 5],
                  [0, 1],
                  clamp,
                ),
                scale: `${spring({ frame: frame - APPROVED, fps, config: { damping: 11, stiffness: 170 } })}`,
              }}
            >
              Approved
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: 1130,
          top: 360,
          display: "grid",
          gap: 50,
        }}
      >
        <Step from={WRITE} to={REVIEW}>
          <span>
            <ModelName model="claude" sheenAt={WRITE + 6}>
              Claude Opus
            </ModelName>{" "}
            writes
          </span>
        </Step>
        <Step from={REVIEW} to={APPROVED}>
          <span>
            <ModelName model="gpt" sheenAt={REVIEW + 6}>
              GPT Astra
            </ModelName>{" "}
            reviews
          </span>
        </Step>
        <Step from={DELIVER} to={9999}>
          <span>The PR opens</span>
        </Step>
      </div>
    </AbsoluteFill>
  );
};
