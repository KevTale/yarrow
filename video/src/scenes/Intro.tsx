import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Cursor, Rise } from "../components/kit";
import { Mark } from "../components/Mark";
import { issue } from "../story";
import { c, clamp, ease, font } from "../theme";

/** Where the mark lands: its place in the header's logo. */
const HEADER = { x: 878, y: 46, size: 49.4 };
/** The field, on the 1920×1080 frame. */
const FIELD = { left: 380, top: 560, width: 1160, height: 104 };
const BUTTON = { x: 1388, y: FIELD.top + FIELD.height / 2 };

/** The scene's beats (local frames). */
const PASTE_CLICK = 86;
const PASTED = 90;
const GO_CLICK = 160;

/**
 * The landing, reduced to its promise and its field: the mark blooms and
 * takes its place in the header, the promise rises, then a pointer pastes
 * an issue and asks for a pull request.
 */
export const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // The mark: blooms large at the center, then flies to the header.
  const fly = interpolate(frame, [22, 42], [0, 1], {
    ...clamp,
    easing: ease.inOut,
  });
  const markSize = interpolate(fly, [0, 1], [240, HEADER.size]);
  const markX = interpolate(fly, [0, 1], [960, HEADER.x]);
  const markY = interpolate(fly, [0, 1], [520, HEADER.y]);
  const logoIn = interpolate(frame, [40, 48], [0, 1], clamp);

  // The field: its focus, the pasted link, the hover and the press.
  const focus = interpolate(
    frame,
    [PASTE_CLICK - 2, PASTE_CLICK + 4],
    [0, 1],
    clamp,
  );
  const pasted = frame >= PASTED;
  const flash = interpolate(frame, [PASTED, PASTED + 16], [1, 0], clamp);
  const caret =
    frame >= PASTE_CLICK && frame < GO_CLICK && Math.floor(frame / 8) % 2 === 0;
  const hover = interpolate(frame, [128, 136], [0, 1], clamp);
  const press = interpolate(
    frame,
    [GO_CLICK - 3, GO_CLICK, GO_CLICK + 6],
    [0, 1, 0],
    clamp,
  );
  const busy = frame >= GO_CLICK + 2;
  const spin = (frame - GO_CLICK) * 14;

  // The camera leans in toward the field once it is there.
  const zoom = interpolate(frame, [56, 180], [1, 1.12], {
    ...clamp,
    easing: ease.inOut,
  });
  const fieldIn = spring({
    frame: frame - 50,
    fps,
    config: { damping: 200 },
    durationInFrames: 24,
  });

  return (
    <AbsoluteFill
      style={{ background: c.bg, fontFamily: font.sans, color: c.text }}
    >
      <AbsoluteFill
        style={{
          scale: `${zoom}`,
          transformOrigin: `960px ${FIELD.top + FIELD.height / 2}px`,
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
            top: 330,
            width: "100%",
            textAlign: "center",
            fontFamily: font.display,
            fontWeight: 500,
            fontSize: 108,
            lineHeight: 1,
            letterSpacing: "-0.02em",
          }}
        >
          <Rise
            text="Free pull requests from frontier AI"
            at={30}
            stagger={4}
          />
        </div>

        {/* The ship field: the link, then the button. */}
        <div
          style={{
            position: "absolute",
            ...FIELD,
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "10px 10px 10px 40px",
            boxSizing: "border-box",
            background: c.surface,
            border: `2px solid ${focus > 0 ? `rgba(230, 174, 56, ${0.6 * focus})` : c.line}`,
            borderRadius: 52,
            opacity: fieldIn,
            translate: `0 ${interpolate(fieldIn, [0, 1], [40, 0])}px`,
          }}
        >
          <div
            style={{
              flex: 1,
              fontFamily: font.mono,
              fontSize: 31,
              color: pasted ? c.text : "#6a707a",
              whiteSpace: "nowrap",
              overflow: "hidden",
            }}
          >
            <span
              style={{
                background: `rgba(242, 181, 68, ${0.28 * flash})`,
                borderRadius: 6,
              }}
            >
              {pasted ? issue.link : "github.com/you/app/issues/42"}
            </span>
            {caret && (
              <span
                style={{
                  display: "inline-block",
                  width: 2,
                  height: 36,
                  background: c.amber,
                  verticalAlign: "middle",
                  marginLeft: pasted ? 2 : -2,
                }}
              />
            )}
          </div>
          <div
            style={{
              height: 80,
              display: "flex",
              alignItems: "center",
              gap: 18,
              padding: "0 12px 0 32px",
              borderRadius: 40,
              background: c.amber,
              color: c.ink,
              fontWeight: 600,
              fontSize: 29,
              boxShadow: `inset 0 1px 0 #ffffff59, 0 10px ${34 + 20 * hover}px rgba(230, 174, 56, ${0.22 + 0.2 * hover})`,
              scale: `${1 - press * 0.05}`,
            }}
          >
            {busy ? "Opening GitHub…" : "Get a pull request"}
            <span
              style={{
                width: 56,
                height: 56,
                borderRadius: "50%",
                background: c.ink,
                display: "grid",
                placeItems: "center",
                translate: `${4 * hover * (busy ? 0 : 1)}px 0`,
              }}
            >
              {busy ? (
                <svg
                  width={26}
                  height={26}
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
                <svg width={26} height={26} viewBox="0 0 24 24">
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

        <Cursor
          path={[
            { f: 60, x: 1500, y: 960 },
            { f: 84, x: 760, y: FIELD.top + 56 },
            { f: 104, x: 760, y: FIELD.top + 56 },
            { f: 130, x: BUTTON.x, y: BUTTON.y + 8 },
          ]}
          clicks={[PASTE_CLICK, GO_CLICK]}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
