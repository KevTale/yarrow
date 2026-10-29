import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { prCardSvg } from "../../../src/core/pr-card";
import { files, issue, sponsor } from "../story";
import { clamp, ease, font } from "../theme";

/** A code host's dark page, generic: no host's logo. */
const gh = {
  bg: "#0d1117",
  line: "#30363d",
  text: "#e6edf3",
  muted: "#8d96a0",
  open: "#238636",
  link: "#4493f8",
  box: "#151b23",
};

/** The real card from src/core/pr-card.ts, with the story's sponsor. */
const card = `data:image/svg+xml;utf8,${encodeURIComponent(
  prCardSvg({
    sponsors: [
      {
        name: sponsor.name,
        description: sponsor.description,
        site: sponsor.site,
        logo: sponsor.logo,
      },
    ],
  }),
)}`;

const PrIcon: React.FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill={color}>
    <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" />
  </svg>
);

const H: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      fontSize: 30,
      fontWeight: 600,
      margin: "30px 0 12px",
      paddingBottom: 8,
      borderBottom: `1px solid ${gh.line}`,
    }}
  >
    {children}
  </div>
);

/**
 * The pull request on the code host: open, its description, and at its
 * foot the sponsor's card. The camera scrolls down to the card and leans in.
 */
export const PullRequest: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({
    frame,
    fps,
    config: { damping: 200 },
    durationInFrames: 14,
  });
  const badge = spring({
    frame: frame - 8,
    fps,
    config: { damping: 10, stiffness: 170 },
  });
  const travel = interpolate(frame, [26, 66], [0, 1], {
    ...clamp,
    easing: ease.inOut,
  });
  const glow = interpolate(frame, [62, 84], [0, 1], clamp);
  const sweep = interpolate(frame, [70, 112], [-40, 140], {
    ...clamp,
    easing: ease.inOut,
  });

  return (
    <AbsoluteFill
      style={{ background: gh.bg, fontFamily: font.sans, color: gh.text }}
    >
      <div
        style={{
          position: "absolute",
          left: 260,
          top: 90,
          width: 1400,
          opacity: enter,
          // Lands with the card centered on the frame, leaned in.
          translate: `${interpolate(travel, [0, 1], [0, 136])}px ${interpolate(travel, [0, 1], [0, -498]) + (1 - enter) * 40}px`,
          scale: `${interpolate(travel, [0, 1], [1, 1.35])}`,
          transformOrigin: "700px 1400px",
        }}
      >
        <div style={{ fontSize: 54, fontWeight: 400, lineHeight: 1.2 }}>
          {issue.title} <span style={{ color: gh.muted }}>#{issue.pr}</span>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 18,
            marginTop: 22,
            fontSize: 25,
            color: gh.muted,
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 22px",
              borderRadius: 99,
              background: gh.open,
              color: "#fff",
              fontWeight: 600,
              scale: `${badge}`,
            }}
          >
            <PrIcon size={22} color="#fff" /> Open
          </span>
          <span>
            <b style={{ color: gh.text }}>yarrow-run</b> wants to merge 1 commit
            into{" "}
            <code
              style={{ color: gh.link, fontFamily: font.mono, fontSize: 22 }}
            >
              main
            </code>
          </span>
        </div>
        <div
          style={{
            display: "flex",
            gap: 40,
            marginTop: 34,
            borderBottom: `1px solid ${gh.line}`,
            fontSize: 24,
            color: gh.muted,
          }}
        >
          <span
            style={{
              color: gh.text,
              paddingBottom: 16,
              borderBottom: "3px solid #f78166",
            }}
          >
            Conversation
          </span>
          <span>Commits 1</span>
          <span>Checks</span>
          <span>Files changed {files.length}</span>
        </div>

        <div style={{ display: "flex", gap: 24, marginTop: 34 }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: "50%",
              background: "#17191d",
              border: `1px solid ${gh.line}`,
              display: "grid",
              placeItems: "center",
              flex: "none",
            }}
          >
            <Img
              src={staticFile("yarrow-mark-on-dark.svg")}
              style={{ width: 40 }}
            />
          </div>
          <div
            style={{
              flex: 1,
              border: `1px solid ${gh.line}`,
              borderRadius: 12,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "16px 24px",
                background: gh.box,
                borderBottom: `1px solid ${gh.line}`,
                fontSize: 23,
                color: gh.muted,
              }}
            >
              <b style={{ color: gh.text }}>yarrow-run</b>{" "}
              <span
                style={{
                  border: `1px solid ${gh.line}`,
                  borderRadius: 99,
                  padding: "1px 10px",
                  fontSize: 18,
                }}
              >
                bot
              </span>{" "}
              commented 3 minutes ago
            </div>
            <div
              style={{
                padding: "10px 30px 34px",
                fontSize: 24,
                lineHeight: 1.55,
              }}
            >
              <p style={{ margin: "18px 0 0" }}>
                Ticket:{" "}
                <span style={{ color: gh.link }}>
                  {issue.repo}#{issue.number}
                </span>
              </p>
              <H>What changed</H>
              <p style={{ margin: 0 }}>
                Settings get a Theme switch: Light, Dark or System. The choice
                is saved and applied before the first paint, so the page never
                flashes. Dark colors live in the design tokens.
              </p>
              <H>How it was verified</H>
              <p style={{ margin: 0 }}>
                <code
                  style={{
                    fontFamily: font.mono,
                    fontSize: 21,
                    background: "#262c36",
                    padding: "2px 8px",
                    borderRadius: 6,
                  }}
                >
                  npm test
                </code>{" "}
                → 14 tests, 14 pass. A new test covers each choice.
              </p>
              <H>Review</H>
              <p style={{ margin: 0 }}>
                Reviewed by GPT Astra: Approved. The change does what the issue
                asks, nothing else.
              </p>
              <p style={{ margin: "30px 0 26px", color: gh.text }}>
                Implemented by Claude Opus 5.5 · Reviewed by GPT Astra
              </p>
              <div
                style={{
                  borderTop: `4px solid ${gh.line}`,
                  margin: "0 0 30px",
                }}
              />
              <div
                style={{ position: "relative", width: 960, borderRadius: 22 }}
              >
                <div
                  style={{
                    position: "absolute",
                    inset: -3,
                    borderRadius: 24,
                    boxShadow: `0 0 0 3px rgba(242, 181, 68, ${0.55 * glow}), 0 0 70px rgba(242, 181, 68, ${0.28 * glow})`,
                  }}
                />
                <Img
                  src={card}
                  style={{ width: 960, display: "block", borderRadius: 21 }}
                />
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    borderRadius: 21,
                    background: `linear-gradient(105deg, transparent ${sweep - 14}%, rgba(255, 236, 190, 0.16) ${sweep}%, transparent ${sweep + 14}%)`,
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
