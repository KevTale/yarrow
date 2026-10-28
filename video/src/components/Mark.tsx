import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

/** public/brand/yarrow-mark-on-dark.svg, as data: five florets of five petals. */
const PETALS: [number, number][][] = [
  [
    [0, -47.25],
    [11.24, -39.08],
    [6.95, -25.87],
    [-6.95, -25.87],
    [-11.24, -39.08],
  ],
  [
    [44.94, -14.6],
    [40.64, -1.39],
    [26.75, -1.39],
    [22.45, -14.6],
    [33.69, -22.77],
  ],
  [
    [27.77, 38.22],
    [13.88, 38.22],
    [9.58, 25.01],
    [20.82, 16.84],
    [32.07, 25.01],
  ],
  [
    [-27.77, 38.22],
    [-32.07, 25.01],
    [-20.82, 16.84],
    [-9.58, 25.01],
    [-13.88, 38.22],
  ],
  [
    [-44.94, -14.6],
    [-33.69, -22.77],
    [-22.45, -14.6],
    [-26.75, -1.39],
    [-40.64, -1.39],
  ],
];
const CENTERS: [number, number][] = [
  [0, -35.43],
  [33.69, -10.95],
  [20.82, 28.66],
  [-20.82, 28.66],
  [-33.69, -10.95],
];

/**
 * The yarrow mark, blooming from its heart: the gold center, then each
 * floret's center, then its petals opening outward. `bloomAt` is the frame
 * the bloom starts; before it, nothing shows.
 */
export const Mark: React.FC<{
  size: number;
  bloomAt?: number;
  style?: React.CSSProperties;
}> = ({ size, bloomAt = 0, style }) => {
  const frame = useCurrentFrame() - bloomAt;
  const { fps } = useVideoConfig();
  const pop = (delay: number, damping = 12) =>
    spring({
      frame: frame - delay,
      fps,
      config: { damping, stiffness: 140, mass: 0.6 },
    });

  return (
    <svg
      viewBox="-51.62 -53.93 103.23 98.83"
      width={size}
      height={size * (98.83 / 103.23)}
      style={{ overflow: "visible", ...style }}
    >
      <circle cx={0} cy={0} r={9.54 * pop(0)} fill="#E6AE38" />
      {PETALS.map((floret, f) => {
        const [cx, cy] = CENTERS[f]!;
        const open = pop(4 + f * 2.5, 14);
        return (
          <g key={f}>
            {floret.map(([x, y], p) => {
              const t = pop(7 + f * 2.5 + p * 1.2);
              // Each petal slides out from its floret's center as it grows.
              const px = interpolate(t, [0, 1], [cx, x]);
              const py = interpolate(t, [0, 1], [cy, y]);
              return (
                <circle
                  key={p}
                  cx={px}
                  cy={py}
                  r={6.68 * Math.max(0, t)}
                  fill="#F5F0E3"
                />
              );
            })}
            <circle
              cx={cx * open}
              cy={cy * open}
              r={4.45 * open}
              fill="#E6AE38"
            />
          </g>
        );
      })}
    </svg>
  );
};
