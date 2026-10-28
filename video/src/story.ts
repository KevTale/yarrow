import { PULL_REQUEST_COST_CENTS } from "../../src/core/pricing";
import { c } from "./theme";

/**
 * The first draft's story, all invented: no real repository or company is
 * shown as a sponsor or a builder. Real runs replace this later.
 */
export const issue = {
  repo: "tidepool/notes",
  number: 42,
  title: "Dark mode toggle in settings",
  link: "github.com/tidepool/notes/issues/42",
  pr: 43,
};

export const sponsor = {
  name: "Quillfern Labs",
  description: "Observability for small teams that ship every day.",
  site: "quillfern.dev",
  letter: "Q",
  color: "#9fd4ff",
};

/** What one pull request costs a sponsor, from the app's own pricing. */
export const prCostCents = PULL_REQUEST_COST_CENTS;

/** Today's board, before Quillfern's new payment lifts it to the top. */
export const board = [
  {
    name: "Mossgrove",
    description: "Design systems, built to last.",
    site: "mossgrove.io",
    letter: "M",
    color: "#b9e3a8",
    cents: 3000,
  },
  {
    name: "Orbitkit",
    description: "Feature flags for indie apps.",
    site: "orbitkit.dev",
    letter: "O",
    color: "#f5b8a8",
    cents: 2000,
  },
  {
    name: sponsor.name,
    description: sponsor.description,
    site: sponsor.site,
    letter: sponsor.letter,
    color: sponsor.color,
    cents: 1500,
  },
  {
    name: null,
    description: null,
    site: null,
    letter: "?",
    color: c.elevated,
    cents: 1000,
  },
] as const;

/** Quillfern's new payment, in cents. */
export const topUpCents = 2500;

/** The run, as the work scene tells it. */
export const files = [
  { path: "src/settings/theme.ts", added: 24, removed: 0 },
  { path: "src/settings/SettingsPage.tsx", added: 11, removed: 2 },
  { path: "src/styles/tokens.css", added: 19, removed: 0 },
  { path: "test/theme.test.ts", added: 18, removed: 0 },
];

export const checks = [
  "Does what the issue asks",
  "Tests pass: 14 of 14",
  "No unrelated changes",
];

/** The run's length on the clock, in seconds (accelerated on screen). */
export const runSeconds = 2 * 60 + 47;
