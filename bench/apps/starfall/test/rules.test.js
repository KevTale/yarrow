import assert from "node:assert/strict";
import { test } from "node:test";
import {
  click,
  HEIGHT,
  LIVES,
  newGame,
  spawnStar,
  step,
} from "../public/rules.js";

const always = (value) => () => value;

test("a click on a star catches it", () => {
  const game = newGame(0);
  spawnStar(game, 0, always(0.5));
  const [star] = game.stars;
  assert.equal(click(game, star.x, star.y), 10);
  assert.equal(game.score, 10);
  assert.equal(game.stars.length, 0);
});

test("a gold star is worth more", () => {
  const game = newGame(0);
  spawnStar(game, 0, always(0.05));
  const [star] = game.stars;
  assert.equal(star.kind, "gold");
  assert.equal(click(game, star.x, star.y), 50);
});

test("a click beside every star catches nothing", () => {
  const game = newGame(0);
  spawnStar(game, 0, always(0.5));
  assert.equal(click(game, 5, 5), 0);
  assert.equal(game.score, 0);
});

test("a star that reaches the ground costs a life, three end the game", () => {
  const game = newGame(0);
  for (let miss = 1; miss <= LIVES; miss++) {
    spawnStar(game, 0, always(0.5));
    game.stars.at(-1).y = HEIGHT + 100;
    step(game, 0, 0);
    assert.equal(game.lives, LIVES - miss);
  }
  assert.equal(game.over, true);
});
