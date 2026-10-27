/** Motion presets are shared by the gallery and future registry consumers. */
export const motionTokens = {
  duration: {
    instant: 0.12,
    fast: 0.16,
    exit: 0.18,
    standard: 0.24,
    considered: 0.48,
  },
  ease: {
    enter: [0.16, 1, 0.3, 1],
    exit: [0.7, 0, 0.84, 0],
    standard: [0.22, 1, 0.36, 1],
    /** For elements that move while already on screen. */
    inOut: [0.65, 0, 0.35, 1],
  },
  spring: {
    responsive: { type: "spring", stiffness: 520, damping: 38 },
    gentle: { type: "spring", stiffness: 340, damping: 34 },
    /** Presses, toggles, thumbs, and small indicators. Settles fast with a hint of life. */
    snappy: { type: "spring", visualDuration: 0.26, bounce: 0.12 },
    /** Panels, height changes, and layout shifts. Critically damped, never overshoots. */
    smooth: { type: "spring", visualDuration: 0.4, bounce: 0 },
    /** Shape morphs, shared layout highlights, and width changes that follow new content. */
    morph: { type: "spring", visualDuration: 0.42, bounce: 0.16 },
    /**
     * Yarrow: the fill or highlight that follows the pointer or the choice
     * between items (button groups, selects, menus, the rail, radio cards).
     * One speed for every such control: change it here.
     */
    highlight: { type: "spring", visualDuration: 0.2, bounce: 0.08 },
  },
  /** Stagger steps in seconds. Keep total stagger under roughly 0.4s. */
  stagger: { char: 0.016, word: 0.04, line: 0.08, item: 0.035 },
  /** Blur radii in px for text and content crossfades. Keep blur small and brief. */
  blur: { subtle: 2, soft: 4, text: 8 },
} as const;

/**
 * A duration spring restated as stiffness and damping, so an animation
 * retargeted mid flight keeps the velocity it already has (motion drops it
 * on duration springs).
 */
export function physicalSpring(spring: {
  visualDuration: number;
  bounce: number;
}) {
  const root = (2 * Math.PI) / (spring.visualDuration * 1.2);
  return {
    type: "spring" as const,
    stiffness: root * root,
    damping: 2 * (1 - spring.bounce) * root,
    mass: 1,
  };
}
