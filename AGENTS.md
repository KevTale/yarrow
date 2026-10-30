# Yarrow

Sponsors fund AI compute; builders get their tagged tickets turned into draft PRs. [docs/mvp/BUILD.md](docs/mvp/BUILD.md) is the source of truth for product decisions: read it before changing behavior, and update it when a decision changes.

## Stack

- **Web (`src/`):** TanStack Start (file routes in `src/routes/`, server functions in `src/functions/`) on Cloudflare Workers via `@cloudflare/vite-plugin`. `src/routeTree.gen.ts` is generated: never edit it.
- **Brain (`workers/brain.ts`):** cron dispatcher + one durable Workflow per run. Claude Managed Agents implements, the OpenAI Agents API reviews (`src/runner/`).
- **Admin (`workers/admin.ts`):** admin.yarrow.run behind Cloudflare Access, no secret: it reads and writes through the brain's `Admin` entrypoint.
- **Data:** Supabase Postgres through Drizzle (`src/db/`), server-side only. Every table has RLS with no policy. Amounts are integer USD cents.
- **Shared rules:** `src/core/` (pricing, packs, queue, contracts) has no I/O and runs in both Workers.
- **Video (`video/`):** Remotion promo films, their own pnpm workspace (`pnpm install` inside `video/`). Scenes import the real `src/core/` rules (pricing, PR card); the Remotion skills live in `.claude/skills/`.

These libraries move fast. Check the installed version in `node_modules` before relying on an API from memory.

## Commands

```bash
pnpm dev            # web on :3000
pnpm check          # lint, typecheck (web + brain), unit tests, build
pnpm test:e2e       # Playwright on the production build (run pnpm build first)
pnpm db:generate    # new Drizzle migration after editing src/db/schema.ts
pnpm bench <name>   # a real ticket on a bench repo, answered by Yarrow dev, checked (pnpm bench list)
pnpm --dir video studio   # preview the promo film
pnpm --dir video render   # video/out/yarrow-launch.mp4
```

Unit tests run real SQL on PGlite (`tests/unit/helpers/pglite.ts`); provider APIs are mocked from their docs. The bench (`bench/`) is the live check: `bench/app` is a small app pushed to the bench repositories, `bench/scenarios.ts` the tickets and what Yarrow must make of them. Run a scenario after changing what the agents do or deliver; it costs what a ticket costs.

## Rules

- Never write "donation" or "don": sponsors **fund compute**.
- Platform API keys only. Never use, store or trigger a Claude, ChatGPT or other consumer subscription.
- Never store project secrets: only references to the provider vault.
- Test or staging credentials only in `.env` / `.dev.vars`; never production, never in chat or commits.
- The only GitHub write path is the brain through the GitHub App. Sandboxes get read-only tokens.
- Ledger writes are idempotent and transactional (`src/db/ledger.ts`); keep it that way.
