# Hackathon video: script (3 min max)

Narration in English, spoken, about 150 words a minute. Notes in French. Timings are targets: the whole is about 2:55, so the long takes (setup, conversation) are where to cut.

| Part | Time | Where |
| --- | --- | --- |
| 1. The problem | 0:00–0:28 | Face cam, words and numbers on screen |
| 2. Transition | 0:28–0:33 | Face cam |
| 3. Setup | 0:33–0:45 | Screen, webcam bottom right |
| 4. The ticket, then Start | 0:45–1:08 | Screen |
| 5. The drop | 1:08–1:18 | Screen, the demo takes the whole frame |
| 6. The demo, then the conversation | 1:18–2:00 | Screen |
| 7. To the viewer: Muse Spark | 2:00–2:13 | Screen, webcam back |
| 8. Merge | 2:13–2:33 | Screen |
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
- Sur « That's where Yarrow comes in » : le logo Yarrow en grand, et dessous **The best ticket harness for your product team**.

L'intro ne pose qu'un problème, la review : les tickets arrivent dans la démo (le ticket créé depuis la conversation) et dans la conclusion. Le 1,3 milliard reste 1,3, jamais arrondi à 1,5 : la source est à l'écran.

## 2. Transition (0:28–0:33, face cam)

> We take your tickets all the way, from the idea to the merge. Let me show you.

## 3. Setup (0:33–0:45, écran + webcam)

> OK, so first, I connect GitHub, and I pick the repository where my code lives.
>
> And here's my Yarrow dashboard. Empty for now, so let's write a ticket.

À l'écran : déjà connecté (pas de sign-in à l'image), la landing une seconde → Get started → l'install de l'App GitHub en ×4 ou coupée (c'est l'écran de GitHub, pas le nôtre) → « Import your repository » avec la seule ligne `my-todo-app` → Import → « Where do your tickets live? », Continue → le dashboard vide. On ne montre pas l'app avant : la démo de Muse Wonder montre l'« avant ».

## 4. The ticket, then Start (0:45–1:08)

New ticket, puis Kevin parle à l'agent :

> **Kevin, à l'agent :** Add filters above the task list: All, To do, Doing and Done, with a count on each.

L'agent écrit le ticket, Create ticket, il arrive en To do. Puis :

> It writes the ticket for me, and it lands in To do.
>
> I slide Start… and Muse Wonder, Meta's model, picks it up right away in the cloud. It reads the code, writes the change, runs the app, and records a demo.

À l'écran : on tire le levier Start, quelques secondes sur le fil « Muse Wonder is reading the code » (pour montrer que c'est réel). Coupe.

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

La démo parle seule 15 à 30 s au plus (le contexte, puis sa première manipulation sur l'app). Kevin prend la parole (le micro), ce qui l'interrompt :

> **Kevin :** Wait, quick question. What happens if I add a task while I'm on the Done filter?
>
> *(L'agent répond à la voix et le montre dans l'app. ~15 s)*
>
> **Kevin :** Can you click Doing and add a task there?
>
> *(Il le fait à l'écran.)*
>
> **Kevin :** Could you create a ticket to fix that?

Si la réponse à la première question ne révèle pas de problème, la troisième devient : « Overdue tasks should show in red. Can you create a ticket for that? » (les données d'exemple ont des tâches en retard). L'agent propose une carte Ticket sous sa réponse :

> **Kevin :** Perfect.

Create ticket. Sur dev, la review du même ticket avait relevé qu'une tâche ajoutée sous Done reste cachée : d'où la première question. Couper le micro seulement une phrase finie (le couper en parlant annule l'envoi). 3–4 prises, on garde la meilleure.

## 7. To the viewer: Muse Spark (2:00–2:13, la webcam revient)

> That's not a recording. That's Muse Spark, Meta's model, live, on my actual app. I can interrupt it anytime, it answers by showing me, and my question just became my next ticket.
>
> Reviewing a pull request now takes the time of a conversation.

À l'écran, sur la dernière phrase : **Code review, as a conversation.**

## 8. Merge (2:13–2:33)

> OK. I've seen it working, and I know exactly what changed. I slide to merge… it lands on GitHub, and the issue closes.
>
> And my next ticket is already waiting in To do.

À l'écran : le levier Merge, la ligne passe à Done ; un seul plan du tableau montre le premier ticket en Done et le nouveau en To do. Si possible un plan d'une seconde sur l'issue GitHub passée en Closed. La preview (« Open the app ») est retirée du film.

## 9. Close (2:33–2:55, face cam)

> With Yarrow, we truly aim to give teams their confidence back. Agents can write the code, but you should still know exactly what you ship.
>
> AI solved the writing. The missing piece is everything around it: a clear ticket going in, and a review you can trust coming out.
>
> That's the piece Yarrow brings.
>
> That's Yarrow. Try it on yarrow.run.

Mot final à l'écran : **yarrow.run**.

## Before recording

- Le dépôt privé [KevTale/my-todo-app](https://github.com/KevTale/my-todo-app) : une liste de tâches React + Vite, **sans issue** (2026-11-04, Kevin les a supprimées : le ticket est créé en direct). Sur prod, la sélection de l'App `yarrow-run` réduite à `my-todo-app`, pour que l'import n'affiche qu'une ligne.
- L'implémenteur sur Meta : `pnpm implementer meta`.
- Sur prod, on filme le vrai Start ; le run dure ~7 min, on coupe pendant.
- **Le premier démarrage de l'app de l'appel est froid (~2 min mesurées sur dev), les suivants ~15 s.** Le faire pendant le cut, avant de filmer la review, sans laisser de message dans le chat du ticket (demander à Claude), ou garder la première prise de la review comme répétition.
- Une répétition complète hors caméra si le temps le permet.
- Un vrai diff long d'une PR quelconque pour le flash de la partie 5.
- Le prompteur : https://claude.ai/artifact/CDfbrjdbQjyGAASstfU3Hp (les répliques et les indications, une partie par écran).

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
- Déjà en place, à garder : les chiffres animés (402M → 1.3B, 5×) avec leur source, le logo et « The best ticket harness for your product team », le drop (flash de diff, silence sur « Instead… », zoom sur la démo), les sous-titres mot à mot, le zoom de caméra par beat.

**Placeholders à remplacer par les rushs de Kevin**
- La face cam (vue `face` : silhouette « FACE CAM · KEVIN ») : intro, transition, Muse Spark, conclusion.
- La bulle webcam en bas à droite (`Bubble`).
- L'écran de setup GitHub → import du dépôt (vue `setup`).
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
