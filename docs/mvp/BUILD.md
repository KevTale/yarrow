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
- **Environments:** local and `dev.yarrow.run` share the dev Supabase project, Stripe test mode and the `yarrow-run-dev` GitHub App; `yarrow.run` has its own Supabase project and the `yarrow-run` App. Every push to `main` deploys dev, every push to `prod` deploys prod (GitHub Actions).
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

1. Sign up.
2. Connect the GitHub repo through the GitHub App. Installing it requires repo admin rights, which proves control.
3. Optionally connect a tracker and map each board to its repo. Supported trackers: GitHub Issues, Linear, Jira and Trello.
4. Tag tickets with the platform label (`yarrow`) or the tracker's equivalent. Only tagged tickets become work units.
5. Optional, to enable screenshots and videos: describe how to run the app.
   - Setup and start commands, plus a seed.
   - Development environment variables.
   - **Test or staging secrets only, never production.**
   - Secrets are stored write-only and encrypted. They are injected through the providers' vault mechanisms, so the agent never sees the values. A secret can only be used for HTTP calls to allowed hosts.
   - Apps that need a database use the one preinstalled in the sandbox, with the seed.

All four trackers are available at launch. Build order: GitHub Issues → Linear → Trello → Jira. Jira goes last because it is the most complex: Atlassian OAuth, site admin rights, custom fields.

Later: appear as an assignable agent in Linear and Jira, so owners can simply assign a ticket to "Yarrow".

### Visibility tiers (chosen by the owner, all free)

| Tier | Public view |
| --- | --- |
| **Public** | Code and PRs (open source) |
| **Listed** | Name, description, product URL, shipped work count. No code, no PRs |
| **Hidden** _(final name TBD)_ | Nothing. It only appears as "a private project" in aggregate stats |

- Hidden projects only receive money from sponsors who explicitly accepted hidden projects. Owners are told that this may mean less compute.
- Code is never shown to the platform team or to sponsors. Only the providers process it, through their API under commercial terms. Sandboxes are destroyed after each run.
- Ticket text and project descriptions are processed by the platform for triage and moderation (see Trust & safety). The terms say so.

## Sponsors

### Why sponsors pay

- **Advertisers:** companies selling to builders (dev tools, infrastructure, AI). They reach people actively shipping products, can target by stack, and get reporting: "your €500 shipped 140 tasks in 38 products".
- **Fans:** users of a product who fund its roadmap. Each project gets a shareable "Fund our roadmap" badge, so project owners bring their own sponsors.
- **Patrons:** individuals who like supporting builders.

The leaderboard is the game layer on top.

### Sponsor filters

- Two modes:
  - `all_except` (default): every eligible project, minus excluded categories and projects. New projects are included automatically.
  - `only`: after "deselect all", only the checked projects. New projects are **not** included.
- Filters by category, by stack, by project size, and by individual project.
- **Hidden projects are opt-in by the sponsor**, and excluded by default.
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

## Money

- **Sponsor packs:** $10 / $25 / $100, plus a **custom amount** in whole dollars between $10 and $1,000. The minimum avoids fixed Stripe fees eating small payments. The maximum limits fraud and chargeback exposure in v1.
- **Platform margin:** 10% of sponsor money excluding VAT _(hypothesis)_. It is the only revenue at launch.
- **Compute credit** = amount paid excluding VAT − actual Stripe fee − platform margin.
  - The Stripe fee comes from the Stripe balance transaction in the webhook, never from an estimate.
  - Checkout shows an estimated breakdown before payment. Examples for $100:
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
   - If Astra also finds it unclear, the platform comments on the ticket asking for a better description, and the run ends as an abstention (`ticket_unclear`).
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

- **Sponsors:** ranked by **$ of compute consumed**.
  - Excluded: promo credits, refunds and anonymous sponsors.
  - Paid but not yet consumed credit is shown next to the name as "committed". It never counts toward rank.
- **Projects showcase:** Public and Listed projects with their shipped work. This is the owners' exposure.
- Merged PRs are shown as a separate metric.

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
  - Still to do: buy the domains (`yarrow.run` and `useyarrow.com` were free on 2026-10-06) and file the trademark.
  - No "Yarrow" trademark was found in the EU and French software classes (9 and 42).
- **GitHub names:** the ticket label is `yarrow`; the correction mention is `@yarrow-run`, also the prod GitHub App slug (`yarrow-run-dev` in dev). Never `@yarrow`: that GitHub account belongs to someone else and would be notified on every request.
- **Logo:** five small florets around a pollen heart, each floret being five petals around its own heart. A yarrow "flower" is really many tiny flowers, like a commons made of small contributions.
- **Palette "Nuit":** night `#141714`, cream `#F5F0E3`, pollen `#E6AE38`. Avoid orange or terracotta as a brand colour: too close to Claude's.
- **Typography:** the wordmark is "yarrow" in lowercase Jost Medium, outlined in the logo files. Jost for headings, Geist stays for UI text. Both fonts are under the OFL.
- **Files:** `public/brand/` (logos) and the favicons, app icons and manifest at the root of `public/`, all generated by `pnpm brand:assets` from the parameters in `scripts/brand-assets.ts`. Change the parameters and rerun; never edit the files by hand.

## Company

The operating entity is the founder's existing EURL, subject to VAT. Before switching Stripe to live payments, configure Stripe Tax:
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
- Sponsor checkout (packs + custom amount).
- Sponsor dashboard with filters, including the hidden opt-in.
- Leaderboard and projects showcase.
- Add project: the GitHub App, plus **all four trackers** (GitHub Issues, Linear, Jira, Trello) behind one `TrackerAdapter` interface. The interface lists tagged tickets, reads a ticket, comments, and receives webhooks or polls.
- Public, Listed and Hidden tiers.
- Fair rotation per account.
- Two runners: Opus implements, Astra reviews (with one fix round), and the unclear-ticket double check.
- Screenshots and video when the app can run in the sandbox. Project run configuration and test secrets.
- Trust & safety basics.
- PR or abstention, with sponsor attribution, and correction requests on the PR.
- GitHub login (Supabase Auth).
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
