import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Cursor, Logo } from "../components/kit";
import { issue, sponsor } from "../story";
import { c, clamp, ease, font } from "../theme";
import { Check } from "./Work";

/** The scene's beats (local frames). */
export const CHEVRON = 28;
const HOVER_MERGE = 122;
export const MERGE_CLICK = 140;
const MERGED = MERGE_CLICK + 14;
export const GITHUB = 192;

/** The opened row's places on the frame. */
const ROW = { top: 250, height: 88 };
const CHEVRON_AT = { x: 152, y: ROW.top + ROW.height / 2 };
const ASIDE = { left: 1270, width: 470 };
const MERGE_AT = { x: ASIDE.left + ASIDE.width / 2 + 40, y: 420 };
const GITHUB_AT = { x: ASIDE.left + 120, y: 546 };

const Icon: React.FC<{
  d: string[];
  size: number;
  color: string;
  style?: React.CSSProperties;
}> = ({ d, size, color, style }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ flex: "none", ...style }}
  >
    {d.map((path) => (
      <path key={path} d={path} />
    ))}
  </svg>
);
/** The app's spinner: a ring with one bright quarter, turning. */
const Spinner: React.FC<{ color: string }> = ({ color }) => {
  const frame = useCurrentFrame();
  return (
    <svg
      width={26}
      height={26}
      viewBox="0 0 24 24"
      fill="none"
      style={{ flex: "none", rotate: `${frame * 24}deg` }}
    >
      <circle
        cx={12}
        cy={12}
        r={9}
        stroke={color}
        strokeOpacity={0.25}
        strokeWidth={3}
      />
      <path
        d="M12 3a9 9 0 0 1 9 9"
        stroke={color}
        strokeWidth={3}
        strokeLinecap="round"
      />
    </svg>
  );
};

const merge = [
  "M6 21V9a9 9 0 0 0 9 9",
  "M18 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z",
  "M6 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z",
];
const arrowUpRight = ["M7 7h10v10", "M7 17 17 7"];
const fileDiff = [
  "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z",
  "M9 10h6",
  "M12 13V7",
  "M9 17h6",
];

/**
 * The builder's dashboard: the ticket's row opens on the pull request,
 * summed up and reviewed; one click merges it, then the pointer goes to
 * GitHub. The header stays put while the page leans in.
 */
export const Dashboard: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({
    frame,
    fps,
    config: { damping: 200 },
    durationInFrames: 14,
  });
  const open = interpolate(frame, [CHEVRON + 2, CHEVRON + 20], [0, 1], {
    ...clamp,
    easing: ease.enter,
  });
  const reveal = (at: number) =>
    interpolate(frame, [at, at + 10], [0, 1], clamp);
  const onMerge = interpolate(
    frame,
    [HOVER_MERGE, HOVER_MERGE + 8, MERGE_CLICK, MERGE_CLICK + 4],
    [0, 1, 1, 0],
    clamp,
  );
  const pulse = onMerge * (0.5 + 0.5 * Math.sin((frame - HOVER_MERGE) / 5));
  const merging = frame >= MERGE_CLICK && frame < MERGED;
  const merged = frame >= MERGED;
  const mergedIn = spring({
    frame: frame - MERGED,
    fps,
    config: { damping: 12, stiffness: 180 },
  });
  const onGithub = interpolate(frame, [GITHUB - 16, GITHUB - 8], [0, 1], clamp);
  // The camera leans toward the decisions while the voice names them.
  const lean = interpolate(frame, [80, 130], [0, 1], {
    ...clamp,
    easing: ease.inOut,
  });

  return (
    <AbsoluteFill
      style={{ background: c.bg, fontFamily: font.sans, color: c.text }}
    >
      <AbsoluteFill style={{ opacity: enter, zIndex: 1 }}>
        {/* The app's header. */}
        <div
          style={{
            position: "absolute",
            inset: "0 0 auto 0",
            height: 84,
            borderBottom: `1px solid ${c.line}`,
            background: c.bg,
          }}
        >
          <Img
            src={staticFile("yarrow-logo-on-dark.svg")}
            style={{ position: "absolute", left: 60, top: 24, height: 38 }}
          />
          <span
            style={{
              position: "absolute",
              right: 60,
              top: 22,
              width: 40,
              height: 40,
              borderRadius: "50%",
              background: "linear-gradient(135deg, #3a3e46, #22252b)",
            }}
          />
        </div>
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          scale: `${interpolate(lean, [0, 1], [1, 1.06])}`,
          transformOrigin: "960px 600px",
          opacity: enter,
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 120,
            top: 120,
            fontFamily: font.display,
            fontWeight: 500,
            fontSize: 44,
            translate: `0 ${(1 - enter) * 16}px`,
          }}
        >
          {issue.repo}
        </div>

        {/* The table's head and the ticket's row. */}
        <div
          style={{
            position: "absolute",
            left: 120,
            right: 120,
            top: 204,
            display: "grid",
            gridTemplateColumns: "64px 1fr 300px 300px 120px",
            fontSize: 19,
            color: c.muted,
            paddingBottom: 12,
            borderBottom: `1px solid ${c.line}`,
          }}
        >
          <span />
          <span>Ticket</span>
          <span>Status</span>
          <span>Paid by</span>
          <span style={{ textAlign: "right" }}>Updated</span>
        </div>
        <div
          style={{
            position: "absolute",
            left: 120,
            right: 120,
            top: ROW.top,
            height: ROW.height,
            display: "grid",
            gridTemplateColumns: "64px 1fr 300px 300px 120px",
            alignItems: "center",
            fontSize: 25,
            background: open > 0 ? c.surface : "transparent",
            borderRadius: "16px 16px 0 0",
          }}
        >
          <span style={{ display: "grid", placeItems: "center" }}>
            <Icon
              d={["m9 18 6-6-6-6"]}
              size={26}
              color={c.secondary}
              style={{ rotate: `${90 * open}deg` }}
            />
          </span>
          <span style={{ display: "flex", gap: 14, alignItems: "baseline" }}>
            <span
              style={{ fontFamily: font.mono, fontSize: 21, color: c.muted }}
            >
              #{issue.number}
            </span>
            <span style={{ fontWeight: 500 }}>{issue.title}</span>
          </span>
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              color: c.green,
              fontSize: 22,
            }}
          >
            <span
              style={{
                width: 9,
                height: 9,
                boxSizing: "border-box",
                borderRadius: "50%",
                border: `1.5px solid ${c.green}`,
                background: merged ? c.green : "transparent",
              }}
            />
            PR #{issue.pr} {merged ? "merged" : "open"}
          </span>
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              fontSize: 22,
            }}
          >
            <Logo src={sponsor.logo} size={30} radius={8} />
            {sponsor.name}
          </span>
          <span
            style={{
              textAlign: "right",
              fontFamily: font.mono,
              fontSize: 19,
              color: c.muted,
            }}
          >
            1m
          </span>
        </div>

        {/* The opened row: what was done and reviewed, then the decisions. */}
        <div
          style={{
            position: "absolute",
            left: 120,
            right: 120,
            top: ROW.top + ROW.height,
            height: 640,
            background: c.surface,
            borderRadius: "0 0 16px 16px",
            clipPath: `inset(0 0 ${100 - 100 * open}% 0)`,
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 84,
              top: 30,
              width: 960,
              display: "grid",
              gap: 40,
            }}
          >
            <section
              style={{
                display: "grid",
                gap: 16,
                opacity: reveal(CHEVRON + 10),
              }}
            >
              <h3
                style={{
                  margin: 0,
                  fontFamily: font.display,
                  fontWeight: 500,
                  fontSize: 31,
                  display: "flex",
                  gap: 14,
                  alignItems: "baseline",
                }}
              >
                Implementation{" "}
                <span
                  style={{
                    fontFamily: font.sans,
                    fontWeight: 400,
                    fontSize: 21,
                    color: c.muted,
                  }}
                >
                  by Claude Opus 5.5
                </span>
              </h3>
              <p
                style={{
                  margin: 0,
                  fontSize: 24,
                  lineHeight: 1.6,
                  color: c.secondary,
                }}
              >
                Settings get a Theme switch: Light, Dark or System. The choice
                is saved and applied before the first paint, so the page never
                flashes.
              </p>
              <div
                style={{
                  display: "grid",
                  gap: 10,
                  fontSize: 22,
                  color: c.secondary,
                }}
              >
                <span
                  style={{ display: "flex", alignItems: "center", gap: 12 }}
                >
                  <Check at={CHEVRON + 16} size={28} /> npm test: 14 of 14 pass
                </span>
                <span
                  style={{ display: "flex", alignItems: "center", gap: 12 }}
                >
                  <Check at={CHEVRON + 22} size={28} /> A new test covers each
                  choice
                </span>
              </div>
            </section>
            <section
              style={{
                display: "grid",
                gap: 16,
                opacity: reveal(CHEVRON + 22),
              }}
            >
              <h3
                style={{
                  margin: 0,
                  fontFamily: font.display,
                  fontWeight: 500,
                  fontSize: 31,
                  display: "flex",
                  gap: 14,
                  alignItems: "center",
                }}
              >
                Review{" "}
                <span
                  style={{
                    fontFamily: font.sans,
                    fontWeight: 400,
                    fontSize: 21,
                    color: c.muted,
                  }}
                >
                  by GPT Astra
                </span>
                <em
                  style={{
                    fontStyle: "normal",
                    fontFamily: font.sans,
                    fontSize: 19,
                    fontWeight: 500,
                    color: c.green,
                    border: "1px solid #5ccb9550",
                    background: "#5ccb9512",
                    borderRadius: 99,
                    padding: "3px 14px",
                  }}
                >
                  Approved
                </em>
              </h3>
              <p
                style={{
                  margin: 0,
                  fontSize: 24,
                  lineHeight: 1.6,
                  color: c.secondary,
                }}
              >
                Does what the issue asks, nothing else. Tests cover each choice.
              </p>
            </section>
          </div>

          <aside
            style={{
              position: "absolute",
              left: ASIDE.left - 120,
              top: 30,
              width: ASIDE.width,
              display: "grid",
              gap: 14,
              opacity: reveal(CHEVRON + 14),
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 12,
                height: 66,
                boxSizing: "border-box",
                borderRadius: 14,
                border: merged ? "1px solid #5ccb9550" : "none",
                background: merged ? "#5ccb9512" : c.green,
                color: merged ? c.green : "#0c1a13",
                fontSize: 25,
                fontWeight: merged ? 500 : 600,
                scale: merged
                  ? `${interpolate(mergedIn, [0, 1], [0.94, 1])}`
                  : `${1 + 0.03 * onMerge - (merging ? 0.02 : 0)}`,
                boxShadow: `0 0 0 ${4 + 6 * pulse}px rgba(92, 203, 149, ${0.18 * onMerge}), 0 12px 40px rgba(92, 203, 149, ${0.3 * onMerge})`,
              }}
            >
              {merging ? (
                <Spinner color="#0c1a13" />
              ) : (
                <Icon
                  d={merge}
                  size={26}
                  color={merged ? c.green : "#0c1a13"}
                />
              )}
              {merged ? "Merged" : "Merge"}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                height: 62,
                padding: "0 20px",
                borderRadius: 14,
                border: `1px solid ${c.line}`,
                background: c.bg,
                fontSize: 23,
                fontWeight: 500,
              }}
            >
              <Icon d={fileDiff} size={24} color={c.secondary} /> Changes
              <span
                style={{
                  marginLeft: "auto",
                  fontFamily: font.mono,
                  fontSize: 20,
                }}
              >
                <span style={{ color: c.green }}>+72</span>{" "}
                <span style={{ color: c.red }}>−2</span>
              </span>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 4px",
                fontSize: 22,
                color: onGithub > 0.5 ? c.text : c.muted,
              }}
            >
              Open on GitHub{" "}
              <Icon
                d={arrowUpRight}
                size={22}
                color={onGithub > 0.5 ? c.text : c.muted}
              />
            </div>
            <div
              style={{
                display: "grid",
                gap: 16,
                padding: 22,
                border: `1px solid ${c.line}`,
                borderRadius: 16,
                background: c.bg,
              }}
            >
              <span
                style={{
                  fontFamily: font.mono,
                  fontSize: 17,
                  letterSpacing: "0.07em",
                  color: c.amber,
                }}
              >
                PAID BY
              </span>
              <span
                style={{ display: "flex", gap: 16, alignItems: "flex-start" }}
              >
                <Logo src={sponsor.logo} size={48} radius={12} />
                <span
                  style={{
                    display: "grid",
                    gap: 4,
                    fontSize: 19,
                    lineHeight: 1.45,
                    color: c.secondary,
                  }}
                >
                  <strong
                    style={{ fontSize: 23, fontWeight: 500, color: c.text }}
                  >
                    {sponsor.name}
                  </strong>
                  {sponsor.description}
                  <span
                    style={{
                      fontFamily: font.mono,
                      fontSize: 17,
                      color: c.muted,
                    }}
                  >
                    {sponsor.site}
                  </span>
                </span>
              </span>
            </div>
          </aside>
        </div>

        <Cursor
          path={[
            { f: 6, x: 700, y: 900 },
            { f: 24, x: CHEVRON_AT.x, y: CHEVRON_AT.y },
            { f: 80, x: CHEVRON_AT.x + 20, y: CHEVRON_AT.y + 40 },
            { f: HOVER_MERGE, x: MERGE_AT.x, y: MERGE_AT.y },
            { f: MERGED + 6, x: MERGE_AT.x + 6, y: MERGE_AT.y + 4 },
            { f: GITHUB - 14, x: GITHUB_AT.x, y: GITHUB_AT.y },
          ]}
          clicks={[CHEVRON, MERGE_CLICK, GITHUB]}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
