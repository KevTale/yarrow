import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { c, clamp, ease, font } from "../theme";

/** A model's name in its maker's colors, the sheen passing on the frame. */
export const ModelName: React.FC<{
  model: "claude" | "gpt";
  children: React.ReactNode;
  /** Frame the sheen passes; it takes a second. */
  sheenAt?: number;
  style?: React.CSSProperties;
}> = ({ model, children, sheenAt = 0, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tint = model === "claude" ? c.claude : c.gpt;
  const shine = model === "claude" ? c.claudeShine : c.gptShine;
  const at = interpolate(frame, [sheenAt, sheenAt + fps], [100, 0], {
    ...clamp,
    easing: ease.inOut,
  });
  return (
    <span
      style={{
        fontWeight: 600,
        // Longhands: a shorthand update would reset the text clip.
        backgroundImage: `linear-gradient(100deg, ${tint} 0 40%, ${shine} 50%, ${tint} 60% 100%)`,
        backgroundPosition: `${at}% 0`,
        backgroundSize: "250% 100%",
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        color: "transparent",
        ...style,
      }}
    >
      {children}
    </span>
  );
};

/** Words rising into place one after the other, from `at`. */
export const Rise: React.FC<{
  text: string;
  at?: number;
  stagger?: number;
  style?: React.CSSProperties;
  wordStyle?: (word: string, index: number) => React.CSSProperties | undefined;
}> = ({ text, at = 0, stagger = 3, style, wordStyle }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <span style={style}>
      {text.split(" ").map((word, i) => {
        const t = spring({
          frame: frame - at - i * stagger,
          fps,
          config: { damping: 200 },
          durationInFrames: 22,
        });
        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              opacity: t,
              translate: `0 ${interpolate(t, [0, 1], [0.45, 0])}em`,
              filter: `blur(${interpolate(t, [0, 1], [8, 0])}px)`,
              marginRight: "0.26em",
              ...wordStyle?.(word, i),
            }}
          >
            {word}
          </span>
        );
      })}
    </span>
  );
};

type Point = { f: number; x: number; y: number };

/**
 * A pointer gliding between points (frame, x, y) on an ease, pressing on
 * `clicks` frames: it dips, and a ring opens where it pressed.
 */
export const Cursor: React.FC<{
  path: Point[];
  clicks?: number[];
  hideAfter?: number;
}> = ({ path, clicks = [], hideAfter }) => {
  const frame = useCurrentFrame();
  const frames = path.map((p) => p.f);
  const x = interpolate(
    frame,
    frames,
    path.map((p) => p.x),
    { ...clamp, easing: ease.inOut },
  );
  const y = interpolate(
    frame,
    frames,
    path.map((p) => p.y),
    { ...clamp, easing: ease.inOut },
  );
  const press = clicks.reduce(
    (sum, at) =>
      sum + interpolate(frame, [at - 3, at, at + 5], [0, 1, 0], clamp),
    0,
  );
  const appear = interpolate(
    frame,
    [path[0]!.f, path[0]!.f + 8],
    [0, 1],
    clamp,
  );
  const leave =
    hideAfter === undefined
      ? 1
      : interpolate(frame, [hideAfter, hideAfter + 8], [1, 0], clamp);
  return (
    <>
      {clicks.map((at) => {
        const t = interpolate(frame, [at, at + 16], [0, 1], clamp);
        if (frame < at || t >= 1) return null;
        return (
          <div
            key={at}
            style={{
              position: "absolute",
              left:
                interpolate(
                  frame,
                  frames,
                  path.map((p) => p.x),
                  clamp,
                ) - 26,
              top:
                interpolate(
                  frame,
                  frames,
                  path.map((p) => p.y),
                  clamp,
                ) - 26,
              width: 52,
              height: 52,
              borderRadius: "50%",
              border: `2px solid ${c.amber}`,
              opacity: 1 - t,
              scale: interpolate(t, [0, 1], [0.3, 1.4]),
            }}
          />
        );
      })}
      <svg
        width={34}
        height={40}
        viewBox="0 0 17 20"
        style={{
          position: "absolute",
          left: x - 3,
          top: y - 2,
          opacity: appear * leave,
          scale: `${1 - press * 0.14}`,
          transformOrigin: "3px 2px",
          filter: "drop-shadow(0 4px 10px #0009)",
        }}
      >
        <path
          d="M1.5 1.2 L1.5 16 L5.4 12.4 L8.1 18.4 L10.6 17.3 L8 11.4 L13.4 11.2 Z"
          fill="#fff"
          stroke="#111"
          strokeWidth={1.1}
          strokeLinejoin="round"
        />
      </svg>
    </>
  );
};

/** The live dot: amber, breathing on the frame. */
export const LiveDot: React.FC<{ size?: number; color?: string }> = ({
  size = 10,
  color = c.amber,
}) => {
  const frame = useCurrentFrame();
  const halo = interpolate(Math.sin(frame / 7), [-1, 1], [0.05, 0.22]);
  return (
    <span
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "50%",
        background: color,
        boxShadow: `0 0 0 ${size * 0.7}px ${color}${Math.round(halo * 255)
          .toString(16)
          .padStart(2, "0")}`,
        flex: "none",
      }}
    />
  );
};

/** A logo tile: a letter on a color, like the boards' seeded sponsors. */
export const Tile: React.FC<{
  letter: string;
  bg: string;
  fg?: string;
  size: number;
  radius?: number;
}> = ({ letter, bg, fg = c.ink, size, radius = size * 0.28 }) => (
  <span
    style={{
      width: size,
      height: size,
      borderRadius: radius,
      background: bg,
      color: fg,
      display: "grid",
      placeItems: "center",
      fontFamily: font.display,
      fontWeight: 500,
      fontSize: size * 0.5,
      flex: "none",
    }}
  >
    {letter}
  </span>
);
