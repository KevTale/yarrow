import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Cursor } from "../components/kit";
import { Spoken } from "../components/Spoken";
import { issue } from "../story";
import { c, clamp, ease, font } from "../theme";

/** The field, on the 1920×1080 frame: centered, nothing above it. */
const FIELD = { left: 380, top: 488, width: 1160, height: 104 };
const BUTTON = { x: 1388, y: FIELD.top + FIELD.height / 2 };

/** The scene's beats (local frames). */
const QUESTION_OUT = 100;
const PAGE_IN = 104;
const PASTE_CLICK = 120;
const PASTED = 124;
const HOVER = 160;
const GO_CLICK = 186;

/**
 * The question, written as it is asked: what if your backlog built itself,
 * for free. Then the landing, reduced to its field: on "Paste a ticket" a
 * pointer pastes one and asks for a pull request.
 */
export const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // The question leaves upward as the page comes in.
  const out = interpolate(frame, [QUESTION_OUT, QUESTION_OUT + 10], [0, 1], {
    ...clamp,
    easing: ease.inOut,
  });
  const pageIn = interpolate(frame, [PAGE_IN, PAGE_IN + 10], [0, 1], clamp);

  // The field: its focus, the pasted link, the hover and the press.
  const focus = interpolate(
    frame,
    [PASTE_CLICK - 2, PASTE_CLICK + 4],
    [0, 1],
    clamp,
  );
  const pasted = frame >= PASTED;
  const flash = interpolate(
    frame,
    [PASTED - 1, PASTED, PASTED + 16],
    [0, 1, 0],
    clamp,
  );
  const caret =
    frame >= PASTE_CLICK && frame < GO_CLICK && Math.floor(frame / 8) % 2 === 0;
  const hover = interpolate(frame, [HOVER, HOVER + 8], [0, 1], clamp);
  const press = interpolate(
    frame,
    [GO_CLICK - 3, GO_CLICK, GO_CLICK + 6],
    [0, 1, 0],
    clamp,
  );
  const busy = frame >= GO_CLICK + 2;
  const spin = (frame - GO_CLICK) * 14;

  // The camera leans in toward the field once it is there.
  const zoom = interpolate(frame, [PAGE_IN, 210], [1, 1.1], {
    ...clamp,
    easing: ease.inOut,
  });
  const fieldIn = spring({
    frame: frame - PAGE_IN,
    fps,
    config: { damping: 200 },
    durationInFrames: 24,
  });

  return (
    <AbsoluteFill
      style={{ background: c.bg, fontFamily: font.sans, color: c.text }}
    >
      {frame < QUESTION_OUT + 10 && (
        <AbsoluteFill
          style={{
            justifyContent: "center",
            alignItems: "center",
            textAlign: "center",
            fontFamily: font.display,
            fontWeight: 500,
            fontSize: 124,
            lineHeight: 1.08,
            letterSpacing: "-0.02em",
            opacity: 1 - out,
            translate: `0 ${-60 * out}px`,
          }}
        >
          <Spoken line="intro" sceneFrom={0} words={[0, 4]} />
          <Spoken line="intro" sceneFrom={0} words={[4, 6]} />
          <Spoken
            line="intro"
            sceneFrom={0}
            words={[6, 8]}
            trim
            style={{ color: c.amber, marginTop: 24 }}
          />
        </AbsoluteFill>
      )}
      <AbsoluteFill
        style={{
          scale: `${zoom}`,
          transformOrigin: `960px ${FIELD.top + FIELD.height / 2}px`,
        }}
      >
        {/* The header: logo centered, a hairline. */}
        <div
          style={{
            position: "absolute",
            inset: "0 0 auto 0",
            height: 92,
            borderBottom: `1px solid ${c.line}`,
            opacity: pageIn,
          }}
        >
          <Img
            src={staticFile("yarrow-logo-on-dark.svg")}
            style={{ position: "absolute", left: 853, top: 22, height: 48 }}
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
            { f: PAGE_IN, x: 1500, y: 960 },
            { f: PASTE_CLICK - 4, x: 760, y: FIELD.top + 56 },
            { f: PASTE_CLICK + 14, x: 760, y: FIELD.top + 56 },
            { f: HOVER + 2, x: BUTTON.x, y: BUTTON.y + 8 },
          ]}
          clicks={[PASTE_CLICK, GO_CLICK]}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
