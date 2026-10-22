# Agent Commons — MVP mockups · Opus

Six standalone HTML screens (Tailwind CDN, Geist and Geist Mono, no JS logic). Open any file directly in a browser. They link to each other.

| File | Route | Role |
|---|---|---|
| `01-landing.html` | `/` | Pitch, live work unit, totals, two actions |
| `02-fund.html` | `/fund` | $5 / $20 / $100 packs, routing, leaderboard visibility, itemized summary |
| `03-leaderboard.html` | `/leaderboard` | Funders ranked by $, period and type filters, "you" row pinned |
| `04-dashboard.html` | `/dashboard` | Credit, outcomes, 30-day spend, funded work, own projects, ledger |
| `05-projects-new.html` | `/projects/new` | GitHub + Jira sources, commons/commercial, intake, delivery policy |
| `06-work-detail.html` | `/work/[id]` | Outcome (PR), run timeline with abstention, strike force, cost, funders |

## Principles
1. **A ledger, not a pitch.** Every dollar is a number you can trace: pack → credit → run → PR. Money and metrics use a tabular monospace font. Prose uses a sans-serif.
2. **Abstention is a first-class outcome.** It gets its own visual state (dashed, neutral grey), a stated reason, and a capped cost. It shows up in platform totals (23%), not hidden away.
3. **One accent, one meaning.** Amber `signal` marks the action to take and live compute. Green marks only a merged or passing result, or a commons project. Red appears only for failed tests or deleted lines.
4. **Hairlines instead of shadows.** 1px `#22252B` borders, `gap-px` grids, and few nested cards make it look like an infra tool (terminal, CI), not a SaaS landing page.
5. **Copy is cut down.** Titles fit in three to five words. Help text is one line. Labels are uppercase 11px. No marketing paragraphs.

## Palette
| Token | Hex | Use |
|---|---|---|
| ink-950 | `#0C0D0F` | Background |
| ink-900 | `#111215` | Surfaces, cards |
| ink-800 / 700 | `#1B1E23` / `#262A31` | Hover, tracks, avatars |
| hairline | `#22252B` | Borders, dividers |
| ink-400 | `#8A909B` | Secondary text (AA on 950) |
| ink-100 | `#EDEEF0` | Primary text |
| signal | `#F2B544` | Primary CTA, live state, active selection, your rank |
| ok | `#5CCB95` | Merged / passing / Commons |
| err | `#EE7B6E` | Failed run, deletions |

## Decisions
- **Commons vs Commercial** is just a tag (green vs neutral outline). Both types sit side by side in every list from day 1. Neither is ranked above the other.
- **The leaderboard sorts by $ only.** Work units and PRs are context columns. The pinned "you" row shows the next step up (`+$20 → #191`), not a guilt nudge.
- **The Fund page shows what $ buys** (≈ work units and runs at the 30-day average) and the fees, line by line. "No subscription, no personal keys" appears once, near the header.
- **Strike force** on the work unit page lists each agent with its role, model class, token count and final state. The parallel agent that abstained is shown, not hidden.
- **The Add a project page uses a vertical stepper.** A sticky preview shows the worst case (`Max exposure = cap × matching issues`).
- **Accessibility:** skip link, landmarks, `aria-current`, real radios and checkboxes with visible amber `:focus-visible` rings, table caption, contrast ≥ 4.5:1 for text, `prefers-reduced-motion` respected.
- **Layout:** desktop-first at a 1200px container (built for 1280). Grids collapse to one column below `lg`.
