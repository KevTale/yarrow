# Yarrow MVP — build brief (updated 2026-10-05)

This brief overrides the historical options in `synthese.md`. All prices and percentages marked _(hypothesis)_ are to be calibrated after launch.

## Principle

Yarrow is for **people who build software**: SaaS, games, tools, open source or closed source.
- **Project owners** connect their repo and tracker. Tagged tickets get processed **for free**, funded by sponsors.
- **Sponsors** fund the compute. In return they get visibility on the work they fund and on the leaderboard.
- The platform picks the work unit and delivers a reviewed PR or an explicit abstention.
- Agents run entirely on provider infrastructure: the platform hosts no execution environment.

**At launch, everything is free for project owners.** There is no paid plan. A paid offer (priority, extra features) will be designed later from real usage metrics and feedback.

### Product strategy

- **Differentiate where the labs won't:** a systematic cross-lab review (Claude implements, OpenAI reviews), the funding marketplace and frictionless onboarding.
- **Do not compete with the labs on agent context, memory or tooling.** They improve these continuously.
  - No custom "repo memory" system.
  - The agents read the project's own `AGENTS.md`, `CLAUDE.md` and `CONTRIBUTING.md` natively.
  - When a ticket is retried, the previous attempt and the owner's comments are passed as plain context.

## Architecture (locked)

- **Shop:** TanStack Start on Cloudflare Workers. It handles the UI, auth, Stripe, webhooks and the dashboards.
- **Brain:** a Cloudflare Worker with a cron dispatcher (every minute) and one durable Workflow per run, with Postgres as the source of truth. It covers work unit selection, reserve/debit/release and PR creation.
- **Hands:** provider-hosted agents, driven step by step by the run Workflow (`RunPipeline`):
  - **implements:** Claude Managed Agents (beta), Claude Code harness, Anthropic-hosted sandbox.
  - **reviews:** OpenAI Agents API (beta), Codex harness, OpenAI-hosted sandbox.
- **Provider accounts:** platform-owned **API** accounts with prepaid credits. Never a consumer subscription (Claude Pro/Max, ChatGPT Plus/Pro).
- **Branding:** do not name the product or features after "Claude Code" or "Codex". "Powered by Claude" or "uses OpenAI models" is fine.
- **DB:** Supabase + Drizzle.
- **Environments:** local and `dev.yarrow.run` share the `yarrow-dev` Supabase project, Stripe test mode and the `yarrow-run-dev` GitHub App; `yarrow.run` has the `yarrow-prod` project and the `yarrow-run` App. Every push to `main` deploys dev, every push to `prod` deploys prod (GitHub Actions).
- **Design:** Opus dark ledger mockups (amber accent).
- **Out of the architecture:** Cloudflare Sandbox runner, Docker/Hetzner pool and OpenRouter.

### Repository access and delivery

- The sandbox gets a **read-only**, short-lived GitHub App installation token, scoped to the single repo of the run.
- The agent returns a patch, a summary and evidence. It never pushes.
- The brain creates the branch, commit and **draft PR** through the GitHub App. This is the only write path.
- For tracker tickets, the brain comments on the ticket with the PR link.

### Fixed roles

- **Implementer:** Claude Opus 5.5, high effort, through Managed Agents.
- **Reviewer:** OpenAI Astra, through the Agents API.

Both are the same for every ticket. This is the platform's offer. Model IDs and effort are server-side config, so they can follow model releases.

Run cost = tokens + sandbox/container time, measured from provider usage data and written to the ledger in cents.

## Project owners

### Onboarding

Least friction first (decided 2026-10-06): one "Connect GitHub" from the landing, nothing typed that the repo already says.

1. Sign in with GitHub, then install the GitHub App on the chosen repositories ("all" or a selection, private ones included). Installing requires repo admin rights, which proves control.
2. One project per selected repository is created automatically: name, description, languages and default branch come from the repo. Every other field is optional and editable later.
3. Yarrow creates the `yarrow` label on each repository.

How it runs: "Get a pull request" and "Connect" go to `/connect/github` (GitHub sign-in, then the App install; the pasted ticket waits in a short-lived cookie). The signed `installation` webhook creates the projects in the installer's account: public repos are Public, private repos are Listed, repositories already on Yarrow are skipped. GitHub then returns the owner to the App's Setup URL, `/connect/done`, which queues the pasted ticket once its repository is connected. GitHub writes (creating the label, labeling the pasted ticket) are `github_tasks` carried out by the brain's cron; labeling the ticket is the owner's authorization, and the issues webhook queues it. Repo description, homepage, default branch and top languages fill only the fields the owner left empty.
4. Optionally connect a tracker and map each board to its repo. Supported trackers: GitHub Issues, Linear, Jira and Trello.
5. Tag tickets with the platform label (`yarrow`) or the tracker's equivalent. Only tagged tickets become work units.
6. Optional, to enable screenshots and videos: describe how to run the app.
   - Setup and start commands, plus a seed.
   - Development environment variables.
   - **Test or staging secrets only, never production.**
   - Secrets are stored write-only and encrypted. They are injected through the providers' vault mechanisms, so the agent never sees the values. A secret can only be used for HTTP calls to allowed hosts.
   - Apps that need a database use the one preinstalled in the sandbox, with the seed.

All four trackers are built. Until each has run live, the landing marks Linear and Trello as "soon" (decided 2026-10-07).

**Jira (decided 2026-10-08):** Jira holds the tickets, GitHub holds the code; GitHub stays the only code host (GitLab, Bitbucket and Azure DevOps would each need their own branch, commit, PR and merge plumbing, later and on demand). The landing offers Jira as soon as the deployment has its Atlassian OAuth app. The builder's journey:
1. Paste a Jira link (`acme.atlassian.net/browse/APP-42`, or a board link with `selectedIssue=`), or choose Jira and Connect.
2. GitHub first, as for every source: sign in and install the App. A builder who already has a connected repository skips it.
3. The dashboard shows a Jira card: the key, the site, and **Code in** (the repository). Without Jira yet: **Connect Jira** (Atlassian's consent, then back to the dashboard). With Jira: **Queue it** (or **Link** without a pasted ticket, with the Jira project to choose).
4. The Jira project (its key, `APP`) is linked to that repository, and the pasted ticket gets the `yarrow` label in Jira and enters the queue. Later pastes of `APP-*` tickets go straight to the queue.
5. The project's table lists its Jira tickets next to its GitHub issues (`APP-42` with Jira's blue mark); Add to queue and Remove put and take the label in Jira at once; labels set in Jira itself are picked up by the 5-minute sync.
6. Moves on the board (decided 2026-10-08): under each linked Jira project, the settings page sets where tickets move when Yarrow starts, when the PR opens and when it is merged, among the project's own statuses (columns follow statuses; names as the team wrote them) or "Don't move". Defaults are proposed once, without AI: started → the first "in progress" status that is not a review, PR → a status whose name reads like a review, if any, merged → don't move (many teams close after shipping). A fourth event, Yarrow stopped (the run abstained), is the builder's call too: don't move by default; it is the only move allowed to go backwards (to "to do", say). The brain moves the ticket at start and when the PR opens, the GitHub webhook when it is merged; a ticket never moves backwards, and a move the workflow refuses never blocks the work and shows on the settings page. The boards API (real column names) was set aside: reading a board's configuration needs Jira admin rights.
7. Delivery: the branch and the PR title keep the key in capitals (`yarrow/APP-42-…`, `APP-42 Fix…`) so Jira links them to the ticket, and Yarrow comments on the ticket with the PR.

One Jira project maps to one repository. Teams with one Jira project for several repositories wait for a V2 (for example, the repository chosen by the ticket's Component). Jira sites are named by their address (`acme.atlassian.net`).

Later: appear as an assignable agent in Linear and Jira, so owners can simply assign a ticket to "Yarrow".

### Visibility tiers (chosen by the owner, all free)

| Tier | Public view |
| --- | --- |
| **Public** | Code and PRs (open source) |
| **Listed** | Name, description, product URL, shipped work count. No code, no PRs |
| **Hidden** _(final name TBD)_ | Nothing. It only appears as "a private project" in aggregate stats |

- Hidden projects are funded like any other: "Every project" includes them (decided 2026-10-07; Listed projects already show no code or PRs, so an opt-in added a choice without meaning).
- Code is never shown to the platform team or to sponsors. Only the providers process it, through their API under commercial terms. Sandboxes are destroyed after each run.
- Ticket text and project descriptions are processed by the platform for triage and moderation (see Trust & safety). The terms say so.

## Sponsors

### Why sponsors pay

- **Advertisers:** companies selling to builders (dev tools, infrastructure, AI). They reach people actively shipping products, can target by stack, and get reporting: "your €500 shipped 140 tasks in 38 products".
- **Fans:** users of a product who fund its roadmap. Each project gets a shareable "Fund our roadmap" badge, so project owners bring their own sponsors.
- **Patrons:** individuals who like supporting builders.

The leaderboard is the game layer on top.

### Sponsor filters

- Two choices in the sponsor's Settings (decided 2026-10-07):
  - **Every project** (`all_except`, default): new projects are included automatically.
  - **Only the projects I choose** (`only`): a searchable list opens right under the option; new projects are **not** included.
- The ledger still supports excluded categories and required stacks, but the UI no longer offers them: projects created from GitHub have no category.
- If none of the selected projects has an eligible ticket, the credit stays unused. The dashboard says so.

### Launch and outreach

- **Founding pool, target $20,000**, raised from the founder and real founding sponsors. It is shown transparently as such.
- Founding sponsors get a permanent "Founding sponsor" badge and a reduced margin for life _(hypothesis)_.
- **No fake accounts or simulated activity.** The leaderboard and feed show only real money and real runs.
- Outreach order:
  1. a working demo on real projects (the founder's own and friends') with real PRs;
  2. individuals from the founder's network;
  3. mid-size builder-facing brands (founders reachable on X, tens of thousands of followers);
  4. large brands, once there are metrics.

  Before launch, ask for **pledges** that convert to payment at launch rather than upfront payment. Announce each founding sponsor publicly as social proof for the next one.

## Dashboard

Decided 2026-10-07 (mockup: claude.ai/artifact/GnHLGnxDoGuDdikpUk3T8i). One page, two tabs, **Builder** and **Sponsor**, shown only when the account has both roles. The avatar menu is Dashboard, Account and Sign out. **Account** (decided 2026-10-09) holds what belongs to the person, not to a role: the email (changed through a link mailed to the new address and opened while signed in, then a notice to the old one; Yarrow's own email, not Supabase's template), GitHub when signed in with it, the payments with each one's Stripe invoice (Checkout creates one per payment), and Delete my account (typed confirmation). Deleting keeps what the law and the ledger need (payments, invoices, the runs they paid for) and removes the person: accounts they were alone in see their projects leave every board and the queue, freeing the repository for a new install, and lose their tracker connections; the sponsor card turns anonymous and the credit left keeps funding every project; memberships and the Supabase sign-in go. The GitHub App stays installed until the person uninstalls it on GitHub.

- **Builder:** one table per project (a project rail appears from two projects; a select on phones). Rows are the repo's open GitHub issues, read live and never stored, plus the tickets Yarrow works on. Filters are the ticket's stage, each ticket in exactly one, with counts: To queue, In progress (queued, at work, or abstained), To review (PR open), Done (PR merged or closed); In progress opens first, To queue while nothing is in progress; Stopped (abstained: the builder's turn, edit then retry) sits after In progress and shows only when a ticket is there; plus search (decided 2026-10-08). A Kanban board was considered and set aside: only one move is the builder's (to the queue and back), and long backlogs fit a table better. A project is named after its repository, with no name of its own; the dashboard shows the repository's name, the public boards `owner/name` (listed projects too, without their tickets). Hovering a ticket's status opens a card with the run at a glance: its stages (Read, Write, Test, Review, PR), its milestones (Claude Opus at work, the review, the PR), the agent's last actions while it works, why it stopped when it abstained, and once the PR is open, the implementer's summary in three lines, signed by its model; clicking it opens the run's page with the whole feed (decided 2026-10-08). The run's page opens with the project, the ticket's key (a link to it) and its title, then the outcome (the draft PR, or why it stopped with the agents' questions as a list), what changed (signed by the implementer's model), the review, then how it happened (the feed), and a facts card (models, duration, cost, sponsors); the old timeline is gone, the feed tells it. The feed reads for people (decided 2026-10-09): files read, edited and created, the agent's thoughts, the tests and their results, the review; shell commands stay out, and so does the message closing each of the implementer's turns (it is the summary). The back arrow goes back where the visitor came from, home when the run was opened first. A run whose session was never read (a finished run from before the feed) is read once when someone opens it. The public Work page (every run) is gone (decided 2026-10-09): nothing linked to it, builders have their dashboard, sponsors their runs, visitors the landing's Live table and Shipped. The feed is read from the Claude session's events (tool calls and results, the agent's notes, errors; never its raw thinking) by the brain at each check and by a viewer's request while the run works, at most every few seconds whoever asks, plus Yarrow's own steps (phases, the review, the outcome). Members and public projects see files and commands; everyone else sees kinds and counts. Search looks in every stage (each stage then counts its matches) until a stage is picked. The project's head ends with a settings cog that names itself on hover. The settings page holds only what a builder changes (decided 2026-10-08): Connections (GitHub and Jira, each Connected or not, with Manage or Connect; Connect on Jira opens Atlassian's consent directly, then the site, and the Jira projects whose tickets the repository takes, ticked in a menu and saved at each tick (several projects per repository are fine); access removed in Atlassian shows as Disconnected, with Reconnect; Manage on Jira opens the person's Atlassian connected apps) and Visibility, saved as soon as it is chosen; no Save button. Gone from it: the project's name, repository, description and URL, categories and stacks (no sponsor filter uses them any more), the label (always `yarrow`, for the brand), and the ticket list (the dashboard has it). The run configuration and test secrets come back with screenshots, once R2 is on. Projects are only created by the GitHub App's installation: `/projects/new` leads there. Later, "Add a project" becomes a short flow: a code source (GitHub) and, optionally, a ticket source (Jira), and the builder may choose not to take GitHub's issues. Jira keys in the table carry Jira's logo (Simple Icons, CC0); Lucide draws no brand marks. The Builder and Sponsor titles show only for accounts that are both, as tabs. Queue and Remove from queue, row by row or in batch, add or remove the label through the brain; only rows they apply to can be selected, and the bar shows only the actions that apply. Retry requeues an abstained ticket. Statuses name the PR, never the issue: Not queued, Queued, Writing, Reviewing, PR #n, PR #n merged, PR #n closed, Abstained. A pasted ticket lands here highlighted. The rail opens with **To review**: the draft PRs of every project in one list, the only count in the rail. Every project loads in the background as soon as the dashboard opens, and the dashboard itself preloads from any page once a signed-in visitor is idle, so switching shows a copy at once and refreshes it (decided 2026-10-08). The project's logo tile in its head is the upload button.
- **Models** column (dashboard and landing): who wrote and who reviewed, with the reasoning level; hover or tap shows time, tokens and cost. Claude's numbers come from Anthropic (exact); the reviewer's tokens come from OpenAI, its cost is tokens × list price and its time is measured by Yarrow, both marked ≈.
- **Sponsor** (reworked 2026-10-09): the same sponsor board as the landing, with the sponsor's card in it (edited in place, "Move up" to pay more), then "Your name on": ticket (public tickets by name, others private), the project with its logo, when, status (hover for the run), the sponsor's share of the cost; each row opens the run's page (not on hidden projects). Beside the tabs: the balance, about how many tickets it still buys at this sponsor's average so far, what is at work, and "funds every project ▾" (every project or only the ones ticked, saved at each tick). Payments are on the Account page.

### Realtime

Decided 2026-10-07. Database triggers send a bare "changed" signal on Supabase Realtime (Broadcast from Database, `drizzle/0007_realtime.sql`); pages refetch through their own server functions, so no data travels on a channel and the access rules stay the server's. Channels: `boards` (public: landing boards, a settled payment, a profile change, a merge), `project:<id>` (private to the project's members: tickets, runs, label tasks, PRs), `sponsor:<user>` (private to that sponsor: their payments and the runs they fund). Private channels are checked by a policy on `realtime.messages`. Polling stays as a slow safety net. Rows that move slide to their new place, new rows fade in, changed values flash.

## Money

- **Sponsor packs:** $10 / $25 / $100, plus a **custom amount** in whole dollars between $10 and $1,000. The minimum avoids fixed Stripe fees eating small payments. The maximum limits fraud and chargeback exposure in v1.
- **Platform margin:** 10% of sponsor money excluding VAT _(hypothesis)_. It is the only revenue at launch.
- **Compute credit** = amount paid excluding VAT − actual Stripe fee − platform margin.
  - The Stripe fee comes from the Stripe balance transaction in the webhook, never from an estimate.
  - The fund page shows the business estimate (fees, margin, compute credit) with "VAT included where it applies"; no consumer toggle (decided 2026-10-07). Examples for $100:
    - a business (no VAT), US card: about $3.20 Stripe and $10.00 margin, so about **$86.80 compute**;
    - a French consumer, VAT-inclusive: $83.33 excluding VAT, about $3.20 Stripe and $8.33 margin, so about **$71.80 compute**.
- **VAT** is handled with Stripe Tax:
  - EU consumers pay VAT at their country's rate (prices shown VAT-inclusive);
  - EU businesses with a VAT number are reverse-charged.
- **Right of withdrawal:** EU consumers must give explicit consent to immediate start and acknowledge losing the 14-day withdrawal right before checkout.
- Compute credit is non-refundable as cash. Reserve before a run, debit actual cost, release the rest.
- USD only for now, integer cents.

## Work unit selection

- **A queue processed fast.** Tickets enter a queue and start as soon as money and provider rate limits allow. Runs execute in parallel.
- **Order: FIFO within each account, round-robin between accounts (organizations).**
  - When money is plentiful, this behaves like plain FIFO.
  - When money is scarce, it stops an account that enqueued thousands of tickets first from taking the whole pool. Waiting tickets start when new money arrives.
  - Creating several projects does not earn more turns.
- **Per-account concurrency limit** on sponsor-funded runs _(hypothesis: 5)_. It stops one account from draining the pool in a burst. It also keeps PRs at a pace owners can review and limits merge conflicts on the same repo.
- **Global concurrency** is bounded by provider rate limits, with backoff.
- A ticket is eligible for a sponsor's money only if its project matches that sponsor's filters.
- **No cost cap and no platform-side safety brake per ticket.** Heavy tickets are accepted. Runaway sessions are the providers' responsibility, since their harnesses have their own safeguards. Cost per run is still recorded in metrics, so anomalies are visible.
- **Correction requests** (`@yarrow-run <request>` on the PR):
  - unlimited;
  - each one is a normal run, funded the same way and with **no priority**;
  - it updates the same PR.

  Priority processing is a candidate for a later paid offer.

## Quality pipeline (free for everyone)

1. **Policy check:** the acceptable use policy is checked on the ticket and project description before any real spend.
2. **Implementation:** Opus implements the ticket with tests and lint.
   - Unclear-ticket path: Opus may flag the ticket as unclear instead of implementing it. Astra then re-reads the ticket.
   - If Astra also finds it unclear, the platform comments on the ticket asking for a better description, and the run ends as an abstention (`ticket_unclear`). The comment and the run's stop reason list one set of questions, Opus's (Astra's when Opus asked none): both agents ask the same things in their own words (decided 2026-10-08).
   - If Astra finds it clear, Opus proceeds with Astra's reading.
3. **Review:** Astra reviews the patch, systematically.
   - Astra classifies each comment as `blocking`, `suggestion` or `nit`. The review prompt is calibrated to be pragmatic, not pedantic.
   - Only `blocking` comments trigger Opus's **one fix round**.
   - The PR then opens.
   - Astra's final review is **published on the PR as a GitHub review**: a summary plus inline comments on remaining suggestions. The owner gets a visible free code review at no extra cost.
   - The implement → review → fix loop is an internal brain module (`ReviewLoop`), with the maximum rounds and the severity threshold in config.
4. **Evidence:** screenshots and video of the change, when the change is visible and the app can run in the sandbox. Uses Playwright and Chromium, installed as environment packages.
5. **PR readable in two minutes:**
   - what changed and why;
   - how it was verified (tests, screenshots/video);
   - the review summary and risks;
   - the smallest possible diff.

Only one PR ever reaches the repo.

Evidence files are stored in platform object storage (R2):
- Public and Listed projects get unguessable links in the PR body.
- Hidden projects get links to the authenticated run page only.

Track **cost per merged PR**, **merge rate** and **rejection reasons** from day one, and show the first two to sponsors.

## Trust & safety

- An **acceptable use policy** applies to all projects, including hidden ones.
- The policy check classifies tickets and project descriptions. Flagged items go to human review: ticket text and description only, never code.
- The platform can suspend a project. Sponsors can report one.
- Provider guardrails apply on top. They are not relied on alone.
- Brand safety is a sponsor concern: sponsors can exclude categories, and hidden projects are opt-in.

## Results

- Each run produces a **draft PR with an evidence bundle**, or an **abstention with a reason**.
- Abstentions consume the compute actually used.
- **Every PR carries attribution** in the PR body footer:
  ```
  Implemented by Claude Opus 5.5 · Reviewed by OpenAI Astra
  Sponsored by <sponsor names> via [Yarrow](<run URL>)
  ```
  - Names come from the contributions that funded the run, with each sponsor's public display name.
  - Anonymous sponsors appear as "an anonymous sponsor".
  - Naming the models is factual attribution, not product branding.
- Commits carry an `Assisted-by: Claude Opus 5.5, OpenAI Astra (Yarrow)` trailer.
  - Agents never add `Signed-off-by`.
  - On repos that require a DCO, the owner certifies when merging.
- Run pages respect the project's visibility tier.

## Leaderboards and showcase

Reworked 2026-10-09. The landing serves builders and sponsors in that order: the hero is the builder's way in, and beside it the proof a sponsor needs (real work, with sponsors' names on it); then the place a sponsor takes. **The landing is the one place a sponsor's card is made, edited and topped up**, right in their own row on the boards; the dashboard's Sponsor tab shows the card and its numbers and sends back there (decided 2026-10-09: one entry point, no second board).

- **Hero, two columns** (stacked under 1040px): the pitch and the ticket field on the left. The subtitle says why it is free ("Free because sponsors pay for the compute, and their names ship with every pull request"). The "or Connect GitHub to send your whole backlog" line is gone (decided 2026-10-09): pasting an issue ends in the same GitHub connection, and the line explained what the field already shows. On the right, the latest tickets as a column of compact rounded cards (reworked 2026-10-09): one card per ticket (project logo and owner/name, when as "16h ago", the title, private on listed projects, the status as a pill, "Paid by" the first sponsor with their logo; the issue number is not printed, it was noise). The column slides down slowly and without end (about five seconds per card) and stops while a card is hovered; three cards show whole, the previous and next half seen through a mask; the column is narrower than its half of the hero, with air on both sides. The status names the model at work, **"Claude Opus is writing"**, **"GPT Astra is reviewing"**, "Opening the PR", in the makers' colors as in the pitch: the frontier models are the brand, so the same words are used in the builder and sponsor dashboards (`workLabel` in `src/core/tickets.ts`). Under the column, the platform's totals: tickets in progress, merged PRs ever. On phones the hero starts closer to the header and each card takes three lines.
- **Sponsors** (reworked 2026-10-09): "Sponsors" on the left of the head ("Paid for by", centered, was tried and dropped the same day), and on the right the viewer's standing ("You #3 today · #10 all time", or "Unranked today") then the amount field and one button, "Claim #N today · #M all time", the ranks following the amount as it is typed. Ranked by **money paid** (what the card was charged, VAT included; decided 2026-10-07), as two hairline lists side by side, **Today** then **All time** (stacked on phones), each with its total in its head. Today resets at midnight UTC: the cheap place to take, every day; All time is the record. Showing both at once is the point (the Today / All time switch of 2026-10-09 hid one of them, and one board alone goes dead once the top is out of a small budget's reach). Paying moves a sponsor up at once.
  - Each row: rank (large and amber for the top three), logo (the uploaded one, or the initial on a plain tile; no colored tiles), name (the row opens the website, counted through a Yarrow redirect) with the tagline, the description only for the top three, and on the right the amount with **clicks and merged PRs always shown, zeros included** (anonymous rows have no clicks). On phones the stats go under the name and descriptions drop, except on the viewer's row. No domain printed, no spent bar, no boxes: cards read as generated.
  - **The visitor's own row is in both boards**, drawn exactly like the others plus a "You" tag that never truncates, its own description always shown, and its all-time stats: at their place once they paid in the period, otherwise at the place $10 takes ("Your company here" until a name is typed). A sponsor's row also shows a discreet "Edit".
  - **The row is the form** (decided 2026-10-09, replacing a card opened above or under the boards): Claim, the standing, "Edit" or the row itself opens the viewer's row in Today (or in All time, when that is the row clicked) as its own form, in place: logo, name · tagline, description and website where they print, the amount where it prints; under them, what the amount buys (**card fees ≈, margin 10% or 5% for founding sponsors, compute ≈**), Stay anonymous, the withdrawal waiver (compute starts right away), Cancel (Close for a sponsor) and the same Claim button, which opens Stripe Checkout. The row moves to the place the amount takes as it is typed, and the row on the other board follows every keystroke. The rows move through CSS `order` so the row being typed in never leaves its place in the page (focus is kept). A sponsor already on the boards has their card saved as each field is left, and their amount adds to what they paid. The first ten places show; a row further down shows after a gap.
  - **The dashboard's Sponsor tab**: the card as the boards print it (logo, name · tagline, description, website) with "Add credit" and "Edit", both opening the landing with the viewer's row open (`/?edit=true#sponsors`); beside it the balance (≈ tickets it buys, what is at work), today's and all-time ranks, clicks and merged PRs, and where the money goes (every project or chosen ones); then "Funded by you", the tickets their money worked on. A sponsor's credit left also shows in the header, beside the avatar, as a link to the Sponsor tab.
  - Excluded: promo credits and refunds. Anonymous sponsors are ranked as "Anonymous sponsor", with no profile, link or clicks (decided 2026-10-07).
- **Shipped:** ranks projects by merged PRs (its own page). Public and Listed projects only. This is the owners' exposure.

## Metrics

Every meaningful action writes an append-only event in Postgres from day one. Dashboards come later.

- **Owners:**
  - signups, repos and trackers connected, tickets tagged;
  - time to first PR;
  - merge rate, time to merge, **rejection reasons**;
  - correction requests per PR;
  - unclear-ticket rate;
  - owners going inactive.
- **Runs:**
  - cost and duration per run, cost per merged PR, tokens and sandbox time per provider;
  - review: share of `blocking` comments, fix-round outcome;
  - abstention reasons, provider errors and rate-limit hits;
  - concurrency.
- **Sponsors:**
  - visit → sponsor conversion, average and repeat contribution;
  - time from payment to consumption;
  - filter usage;
  - leaderboard and showcase views.
- **Platform:** revenue (margin), pool balance, burn rate, days of activity left in the pool.

## Brand (decided 2026-10-06)

- **Name: Yarrow** (the plant, _achillée millefeuille_ in French). It replaces the working name "Agent Commons" (app and GitHub repo renamed on 2026-10-06).
  - `yarrow.run` bought on 2026-10-06 (Cloudflare Registrar, auto-renew off). Still to do: file the trademark.
  - No "Yarrow" trademark was found in the EU and French software classes (9 and 42).
- **GitHub names:** the ticket label is `yarrow`; the correction mention is `@yarrow-run`, also the prod GitHub App slug (`yarrow-run-dev` in dev). Never `@yarrow`: that GitHub account belongs to someone else and would be notified on every request.
- **Logo:** five small florets around a pollen heart, each floret being five petals around its own heart. A yarrow "flower" is really many tiny flowers, like a commons made of small contributions.
- **Palette "Nuit":** night `#141714`, cream `#F5F0E3`, pollen `#E6AE38`. Avoid orange or terracotta as a brand colour: too close to Claude's.
- **Landing title:** "Frontier AI for free", no comma, no period; the subtitle carries the detail (paste an issue, Claude Opus and GPT Astra turn it into a pull request in minutes, sponsors' names ship with every PR). Sources marked "soon" show in the picker but cannot be chosen.
- **Typography:** the wordmark is "yarrow" in lowercase Jost Medium, outlined in the logo files. Jost for headings, Geist stays for UI text. Both fonts are under the OFL.
- **Files:** `public/brand/` (logos) and the favicons, app icons and manifest at the root of `public/`, all generated by `pnpm brand:assets` from the parameters in `scripts/brand-assets.ts`. Change the parameters and rerun; never edit the files by hand.

## Company

The operating entity is the founder's existing EURL, TOTEM (RCS Nanterre 881 263 503), subject to VAT. A dedicated company with its own address and email may replace it if Yarrow ships. Legal notice, Terms and Privacy live at /legal, /terms and /privacy (drafted 2026-10-07; to have reviewed before live payments, and a consumer mediator to name). Before switching Stripe to live payments, configure Stripe Tax:
- French VAT (20%) by default; VAT is due when the sponsor pays, not when the credit is consumed.
- EU businesses with a VAT number: reverse charge ("autoliquidation", no VAT on the invoice).
- EU individuals: French VAT until cross-border sales to individuals pass €10,000 a year, then the customer's country VAT through the One-Stop Shop (OSS). This depends on whether sponsoring counts as an electronically supplied service: the one point worth a professional opinion.
- A compliant invoice for every payment.

## Terminology

- Never "donation" / "don".
  - In France (and in many other countries), a "don" implies a gift to a qualifying non-profit, giving the right to a tax reduction and a tax receipt.
  - Yarrow is a commercial platform with a margin, and sponsors get visibility in return. Calling payments "dons" would be misleading.
  - For companies, sponsoring is usually a deductible advertising expense ("parrainage"). Confirm with an accountant.
- Use **sponsor**, **sponsoring**, **contribution** (code and ledger) and **compute credit**.

## Scope

**v1**
- Landing.
- Sponsor checkout (packs + custom amount). The profile form is the sponsor's own board row, edited in place, with the rank today for the amount chosen (decided 2026-10-07). Its logo tile is the upload button.
- Logos (sponsors and projects): the browser draws the file at 128 px (WebP, PNG fallback) and the server keeps it in Postgres (`images`, by SHA-256), served at `/images/<hash>.<ext>` with a one-year immutable cache. PNG, JPEG and WebP only, checked by their bytes; never SVG. A project without a logo shows its GitHub owner's avatar, on public projects only for the public boards (decided 2026-10-08).
- Sponsor dashboard with filters, including the hidden opt-in.
- Leaderboard and projects showcase.
- Add project: the GitHub App, plus **all four trackers** (GitHub Issues, Linear, Jira, Trello) behind one `TrackerAdapter` interface. The interface lists tagged tickets, reads a ticket, comments, and receives webhooks or polls.
- Public, Listed and Hidden tiers.
- Fair rotation per account.
- Two runners: Opus implements, Astra reviews (with one fix round), and the unclear-ticket double check.
- Screenshots and video when the app can run in the sandbox. Project run configuration and test secrets.
- Trust & safety basics.
- PR or abstention, with sponsor attribution, and correction requests on the PR.
- Login: GitHub for builders (Supabase Auth). Sponsors never need GitHub: Stripe Checkout collects the email, and the account is reached through an email sign-in link (decided 2026-10-06). A guest payment is held by a placeholder sponsor (`sponsor_profiles.guest`). The browser that paid is recognized at once by a signed HttpOnly cookie: back from Stripe, the guest lands on the Sponsor tab with no email to click; later payments from that browser add to the same row. The cookie only ever opens that guest's own sponsoring, never an account (Stripe does not verify emails). After each payment Yarrow sends its own thank-you email through Resend, with the sponsor's place and a one-time sign-in link for guests (Supabase admin link). Signing in (that link, the email form or GitHub) moves the guest's payments to the account, matched by verified email or by this browser's cookie; an existing profile is never renamed by someone else's payment (decided 2026-10-07). The Supabase "Magic Link" template points to `/auth/confirm?token_hash=…` so the link works on any device.
- Event log and metrics from day one.
- `Contribution → AgentRun → WorkUnit → Result` with reserve/debit/release.

**Later** (decided from metrics and feedback)
- A paid offer for owners, for example priority processing, owner top-ups and more powerful models.
- Separate handling of non-code tickets (analysis, architecture, ideation).
- **Best-of-two in parallel:** both providers implement the same ticket, and a judge keeps the better patch based on tests, acceptance criteria and cross-reviews. It costs about 2.2× on every ticket.
  - Ship it as an experiment flag, at first on tickets that triage marks as hard.
  - Keep it only if the merge-rate gain justifies the cost per merged PR.

**Out of scope (parked)**
- **Sponsors contributing their own subscriptions** (Claude, ChatGPT/Codex, Cursor).
  - "Sign in with ChatGPT" plan usage is dropped: approval is selective.
  - A sponsor-created Claude routine pulling work from our MCP is parked until Anthropic confirms in writing that it fits "ordinary, individual usage".
  - The platform must never hold or trigger a sponsor's subscription credentials.
- Custom repo memory: left to the labs' own agent tooling.
- Monetary rewards for sponsors.

## Repo

Standalone GitHub `KevTale/yarrow` (not inside saas-forge).
