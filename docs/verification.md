# Vérifications de livraison — 2026-10-05

Exécutées localement avec Node 22.23.3 et pnpm 12.6.0. Aucun service distant ni secret utilisé.

| Vérification                     | Résultat                                                                                                        |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile` | Réussite                                                                                                        |
| `pnpm lint`                      | Réussite                                                                                                        |
| `pnpm typecheck`                 | Réussite pour l'app et le Worker                                                                                |
| `pnpm test`                      | 15 tests réussis, dont 8 sur les migrations et transactions PostgreSQL via PGlite                               |
| `pnpm build`                     | Build Next.js réussi                                                                                            |
| `pnpm test:e2e`                  | 12 tests réussis : 6 parcours en desktop, les mêmes en mobile                                                   |
| `pnpm cf:build`                  | Bundle OpenNext généré dans `.open-next/worker.js`                                                              |
| `pnpm brain:check`               | Bundle Worker valide en dry-run Wrangler                                                                        |
| `pnpm cf:preview --port 8788`    | Landing, Fund, leaderboard, projet, activité et work detail répondent en 200 dans workerd                       |
| Checkout dans workerd            | Réponse demo, `charged: false`, aucune contribution créée                                                       |
| Workflow local                   | Instance `smoke-stub` terminée ; abstention `sandbox_not_configured`, coût 0, ledger explicitement non connecté |

Vérification visuelle de la landing en 1440 px et 390 px, sans débordement horizontal ni erreur JavaScript. Les tests couvrent le choix de pack/pool, la recherche et les filtres du leaderboard, le brouillon de projet conservé après rechargement, l'abstention et les endpoints qui refusent les événements non implémentés.

Ces vérifications ne valident pas de paiement Stripe réel, d'authentification Supabase, de synchronisation GitHub/Jira, de container Sandbox ou d'exécution LLM : ces intégrations sont des stubs explicitement documentés dans le [README](../README.md).
