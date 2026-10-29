import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { clamp } from "../theme";

/**
 * A warm light behind a scene: two soft blooms, amber and coral, drifting
 * slowly, so the night is never a flat plate.
 */
export const Glow: React.FC<{ strength?: number }> = ({ strength = 1 }) => {
  const frame = useCurrentFrame();
  const drift = (speed: number, phase: number) =>
    Math.sin(frame / speed + phase);
  const ax = 28 + 6 * drift(70, 0);
  const ay = 34 + 5 * drift(90, 1);
  const bx = 74 + 5 * drift(80, 2);
  const by = 72 + 6 * drift(100, 3);
  return (
    <AbsoluteFill
      style={{
        opacity: strength,
        backgroundImage: [
          `radial-gradient(900px 620px at ${ax}% ${ay}%, rgba(242, 181, 68, 0.13), transparent 70%)`,
          `radial-gradient(820px 600px at ${bx}% ${by}%, rgba(224, 141, 109, 0.10), transparent 70%)`,
        ].join(", "),
      }}
    />
  );
};

/**
 * A scene's way in and out: it comes into focus from a blur and leaves into
 * one, so a cut on the beat reads as one motion through the frame.
 */
export const Shot: React.FC<{
  /** The scene's length in frames. */
  duration: number;
  enters?: boolean;
  leaves?: boolean;
  children: React.ReactNode;
}> = ({ duration, enters = true, leaves = true, children }) => {
  const frame = useCurrentFrame();
  const enter = enters ? interpolate(frame, [0, 8], [1, 0], clamp) : 0;
  const leave = leaves
    ? interpolate(frame, [duration - 5, duration], [0, 1], clamp)
    : 0;
  const blur = 22 * enter ** 2 + 16 * leave ** 2;
  return (
    <AbsoluteFill
      style={{
        filter: blur > 0.2 ? `blur(${blur}px)` : undefined,
        scale: `${1 + 0.035 * enter + 0.03 * leave}`,
      }}
    >
      {children}
    </AbsoluteFill>
  );
};
