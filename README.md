# Yarrow

Fund the compute. Ship the PR.

Yarrow s'adresse aux gens qui construisent du logiciel : SaaS, jeux, outils, open source ou non. Des **sponsors** financent du compute IA, et des **porteurs de projets** connectent leur repo et leur tracker (GitHub Issues, Linear, Jira, Trello) pour faire traiter **gratuitement** leurs tickets tagués. Chaque ticket donne l'un de ces deux résultats :

- une PR draft signée `Sponsored by <sponsors> via Yarrow` ;
- une abstention motivée.

Claude Opus 5.5 implémente via Claude Managed Agents, OpenAI Astra relit via l'Agents API d'OpenAI. Les agents tournent entièrement chez les fournisseurs : la plateforme n'héberge aucun environnement d'exécution.

[BUILD.md](docs/mvp/BUILD.md) fait foi pour les décisions produit. La [synthèse](docs/mvp/synthese.md) est un historique des options étudiées.

## Lancer en local

Prérequis : **Node.js 22+** et **pnpm** (version dans `packageManager`).

```bash
corepack enable
pnpm install
pnpm dev                        # http://localhost:3000
```

Aucun secret n'est requis pour l'interface. Sans base de données, les pages publiques affichent leur état vide et les intégrations répondent « not configured ». Pour brancher une intégration, copier [`.dev.vars.example`](.dev.vars.example) en `.dev.vars` et ne remplir que ce dont on a besoin, avec des valeurs de test uniquement.

## Pages

| Route                                   | Rôle                                                                        |
| --------------------------------------- | --------------------------------------------------------------------------- |
| `/`                                     | Landing : chiffres réels, derniers runs, sponsors                           |
| `/fund`                                 | Packs $10 / $25 / $100 ou montant libre, estimation du crédit, Stripe       |
| `/leaderboard`                          | Sponsors classés par compute consommé ; le crédit restant est « committed » |
| `/showcase`                             | Projets visibles et leurs PR                                                |
| `/work`, `/runs/$runId`                 | Flux des runs, détail : timeline, review, captures, coût, sponsors          |
| `/dashboard`                            | Espace sponsor et porteur : contributions, projets, runs                    |
| `/sponsor/filters`                      | Périmètre du sponsor : `all_except` / `only`, catégories, stacks, cachés    |
| `/projects/new`, `/projects/$projectId` | Création, GitHub App, tracker, configuration de lancement, secrets          |
| `/sign-in`                              | Connexion GitHub via Supabase Auth                                          |

Endpoints serveur : `/auth/*` (OAuth GitHub), `/api/webhooks/stripe`, `/api/webhooks/github`, `/integrations/*` (OAuth Linear et Jira, jeton Trello) et `/evidence/*` (captures et vidéos stockées dans R2).

## Architecture

```text
src/routes/       Pages et endpoints TanStack Start
src/functions/    Server functions appelées par les pages
src/components/   Composants UI
src/core/         Règles pures : prix, packs, file d'attente, contrats, attribution
src/db/           Schéma Drizzle, ledger transactionnel, lectures
src/server/       Auth Supabase, Stripe, GitHub App, Linear/Jira/Trello
src/runner/       Clients Managed Agents et Agents API, prompts, pipeline d'un run
workers/          Cerveau : dispatcher cron + Workflow durable par run
scripts/          Création unique de l'agent Claude et de son environnement
drizzle/          Migrations SQL
tests/            Tests unitaires (vrai SQL via PGlite) et Playwright
```

Deux Workers Cloudflare :

- **la boutique** (`wrangler.jsonc`) : UI, auth, paiements, webhooks, tableaux de bord ;
- **le cerveau** (`workers/wrangler.jsonc`) : chaque minute, il choisit les tickets à traiter (FIFO par compte, tour de rôle entre comptes, 5 runs en parallèle max par compte) et lance un Workflow par run. Toutes les 5 minutes, il synchronise Linear, Jira et Trello.

Détails dans [l'architecture](docs/architecture.md).

## Environnements

| | Adresse | Déploiement | Supabase | GitHub App |
|---|---|---|---|---|
| **local** | `localhost:3000` | `pnpm dev`, `pnpm brain:dev` | `yarrow-dev` | `yarrow-run-dev` |
| **dev** | `dev.yarrow.run` | chaque push sur `main` | `yarrow-dev` | `yarrow-run-dev` |
| **prod** | `yarrow.run` | chaque push sur `prod` (`git push origin main:prod`) | `yarrow-prod` | `yarrow-run` |

Le workflow [`deploy.yml`](.github/workflows/deploy.yml) lance lint, typecheck et tests, puis `pnpm deploy:dev` ou `pnpm deploy:prod` (boutique et cerveau). Il lui faut un seul secret de dépôt, `CLOUDFLARE_API_TOKEN` (modèle « Edit Cloudflare Workers », avec la zone `yarrow.run`). Les valeurs publiques de chaque environnement sont dans `wrangler.jsonc` et `workers/wrangler.jsonc` ; les secrets se posent une fois par environnement :

```bash
pnpm exec wrangler secret put NOM --env dev                                 # boutique
pnpm exec wrangler secret put NOM --config workers/wrangler.jsonc --env dev # cerveau
```

## Mise en ligne

À faire une fois par environnement, en commençant par dev :

1. **Base :** les migrations sont appliquées sur les deux projets Supabase (`yarrow-dev`, `yarrow-prod`). Renseigner `DATABASE_URL` (pooler transactionnel) dans les deux Workers.
2. **Auth (Supabase) :** provider GitHub avec le Client ID et un client secret de la GitHub App ci-dessous. URL Configuration : Site URL `<APP_URL>`, redirection `<APP_URL>/**`. Email : OTP expiry à 86400 s (les liens de connexion durent 24 h).
3. **GitHub App** (`yarrow-run-dev` pour dev et le local, `yarrow-run` pour la prod, installable par **n'importe quel compte**) :
   - permissions de dépôt : Contents, Pull requests et Issues en écriture, Metadata en lecture ; permission de compte : Email addresses en lecture (connexion Supabase) ;
   - événements : Installation, Installation repositories, Issues, Issue comment, Pull request, Repository ;
   - webhook : `<APP_URL>/api/webhooks/github` ;
   - Callback URL : `https://<ref Supabase>.supabase.co/auth/v1/callback` ; Setup URL : `<APP_URL>/connect/done`, avec « Redirect on update ».
4. **Stripe :** webhook `<APP_URL>/api/webhooks/stripe` avec `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded` et `charge.dispute.created`. Activer Stripe Tax puis `STRIPE_TAX=on`.
5. **Fournisseurs :** clés API Anthropic et OpenAI de la plateforme. `scripts/set-secrets.ps1` propose de créer l'agent Claude et son environnement avec la clé saisie (`pnpm bootstrap:anthropic`) et pose `ANTHROPIC_AGENT_ID` et `ANTHROPIC_ENVIRONMENT_ID`. Activer la recharge automatique sur les deux consoles (avec un plafond mensuel) : quand un compte est vide malgré tout, les tickets restent dans la file, la distribution se met en pause et l'alerte part par Resend si le cerveau a `RESEND_API_KEY`.
6. **Trackers :** applications OAuth Linear et Jira, clé Trello, et `TOKEN_ENCRYPTION_KEY` (identique dans les deux Workers). Jira, une app par environnement (« Yarrow dev », « Yarrow ») sur [developer.atlassian.com/console/myapps](https://developer.atlassian.com/console/myapps/) :
   - *Create* > *OAuth 2.0 integration* ;
   - *Permissions* > *Jira API* > *Add*, puis *Configure* > *Edit Scopes* : `read:jira-work` et `write:jira-work` (Yarrow demande aussi `offline_access` à la connexion) ;
   - *Authorization* > *OAuth 2.0 (3LO)* > *Callback URL* : `<APP_URL>/integrations/jira/callback` ;
   - *Distribution* > *Sharing*, pour que n'importe quel site Jira puisse se connecter (nom de l'éditeur, politique de confidentialité `<APP_URL>/privacy`) ;
   - *Settings* : Client ID et Secret, posés dans les deux Workers par `scripts/set-secrets.ps1 -Target <env> -Jira`.
7. **R2 :** activer R2 dans le tableau de bord Cloudflare, puis créer les buckets `yarrow-evidence-dev` et `yarrow-evidence` (fait le 2026-10-15). Les deux Workers les lient sous `EVIDENCE` ; en local, R2 est simulé.
8. **Secrets :** chaque secret avec `wrangler secret put` (voir [Environnements](#environnements)), puis un push sur la branche de l'environnement.

La liste complète des secrets est dans [`.dev.vars.example`](.dev.vars.example) et [`workers/.dev.vars.example`](workers/.dev.vars.example). Pour couper la distribution des runs sans rien redéployer : `DISPATCH=off` sur le cerveau.

## Vérifications

```bash
pnpm check                      # lint, typecheck (boutique + cerveau), tests unitaires, build
pnpm exec playwright install chromium
pnpm test:e2e                   # desktop et mobile, sur le build de production
pnpm brain:check                # bundle du cerveau en dry-run, sans déploiement
```

Les tests unitaires appliquent les migrations sur un PostgreSQL embarqué (PGlite) : ledger, filtres sponsors, file d'attente, webhooks GitHub et Stripe, trackers et pipeline d'un run. Les API des fournisseurs y sont simulées d'après leur documentation : seul un vrai run confirmera les deux API d'agents, encore en bêta.

## Base de données

Supabase Postgres + Drizzle, uniquement côté serveur. RLS activée sur toutes les tables, sans policy : le navigateur n'a accès à rien. Montants en cents USD.

```bash
pnpm db:generate                # nouvelle migration après une modification de src/db/schema.ts
pnpm db:migrate                 # lit DATABASE_URL dans le shell ou dans .env
```
