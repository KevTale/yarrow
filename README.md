# Agent Commons

Fund the compute. Ship the PR.

Agent Commons s'adresse aux gens qui construisent du logiciel : SaaS, jeux, outils, open source ou non. Des **sponsors** financent du compute IA, et des **porteurs de projets** connectent leur repo et leur tracker (GitHub Issues, Linear, Jira, Trello) pour faire traiter **gratuitement** leurs tickets tagués. La plateforme choisit la work unit à traiter, puis livre l'un de ces deux résultats :

- une PR draft signée `Sponsored by <sponsors> via Agent Commons` ;
- une abstention motivée.

Les agents tournent entièrement chez les fournisseurs : Claude Managed Agents et l'Agents API d'OpenAI. La plateforme n'héberge aucun environnement d'exécution. Un compte, deux actions : **Fund AI work** / **Add a project**. Il n'y a qu'un seul pool : par défaut, tout sponsor finance tous les projets visibles, et il peut en exclure par catégorie, par stack ou par projet. Au lancement, tout est gratuit pour les porteurs de projets, y compris le niveau caché.

Ce dépôt est un scaffold MVP :

- une application Next.js en TypeScript strict ;
- une UI dark ledger inspirée des [maquettes Opus](docs/mvp/opus/README.md) ;
- un cerveau Cloudflare Queue → Workflow → `Runner`.

> **Le brief a changé le 2026-10-05.** [BUILD.md](docs/mvp/BUILD.md) fait foi. Le code n'est pas encore aligné : voir [Écart entre le code et le brief](#écart-entre-le-code-et-le-brief).

## Lancer en local

Prérequis : **Node.js 22+** et **pnpm 12.6.0**. Wrangler requiert Node 22 ; la version est indiquée dans `.nvmrc`.

```bash
nvm use                         # si nvm est installé
corepack enable                # si pnpm n'est pas déjà disponible
corepack prepare pnpm@12.6.0 --activate
pnpm install
cp .env.example .env.local      # facultatif : aucun secret requis pour l'UI
pnpm dev
```

Ouvrir [localhost:3000](http://localhost:3000). Si le port est occupé : `pnpm dev --port 3100`.

Les polices Geist sont fournies par le paquet npm et servies localement : le build ne télécharge pas de polices Google. Aucun compte cloud, Docker ou service externe n'est requis pour développer l'interface.

## Parcours disponibles

| Route                   | Comportement                                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------------------------- |
| `/`                     | Landing, work unit de démonstration, métriques, projets, funders et packs                            |
| `/fund`                 | Packs **$5 / $20 / $100**, pool, projet, visibilité et résumé réactifs                               |
| `/leaderboard`          | Classement en dollars, période, recherche et filtres commons/commercial                              |
| `/projects/new`         | Formulaire GitHub + Jira, budget et politique de livraison ; brouillon sauvegardé dans ce navigateur |
| `/dashboard`            | Mon activité : crédit, dépense, résultats, projets locaux et ledger                                  |
| `/work` et `/work/[id]` | Liste filtrable, timeline, coûts, preuves et abstention explicite                                    |
| `/sign-in`              | Point d'entrée commun ; accès à la démo en attendant Supabase Auth                                   |

Toutes les statistiques, PR et contributions affichées sont des **exemples**, indiqués dans l'interface. Les formulaires sont interactifs ; le checkout n'encaisse rien et ne crédite pas le ledger. Les brouillons de projets utilisent `localStorage` et ne connectent aucun dépôt.

## Architecture

```text
src/app/          Next.js App Router : boutique et endpoints stub
src/components/   Composants UI et formulaires accessibles
src/core/         Contrats Runner, budget en cents, packs et validations Zod
src/db/           Schéma Drizzle, client Supabase Postgres, ledger transactionnel
src/runner/       Adaptateurs Runner (actuellement le stub CloudflareSandboxRunner, à remplacer)
src/lib/          Fixtures de démonstration et stockage local des brouillons
workers/          Worker consommateur Queue + Workflow, configuration Wrangler
drizzle/          Migrations SQL versionnées et snapshots
tests/            Tests métier/PostgreSQL embarqué et parcours Playwright
```

- **Boutique :** Next.js + OpenNext sur Cloudflare Workers.
- **Cerveau :** Cloudflare Queues + Workflows. Il gère le choix des work units (rotation équitable par compte), les réservations et le règlement dans Postgres, et l'ouverture des PR par la GitHub App.
- **Atelier :** `Runner { execute(run): Promise<RunResult> }`, avec deux adaptateurs cibles :
  - `ClaudeManagedAgentsRunner` **implémente** avec Opus 5.5 (effort élevé), dans une sandbox hébergée par Anthropic ;
  - `OpenAIAgentsRunner` **relit systématiquement** avec Astra, dans une sandbox hébergée par OpenAI.

  L'agent lit le repo avec un jeton en lecture seule et renvoie un patch, avec des captures et une vidéo quand c'est pertinent. Seul le cerveau écrit sur GitHub.

- **Base :** Supabase Postgres + Drizzle. Montants en cents, contraintes SQL, RLS et opérations idempotentes `reserve / debit / release`.
- **LLM :** comptes **API** de la plateforme chez Anthropic et OpenAI, crédités avec l'argent des sponsors. Aucun appel LLM dans ce scaffold. Pas d'OpenRouter, et jamais d'abonnement Claude, ChatGPT ou Cursor, ni celui de la plateforme ni celui des sponsors.

Voir [l'architecture et les limites d'intégration](docs/architecture.md), [le brief](docs/mvp/BUILD.md) et [la synthèse](docs/mvp/synthese.md). Les décisions finales du brief priment sur les options historiques de la synthèse.

## Vérifications

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck                  # Next.js + TypeScript strict app et Worker
pnpm test                       # tests budget, runner et vrai SQL via PGlite
pnpm build                      # build Next.js de production

pnpm exec playwright install chromium
pnpm test:e2e                   # desktop et mobile, serveur de test dédié :3100
```

`pnpm check` regroupe lint, typecheck, tests métier et build. Playwright exige un build existant et démarre son propre serveur ; il ne réutilise pas une autre application sur le port 3000. Les screenshots de la landing et les traces d'échec sont dans `test-results/` (ignoré par Git).

Les tests PostgreSQL embarqués appliquent les migrations sans Supabase ni secrets. Ils vérifient :

- la réservation, le règlement et leur déduplication ;
- le financement d'un run par plusieurs contributions (l'argent le plus ancien d'abord), les recharges en cours de run et le coût non couvert ;
- les filtres sponsors (`all_except` / `only`, catégories, stacks, projets cachés en opt-in) ;
- les PR et leurs corrections, les abstentions, les merges et refus ;
- le journal d'événements ;
- le classement par compute consommé, sans crédits promo, remboursements ni anonymes.

## Cloudflare en local

```bash
pnpm cf:build                   # Next.js puis adaptation OpenNext
pnpm cf:preview                 # aperçu du bundle dans le runtime Workers
pnpm brain:check                # wrangler deploy --dry-run ; aucun déploiement
pnpm brain:dev                  # Worker/Workflow local :8787
```

Dans un autre terminal, ce smoke test local ne nécessite aucune base ni clé :

```bash
pnpm exec wrangler workflows trigger agent-commons-workflow \
  '{"runId":"a5c1a60e-68b0-4ca9-9d18-fc27849384f8","workUnitId":"b85118be-2c15-4eb0-9608-f3a90c9b07ac","kind":"implementation","budgetCents":800}' \
  --config workers/wrangler.jsonc --local --id demo-stub
pnpm exec wrangler workflows instances describe agent-commons-workflow demo-stub \
  --config workers/wrangler.jsonc --local --json
```

Résultat attendu : `status: complete`, `mode: stub`, `outcome: abstained`, `actualCostCents: 0`. Utiliser un autre `--id` pour déclencher une nouvelle instance. Pour faire tourner boutique et cerveau en même temps, lancer `pnpm cf:preview --port 8788`.

Le frontend déclare le binding producteur `WORK_QUEUE` ; les routes demo n'y envoient rien. Le cerveau consomme `agent-commons-work`, avec une dead-letter queue `agent-commons-dead-letter`. Aucune ressource distante n'est créée par ces commandes.

Le runner actuel est un stub, destiné à être remplacé par les adaptateurs Managed Agents et Agents API : il retourne `sandbox_not_configured`, coût 0. Aucun atelier Linux n'est démarré. Sans `DATABASE_URL`, le Workflow renvoie un résultat stub explicitement marqué et ne prétend pas écrire dans le ledger. Avec une base de test renseignée dans `workers/.dev.vars`, il réserve puis libère réellement le budget autour du même runner stub. La work unit du message doit alors exister, être autorisée et en attente, et une contribution réglée doit pouvoir la financer.

## Base de données

Le schéma contient :

- **comptes et projets :** `Account` (organisation, unité de la rotation équitable), ses membres, et `Project` avec son niveau de visibilité, ses catégories, ses stacks, sa configuration de lancement et les références de ses secrets (jamais les valeurs) ;
- **sponsors :** `SponsorProfile` (nom public, mode `all_except` / `only`, opt-in aux projets cachés, catégories exclues, stacks ciblées) et ses sélections de projets ;
- **travail et argent :** `Contribution → RunFunding → AgentRun → WorkUnit → Result`, `PullRequest` et les écritures du ledger ;
- **métriques :** `Event`, un journal en ajout seul.

Les migrations activent RLS sans accès public. La connexion Drizzle est exclusivement serveur et doit avoir les permissions adaptées ; `prepare: false` convient au pooler transactionnel Supabase.

```bash
pnpm db:generate                # ne nécessite pas de connexion
# Après avoir exporté DATABASE_URL vers votre base locale/de test :
pnpm db:migrate
```

Drizzle Kit lit `DATABASE_URL` dans l'environnement du shell ; il ne charge pas `.env.local` automatiquement. Ne mettre aucune URL de base privée dans une variable `NEXT_PUBLIC_*`. Aucun schéma distant n'a été modifié pour cette livraison.

## Stubs et travail restant

| Intégration                 | État livré                                                                                            |
| --------------------------- | ----------------------------------------------------------------------------------------------------- |
| Supabase Auth               | Page commune de connexion ; pas de session authentifiée                                               |
| Stripe                      | Packs + endpoint de preview ; pas de Checkout Session, frais non inventés                             |
| Webhooks Stripe/GitHub/Jira | Réponse **501**, sans effet, avant implémentation des signatures et de l'idempotence                  |
| GitHub App / Jira OAuth     | UI et contrats de projet ; réponse **501** explicite aux demandes de connexion                        |
| Intake → Queue              | Configurations présentes ; publication après authentification et autorisation à brancher              |
| Managed Agents / Agents API | Contrat `Runner` et stub ; les deux adaptateurs, la mesure des coûts et les plafonds restent à écrire |
| Attribution sponsor         | Mention `Sponsored by` dans chaque PR à implémenter à l'ouverture de la PR                            |
| Ledger persistant           | Schéma, migrations et transactions testés ; UI encore alimentée par les fixtures                      |

Ajouter uniquement les secrets nécessaires depuis `.env.example` au moment de brancher chaque intégration. Aucun secret n'est requis pour `pnpm install`, les tests ou le build. Les webhooks n'accepteront pas de paiements simplement parce qu'une clé est renseignée : leur implémentation reste à faire.

## Écart entre le code et le brief

Le code reflète encore le premier brief. Points à aligner avec [BUILD.md](docs/mvp/BUILD.md) :

| Sujet       | Code actuel                                                                                  | Brief                                                                                            |
| ----------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Pools       | Base alignée (pool unique et filtres) ; formulaires et UI encore en `commons` / `commercial` | Pool unique ; opt-out par catégorie et par projet, modes `all_except` / `only`                   |
| Montants    | Packs $5 / $20 / $100                                                                        | Packs $10 / $25 / $100 + montant libre $10–$1 000 ; crédit = payé HT − frais Stripe réels − 10 % |
| Atelier     | `CloudflareSandboxRunner` (stub)                                                             | `ClaudeManagedAgentsRunner` + `OpenAIAgentsRunner` ; patch en sortie, PR par le cerveau          |
| Leaderboard | Requête `sponsorLeaderboard` alignée ; l'UI affiche encore des fixtures                      | Classé par compute consommé ; le crédit non consommé est affiché comme « committed »             |
| PR          | Pas de mention sponsor                                                                       | `Sponsored by <sponsors> via Agent Commons` dans chaque PR                                       |
| Secrets     | `OPENAI_API_KEY` seulement                                                                   | Ajouter `ANTHROPIC_API_KEY`                                                                      |

Aucun push GitHub, compte cloud ou déploiement n'est inclus.
