# Vérifications — 2026-10-06

Exécutées localement avec Node 24 et pnpm 12.9, sans secret ni service distant.

| Vérification       | Résultat                                                      |
| ------------------ | ------------------------------------------------------------- |
| `pnpm lint`        | Réussite                                                      |
| `pnpm typecheck`   | Réussite pour la boutique et le cerveau                       |
| `pnpm test`        | 65 tests réussis sur 8 fichiers, avec vrai SQL via PGlite     |
| `pnpm build`       | Build de production réussi                                    |
| `pnpm test:e2e`    | 10 tests réussis : 5 parcours en desktop, les mêmes en mobile |
| `pnpm brain:check` | Bundle du cerveau valide en dry-run Wrangler                  |

La migration est appliquée sur le projet Supabase, dont les seules alertes sont « RLS activée sans policy », voulues.

Ce qui n'est **pas** encore vérifié en conditions réelles, faute de clés : les appels à Claude Managed Agents, à l'Agents API d'OpenAI, à Stripe, à la GitHub App et aux trois trackers. Les tests les simulent d'après leur documentation. Les deux API d'agents sont en bêta : le premier vrai run servira de validation.
