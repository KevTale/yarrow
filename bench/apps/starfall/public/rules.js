/**
 * Starfall's rules, apart from the drawing so they can be tested: stars
 * fall, a click catches one, a star that reaches the ground costs a life.
 */

export const WIDTH = 800;
export const HEIGHT = 600;
export const LIVES = 3;
export const STAR_RADIUS = 22;

export const POINTS = { white: 10, gold: 50 };

/** A new game. */
export function newGame(now = 0) {
  return {
    score: 0,
    lives: LIVES,
    stars: [],
    caught: 0,
    nextStarAt: now + 600,
    over: false,
    startedAt: now,
  };
}

/** How fast stars fall, in pixels a second: faster as the game goes on. */
export function fallSpeed(game, now) {
  const seconds = (now - game.startedAt) / 1000;
  return 120 + Math.min(seconds, 90) * 3;
}

/** One star in ten is gold. `random` is Math.random, or a test's. */
export function spawnStar(game, now, random = Math.random) {
  game.stars.push({
    x: STAR_RADIUS + random() * (WIDTH - STAR_RADIUS * 2),
    y: -STAR_RADIUS,
    kind: random() < 0.1 ? "gold" : "white",
  });
  game.nextStarAt = now + Math.max(350, 1100 - (now - game.startedAt) / 60);
}

/** Moves the stars on by `ms`; a star that reaches the ground is lost. */
export function step(game, now, ms, random = Math.random) {
  if (game.over) return;
  if (now >= game.nextStarAt) spawnStar(game, now, random);
  const fall = (fallSpeed(game, now) * ms) / 1000;
  for (const star of game.stars) star.y += fall;
  const landed = game.stars.filter((star) => star.y - STAR_RADIUS > HEIGHT);
  game.stars = game.stars.filter((star) => !landed.includes(star));
  game.lives = Math.max(0, game.lives - landed.length);
  if (game.lives === 0) game.over = true;
}

/** A click at (x, y): catches the star under it, if any. Returns its points. */
export function click(game, x, y) {
  if (game.over) return 0;
  const star = game.stars.find(
    (candidate) =>
      Math.hypot(candidate.x - x, candidate.y - y) <= STAR_RADIUS + 6,
  );
  if (!star) return 0;
  game.stars = game.stars.filter((candidate) => candidate !== star);
  const points = POINTS[star.kind];
  game.score += points;
  game.caught += 1;
  return points;
}
