import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Cursor, ModelName, Rise } from "../components/kit";
import { Mark } from "../components/Mark";
import { issue } from "../story";
import { c, clamp, ease, font } from "../theme";

/** Where the mark lands: its place in the header's logo. */
const HEADER = { x: 878, y: 46, size: 49.4 };
/** The field, on the 1920×1080 frame. */
const FIELD = { left: 360, top: 640, width: 1200, height: 96 };
const BUTTON = { x: 1405, y: FIELD.top + FIELD.height / 2 };

/**
 * The landing, built in front of the viewer: the mark blooms and takes its
 * place in the header, the pitch rises, then a pointer pastes an issue and
 * asks for a pull request.
 */
export const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // The mark: blooms large at the center, then flies to the header.
  const fly = interpolate(frame, [34, 58], [0, 1], {
    ...clamp,
    easing: ease.inOut,
  });
  const markSize = interpolate(fly, [0, 1], [260, HEADER.size]);
  const markX = interpolate(fly, [0, 1], [960, HEADER.x]);
  const markY = interpolate(fly, [0, 1], [500, HEADER.y]);
  const logoIn = interpolate(frame, [54, 64], [0, 1], clamp);

  // The field: its focus, the pasted link, the press.
  const focus = interpolate(frame, [138, 144], [0, 1], clamp);
  const typed = Math.round(
    interpolate(frame, [146, 172], [0, issue.link.length], clamp),
  );
  const caret = frame >= 142 && frame < 200 && Math.floor(frame / 8) % 2 === 0;
  const press = interpolate(frame, [199, 202, 208], [0, 1, 0], clamp);
  const busy = frame >= 203;
  const spin = (frame - 203) * 14;

  // The camera leans in toward the field once it is there.
  const zoom = interpolate(frame, [112, 230], [1, 1.1], {
    ...clamp,
    easing: ease.inOut,
  });
  const fieldIn = spring({
    frame: frame - 92,
    fps,
    config: { damping: 200 },
    durationInFrames: 26,
  });
  const subIn = interpolate(frame, [80, 100], [0, 1], {
    ...clamp,
    easing: ease.enter,
  });
  const freeIn = interpolate(frame, [104, 120], [0, 1], clamp);

  return (
    <AbsoluteFill
      style={{ background: c.bg, fontFamily: font.sans, color: c.text }}
    >
      <AbsoluteFill
        style={{
          scale: `${zoom}`,
          transformOrigin: `960px ${FIELD.top + 40}px`,
        }}
      >
        {/* The header: logo centered, Sign in on the right, a hairline. */}
        <div
          style={{
            position: "absolute",
            inset: "0 0 auto 0",
            height: 92,
            borderBottom: `1px solid ${c.line}`,
            opacity: logoIn,
          }}
        >
          <Img
            src={staticFile("yarrow-logo-on-dark.svg")}
            style={{ position: "absolute", left: 853, top: 22, height: 48 }}
          />
          <span
            style={{
              position: "absolute",
              right: 48,
              top: 33,
              fontSize: 21,
              color: c.muted,
            }}
          >
            Sign in
          </span>
        </div>
        {logoIn < 1 && (
          <Mark
            size={markSize}
            bloomAt={2}
            style={{
              position: "absolute",
              left: markX - markSize / 2,
              top: markY - markSize * 0.479,
            }}
          />
        )}

        <div
          style={{
            position: "absolute",
            top: 262,
            width: "100%",
            textAlign: "center",
            fontFamily: font.display,
            fontWeight: 500,
            fontSize: 104,
            lineHeight: 1,
            letterSpacing: "-0.02em",
          }}
        >
          <Rise
            text="Free pull requests from frontier AI"
            at={50}
            stagger={4}
          />
        </div>

        <p
          style={{
            position: "absolute",
            top: 432,
            left: 330,
            width: 1260,
            margin: 0,
            textAlign: "center",
            fontSize: 34,
            lineHeight: 1.5,
            color: c.secondary,
            opacity: subIn,
            translate: `0 ${interpolate(subIn, [0, 1], [18, 0])}px`,
          }}
        >
          Paste an issue:{" "}
          <ModelName model="claude" sheenAt={96}>
            Claude Opus
          </ModelName>{" "}
          and{" "}
          <ModelName model="gpt" sheenAt={108}>
            GPT Astra
          </ModelName>{" "}
          turn it into a reviewed pull request in minutes,{" "}
          <span style={{ color: c.gold }}>paid for by sponsors</span> whose
          names ship with every PR.
        </p>

        {/* The ship field: source, link, button. */}
        <div
          style={{
            position: "absolute",
            ...FIELD,
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: 10,
            boxSizing: "border-box",
            background: c.surface,
            border: `2px solid ${focus > 0 ? `rgba(230, 174, 56, ${0.6 * focus})` : c.line}`,
            borderRadius: 48,
            opacity: fieldIn,
            translate: `0 ${interpolate(fieldIn, [0, 1], [40, 0])}px`,
          }}
        >
          <div
            style={{
              height: 74,
              padding: "0 22px",
              display: "flex",
              alignItems: "center",
              gap: 10,
              borderRadius: 37,
              background: c.elevated,
              border: `1px solid ${c.line}`,
              color: c.muted,
              fontSize: 22,
            }}
          >
            <span
              style={{
                width: 14,
                height: 14,
                borderRadius: "50%",
                background: "#f5f0e3",
              }}
            />
            <svg width={16} height={16} viewBox="0 0 16 16">
              <path
                d="M4 6l4 4 4-4"
                stroke={c.muted}
                strokeWidth={1.8}
                fill="none"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <div
            style={{
              flex: 1,
              fontFamily: font.mono,
              fontSize: 28,
              color: typed ? c.text : "#6a707a",
              whiteSpace: "nowrap",
              overflow: "hidden",
            }}
          >
            {typed
              ? issue.link.slice(0, typed)
              : "github.com/you/app/issues/42"}
            {caret && (
              <span
                style={{
                  display: "inline-block",
                  width: 2,
                  height: 32,
                  background: c.amber,
                  verticalAlign: "middle",
                  marginLeft: typed ? 2 : -2,
                }}
              />
            )}
          </div>
          <div
            style={{
              height: 74,
              display: "flex",
              alignItems: "center",
              gap: 18,
              padding: "0 10px 0 30px",
              borderRadius: 37,
              background: c.amber,
              color: c.ink,
              fontWeight: 600,
              fontSize: 27,
              boxShadow: "inset 0 1px 0 #ffffff59, 0 10px 34px #e6ae3838",
              scale: `${1 - press * 0.05}`,
            }}
          >
            {busy ? "Opening GitHub…" : "Get a pull request"}
            <span
              style={{
                width: 52,
                height: 52,
                borderRadius: "50%",
                background: c.ink,
                display: "grid",
                placeItems: "center",
              }}
            >
              {busy ? (
                <svg
                  width={24}
                  height={24}
                  viewBox="0 0 24 24"
                  style={{ rotate: `${spin}deg` }}
                >
                  <circle
                    cx={12}
                    cy={12}
                    r={9}
                    stroke={c.amber}
                    strokeOpacity={0.25}
                    strokeWidth={3}
                    fill="none"
                  />
                  <path
                    d="M12 3a9 9 0 0 1 9 9"
                    stroke={c.amber}
                    strokeWidth={3}
                    fill="none"
                    strokeLinecap="round"
                  />
                </svg>
              ) : (
                <svg width={24} height={24} viewBox="0 0 24 24">
                  <path
                    d="M5 12h14M13 6l6 6-6 6"
                    stroke={c.amber}
                    strokeWidth={2.6}
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </span>
          </div>
        </div>

        <div
          style={{
            position: "absolute",
            top: FIELD.top + FIELD.height + 22,
            left: FIELD.left + 12,
            width: FIELD.width - 24,
            display: "flex",
            justifyContent: "space-between",
            fontSize: 24,
            color: c.muted,
            opacity: freeIn,
          }}
        >
          <span>
            or{" "}
            <span
              style={{
                color: c.secondary,
                textDecoration: "underline",
                textDecorationColor: "#4a4f57",
                textUnderlineOffset: 5,
              }}
            >
              connect your backlog
            </span>
          </span>
          <span>No API key · No card · No subscription</span>
        </div>

        <Cursor
          path={[
            { f: 118, x: 1500, y: 980 },
            { f: 138, x: 820, y: FIELD.top + 50 },
            { f: 176, x: 820, y: FIELD.top + 50 },
            { f: 196, x: BUTTON.x, y: BUTTON.y + 6 },
          ]}
          clicks={[140, 201]}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
