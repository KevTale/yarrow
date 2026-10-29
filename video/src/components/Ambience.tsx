import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { clamp } from "../theme";

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
