# Agent Commons v1 — synthèse des 3 avis (2026-10-05)

Sources : `reviews/chatgpt.md`, `reviews/codex-astra.md`, `reviews/claude-opus.md`.

## Verdict commun

**Oui, la v1 est construisible en ~5 jours** avec tout le scope figé : landing + packs Stripe $5/$20/$100, leaderboard par $, commons + commercial dès le jour 1, GitHub + Jira, orchestrateur (plus d’A/B) qui livre une PR ou s’abstient.

Socle à réutiliser dans **saas-forge** : `apps/agent-commons` (+ éventuellement un petit package métier / un runner).

## Consensus fonctionnel

- Un compte, deux portes : **Fund AI work** / **Add a project**.
- Contribution → AgentRun → WorkUnit → Result (visible dans « mon activité »).
- Budget compute **non retirable** ; réserver avant d’exécuter ; débiter le réel ; libérer le reste.
- Pools **commons** et **commercial** séparés en base (même moteur, destinations différentes).
- Leaderboard = $ encaissés (hors crédits promo) ; les PR sont une métrique à part.
- Livraison = **PR** (idéalement draft) + dossier de preuve ; abstention avec motif si non actionable.
- GitHub App + label d’autorisation ; Jira OAuth (site dédié, jamais ecoagile) + commentaire/lien PR.

## Divergence unique qui compte : où tournent les agents

| | ChatGPT | Codex Astra | Claude Opus |
|---|---|---|---|
| UI / Stripe / webhooks | CF Workers | CF Workers | CF Workers |
| Cerveau (choix, réserve, valid.) | CF Workflows | **VPS** Node | **CF Worker** (Queue + crons) |
| Exécution agents (clone, code, tests) | **CF Sandboxes** | **E2B** (via VPS) | **VPS** Docker + gVisor |
| VPS au lancement ? | Non | Oui | Oui |

Les trois disent la même chose sur le fond : un Worker seul ne peut pas faire tourner un agent 20 min avec `npm install`. ChatGPT parie sur les Sandboxes Cloudflare récents ; Codex et Claude parient sur une machine Linux à côté.

## Recommandation (CEO)

**Plan Claude, sandbox style Codex si besoin :**

1. **Cerveau sur Cloudflare** (Queue + Postgres) — même schéma que rapport-deco, UI et ledger restent la source de vérité.
2. **Mains sur un VPS** (Hetzner) : runner qui *pull* le travail (`claim` + heartbeat), aucune DB ouverte, clés LLM hors sandbox.
3. Isolation : Docker + gVisor en v1 (repos Kevin) ; interface `SandboxProvider` pour basculer vers E2B / CF Sandboxes plus tard.
4. Repo : `apps/agent-commons` dans saas-forge ; règles métier hors de `@forge/core`.

Pourquoi pas « tout Cloudflare » dès demain : moins de surprise ops pour un solo qui a déjà le VPS et le pattern Queue du socle ; on garde la porte ouverte vers les Sandboxes CF.

## Plan demain (condensé)

- **J0** : app GitHub + OAuth Jira (site démo) + produits Stripe test + schéma ledger + 2–3 repos démo avec issues.
- **J1–J2** : landing, packs, checkout, leaderboard, mon activité.
- **J2–J3** : Add project (GH App + Jira poll léger), work units.
- **J3–J4** : runner + un agent (Claude Code *ou* Codex CLI, clés API plateforme) → PR.
- **J5** : critique/validation, attribution $, commercial, polish, kill switch admin.

Coupes de secours si débordement : Jira « Sync now » sans cron ; projets commerciaux créés par admin ; un seul agent CLI.

## Fichiers

- `file:///workspace/agent-commons/mvp/reviews/chatgpt.md`
- `file:///workspace/agent-commons/mvp/reviews/codex-astra.md`
- `file:///workspace/agent-commons/mvp/reviews/claude-opus.md`


## Décision exécution (2026-10-05, mise à jour)

Kevin choisit **Cloudflare Sandboxes** pour le MVP (simplicité), pas Hetzner.

- Workers = boutique (UI, Stripe, ledger, webhooks)
- Workflow/Queue = cerveau
- Cloudflare Sandbox = atelier Linux (agents, git, tests)
- Abstraction `Runner` dès J0 → `CloudflareSandboxRunner` maintenant, `HetznerRunner` possible plus tard

## Maquettes

- Astra : `/workspace/agent-commons/mvp/mockups/astra/` (6 HTML + README)
- Opus : `/workspace/agent-commons/mvp/mockups/opus/` (6 HTML + README)
