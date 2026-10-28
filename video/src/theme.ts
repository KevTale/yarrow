import { loadFont } from "@remotion/fonts";
import { Easing, staticFile } from "remotion";

/** Yarrow's night palette, as in src/styles.css. */
export const c = {
  bg: "#0c0d0f",
  surface: "#111215",
  elevated: "#17191d",
  hover: "#1b1e23",
  line: "#25282e",
  lineSoft: "#1d2025",
  text: "#edeef0",
  secondary: "#bdc1c9",
  muted: "#8a909b",
  amber: "#f2b544",
  gold: "#f0c674",
  green: "#5ccb95",
  red: "#ee7b6e",
  claude: "#e08d6d",
  claudeShine: "#ffd9c7",
  gpt: "#4cc3a0",
  gptShine: "#d2fff0",
  ink: "#141714",
} as const;

export const font = {
  display: "Jost, Geist, sans-serif",
  sans: "Geist, sans-serif",
  mono: "'Geist Mono', monospace",
} as const;

export const fontsReady = Promise.all([
  loadFont({
    family: "Jost",
    url: staticFile("fonts/jost-500.woff2"),
    weight: "500",
  }),
  loadFont({
    family: "Geist",
    url: staticFile("fonts/geist.woff2"),
    weight: "100 900",
  }),
  loadFont({
    family: "Geist Mono",
    url: staticFile("fonts/geist-mono.woff2"),
    weight: "100 900",
  }),
]);

/** The app's easings: enter, and a soft spring with a hint of overshoot. */
export const ease = {
  enter: Easing.bezier(0.16, 1, 0.3, 1),
  standard: Easing.bezier(0.22, 1, 0.36, 1),
  inOut: Easing.bezier(0.65, 0, 0.35, 1),
};

export const clamp = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;
