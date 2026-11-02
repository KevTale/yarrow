import {
  click,
  HEIGHT,
  newGame,
  STAR_RADIUS,
  step,
  WIDTH,
} from "./rules.js";

const canvas = document.querySelector("canvas");
const context = canvas.getContext("2d");
const scoreLabel = document.querySelector("#score");
const livesLabel = document.querySelector("#lives");
const bestLabel = document.querySelector("#best");
const overlay = document.querySelector("#overlay");
const overlayTitle = overlay.querySelector("h2");
const overlayText = overlay.querySelector("p");
const playButton = overlay.querySelector("button");

let game = null;
let last = 0;
let pops = [];
const best = () => Number(localStorage.getItem("starfall.best") ?? 0);

function drawStar(x, y, radius, color) {
  context.beginPath();
  for (let point = 0; point < 10; point++) {
    const angle = (Math.PI / 5) * point - Math.PI / 2;
    const r = point % 2 ? radius * 0.45 : radius;
    context.lineTo(x + Math.cos(angle) * r, y + Math.sin(angle) * r);
  }
  context.closePath();
  context.fillStyle = color;
  context.fill();
}

function draw(now) {
  context.clearRect(0, 0, WIDTH, HEIGHT);
  for (const star of game?.stars ?? [])
    drawStar(
      star.x,
      star.y,
      STAR_RADIUS,
      star.kind === "gold" ? "#ffc940" : "#e9ecff",
    );
  pops = pops.filter((pop) => now - pop.at < 700);
  for (const pop of pops) {
    const age = (now - pop.at) / 700;
    context.globalAlpha = 1 - age;
    context.fillStyle = "#fff";
    context.font = "600 20px system-ui, sans-serif";
    context.textAlign = "center";
    context.fillText(`+${pop.points}`, pop.x, pop.y - age * 40);
    context.globalAlpha = 1;
  }
}

function render() {
  scoreLabel.textContent = game ? game.score : 0;
  livesLabel.textContent = "♥".repeat(game?.lives ?? 0);
  bestLabel.textContent = best();
}

function frame(now) {
  if (!game) return;
  step(game, now, Math.min(now - last, 50));
  last = now;
  draw(now);
  render();
  if (game.over) return end();
  requestAnimationFrame(frame);
}

function start() {
  overlay.hidden = true;
  last = performance.now();
  game = newGame(last);
  pops = [];
  requestAnimationFrame(frame);
}

function end() {
  if (game.score > best()) localStorage.setItem("starfall.best", game.score);
  render();
  overlayTitle.textContent = "Game over";
  overlayText.textContent = `You caught ${game.caught} star${game.caught === 1 ? "" : "s"} for ${game.score} points.`;
  playButton.textContent = "Play again";
  overlay.hidden = false;
}

canvas.addEventListener("pointerdown", (event) => {
  if (!game || game.over) return;
  const box = canvas.getBoundingClientRect();
  const x = ((event.clientX - box.left) / box.width) * WIDTH;
  const y = ((event.clientY - box.top) / box.height) * HEIGHT;
  const points = click(game, x, y);
  if (points) pops.push({ x, y, points, at: performance.now() });
});

playButton.addEventListener("click", start);
render();
