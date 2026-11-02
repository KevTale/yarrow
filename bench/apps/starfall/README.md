# Starfall

Catch the falling stars before they reach the ground. Gold stars are worth 50 points, white ones 10. Three misses and the game is over. Your best score stays in the browser.

## Play

Node 20 or later, no install needed.

```bash
npm start      # http://localhost:3000
```

## Test

```bash
npm test
```

## Layout

- `public/rules.js`: the rules (stars, clicks, lives, score), with no drawing, tested in `test/`.
- `public/game.js`: the loop, the drawing and the clicks.
- `public/index.html`, `public/style.css`: the page.
- `server.js`: serves `public/`.
