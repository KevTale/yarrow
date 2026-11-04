# Hackathon video: script (3 min max)

Narration in English, spoken, about 150 words a minute. Notes in French. Timings are targets: the whole is about 2:55, so the long takes (setup, conversation) are where to cut.

| Part | Time | Where |
| --- | --- | --- |
| 1. The problem | 0:00–0:28 | Face cam, words and numbers on screen |
| 2. Transition | 0:28–0:33 | Face cam |
| 3. Setup | 0:33–0:53 | Screen, webcam bottom right |
| 4. Start | 0:53–1:08 | Screen |
| 5. The drop | 1:08–1:18 | Screen, the demo takes the whole frame |
| 6. The demo, then the conversation | 1:18–2:00 | Screen |
| 7. To the viewer: Muse Spark | 2:00–2:13 | Screen, webcam back |
| 8. Preview, then merge | 2:13–2:33 | Screen |
| 9. Close | 2:33–2:55 | Face cam |

## 1. The problem (0:00–0:28, face cam)

> Hi, I'm Kevin, founder of Yarrow.
>
> As we all know, with the latest AI models, coding is basically solved. Two years ago, developers on GitHub merged 400 million pull requests. This year, it's 1.3 billion. More than three times as many, largely driven by AI agents.
>
> But here's the thing: teams can't keep up. According to Faros AI, a pull request now sits in review five times longer.
>
> So on one hand, we've never produced so much code. On the other, we just don't have the capacity to review what agents ship, and merge it with confidence.
>
> That's where Yarrow comes in.

À l'écran, chaque chiffre apparaît quand il est dit, la source en petit dessous :
- **402M → 1.3B** merged pull requests, 2024 → 2026 · *GitHub Octoverse 2026*
- **5×** longer in review · *Faros AI, AI Engineering Report 2026*
- Sur « That's where Yarrow comes in » : le logo Yarrow en grand, et dessous **The best ticket harness for your team**.

L'intro ne pose qu'un problème, la review : les tickets arrivent dans la démo (le ticket créé depuis la conversation) et dans la conclusion. Le 1,3 milliard reste 1,3, jamais arrondi à 1,5 : la source est à l'écran.

## 2. Transition (0:28–0:33, face cam)

> We take your tickets all the way, from the idea to the merge. Let me show you.

## 3. Setup (0:33–0:53, écran + webcam)

> OK, so first, I connect the GitHub repository where my code lives… and I import its Jira backlog.
>
> And here we go, this is my Yarrow dashboard. Every single Jira ticket is right here, already synced. Nothing to set up.

À l'écran : Connect GitHub → install de l'App → étape « where tickets live » → Import Jira → dashboard. L'install GitHub en ×4 ou coupée : c'est l'écran de GitHub, pas le nôtre.

## 4. Start (0:53–1:08)

> As you can see, we've got twelve tickets to do on this project. Let's take this one: filter the task list by status.
>
> I slide Start… and Muse Wonder, Meta's model, picks it up right away in the cloud. It reads the code, writes the change, runs the app, and records a demo.

À l'écran : on tire le levier Start, le fil affiche « Muse Wonder is reading the code ». Coupe.

## 5. The drop (1:08–1:18)

C'est ici que l'attention doit monter.

> A few minutes later, it's done. Now, usually, this is where I'd open a four-hundred-line diff and hope for the best.
>
> Instead… it shows me.

À l'écran :
- Carton bref « 7 minutes later » (médiane mesurée d'un ticket filmé : 7,6 min), la ligne passe en To review.
- Sur « open a four-hundred-line diff », flash d'une seconde sur un vrai diff GitHub qui défile, un peu flou.
- Sur « Instead… », une demi-seconde de silence, la musique coupe.
- Sur « it shows me », clic sur la ligne, zoom sur la démo qui prend tout le cadre, la webcam disparaît, la musique repart, la voix de l'agent démarre.

## 6. The demo, then the conversation (1:18–2:00)

La démo parle seule ~12 s (le contexte, puis sa première manipulation sur l'app). Puis :

> **Kevin :** Wait, quick question. What happens to a task whose status isn't one of those three?
>
> *(L'agent répond à la voix et agit en même temps : il ouvre le code ou montre la liste dans l'app. ~15 s)*
>
> **Kevin :** Got it. And could overdue tasks come first in each filter?
>
> *(L'agent propose une carte Ticket sous sa réponse.)*
>
> **Kevin :** Perfect. Create ticket.

La première question est celle du bench vocal (« what the code does with an unknown status »), donc on sait qu'elle tient. 3–4 prises, on garde la meilleure.

## 7. To the viewer: Muse Spark (2:00–2:13, la webcam revient)

> That's not a recording. That's Muse Spark, Meta's model, live, on my actual app. I can interrupt it anytime, it answers by showing me, and my question just became my next ticket.
>
> Reviewing a pull request now takes the time of a conversation.

À l'écran, sur la dernière phrase : **Code review, as a conversation.**

## 8. Preview, then merge (2:13–2:33)

> And if I want to try it myself, Open the app. Every pull request gets its own preview URL, automatically. No config, no deploy, it's just there.
>
> OK. I've seen it working, and I know exactly what changed. I slide to merge… it lands on GitHub, and Jira moves to Done.

À l'écran : Open the app, la preview s'ouvre à son adresse yarrow.page (l'URL bien visible), deux clics dans l'app. Retour, le levier Merge, la ligne passe à Done. Si possible un plan d'une seconde sur le ticket Jira passé en Done.

## 9. Close (2:33–2:55, face cam)

> So, agents are going to write most of the code. That's a given. But your team still decides what gets built, and what gets shipped.
>
> That's the part Yarrow makes fast. You write a clear ticket, you get a working demo back, and you merge knowing exactly what you're shipping. Dozens of tickets a day, and you understand every single one.
>
> That's Yarrow. Go try it on yarrow.run.

Mot final à l'écran : **yarrow.run**.

## Before recording

- Un projet Jira propre (une douzaine de tickets plausibles), lié au dépôt Tally du bench.
- L'implémenteur sur Meta : `pnpm implementer meta`.
- Le ticket `filter` lancé une fois avant le tournage : si la démo est bonne, on filme le vrai Start et on monte sur ce résultat déjà prêt.
- Un vrai diff long d'une PR quelconque pour le flash de la partie 5.

Sources :
- [GitHub Octoverse 2026](https://github.blog/news-insights/octoverse/octoverse-commits-pushes-reach-new-highs-in-2026-as-developers-build-with-agents/) : merged pull requests 402M → 538M → 1.3B (years ending September 30, 2024, 2025 and 2026).
- [Faros AI, AI Engineering Report 2026](https://faros.ai/blog/ai-acceleration-whiplash-takeaways) : median time in review up 441.5% (22,000 developers, 4,000+ teams, two years, each organization's lowest versus highest AI adoption).

## Assemblage final : où on en est (2026-11-03)

À lire par la session qui fera l'assemblage, avant toute chose.

**Décidé**
- Le script ci-dessus est la version validée par Kevin, intro comprise (« on the teams using AI the most » retiré).
- L'intro ne pose qu'un problème, la review ; les tickets arrivent dans la démo et la conclusion.
- Pas de musique de fond (retirée de la composition).
- Q1 de la conversation : sur la landing, l'agent d'exemple ne lit pas le code, d'où « Does my filter survive a reload? » dans la version test. Sur le vrai dashboard, l'agent lit le dépôt : Kevin garde la question qu'il veut.

**Fait : une version test complète (2:55)**
- Composition Remotion `Hackathon` : [video/src/hackathon/Hackathon.tsx](../../video/src/hackathon/Hackathon.tsx), ses beats dans [timeline.ts](../../video/src/hackathon/timeline.ts). Chaque beat dure le temps de sa ligne de voix.
- Voix ElevenLabs, une prise par ligne : [lines.json](../../video/src/hackathon/lines.json) (Kevin = « Mark », l'agent = « Josh », la voix des films du produit), accélérées de 10 % après coup ; `scripts/hackathon-voice.mjs` ne refait que les lignes changées et écrit `voice.json` (durées et temps de chaque mot, pour les sous-titres).
- La prise de yarrow.run : `video/public/hackathon/landing.mp4` (Playwright sur Edge, frames CDP, un curseur dessiné), ses moments dans [take.json](../../video/src/hackathon/take.json) : Start sur #147, le run, To review, le film, deux questions, Create ticket (#148), Merge.
- Déjà en place, à garder : les chiffres animés (402M → 1.3B, 5×) avec leur source, le logo et « The best ticket harness for your team », le drop (flash de diff, silence sur « Instead… », zoom sur la démo), les sous-titres mot à mot, le zoom de caméra par beat.

**Placeholders à remplacer par les rushs de Kevin**
- La face cam (vue `face` : silhouette « FACE CAM · KEVIN ») : intro, transition, Muse Spark, conclusion.
- La bulle webcam en bas à droite (`Bubble`).
- L'écran de setup GitHub → Jira (vue `setup`).
- « Open the app » (vue `preview` : un faux navigateur et une adresse yarrow.page inventée).
- La voix ElevenLabs de Kevin, par sa vraie voix ; celle de l'agent par la vraie voix de l'appel, s'il l'a filmé.
- Si Kevin filme le vrai dashboard, ses prises remplacent aussi la prise de la landing.

**Les rushs**
- Dans `video/rush/` (ignoré par git), un fichier par partie du script (`intro.mp4`, `setup.mp4`, `start.mp4`…), une seconde de silence avant et après chaque phrase.
- Copier dans `video/public/hackathon/` ce que la composition lit (`staticFile`), puis caler chaque beat sur sa prise : la durée d'un beat vient alors de la prise, plus de la voix générée.

**Commandes**
- Les dépendances : `pnpm --dir video install`.
- La clé ElevenLabs dans `video/.env` (`ELEVENLABS_API_KEY=`, jamais commit), seulement pour regénérer des voix : `pnpm --dir video exec node --env-file=.env scripts/hackathon-voice.mjs`.
- L'aperçu : `pnpm --dir video studio`, composition `Hackathon`.
- Le rendu : `pnpm --dir video exec remotion render Hackathon out/yarrow-hackathon.mp4`.
