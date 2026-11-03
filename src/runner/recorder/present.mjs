// Yarrow's recorder: the agent writes a plan of its presentation, this plays
// it in a real browser and records each chapter as a clip. It runs in the
// implementer's sandbox, mounted at /mnt/session/uploads/yarrow/present.mjs
// (src/runner/recorder/source.ts carries it; pnpm recorder:embed after an edit).
//
//   node present.mjs plan.json           record every chapter
//   node present.mjs plan.json --check   check the plan, record nothing
//   node present.mjs stage.json --stage  the app live on the desktop, served
//                                        over VNC until stopped (workers/stage.ts)
//
// Writes presentation/presentation.json, one clip per chapter and a poster
// under the session's outputs. The brain voices it after the review.
//
// It films a real desktop when it can (see "The desktop" below): the browser
// and the terminal in their windows, the real pointer. Otherwise, or
// with YARROW_DESKTOP=0, each chapter is a clip of the page alone.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const OUTPUTS = process.env.YARROW_OUTPUTS || "/mnt/session/outputs";
const DIR = path.join(OUTPUTS, "presentation");
// As estimateSpeechMs in src/core/presentation.ts.
// The voice says about 3.3 words a second; a little slower here, so the
// film rarely runs short of the words (the player ends a chapter with them).
const WORDS_PER_SECOND = 3.1;
// The player shows it in a browser window on a 16:10 stage.
const DESKTOP = { width: 1280, height: 720 };
const PHONE = { width: 390, height: 844 };
const ACTIONS = [
  "point",
  "circle",
  "hover",
  "click",
  "fill",
  "type",
  "press",
  "select",
  "scroll",
  "goto",
  "reload",
  "wait",
];
const COLORS = {
  bg: "#0c0d0f",
  surface: "#111215",
  elevated: "#17191d",
  line: "#25282e",
  text: "#edeef0",
  secondary: "#bdc1c9",
  muted: "#8a909b",
  amber: "#f2b544",
  green: "#5ccb95",
  red: "#ee7b6e",
};
const FONTS =
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&family=Jost:wght@500&display=swap">';

/** What the presenter said while it played a cue: sent back with it. */
let heard = null;
const log = (message) => {
  console.log("recorder: " + message);
  heard?.push(message);
};

function estimateMs(text) {
  const words = String(text).trim().split(/\s+/).filter(Boolean).length;
  return Math.round((words / WORDS_PER_SECOND) * 1000) + 600;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.status !== 0)
    throw new Error(
      command +
        " " +
        args.join(" ") +
        " failed (" +
        (result.error?.message || "exit " + result.status) +
        ")",
    );
}

const slug = (text) =>
  String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32) || "chapter";

const bare = (address) => String(address).replace(/^https?:\/\//, "");

const escape = (text) =>
  String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// ---------- The plan ----------

/** A demo's parts, in this order (src/core/presentation.ts). */
const PARTS = ["context", "change", "proof"];

function check(plan) {
  const problems = [];
  if (!plan || typeof plan !== "object")
    return ["the plan is not a JSON object"];
  if (!plan.title) problems.push("title: missing");
  if (!plan.ticket || !plan.ticket.title)
    problems.push("ticket.title: missing");
  if (!Array.isArray(plan.chapters) || plan.chapters.length === 0)
    problems.push("chapters: at least one");
  else if (plan.chapters.length > 12) problems.push("chapters: at most 12");
  for (const [i, chapter] of (plan.chapters || []).entries()) {
    const at = "chapters[" + i + "]";
    if (!chapter.title || chapter.title.length > 40)
      problems.push(at + ".title: 1 to 40 characters");
    if (!chapter.say || chapter.say.length > 600)
      problems.push(at + ".say: 1 to 600 characters");
    if (!["app", "document", "ticket", "terminal"].includes(chapter.tab))
      problems.push(at + ".tab: app, document, ticket or terminal");
    if (!PARTS.includes(chapter.part))
      problems.push(at + ".part: context, change or proof");
    if (chapter.tab === "document") {
      if (!fileOf(chapter))
        problems.push(at + ".file: the file's path in the repository");
      else
        try {
          documentOf(chapter);
        } catch (error) {
          problems.push(at + ": " + error.message);
        }
    }
    if (chapter.tab === "app") {
      const app = (plan.apps || {})[chapter.app || "after"];
      if (!app || !app.url)
        problems.push(
          at + ': apps["' + (chapter.app || "after") + '"].url is missing',
        );
      else if (app.storage && !fs.existsSync(app.storage))
        problems.push(at + ": " + app.storage + " does not exist");
    }
    if (chapter.tab === "app" || chapter.tab === "document") {
      for (const [j, action] of (chapter.actions || []).entries()) {
        if (!ACTIONS.includes(action.do))
          problems.push(
            at + ".actions[" + j + "].do: one of " + ACTIONS.join(", "),
          );
        const needs = [
          "point",
          "circle",
          "hover",
          "click",
          "fill",
          "type",
          "select",
        ].includes(action.do);
        const aimed = ["point", "hover", "click"].includes(action.do);
        if (
          action.at !== undefined &&
          (!aimed || typeof action.at !== "string")
        )
          problems.push(
            at +
              ".actions[" +
              j +
              "].at: an expression, for point, hover or click",
          );
        if (needs && !action.target && !(aimed && action.at))
          problems.push(
            at + ".actions[" + j + "].target: a Playwright selector",
          );
      }
    }
    if (chapter.tab === "terminal" && !chapter.command)
      problems.push(at + ".command: missing");
  }
  const parts = (plan.chapters || []).map((chapter) => chapter.part);
  if (
    PARTS.some((part) => !parts.includes(part)) ||
    parts.some((part, i) => PARTS.indexOf(part) < PARTS.indexOf(parts[i - 1]))
  )
    problems.push("chapters: context, then change, then proof, each once");
  // A change the app shows opens on the app as it was, or as it is now with
  // the reason the plan gives: the ticket's card is for what the app cannot
  // show.
  const chapters = plan.chapters || [];
  if (chapters.some((chapter) => chapter.tab === "app")) {
    for (const [i, chapter] of chapters.entries())
      if (chapter.tab === "ticket")
        problems.push(
          "chapters[" +
            i +
            "]: no ticket chapter when the app is filmed: open on the app as it was",
        );
    const first = chapters[0];
    const before = first?.tab === "app" && first.app === "before";
    if (!before && !String(plan.noBefore || "").trim())
      problems.push(
        'chapters[0]: open on the app as it was (tab app, app before, apps.before.url); only when it cannot run, open on the app as it is now and say why in "noBefore"',
      );
  }
  return problems;
}

// ---------- Playwright, wherever the sandbox has it ----------

/** Playwright writes ffmpeg next to the browsers: a read-only folder is mirrored. */
function browsersPath() {
  const wanted =
    process.env.PLAYWRIGHT_BROWSERS_PATH ||
    (fs.existsSync("/opt/pw-browsers") ? "/opt/pw-browsers" : null);
  if (!wanted || !fs.existsSync(wanted)) return;
  try {
    fs.accessSync(wanted, fs.constants.W_OK);
    process.env.PLAYWRIGHT_BROWSERS_PATH = wanted;
    return;
  } catch {
    // Read-only: links in a folder of our own.
  }
  const mirror = path.join(os.tmpdir(), "yarrow-pw");
  fs.mkdirSync(mirror, { recursive: true });
  for (const entry of fs.readdirSync(wanted)) {
    const link = path.join(mirror, entry);
    if (!fs.existsSync(link)) fs.symlinkSync(path.join(wanted, entry), link);
  }
  process.env.PLAYWRIGHT_BROWSERS_PATH = mirror;
}

function loadPlaywright() {
  const global = spawnSync("npm root -g", { encoding: "utf8", shell: true });
  const own = path.join(os.tmpdir(), "yarrow-recorder");
  const roots = [
    process.cwd(),
    "/workspace/repo",
    global.stdout?.trim(),
    own,
  ].filter(Boolean);
  const attempt = () => {
    for (const root of roots)
      for (const name of ["playwright-core", "playwright"]) {
        try {
          const require = createRequire(path.join(root, "noop.js"));
          const manifest = require.resolve(name + "/package.json");
          return {
            pw: require(name),
            cli: path.join(path.dirname(manifest), "cli.js"),
          };
        } catch {
          // Not there: the next place.
        }
      }
    return null;
  };
  const found = attempt();
  if (found) return found;
  log("installing playwright-core");
  fs.mkdirSync(own, { recursive: true });
  run("npm", [
    "install",
    "--no-save",
    "--no-audit",
    "--no-fund",
    "--prefix",
    own,
    "playwright-core",
  ]);
  return (
    attempt() ||
    (() => {
      throw new Error("playwright-core did not install");
    })()
  );
}

function findChromium({ full = false } = {}) {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !fs.existsSync(root)) return null;
  const candidates = [];
  for (const entry of fs.readdirSync(root)) {
    const revision = Number(entry.split("-").at(-1)) || 0;
    for (const binary of [
      "chrome-linux/chrome",
      "chrome-linux64/chrome",
      "chrome-linux/headless_shell",
      "chrome-headless-shell-linux64/chrome-headless-shell",
    ]) {
      const file = path.join(root, entry, binary);
      const shell = entry.includes("headless") || binary.includes("headless");
      if (
        entry.startsWith("chromium") &&
        fs.existsSync(file) &&
        !(full && shell)
      )
        candidates.push({ file, revision, shell });
    }
  }
  candidates.sort(
    (a, b) => Number(a.shell) - Number(b.shell) || b.revision - a.revision,
  );
  return candidates[0]?.file ?? null;
}

async function launch({ pw, cli }, options = {}) {
  const full = options.headless === false;
  const attempts = [
    () => pw.chromium.launch(options),
    () => {
      const executablePath = findChromium({ full });
      if (!executablePath)
        throw new Error(
          "no Chromium under " + process.env.PLAYWRIGHT_BROWSERS_PATH,
        );
      return pw.chromium.launch({ ...options, executablePath });
    },
    () => {
      log("installing Chromium for this Playwright");
      run(process.execPath, [cli, "install", "chromium"]);
      return pw.chromium.launch(options);
    },
  ];
  let last;
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (error) {
      last = error;
    }
  }
  throw last;
}

/** Recording needs Playwright's own ffmpeg: fetched once when it is missing. */
async function ensureVideo(browser, { cli }) {
  for (let attempt = 0; ; attempt++) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yarrow-try-"));
    try {
      const context = await browser.newContext({
        recordVideo: { dir, size: { width: 320, height: 200 } },
      });
      const page = await context.newPage();
      await page.setContent("<p>ok</p>");
      await context.close();
      return;
    } catch (error) {
      if (attempt > 0 || !/ffmpeg/i.test(String(error?.message))) throw error;
      log("installing Playwright's ffmpeg");
      run(process.execPath, [cli, "install", "ffmpeg"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}

// ---------- What the agent points with ----------

/**
 * Runs in every page: the agent's cursor and its clicks. Nothing is drawn
 * around what it shows: the pointer goes there, as on a shared screen.
 * On the desktop the pointer is real: the page only notes where it is on
 * the screen, from the pointer's own events.
 */
function overlay(options) {
  if (window.top !== window) return;
  const real = Boolean(options && options.real);
  if (real)
    addEventListener(
      "pointerdown",
      () => {
        window.__yarrowPresses = (window.__yarrowPresses || 0) + 1;
      },
      { capture: true, passive: true },
    );
  if (real)
    addEventListener(
      "mousemove",
      (event) => {
        window.__yarrowScreen = [
          event.screenX - event.clientX,
          event.screenY - event.clientY,
        ];
      },
      { capture: true, passive: true },
    );
  const css = (element, text) => {
    element.style.cssText = text;
    return element;
  };
  const install = () => {
    if (document.getElementById("__yarrow")) return;
    const root = css(
      document.createElement("div"),
      "position:fixed;inset:0;pointer-events:none;z-index:2147483647",
    );
    root.id = "__yarrow";
    const ripple = css(
      document.createElement("div"),
      "position:fixed;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;background:rgba(242,181,68,.45);opacity:0;transform:scale(.3)",
    );
    ripple.id = "__yarrow_ripple";
    const ns = "http://www.w3.org/2000/svg";
    const cursor = document.createElementNS(ns, "svg");
    cursor.id = "__yarrow_cursor";
    cursor.setAttribute("width", "26");
    cursor.setAttribute("height", "26");
    cursor.setAttribute("viewBox", "0 0 24 24");
    css(
      cursor,
      "position:fixed;left:" +
        (window.__yarrowAt?.[0] ?? -40) +
        "px;top:" +
        (window.__yarrowAt?.[1] ?? -40) +
        "px;margin:-3px 0 0 -3px;transition-property:left,top;transition-timing-function:cubic-bezier(.45,0,.2,1);filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))",
    );
    const arrow = document.createElementNS(ns, "path");
    arrow.setAttribute(
      "d",
      "M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z",
    );
    arrow.setAttribute("fill", "#1d1f23");
    arrow.setAttribute("stroke", "#ffffff");
    arrow.setAttribute("stroke-width", "1.5");
    arrow.setAttribute("stroke-linejoin", "round");
    cursor.appendChild(arrow);
    root.append(ripple);
    if (!real) root.append(cursor);
    document.documentElement.appendChild(root);
  };
  const get = (id) => {
    install();
    return document.getElementById(id);
  };
  window.__yarrow = {
    move(x, y, ms) {
      window.__yarrowAt = [x, y];
      const cursor = get("__yarrow_cursor");
      if (!cursor) return;
      cursor.style.transitionDuration = ms + "ms";
      cursor.style.left = x + "px";
      cursor.style.top = y + "px";
    },
    // Along points, at the frame rate: a loop drawn by hand.
    path(points, ms) {
      const cursor = get("__yarrow_cursor");
      if (!cursor || !points.length) return;
      cursor.style.transitionDuration = "0ms";
      const started = performance.now();
      const frame = (now) => {
        const at = Math.min(1, (now - started) / ms);
        const [x, y] = points[Math.round(at * (points.length - 1))];
        window.__yarrowAt = [x, y];
        cursor.style.left = x + "px";
        cursor.style.top = y + "px";
        if (at < 1) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    },
    tap(x, y) {
      const ripple = get("__yarrow_ripple");
      ripple.style.transition = "none";
      ripple.style.left = x + "px";
      ripple.style.top = y + "px";
      ripple.style.opacity = "1";
      ripple.style.transform = "scale(.3)";
      void ripple.offsetWidth;
      ripple.style.transition = "opacity .5s ease, transform .5s ease";
      ripple.style.opacity = "0";
      ripple.style.transform = "scale(1.6)";
    },
  };
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", install);
  else install();
}

const cursor = { x: 640, y: 520 };

async function place(page) {
  // In sight from the chapter's first frame, a phone's narrow screen too.
  const size = page.viewportSize();
  if (size) {
    cursor.x = Math.min(cursor.x, size.width - 40);
    cursor.y = Math.min(cursor.y, size.height - 60);
  }
  await page
    .evaluate(([x, y]) => window.__yarrow?.move(x, y, 0), [cursor.x, cursor.y])
    .catch(() => {});
}

async function moveTo(page, x, y, ms) {
  cursor.x = Math.round(x);
  cursor.y = Math.round(y);
  await page
    .evaluate(
      ([cx, cy, d]) => window.__yarrow?.move(cx, cy, d),
      [cursor.x, cursor.y, ms],
    )
    .catch(() => {});
  await page.mouse.move(cursor.x, cursor.y, { steps: 10 });
  await page.waitForTimeout(ms);
}

/**
 * The pointer's loop around a box, as people circle what they talk about
 * on a shared screen: an ellipse a little wider than the box, clockwise
 * from its upper left, a turn and a bit, not quite round.
 */
function loop(box, every = 16) {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const rx = Math.min(Math.max(box.width / 2 + 18, 30), 340);
  const ry = Math.min(Math.max(box.height / 2 + 14, 22), 220);
  const ms = Math.round(Math.min(1700, 800 + (rx + ry) * 2));
  const steps = Math.max(30, Math.round(ms / every));
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    const angle = -2.6 + eased * 1.2 * 2 * Math.PI;
    // A hand's loop: a little uneven, and wider as it closes.
    const r = 1 + 0.05 * Math.sin(angle * 3 + 0.7) + 0.07 * eased;
    points.push([
      Math.round(cx + rx * r * Math.cos(angle)),
      Math.round(cy + ry * r * Math.sin(angle)),
    ]);
  }
  return { points, ms };
}

async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(400);
  await place(page);
}

function join(base, route) {
  if (!route) return base;
  if (/^https?:/.test(route)) return route;
  return base.replace(/\/$/, "") + "/" + String(route).replace(/^\//, "");
}

/**
 * Where an "at" action aims: the plan's expression, answered by the page as
 * a point of it ({x, y}), asked until it has one. For what no selector
 * reaches: a star on a canvas, a sprite. An arrow function is called.
 */
async function aim(page, expression, ms = 4000) {
  const start = Date.now();
  for (;;) {
    const spot = await page
      .evaluate(
        `(() => { const v = (${expression}); return typeof v === "function" ? v() : v; })()`,
      )
      .catch(() => null);
    if (spot && Number.isFinite(spot.x) && Number.isFinite(spot.y))
      return { x: spot.x, y: spot.y };
    if (Date.now() - start >= ms) return null;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** How many times an "at" action goes: a few catches in a row, at most 10. */
const repeats = (action) =>
  Math.min(Math.max(Math.round(Number(action.times) || 1), 1), 10);

/** A pointer's mark around an aimed point. */
const around = (spot) => ({
  x: Math.round(spot.x) - 14,
  y: Math.round(spot.y) - 14,
  width: 28,
  height: 28,
});

async function act(page, base, action, marks, clock) {
  const kind = action.do;
  if (kind === "wait")
    return page.waitForTimeout(Math.min(Number(action.ms) || 1000, 8000));
  if (kind === "goto") {
    await page.goto(join(base, action.path), { waitUntil: "load" });
    return settle(page);
  }
  if (kind === "reload") {
    await page.reload({ waitUntil: "load" });
    return settle(page);
  }
  if (kind === "press") {
    await page.keyboard.press(action.key);
    return settle(page);
  }
  if (kind === "scroll" && !action.target) {
    await page.evaluate(
      (y) => window.scrollBy({ top: y, behavior: "smooth" }),
      Number(action.y) || 400,
    );
    return page.waitForTimeout(900);
  }
  if (action.at) {
    for (let i = 0; i < repeats(action); i++) {
      const spot = await aim(page, action.at);
      if (!spot) throw new Error("nothing to aim at");
      await moveTo(page, spot.x, spot.y, 260);
      // A moving target: aimed again once the pointer is there.
      const now = (await aim(page, action.at, 0)) || spot;
      if (kind !== "click") {
        marks.push({ atMs: clock(), kind: "point", box: around(now) });
        await page.waitForTimeout(Math.min(Number(action.ms) || 1600, 6000));
        continue;
      }
      await moveTo(page, now.x, now.y, 40);
      marks.push({ atMs: clock(), kind: "click", box: around(now) });
      await page.evaluate(
        ([cx, cy]) => window.__yarrow?.tap(cx, cy),
        [now.x, now.y],
      );
      await page.mouse.click(now.x, now.y);
      await page.waitForTimeout(Math.min(Number(action.ms) || 120, 3000));
    }
    return;
  }
  const locator = page.locator(action.target).first();
  await locator.waitFor({ state: "visible", timeout: 8000 });
  await locator.scrollIntoViewIfNeeded();
  if (kind === "scroll") return page.waitForTimeout(600);
  const box = await locator.boundingBox();
  if (!box) throw new Error("not on screen");
  const shown = {
    x: Math.round(box.x),
    y: Math.round(box.y),
    width: Math.round(box.width),
    height: Math.round(box.height),
  };
  if (kind === "circle") {
    const { points, ms } = loop(box);
    await moveTo(page, points[0][0], points[0][1], 700);
    marks.push({ atMs: clock(), kind: "point", box: shown });
    await page.evaluate(([p, d]) => window.__yarrow?.path(p, d), [points, ms]);
    await page.waitForTimeout(ms + 300);
    [cursor.x, cursor.y] = points.at(-1);
    await page.mouse.move(cursor.x, cursor.y);
    return;
  }
  const x = box.x + Math.min(box.width * 0.6, box.width - 6);
  const y = box.y + Math.min(box.height * 0.65, box.height - 4);
  await moveTo(page, x, y, 750);
  const at = clock();
  if (kind === "point" || kind === "hover") {
    marks.push({ atMs: at, kind: "point", box: shown });
    await page.waitForTimeout(Math.min(Number(action.ms) || 1600, 6000));
    return;
  }
  await page.evaluate(([cx, cy]) => window.__yarrow?.tap(cx, cy), [x, y]);
  if (kind === "click") {
    marks.push({ atMs: at, kind: "click", box: shown });
    await locator.click();
    return settle(page);
  }
  if (kind === "select") {
    marks.push({ atMs: at, kind: "click", box: shown });
    await locator.selectOption(String(action.value));
    return settle(page);
  }
  // fill / type: typed where one sees it.
  marks.push({ atMs: at, kind: "type", box: shown });
  await locator.click();
  await locator.fill("");
  await locator.pressSequentially(String(action.text ?? ""), { delay: 55 });
  await page.waitForTimeout(300);
}

// ---------- Yarrow's own pages: the ticket, the terminal ----------

function htmlPage(body, style) {
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    FONTS +
    "<style>html,body{margin:0;height:100%;background:" +
    COLORS.surface +
    ";color:" +
    COLORS.text +
    ";font-family:Geist,system-ui,sans-serif;-webkit-font-smoothing:antialiased}" +
    style +
    "</style></head><body>" +
    body +
    "</body></html>"
  );
}

const GITHUB =
  '<svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>';

/** The ticket as a title card: where it comes from and its title, nothing to read along. */
function ticketPage(ticket) {
  const sources = {
    github: "GitHub",
    jira: "Jira",
    linear: "Linear",
    trello: "Trello",
  };
  const key = String(ticket.source || "").toLowerCase();
  const number = ticket.number ? String(ticket.number) : "";
  return htmlPage(
    '<main><p class="by">' +
      (key === "github" ? GITHUB : "") +
      "<span>" +
      escape(sources[key] || ticket.source || "Ticket") +
      "</span>" +
      (number
        ? "<b>" + escape(/^\d+$/.test(number) ? "#" + number : number) + "</b>"
        : "") +
      "</p><h1>" +
      escape(ticket.title) +
      "</h1></main>",
    "body{background:#f6f4ef;color:#141518}" +
      "main{box-sizing:border-box;height:100%;padding:0 128px 24px;display:flex;flex-direction:column;justify-content:center;gap:30px}" +
      "main>*{opacity:0;transform:translateY(16px)}" +
      ".go main>*{animation:in .7s cubic-bezier(.2,.7,.2,1) forwards}.go main>h1{animation-delay:.15s}" +
      "@keyframes in{to{opacity:1;transform:none}}" +
      ".by{margin:0;display:flex;align-items:center;gap:12px;color:#5f636b;font-size:24px;font-weight:500}" +
      ".by b{margin-left:4px;padding:3px 12px;border-radius:9px;background:" +
      COLORS.amber +
      ";color:#1a1408;font-weight:600}" +
      "h1{margin:0;max-width:1000px;font:500 66px/1.1 Jost,Geist,sans-serif;letter-spacing:-.02em;text-wrap:balance}",
  );
}

function terminalPage(cwd) {
  return htmlPage(
    '<pre id="t"></pre><script>' +
      "var t=document.getElementById('t');" +
      "function line(cls,text){var s=document.createElement('div');if(cls)s.className=cls;s.textContent=text;t.appendChild(s);while(t.scrollHeight>t.clientHeight&&t.children.length>1)t.removeChild(t.firstChild);return s}" +
      "window.prompt_=function(){var s=line('cmd','');var p=document.createElement('b');p.textContent=" +
      JSON.stringify(cwd + " $ ") +
      ";s.appendChild(p);var c=document.createElement('span');s.appendChild(c);return c};" +
      "window.type_=async function(text){var c=window.prompt_();var step=Math.max(12,Math.min(45,2200/Math.max(text.length,1)));for(var ch of text){c.textContent+=ch;await new Promise(function(r){setTimeout(r,step)})}};" +
      "window.print_=async function(lines,total){var step=Math.max(8,Math.min(90,total/Math.max(lines.length,1)));for(var l of lines){line(l.cls,l.text);await new Promise(function(r){setTimeout(r,step)})}};" +
      "</script>",
    "pre{box-sizing:border-box;margin:0;height:100%;padding:48px 56px;overflow:hidden;background:#0f1013;color:#c9ccd2;font:22px/1.65 'Geist Mono',ui-monospace,monospace;white-space:pre-wrap;word-break:break-all}" +
      ".cmd b{font-weight:400;color:" +
      COLORS.muted +
      "}.cmd span{color:" +
      COLORS.text +
      "}" +
      ".err{color:" +
      COLORS.red +
      "}.ok{color:" +
      COLORS.green +
      "}",
  );
}

// ---------- A document: a file of the repository, as a reader sees it ----------

/** Where the browser opens a document: its context answers, no server. */
const FILES = "http://files.localhost";
/** The repository as it was (git worktree add /tmp/before HEAD). */
const BEFORE = "/tmp/before";

const repoDir = () =>
  fs.existsSync("/workspace/repo") ? "/workspace/repo" : process.cwd();
const fileOf = (chapter) => String(chapter.file || "").replace(/^\.?\/+/, "");
/** The change's version at /file, the one before it at /before/file. */
const documentPath = (chapter) =>
  (chapter.before === true ? "/before/" : "/") + fileOf(chapter);

/** A line of Markdown: code, links, images, emphasis. */
function inline(text) {
  const codes = [];
  const html = escape(text)
    .replace(/`([^`]+)`/g, (_, code) => {
      codes.push(code);
      return "\uE000" + (codes.length - 1) + "\uE000";
    })
    .replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (_, alt, src) =>
      /^https?:/.test(src)
        ? '<img alt="' + alt + '" src="' + src + '">'
        : '<span class="alt">' + alt + "</span>",
    )
    .replace(
      /\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g,
      '<a href="$2" onclick="return false">$1</a>',
    )
    .replace(
      /&lt;(https?:\/\/[^&\s]+)&gt;/g,
      '<a href="$1" onclick="return false">$1</a>',
    )
    .replace(
      /\*\*(.+?)\*\*|__(.+?)__/g,
      (_, a, b) => "<strong>" + (a ?? b) + "</strong>",
    )
    .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/(^|\W)_(?!\s)(.+?)_(?=\W|$)/g, "$1<em>$2</em>")
    .replace(/~~(.+?)~~/g, "<del>$1</del>");
  return html.replace(
    /\uE000(\d+)\uE000/g,
    (_, i) => "<code>" + codes[i] + "</code>",
  );
}

const headingId = (text) =>
  String(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");

const heading = (level, text) =>
  "<h" +
  level +
  ' id="' +
  headingId(text) +
  '">' +
  inline(text) +
  "</h" +
  level +
  ">";

const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const FENCE = /^\s*(`{3,}|~{3,})/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const ATX = /^(#{1,6})\s+(.*?)\s*#*\s*$/;

/** Raw HTML, as READMEs open with, without what would run. */
const safeHtml = (html) =>
  html
    .replace(/<(script|style|iframe)[\s\S]*?<\/\1>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "");

const cells = (row) =>
  row
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());

/** A list's items: each its lines, the marker taken off, nested lists kept. */
function listItems(lines) {
  const indent = LIST.exec(lines[0])[1].length;
  const items = [];
  for (const line of lines) {
    const match = LIST.exec(line);
    if (match && match[1].length <= indent) items.push([match[3]]);
    else
      items
        .at(-1)
        .push(line.replace(new RegExp("^\\s{0," + (indent + 4) + "}"), ""));
  }
  return items;
}

function listHtml(lines) {
  const ordered = /\d/.test(LIST.exec(lines[0])[2]);
  const items = listItems(lines.filter((line) => line.trim())).map((item) => {
    const task = /^\[([ xX])\]\s+/.exec(item[0]);
    if (task) item[0] = item[0].slice(task[0].length);
    const inner = blocks(item.join("\n"));
    const html =
      inner.length === 1 && inner[0].html.startsWith("<p>")
        ? inner[0].html.slice(3, -4)
        : inner.map((block) => block.html).join("");
    return (
      "<li" +
      (task ? ' class="task"' : "") +
      ">" +
      (task
        ? '<input type="checkbox" disabled' +
          (task[1] === " " ? "" : " checked") +
          "> "
        : "") +
      html +
      "</li>"
    );
  });
  return (
    (ordered ? "<ol>" : "<ul>") + items.join("") + (ordered ? "</ol>" : "</ul>")
  );
}

function tableHtml(head, rule, rows) {
  const align = cells(rule).map((cell) =>
    /^:-+:$/.test(cell) ? "center" : /-+:$/.test(cell) ? "right" : "",
  );
  const cell = (tag, text, j) =>
    "<" +
    tag +
    (align[j] ? ' align="' + align[j] + '"' : "") +
    ">" +
    inline(text) +
    "</" +
    tag +
    ">";
  return (
    "<table><thead><tr>" +
    cells(head)
      .map((text, j) => cell("th", text, j))
      .join("") +
    "</tr></thead><tbody>" +
    rows
      .map(
        (row) =>
          "<tr>" +
          cells(row)
            .map((text, j) => cell("td", text, j))
            .join("") +
          "</tr>",
      )
      .join("") +
    "</tbody></table>"
  );
}

/** A Markdown text's blocks, each its source and its HTML. */
function blocks(markdown) {
  const lines = String(markdown)
    .replace(/\r/g, "")
    .replace(/\t/g, "    ")
    .split("\n");
  const out = [];
  let i = 0;
  const take = (from, html) =>
    out.push({ raw: lines.slice(from, i).join("\n"), html });
  const starts = (line) =>
    FENCE.test(line) || ATX.test(line) || /^\s*>/.test(line);
  while (i < lines.length) {
    const line = lines[i];
    const from = i;
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const lang = line.trim().slice(fence[1].length).trim().split(/\s/)[0];
      const body = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1]))
        body.push(lines[i++]);
      i++;
      take(
        from,
        "<pre" +
          (lang ? ' data-lang="' + escape(lang) + '"' : "") +
          "><code>" +
          escape(body.join("\n")) +
          "</code></pre>",
      );
      continue;
    }
    const atx = ATX.exec(line);
    if (atx) {
      i++;
      take(from, heading(atx[1].length, atx[2]));
      continue;
    }
    if (RULE.test(line)) {
      i++;
      take(from, "<hr>");
      continue;
    }
    if (/^\s*>/.test(line)) {
      const body = [];
      while (i < lines.length && /^\s*>/.test(lines[i]))
        body.push(lines[i++].replace(/^\s*>\s?/, ""));
      take(
        from,
        "<blockquote>" +
          blocks(body.join("\n"))
            .map((block) => block.html)
            .join("") +
          "</blockquote>",
      );
      continue;
    }
    const next = lines[i + 1] || "";
    if (line.includes("|") && next.includes("-") && TABLE_RULE.test(next)) {
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim())
        rows.push(lines[i++]);
      take(from, tableHtml(line, next, rows));
      continue;
    }
    if (LIST.test(line)) {
      const indent = LIST.exec(line)[1].length;
      i++;
      while (i < lines.length) {
        const current = lines[i];
        if (!current.trim()) {
          // A blank line ends the list, unless an item or its text goes on.
          const after = lines[i + 1] || "";
          const item = LIST.exec(after);
          if ((item && item[1].length >= indent) || /^\s{2,}\S/.test(after))
            i++;
          else break;
          continue;
        }
        const item = LIST.exec(current);
        if (item && item[1].length < indent) break;
        if (!item && !/^\s/.test(current) && starts(current)) break;
        i++;
      }
      take(from, listHtml(lines.slice(from, i)));
      continue;
    }
    if (/^\s*<[a-zA-Z!/]/.test(line)) {
      while (i < lines.length && lines[i].trim()) i++;
      take(from, safeHtml(lines.slice(from, i).join("\n")));
      continue;
    }
    const text = [];
    let level = 0;
    while (i < lines.length && lines[i].trim()) {
      const current = lines[i];
      // A line of = or - under text makes it a heading.
      if (text.length && /^\s*(=+|-+)\s*$/.test(current)) {
        level = current.trim()[0] === "=" ? 1 : 2;
        i++;
        break;
      }
      if (text.length && (starts(current) || LIST.test(current))) break;
      text.push(current.trim());
      i++;
    }
    take(
      from,
      level
        ? heading(level, text.join(" "))
        : "<p>" + inline(text.join(" ")) + "</p>",
    );
  }
  return out;
}

const blockKey = (raw) => raw.replace(/\s+/g, " ").trim();

/** The blocks of `now` the file as it was already had, in order, as a diff keeps them. */
function keptBlocks(was, now) {
  const a = was.map((block) => blockKey(block.raw));
  const b = now.map((block) => blockKey(block.raw));
  const longest = Array.from({ length: a.length + 1 }, () =>
    new Array(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      longest[i][j] =
        a[i] === b[j]
          ? longest[i + 1][j + 1] + 1
          : Math.max(longest[i + 1][j], longest[i][j + 1]);
  const kept = new Set();
  for (let i = 0, j = 0; i < a.length && j < b.length;)
    if (a[i] === b[j]) {
      kept.add(j);
      i++;
      j++;
    } else if (longest[i + 1][j] >= longest[i][j + 1]) i++;
    else j++;
  return kept;
}

const FILE_ICON =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 9 4.25V1.5Zm6.75.062V4.25c0 .138.112.25.25.25h2.688Z"/></svg>';

/**
 * The file's page: Markdown read as on the repository's page, anything else
 * as text. Given the file as it was, what the change added or rewrote is
 * marked in the margin.
 */
function documentPage(file, text, was) {
  let body;
  if (/\.(md|markdown|mdx)$/i.test(file)) {
    const now = blocks(text);
    const kept = was === null ? null : keptBlocks(blocks(was), now);
    body = now
      .map((block, i) =>
        kept && !kept.has(i)
          ? '<div class="new">' + block.html + "</div>"
          : block.html,
      )
      .join("");
  } else body = "<pre><code>" + escape(text) + "</code></pre>";
  return (
    '<!doctype html><html><head><meta charset="utf-8"><title>' +
    escape(file) +
    "</title><style>" +
    "html{background:#f6f8fa}body{margin:0;padding:32px 24px 160px;color:#1f2328;font:16px/1.6 Inter,-apple-system,'Segoe UI',system-ui,sans-serif;-webkit-font-smoothing:antialiased}" +
    ".box{max-width:980px;margin:0 auto;background:#fff;border:1px solid #d1d9e0;border-radius:8px}" +
    ".head{display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid #d1d9e0;font-size:14px;font-weight:600}" +
    ".head svg{color:#59636e}" +
    "article{padding:32px 48px 40px}article>:first-child,article>.new:first-child>*{margin-top:0}" +
    "h1,h2,h3,h4,h5,h6{margin:24px 0 16px;font-weight:600;line-height:1.25}" +
    "h1,h2{padding-bottom:.3em;border-bottom:1px solid #d1d9e0}h1{font-size:2em}h2{font-size:1.5em}h3{font-size:1.25em}" +
    "p,ul,ol,blockquote,pre,table{margin:0 0 16px}ul,ol{padding-left:2em}li+li{margin-top:.25em}li.task{list-style:none;margin-left:-1.4em}" +
    "a{color:#0969da;text-decoration:none}img{max-width:100%}.alt{color:#59636e;font-style:italic}" +
    "code{padding:.2em .4em;font:85% 'JetBrains Mono',ui-monospace,monospace;background:#818b981f;border-radius:6px}" +
    "pre{padding:16px;overflow:auto;background:#f6f8fa;border-radius:6px;line-height:1.45}pre code{padding:0;background:none;font-size:85%}" +
    "blockquote{padding:0 1em;color:#59636e;border-left:.25em solid #d1d9e0}" +
    "hr{height:.25em;margin:24px 0;border:0;background:#d1d9e0}" +
    "table{border-collapse:collapse}th,td{padding:6px 13px;border:1px solid #d1d9e0}th{font-weight:600}tr:nth-child(2n) td{background:#f6f8fa}" +
    ".new{position:relative}.new::before{content:'';position:absolute;left:-26px;top:2px;bottom:2px;width:4px;border-radius:2px;background:#1a7f37}" +
    '</style></head><body><div class="box"><div class="head">' +
    FILE_ICON +
    "<span>" +
    escape(file) +
    "</span></div><article>" +
    body +
    "</article></div></body></html>"
  );
}

/**
 * The chapter's document, read from the repository; as it was, from
 * /tmp/before, else from the last commit (the sandbox commits nothing: the
 * brain does, on delivery).
 */
function documentOf(chapter) {
  const file = fileOf(chapter);
  const read = (dir) => {
    try {
      return fs.readFileSync(path.join(dir, file), "utf8");
    } catch {
      return null;
    }
  };
  const committed = () => {
    const shown = spawnSync("git", ["show", "HEAD:" + file], {
      cwd: repoDir(),
      encoding: "utf8",
    });
    return shown.status === 0 ? shown.stdout : null;
  };
  const was = read(BEFORE) ?? committed();
  const text = chapter.before === true ? was : read(repoDir());
  if (text === null)
    throw new Error(
      file +
        (chapter.before === true
          ? " as it was: neither in " + BEFORE + " nor in the last commit"
          : " is not in the repository"),
    );
  return {
    file,
    path: documentPath(chapter),
    html: documentPage(file, text, chapter.before === true ? null : was),
  };
}

/** A browser context's documents, by path: the context answers them itself. */
async function serveDocuments(context, documents) {
  await context.route(FILES + "/**", (route) => {
    const html = documents.get(
      decodeURIComponent(new URL(route.request().url()).pathname),
    );
    return route.fulfill(
      html
        ? { contentType: "text/html; charset=utf-8", body: html }
        : { status: 404, contentType: "text/plain", body: "Not found" },
    );
  });
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g;

function terminalOutput(chapter) {
  if (typeof chapter.output === "string")
    return { text: chapter.output, code: 0 };
  const cwd =
    chapter.cwd ||
    (fs.existsSync("/workspace/repo") ? "/workspace/repo" : process.cwd());
  log("running: " + chapter.command);
  const result = spawnSync("bash", ["-lc", "(" + chapter.command + ") 2>&1"], {
    cwd,
    encoding: "utf8",
    timeout: 240000,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, CI: "1", FORCE_COLOR: "0", NO_COLOR: "1" },
  });
  const text =
    String(result.stdout || "") +
    (result.error ? "\n" + result.error.message : "");
  return { text, code: result.status ?? 1 };
}

// ---------- Recording ----------

async function record(browser, plan, chapter, index, take, state) {
  const tab = chapter.tab;
  const doc = tab === "document" ? documentOf(chapter) : null;
  // A document is a page of the browser, as the app's are.
  const app = doc
    ? { url: FILES }
    : tab === "app"
      ? plan.apps[chapter.app || "after"]
      : null;
  const phone = chapter.device === "phone";
  const size = phone ? PHONE : DESKTOP;
  // The command runs before the clip: the clip replays it at reading pace.
  const output = tab === "terminal" ? terminalOutput(chapter) : null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yarrow-clip-"));
  const options = {
    viewport: size,
    deviceScaleFactor: 1,
    recordVideo: { dir, size },
    bypassCSP: true,
  };
  if (phone) Object.assign(options, { isMobile: true, hasTouch: true });
  if (app?.storage) options.storageState = app.storage;
  const context = await browser.newContext(options);
  if (app) await context.addInitScript(overlay);
  if (doc) await serveDocuments(context, new Map([[doc.path, doc.html]]));
  const page = await context.newPage();
  const born = Date.now();
  const problems = [];
  const marks = [];
  const target = estimateMs(chapter.say);
  let url = null;
  if (app) {
    url = doc ? FILES + doc.path : join(app.url, chapter.path);
    await page.goto(url, { waitUntil: "load", timeout: 45000 });
    await page
      .waitForLoadState("networkidle", { timeout: 6000 })
      .catch(() => {});
    await place(page);
  } else {
    const html =
      tab === "ticket"
        ? ticketPage(plan.ticket)
        : terminalPage(chapter.cwd ? path.basename(chapter.cwd) : "repo");
    await page
      .setContent(html, { waitUntil: "load", timeout: 10000 })
      .catch(() => {});
    await page.evaluate(() => document.fonts.ready).catch(() => {});
    url = tab === "ticket" ? plan.ticket.url || null : chapter.command;
  }
  const startMs = Date.now() - born;
  const clock = () => Date.now() - born - startMs;
  // The address bar follows the page: a link, a filter kept in the
  // address, a reload (the same address, loaded again).
  const urls = [];
  if (app) {
    url = bare(page.url());
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame())
        urls.push({ atMs: clock(), url: bare(frame.url()) });
    });
  }

  if (app) {
    const actions = chapter.actions || [];
    const lead = 700;
    await page.waitForTimeout(lead);
    for (const [i, action] of actions.entries()) {
      // Spread over what is said, so the gestures land on the words.
      const due =
        lead + (target - lead) * 0.85 * (i / Math.max(actions.length, 1));
      const wait = due - clock();
      if (wait > 0) await page.waitForTimeout(Math.min(wait, 3000));
      try {
        await act(page, app.url, action, marks, clock);
      } catch (error) {
        problems.push(
          "chapter " +
            (index + 1) +
            ' "' +
            chapter.title +
            '": ' +
            action.do +
            " " +
            (action.target || action.path || "") +
            ": " +
            String(error?.message).split("\n")[0],
        );
      }
    }
  } else if (tab === "ticket") {
    await page.evaluate(() => document.body.classList.add("go"));
  } else {
    const lines = output.text
      .replace(ANSI, "")
      .replace(/\r/g, "")
      .split("\n")
      .slice(-60)
      .map((text) => ({
        text,
        cls: /\b(fail(ed|ing)?|error)\b/i.test(text)
          ? "err"
          : /\b(pass(ed|ing)?|ok)\b/i.test(text)
            ? "ok"
            : "",
      }));
    while (lines.length && !lines.at(-1).text.trim()) lines.pop();
    if (output.code !== 0)
      lines.push({ text: "exit " + output.code, cls: "err" });
    await page.waitForTimeout(500);
    await page.evaluate((text) => window.type_(text), chapter.command);
    await page.waitForTimeout(250);
    await page.evaluate(
      ([l, total]) => window.print_(l, total),
      [lines, Math.min(2500, Math.max(600, target * 0.3))],
    );
  }

  await page.waitForTimeout(Math.max(target, clock() + 1000) - clock());
  const title = app ? await page.title().catch(() => "") : null;
  // The poster shows the change: the app after it, else its proof run.
  const before = chapter.app === "before" || chapter.before === true;
  if (!before && app && !state.poster)
    state.poster = await page.screenshot({ type: "jpeg", quality: 82 });
  if (!before && tab === "terminal" && !state.run)
    state.run = await page.screenshot({ type: "jpeg", quality: 82 });
  if (!state.first)
    state.first = await page.screenshot({ type: "jpeg", quality: 82 });
  const durationMs = clock();
  const video = page.video();
  await context.close();
  const name =
    take +
    "-" +
    String(index + 1).padStart(2, "0") +
    "-" +
    slug(chapter.title) +
    ".webm";
  fs.copyFileSync(await video.path(), path.join(DIR, name));
  fs.rmSync(dir, { recursive: true, force: true });
  return {
    chapter: {
      title: chapter.title,
      part: chapter.part,
      tab,
      url,
      urls,
      page: title || null,
      before,
      say: chapter.say,
      clip: "presentation/" + name,
      startMs,
      durationMs,
      width: size.width,
      height: size.height,
      marks,
    },
    problems,
  };
}

// ---------- The desktop: a real screen, filmed ----------
//
// A virtual screen (Xvfb) and a window manager (openbox); Yarrow's wallpaper
// under every window (a page, in a Chromium app window); the browser, driven
// by Playwright, and a terminal (xterm), each filling the screen, the one the
// chapter needs in front. The pointer is the real one, moved and clicked by
// xdotool. ffmpeg films the whole screen; each chapter is cut from that film,
// its waits taken out.

const SCREEN = { width: 1440, height: 900 };
/** The pointer's way to what the agent shows as it talks: the voice goes on. */
const BRISK_GLIDE_MS = 280;
// Each app fills the screen, its frame included, so it reads large on film:
// no corners, no gaps.
const FULL = { x: 0, y: 0, ...SCREEN };
const WINDOWS = { browser: FULL, terminal: FULL };
// The browser and its pages a quarter larger, as a zoomed screen share:
// what the app shows reads in a player a third of the film's width. The
// page and its window count in these units, the pointer in the screen's.
const ZOOM = 1.25;
// Chromium's toolbar, from the window's top left in the window's units (ZOOM
// turns them into the screen's): the address, the reload button.
const TOOLBAR = { y: 63, reload: 98 };
// Chromium's tabs, from the window's corner: where the first starts, how
// wide each is (two fit at full width), the strip's middle.
const TABS = { left: 44, width: 230, y: 20 };
// The app as it was, then as it is now: the tabs' order.
const TWINS = ["before", "after"];
// What the desktop needs, by command, and the packages that bring it.
const DESKTOP_TOOLS = {
  Xvfb: "xvfb",
  openbox: "openbox",
  xdotool: "xdotool",
  wmctrl: "wmctrl",
  xterm: "xterm",
  xprop: "x11-utils",
  ffmpeg: "ffmpeg",
};
const DESKTOP_EXTRAS = [
  "dmz-cursor-theme",
  "fonts-inter",
  "fonts-jetbrains-mono",
  "fonts-dejavu-core",
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// A command's flags, written as one would type them.
const flags = (text) => text.trim().split(/\s+/);

/**
 * The keyboard of whoever takes control of the stage's screen. x11vnc
 * presses a real key for each character the page sends, and one added on a
 * spare key (its -add_keysyms) types nothing in Chromium: so every accented
 * letter sits on AltGr and Shift+AltGr of a real key, the us layout otherwise.
 * A Mac's Command is Control here: its Command+C copies, as at home.
 * Failing leaves the plain keyboard, ASCII only.
 */
function accentKeyboard(display) {
  const code = (at) => "U" + at.toString(16).toUpperCase().padStart(4, "0");
  const accents = [];
  for (let at = 0xe0; at <= 0xfd; at++)
    if (at !== 0xf7) accents.push([code(at), code(at - 32)]);
  // By name: X's numbers for these are not Unicode's.
  accents.push(
    ["oe", "OE"],
    [code(0xff), "Ydiaeresis"],
    ["EuroSign", code(0xa3)],
    [code(0xdf), code(0xa7)],
  );
  const row = (name, letters) =>
    [...letters].map((letter, i) => [
      name + String(i + 1).padStart(2, "0"),
      letter,
      letter.toUpperCase(),
    ]);
  const digits = "exclam at numbersign dollar percent asciicircum ampersand";
  const keys = [
    ...row("AD", "qwertyuiop"),
    ...row("AC", "asdfghjkl"),
    ...row("AB", "zxcvbnm"),
    ...digits
      .split(" ")
      .map((shifted, i) => ["AE0" + (i + 1), String(i + 1), shifted]),
  ];
  const symbols = keys.map(([key, plain, shifted], i) => {
    const type = i < 26 ? "FOUR_LEVEL_ALPHABETIC" : "FOUR_LEVEL";
    const levels = [plain, shifted, ...accents[i]].join(",");
    return "key <" + key + '> {type="' + type + '",[' + levels + "]};";
  });
  const file = path.join(os.tmpdir(), "yarrow-keyboard.xkb");
  fs.writeFileSync(
    file,
    'xkb_keymap {xkb_keycodes {include "evdev+aliases(qwerty)"};' +
      'xkb_types {include "complete"};xkb_compat {include "complete"};' +
      'xkb_symbols {include "pc+us+inet(evdev)+level3(ralt_switch)"\n' +
      symbols.join("\n") +
      '\nmodifier_map Control {<LWIN>,<RWIN>};\n};xkb_geometry {include "pc(pc105)"};};\n',
  );
  const loaded = spawnSync("xkbcomp", ["-w0", file, display], {
    stdio: "ignore",
  });
  if (loaded.status !== 0) log("no accents on the screen's keyboard");
}

async function until(test, ms, step = 100) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await test();
    if (value) return value;
    if (Date.now() > end) return null;
    await sleep(step);
  }
}

const quote = (text) =>
  /^[\w@%+=:,./-]+$/.test(text)
    ? text
    : "'" + text.replace(/'/g, "'\\''") + "'";

const has = (command) =>
  spawnSync("sh", ["-c", "command -v " + command], { stdio: "ignore" })
    .status === 0;

/** The desktop's programs, installed when the sandbox lacks them. */
function installDesktop() {
  const missing = Object.keys(DESKTOP_TOOLS).filter((command) => !has(command));
  if (missing.length === 0) return;
  const root = process.getuid?.() === 0;
  if (!root && spawnSync("sudo", ["-n", "true"]).status !== 0)
    throw new Error("installing " + missing.join(", ") + " needs root");
  log("installing the desktop: " + missing.join(", "));
  const apt = (args) =>
    spawnSync(
      root ? "apt-get" : "sudo",
      root ? args : ["-n", "apt-get", ...args],
      {
        stdio: "ignore",
        env: { ...process.env, DEBIAN_FRONTEND: "noninteractive" },
        timeout: 420000,
      },
    ).status === 0;
  apt(["update", "-qq"]);
  const packages = [
    ...new Set([
      ...missing.map((command) => DESKTOP_TOOLS[command]),
      ...DESKTOP_EXTRAS,
    ]),
  ];
  const install = ["install", "-y", "-qq", "--no-install-recommends"];
  if (!apt([...install, ...packages]))
    for (const name of packages) apt([...install, name]);
  const still = Object.keys(DESKTOP_TOOLS).filter((command) => !has(command));
  if (still.length) throw new Error("still missing: " + still.join(", "));
}

/** An X bitmap for openbox's title buttons, drawn with # and dots. */
function xbm(name, rows) {
  const width = rows[0].length;
  const bytes = [];
  for (const row of rows)
    for (let start = 0; start < width; start += 8) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit++)
        if (row[start + bit] === "#") byte |= 1 << bit;
      bytes.push("0x" + byte.toString(16).padStart(2, "0"));
    }
  return (
    "#define " +
    name +
    "_width " +
    width +
    "\n#define " +
    name +
    "_height " +
    rows.length +
    "\nstatic unsigned char " +
    name +
    "_bits[] = {" +
    bytes.join(",") +
    "};\n"
  );
}

const BUTTONS = {
  close: [
    "##....##",
    "###..###",
    ".######.",
    "..####..",
    "..####..",
    ".######.",
    "###..###",
    "##....##",
  ],
  max: [
    "########",
    "########",
    "#......#",
    "#......#",
    "#......#",
    "#......#",
    "#......#",
    "########",
  ],
  iconify: [
    "........",
    "........",
    "........",
    "........",
    "........",
    "........",
    "########",
    "########",
  ],
};

/** A flat dark theme for the windows openbox frames (the terminal). */
const THEME = `border.width: 1
padding.width: 12
padding.height: 7
window.handle.width: 0
window.client.padding.width: 0
window.client.padding.height: 0
window.active.border.color: #2c2f36
window.inactive.border.color: #24262b
window.active.title.bg: flat solid
window.active.title.bg.color: #1c1e23
window.inactive.title.bg: flat solid
window.inactive.title.bg.color: #17191c
window.active.title.separator.color: #1c1e23
window.inactive.title.separator.color: #17191c
window.active.label.bg: parentrelative
window.inactive.label.bg: parentrelative
window.active.label.text.color: #e4e6ea
window.inactive.label.text.color: #8a909b
window.label.text.justify: center
window.active.button.unpressed.bg: parentrelative
window.active.button.unpressed.image.color: #aeb3bc
window.active.button.hover.bg: parentrelative
window.active.button.hover.image.color: #ffffff
window.active.button.pressed.bg: parentrelative
window.active.button.pressed.image.color: #ffffff
window.active.button.disabled.bg: parentrelative
window.active.button.disabled.image.color: #555a63
window.inactive.button.unpressed.bg: parentrelative
window.inactive.button.unpressed.image.color: #5f646d
window.inactive.button.hover.bg: parentrelative
window.inactive.button.hover.image.color: #aeb3bc
window.inactive.button.pressed.bg: parentrelative
window.inactive.button.pressed.image.color: #aeb3bc
window.inactive.button.disabled.bg: parentrelative
window.inactive.button.disabled.image.color: #3c4048
menu.border.width: 1
menu.border.color: #2c2f36
menu.items.bg: flat solid
menu.items.bg.color: #1c1e23
menu.items.text.color: #e4e6ea
menu.items.active.bg: flat solid
menu.items.active.bg.color: #2c2f36
menu.items.active.text.color: #ffffff
menu.title.bg: flat solid
menu.title.bg.color: #1c1e23
menu.title.text.color: #e4e6ea
osd.border.width: 1
osd.border.color: #2c2f36
osd.bg: flat solid
osd.bg.color: #1c1e23
osd.label.text.color: #e4e6ea
`;

function openboxConfig() {
  const rule = (match, box, extra = "") =>
    "<application " +
    match +
    '><position force="yes"><x>' +
    box.x +
    "</x><y>" +
    box.y +
    "</y></position><size><width>" +
    box.width +
    "</width><height>" +
    box.height +
    "</height></size>" +
    extra +
    "</application>";
  const under =
    "<decor>no</decor><layer>below</layer><focus>no</focus><skip_pager>yes</skip_pager><skip_taskbar>yes</skip_taskbar>";
  // A click focuses and raises its window, and still reaches the app.
  const press = (context) =>
    '<context name="' +
    context +
    '"><mousebind button="Left" action="Press"><action name="Focus"/><action name="Raise"/></mousebind></context>';
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n<openbox_config xmlns="http://openbox.org/3.4/rc">' +
    "<focus><focusNew>yes</focusNew><followMouse>no</followMouse></focus>" +
    "<placement><policy>Smart</policy><center>yes</center></placement>" +
    "<theme><name>Yarrow</name><titleLayout>LIMC</titleLayout><keepBorder>yes</keepBorder><animateIconify>no</animateIconify>" +
    '<font place="ActiveWindow"><name>Inter</name><size>10</size><weight>Normal</weight></font>' +
    '<font place="InactiveWindow"><name>Inter</name><size>10</size><weight>Normal</weight></font>' +
    "</theme><desktops><number>1</number></desktops>" +
    // One key no keyboard has: with none, openbox binds its own (Alt+Tab).
    '<keyboard><keybind key="W-F24"><action name="Focus"/></keybind></keyboard>' +
    "<mouse><dragThreshold>4</dragThreshold><doubleClickTime>300</doubleClickTime>" +
    press("Client") +
    '<context name="Titlebar"><mousebind button="Left" action="Press"><action name="Focus"/><action name="Raise"/></mousebind><mousebind button="Left" action="Drag"><action name="Move"/></mousebind></context>' +
    "</mouse><applications>" +
    rule('title="Yarrow desktop*"', FULL, under) +
    rule('class="YarrowDesktop"', FULL, under) +
    rule('class="YarrowBrowser"', WINDOWS.browser) +
    rule('class="YarrowTerm"', WINDOWS.terminal) +
    "</applications></openbox_config>\n"
  );
}

// Inter for the interface, a programmer's font in the terminal; the
// sandbox's own fonts after them.
const FONTCONFIG = `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <alias><family>sans-serif</family><prefer><family>Inter</family><family>DejaVu Sans</family></prefer></alias>
  <alias><family>monospace</family><prefer><family>JetBrains Mono</family><family>DejaVu Sans Mono</family></prefer></alias>
  <include ignore_missing="yes">/etc/fonts/fonts.conf</include>
  <match target="font">
    <edit name="antialias" mode="assign"><bool>true</bool></edit>
    <edit name="hinting" mode="assign"><bool>true</bool></edit>
    <edit name="hintstyle" mode="assign"><const>hintslight</const></edit>
    <edit name="rgba" mode="assign"><const>none</const></edit>
  </match>
</fontconfig>
`;

// The terminal's colors, quieter than xterm's own.
const PALETTE = [
  "#1c1e23",
  "#ee7b6e",
  "#5ccb95",
  "#f2b544",
  "#6ea8fe",
  "#c792ea",
  "#5fc9d8",
  "#c9ccd2",
  "#5f646d",
  "#ff9a8f",
  "#7ee0ae",
  "#ffd27a",
  "#93bfff",
  "#dcb2f5",
  "#86dce8",
  "#f2f3f5",
];

function bashrc(state, cwd) {
  return [
    "export PS1='\\[\\e[38;2;138;144;155m\\]\\W\\[\\e[0m\\] \\[\\e[38;2;242;181;68m\\]$\\[\\e[0m\\] '",
    "export CI=1 TERM=xterm-256color HISTFILE=/dev/null PAGER=cat GIT_PAGER=cat",
    "__yarrow_n=0",
    // Each prompt: the run's exit code when it failed, and a note the
    // recorder reads to know the command is done.
    "__yarrow_prompt() { local s=$?; __yarrow_n=$((__yarrow_n + 1)); if [ $__yarrow_n -gt 1 ] && [ $s -ne 0 ]; then printf '\\e[38;2;238;123;110mexit %s\\e[0m\\n' $s; fi; echo \"$__yarrow_n $s\" > " +
      quote(state) +
      "; }",
    "PROMPT_COMMAND=__yarrow_prompt",
    "cd " + quote(cwd),
    "",
  ].join("\n");
}

/** The wallpaper: the page under every window. */
const DESKTOP_PAGE =
  '<!doctype html><html><head><meta charset="utf-8"><title>Yarrow desktop</title><style>' +
  "html,body{margin:0;width:" +
  SCREEN.width +
  "px;height:" +
  SCREEN.height +
  "px;overflow:hidden;cursor:default;user-select:none}" +
  "body{background:radial-gradient(900px 560px at 84% 106%,rgba(230,174,56,.2),transparent 70%)," +
  "radial-gradient(820px 560px at 4% -10%,rgba(110,150,255,.13),transparent 70%)," +
  "linear-gradient(160deg,#181a1f 0%,#0f1013 55%,#0b0c0e 100%)}" +
  "</style></head><body></body></html>";

/** A chapter's own time on the film: it stops while a long run is cut out. */
class Take {
  constructor() {
    this.parts = [];
    this.open = Date.now();
  }
  clock() {
    const closed = this.parts.reduce((sum, [from, to]) => sum + to - from, 0);
    return closed + (this.open ? Date.now() - this.open : 0);
  }
  pause() {
    if (!this.open) return;
    this.parts.push([this.open, Date.now()]);
    this.open = null;
  }
  resume() {
    if (!this.open) this.open = Date.now();
  }
  end() {
    this.pause();
    return this.parts;
  }
}

class Desktop {
  constructor() {
    this.dir = fs.mkdtempSync(path.join(os.tmpdir(), "yarrow-desk-"));
    this.children = [];
    this.ids = {};
    this.front = null;
    this.pointer = { x: 720, y: 470 };
    this.jobs = [];
    this.known = new Set();
    // The documents its browser opens, by path (serveDocuments).
    this.documents = new Map();
    this.typed = false;
    this.cwd = null;
    this.focused = 0;
    /** The agent acts as it talks: quicker than on film, on the word. */
    this.brisk = false;
  }

  spawn(name, command, args, options = {}) {
    const out = fs.openSync(path.join(this.dir, name + ".log"), "a");
    const child = spawn(command, args, {
      env: this.env,
      stdio: ["ignore", out, out],
      ...options,
    });
    child.on("error", () => {});
    this.children.push(child);
    return child;
  }

  x(command, args) {
    const result = spawnSync(command, args, {
      env: this.env,
      encoding: "utf8",
      timeout: 15000,
    });
    if (result.status !== 0)
      throw new Error(
        command +
          " " +
          args[0] +
          ": " +
          String(
            result.stderr || result.error?.message || "exit " + result.status,
          )
            .trim()
            .split("\n")[0],
      );
    return result.stdout.trim();
  }

  /** The windows openbox manages, by id. */
  windows() {
    let listing = "";
    try {
      listing = this.x("wmctrl", ["-lx"]);
    } catch {
      return [];
    }
    return listing
      .split("\n")
      .map((line) => line.match(/^(0x[0-9a-f]+)\s+-?\d+\s+(\S+)/i))
      .filter(Boolean)
      .map((match) => ({ id: parseInt(match[1], 16), wmClass: match[2] }));
  }

  /** The window that appeared since the last look: the one just opened. */
  async opened(test = () => true, ms = 20000) {
    const found = await until(
      () => this.windows().find((w) => !this.known.has(w.id) && test(w)),
      ms,
      150,
    );
    if (!found) return null;
    this.known.add(found.id);
    return found.id;
  }

  activeId() {
    try {
      const match = this.x("xprop", ["-root", "_NET_ACTIVE_WINDOW"]).match(
        /0x[0-9a-f]+/i,
      );
      return match ? parseInt(match[0], 16) : null;
    } catch {
      return null;
    }
  }

  /**
   * How the window manager sizes it: its frame's edges (openbox's title bar,
   * a border: left, right, top, bottom) and the steps it grows by (a
   * terminal grows a character at a time).
   */
  sizing(id) {
    const found = { frame: [0, 0, 0, 0], step: [1, 1] };
    try {
      const listing = this.x("xprop", [
        "-id",
        "0x" + id.toString(16),
        "_NET_FRAME_EXTENTS",
        "WM_NORMAL_HINTS",
      ]);
      const edges = listing.match(/=\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+)/);
      if (edges) found.frame = edges.slice(1).map(Number);
      const step = listing.match(/resize increment: (\d+) by (\d+)/);
      if (step) found.step = step.slice(1).map((n) => Math.max(1, Number(n)));
    } catch {
      // Not framed yet.
    }
    return found;
  }

  /**
   * The window and its frame in the box (wmctrl sizes the window alone). A
   * window that grows by steps (a terminal, a character at a time) would be
   * rounded down, the window behind showing in the gap: it is maximized
   * instead.
   */
  place(id, box) {
    const hex = "0x" + id.toString(16);
    const { frame, step } = this.sizing(id);
    const [left, right, top, bottom] = frame;
    try {
      if (step[0] > 1 || step[1] > 1)
        this.x("wmctrl", [
          "-i",
          "-r",
          hex,
          "-b",
          "add,maximized_vert,maximized_horz",
        ]);
      else
        this.x("wmctrl", [
          "-i",
          "-r",
          hex,
          "-e",
          "0," +
            box.x +
            "," +
            box.y +
            "," +
            (box.width - left - right) +
            "," +
            (box.height - top - bottom),
        ]);
    } catch {
      // openbox's rule placed it already.
    }
  }

  /** Where the window is on the screen, as X places it: in the screen's units. */
  corner(id, box) {
    try {
      const listing = this.x("xdotool", [
        "getwindowgeometry",
        "--shell",
        String(id),
      ]);
      const x = listing.match(/^X=(-?\d+)/m);
      const y = listing.match(/^Y=(-?\d+)/m);
      if (x && y) return { x: Number(x[1]), y: Number(y[1]) };
    } catch {
      // Unread: where it was placed.
    }
    return { x: box.x, y: box.y };
  }

  raise(id) {
    try {
      this.x("wmctrl", ["-i", "-a", "0x" + id.toString(16)]);
    } catch {
      // Gone: the next chapter opens it again.
    }
  }

  /**
   * The app's browser alone on the screen, for the member who takes
   * control, the terminal gone. Or the desktop as it was.
   */
  alone(on) {
    const { browser, terminal } = this.ids;
    this.x("xdotool", [on ? "windowunmap" : "windowmap", String(terminal)]);
    if (!browser) return;
    this.raise(browser);
    this.front = "browser";
  }

  /** Tells the running x11vnc, each heard before the next. */
  tell(...commands) {
    for (const command of commands) {
      const told = spawnSync(
        "x11vnc",
        ["-display", this.env.DISPLAY, "-sync", "-R", command],
        { env: this.env, encoding: "utf8", timeout: 5000 },
      );
      if (!/ack=1/.test(told.stdout + told.stderr))
        throw new Error("the screen did not take " + command);
    }
  }

  key(keys) {
    this.x("xdotool", ["key", "--clearmodifiers", keys]);
  }

  async start(playwright, { film = true } = {}) {
    const born = Date.now();
    installDesktop();
    let display = 99;
    while (fs.existsSync("/tmp/.X" + display + "-lock") && display > 80)
      display--;
    const home = path.join(this.dir, "home");
    for (const sub of [
      ".config/openbox",
      ".themes/Yarrow/openbox-3",
      ".config/fontconfig",
    ])
      fs.mkdirSync(path.join(home, sub), { recursive: true });
    const fontconfig = path.join(home, ".config/fontconfig/fonts.conf");
    fs.writeFileSync(fontconfig, FONTCONFIG);
    this.env = {
      ...process.env,
      DISPLAY: ":" + display,
      FONTCONFIG_FILE: fontconfig,
      XCURSOR_THEME: "DMZ-Black",
      XCURSOR_SIZE: "32",
      LANG: process.env.LANG || "C.UTF-8",
      NO_AT_BRIDGE: "1",
    };
    this.spawn("xvfb", "Xvfb", [
      ":" + display,
      ...flags(
        `-screen 0 ${SCREEN.width}x${SCREEN.height}x24 -dpi 96 -nolisten tcp`,
      ),
    ]);
    if (
      !(await until(
        () =>
          spawnSync("xprop", ["-root"], { env: this.env, stdio: "ignore" })
            .status === 0,
        10000,
      ))
    )
      throw new Error("the virtual screen did not start");
    spawnSync("xrdb", ["-merge"], {
      env: this.env,
      input:
        "Xft.dpi: 96\nXft.antialias: 1\nXft.hintstyle: hintslight\nXft.rgba: none\nXcursor.theme: DMZ-Black\nXcursor.size: 32\n",
    });

    // The window manager, in Yarrow's colors.
    const theme = path.join(home, ".themes/Yarrow/openbox-3");
    fs.writeFileSync(path.join(theme, "themerc"), THEME);
    for (const [name, rows] of Object.entries(BUTTONS))
      fs.writeFileSync(path.join(theme, name + ".xbm"), xbm(name, rows));
    const rc = path.join(home, ".config/openbox/rc.xml");
    fs.writeFileSync(rc, openboxConfig());
    this.spawn("openbox", "openbox", ["--config-file", rc], {
      env: {
        ...this.env,
        HOME: home,
        XDG_DATA_HOME: path.join(home, ".local/share"),
      },
    });
    await sleep(600);

    // The desktop page.
    this.server = http.createServer((request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(DESKTOP_PAGE);
    });
    await new Promise((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    const port = this.server.address().port;

    // The browser the agent drives, with its tabs and its address bar.
    const box = WINDOWS.browser;
    this.browser = await launch(playwright, {
      headless: false,
      env: this.env,
      ignoreDefaultArgs: ["--enable-automation"],
      args: [
        "--class=YarrowBrowser",
        "--force-device-scale-factor=" + ZOOM,
        "--window-position=" +
          Math.round(box.x / ZOOM) +
          "," +
          Math.round(box.y / ZOOM),
        "--window-size=" +
          Math.round(box.width / ZOOM) +
          "," +
          Math.round(box.height / ZOOM),
        "--force-dark-mode",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-gpu",
        "--test-type",
        "--hide-crash-restore-bubble",
        "--password-store=basic",
        "--disable-search-engine-choice-screen",
        "--disable-features=Translate,MediaRouter",
      ],
    });

    // Under every window: the same Chromium, as an app window.
    const chrome = [
      playwright.pw.chromium.executablePath(),
      findChromium({ full: true }),
    ].find((file) => file && fs.existsSync(file));
    if (!chrome) throw new Error("no Chromium for the desktop");
    const profile = path.join(this.dir, "desktop-profile");
    fs.mkdirSync(path.join(profile, "Default"), { recursive: true });
    fs.writeFileSync(
      path.join(profile, "Default", "Preferences"),
      JSON.stringify({
        browser: { custom_chrome_frame: false },
        profile: { exit_type: "Normal" },
      }),
    );
    this.known = new Set(this.windows().map((w) => w.id));
    this.spawn("desktop", chrome, [
      "--app=http://127.0.0.1:" + port + "/",
      "--class=YarrowDesktop",
      "--user-data-dir=" + profile,
      "--window-position=0,0",
      "--window-size=" + SCREEN.width + "," + SCREEN.height,
      "--force-device-scale-factor=1",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "--no-sandbox",
      "--test-type",
      "--hide-scrollbars",
      "--noerrdialogs",
      "--hide-crash-restore-bubble",
      "--password-store=basic",
      "--disable-features=Translate,MediaRouter",
    ]);
    const desk = await this.opened(() => true, 30000);
    if (!desk) throw new Error("the desktop window did not open");
    this.place(desk, { x: 0, y: 0, ...SCREEN });
    try {
      this.x("wmctrl", [
        "-i",
        "-r",
        "0x" + desk.toString(16),
        "-b",
        "add,below,sticky,skip_taskbar,skip_pager",
      ]);
    } catch {
      // openbox's rule keeps it below.
    }

    // The terminal, its shell in the repository.
    this.cwd = fs.existsSync("/workspace/repo")
      ? "/workspace/repo"
      : process.cwd();
    this.state = path.join(this.dir, "prompt");
    // What it shows, kept as it comes: a command run live is read back.
    this.transcript = path.join(this.dir, "terminal.log");
    const rcfile = path.join(this.dir, "bashrc");
    fs.writeFileSync(rcfile, bashrc(this.state, this.cwd));
    const shell = ["bash", "--rcfile", rcfile, "-i"];
    const resources = [
      "cursorBlink: false",
      "visualBell: false",
      "termName: xterm-256color",
      "locale: true",
      "borderWidth: 0",
      ...PALETTE.map((color, i) => "color" + i + ": " + color),
    ];
    this.spawn("xterm", "xterm", [
      ...flags(
        "-class YarrowTerm -T Terminal -n Terminal -fa monospace -fs 16",
      ),
      ...flags(
        "-bg #0f1013 -fg #d5d7dc -cr #f2b544 -b 20 +sb -geometry 100x28",
      ),
      ...resources.flatMap((line) => ["-xrm", "XTerm*" + line]),
      "-e",
      ...(has("script")
        ? ["script", "-q", "-f", this.transcript, "-c", shell.join(" ")]
        : shell),
    ]);
    const term = await this.opened((w) => /yarrowterm/i.test(w.wmClass), 15000);
    if (!term) throw new Error("the terminal did not open");
    this.place(term, WINDOWS.terminal);
    this.ids.terminal = term;
    this.front = "terminal";
    await until(() => this.prompt(), 8000);

    this.x("xdotool", [
      "mousemove",
      String(this.pointer.x),
      String(this.pointer.y),
    ]);
    if (film) await this.startFilm();
    log(
      "desktop up on :" +
        display +
        " in " +
        ((Date.now() - born) / 1000).toFixed(1) +
        " s",
    );
  }

  /** The whole screen, filmed until the end; chapters are cut from it later. */
  async startFilm() {
    this.master = path.join(this.dir, "screen.mkv");
    this.ffmpeg = this.spawn(
      "ffmpeg-film",
      "ffmpeg",
      [
        ...flags(
          "-loglevel error -nostats -progress pipe:1 -stats_period 0.25",
        ),
        ...flags(
          `-f x11grab -framerate 30 -video_size ${SCREEN.width}x${SCREEN.height}`,
        ),
        ...flags(`-draw_mouse 1 -i ${this.env.DISPLAY}`),
        ...flags(
          "-c:v libx264 -preset ultrafast -tune zerolatency -crf 14 -g 30",
        ),
        ...flags("-pix_fmt yuv420p"),
        this.master,
      ],
      { stdio: ["pipe", "pipe", "ignore"] },
    );
    // Video time 0 on the wall clock: the earliest frame time, minus how far
    // the film had got when ffmpeg said so.
    this.zero = null;
    let rest = "";
    this.ffmpeg.stdout.on("data", (data) => {
      const lines = (rest + data).split("\n");
      rest = lines.pop();
      for (const line of lines) {
        const match = line.match(/^out_time_us=(\d+)/);
        if (!match || Number(match[1]) <= 0) continue;
        const zero = Date.now() - Number(match[1]) / 1000;
        if (this.zero === null || zero < this.zero) this.zero = zero;
      }
    });
    // A busy sandbox can take more than ten seconds (seen once).
    if (!(await until(() => this.zero !== null, 20000)))
      throw new Error("ffmpeg did not start filming");
  }

  alive() {
    return (
      this.ffmpeg && this.ffmpeg.exitCode === null && this.browser.isConnected()
    );
  }

  /** The shell's last prompt: how many it showed, and the exit code before it. */
  prompt() {
    try {
      const [count, status] = fs
        .readFileSync(this.state, "utf8")
        .trim()
        .split(" ")
        .map(Number);
      return { count, status };
    } catch {
      return null;
    }
  }

  async glide(x, y, ms = 700) {
    x = Math.round(Math.max(1, Math.min(SCREEN.width - 2, x)));
    y = Math.round(Math.max(1, Math.min(SCREEN.height - 2, y)));
    const from = { ...this.pointer };
    const distance = Math.hypot(x - from.x, y - from.y);
    if (distance < 1) return;
    const duration = Math.min(ms, 220 + distance * 0.9);
    const steps = Math.max(6, Math.round(duration / 14));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const eased = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
      this.x("xdotool", [
        "mousemove",
        String(Math.round(from.x + (x - from.x) * eased)),
        String(Math.round(from.y + (y - from.y) * eased)),
      ]);
      await sleep(duration / steps);
    }
    this.pointer = { x, y };
  }

  async click() {
    this.x("xdotool", ["mousedown", "1"]);
    await sleep(70);
    this.x("xdotool", ["mouseup", "1"]);
  }

  /** A real click on the page; Playwright's when the page never felt it. */
  async press(page, locator) {
    const count = () => page.evaluate(() => window.__yarrowPresses || 0);
    const before = await count().catch(() => 0);
    await this.click();
    const felt = await until(
      async () => (await count().catch(() => before + 1)) > before,
      600,
      50,
    );
    if (felt) return;
    log("a click missed the page: Playwright clicked");
    await locator.click();
  }

  /**
   * Off the film: the page takes the keyboard from the address bar, as after
   * an address typed, by a click where the page has nothing to click.
   */
  async focusPage(page) {
    const spot = await page.evaluate(() => {
      const quiet = (x, y) => {
        const element = document.elementFromPoint(x, y);
        return (
          element &&
          !element.closest(
            "a,button,input,textarea,select,label,summary,video,iframe,[role],[onclick],[tabindex],[contenteditable]",
          )
        );
      };
      const { innerWidth: width, innerHeight: height } = window;
      for (const [x, y] of [
        [width - 24, height - 24],
        [24, height - 24],
        [width / 2, height - 24],
        [width - 24, height / 2],
      ])
        if (quiet(x, y)) return [x, y];
      return null;
    });
    if (!spot) return;
    const at = { ...this.pointer };
    const aim = await this.screenOf(page, spot[0], spot[1]);
    // The window's tabs share the spot: two clicks there in half a second
    // made a double click, and the page showed text selected on film.
    await sleep(Math.max(0, this.focused + 600 - Date.now()));
    this.x("xdotool", [
      "mousemove",
      String(Math.round(aim.x)),
      String(Math.round(aim.y)),
    ]);
    await this.click();
    this.focused = Date.now();
    await page
      .evaluate(() => window.getSelection()?.removeAllRanges())
      .catch(() => {});
    this.x("xdotool", ["mousemove", String(at.x), String(at.y)]);
    await sleep(150);
  }

  /** Where a point of the page is on the screen, in the screen's pixels. */
  async screenOf(page, x, y) {
    const [left, top] = await page.evaluate(
      () =>
        window.__yarrowScreen || [
          window.screenX + (window.outerWidth - window.innerWidth) / 2,
          window.screenY +
            window.outerHeight -
            window.innerHeight -
            (window.outerWidth - window.innerWidth) / 2,
        ],
    );
    return { x: (left + x) * ZOOM, y: (top + y) * ZOOM };
  }

  /** The pointer onto a point of the page, corrected once the page saw it. */
  async glideTo(page, x, y, ms = 750) {
    const aim = await this.screenOf(page, x, y);
    await this.glide(aim.x, aim.y, this.brisk ? BRISK_GLIDE_MS : ms);
    await sleep(40);
    const seen = await this.screenOf(page, x, y);
    if (Math.abs(seen.x - aim.x) > 1 || Math.abs(seen.y - aim.y) > 1)
      await this.glide(seen.x, seen.y, 120);
  }

  /** The real pointer's loop around a box of the page. */
  async circle(page, box) {
    const corner = await this.screenOf(page, box.x, box.y);
    const { points, ms } = loop({
      x: corner.x,
      y: corner.y,
      width: box.width * ZOOM,
      height: box.height * ZOOM,
    });
    await this.glide(
      points[0][0],
      points[0][1],
      this.brisk ? BRISK_GLIDE_MS : 700,
    );
    const each = (ms * (this.brisk ? 0.6 : 1)) / points.length;
    for (const [x, y] of points) {
      this.x("xdotool", ["mousemove", String(x), String(y)]);
      await sleep(each);
    }
    const [x, y] = points.at(-1);
    this.pointer = { x, y };
  }

  /** The app in front, at once: the film cuts to it. */
  async show(app) {
    if (this.front === app && this.activeId() === this.ids[app]) return;
    this.raise(this.ids[app]);
    await until(() => this.activeId() === this.ids[app], 1500, 50);
    this.front = app;
  }

  /** A grab of the screen as it is, for the poster. */
  still() {
    const result = spawnSync(
      "ffmpeg",
      [
        ...flags(
          `-loglevel error -f x11grab -video_size ${SCREEN.width}x${SCREEN.height}`,
        ),
        ...flags(
          `-i ${this.env.DISPLAY} -frames:v 1 -q:v 3 -f image2 -c:v mjpeg pipe:1`,
        ),
      ],
      { env: this.env, maxBuffer: 32 * 1024 * 1024, timeout: 15000 },
    );
    return result.status === 0 && result.stdout.length ? result.stdout : null;
  }

  async record(plan, chapter, index, take, state) {
    const name =
      take +
      "-" +
      String(index + 1).padStart(2, "0") +
      "-" +
      slug(chapter.title) +
      ".mp4";
    const result =
      chapter.tab === "app" || chapter.tab === "document"
        ? await this.recordApp(plan, chapter, index, state)
        : await this.recordTerminal(chapter, state);
    const parts = result.take.end();
    this.jobs.push({ name, parts });
    const durationMs = parts.reduce((sum, [from, to]) => sum + to - from, 0);
    return {
      chapter: {
        ...result.chapter,
        title: chapter.title,
        part: chapter.part,
        tab: chapter.tab,
        say: chapter.say,
        desktop: true,
        clip: "presentation/" + name,
        startMs: 0,
        durationMs,
        width: SCREEN.width,
        height: SCREEN.height,
      },
      problems: result.problems,
    };
  }

  async recordApp(plan, chapter, index, state) {
    const doc = chapter.tab === "document" ? documentOf(chapter) : null;
    if (doc) this.documents.set(doc.path, doc.html);
    const { which, app } = shownIn(plan, chapter);
    const before = which === "before" || chapter.before === true;
    const target = estimateMs(chapter.say);
    const problems = [];
    const marks = [];
    const url = doc ? FILES + doc.path : join(app.url, chapter.path);
    // The other app's tab, untouched on this chapter's page: a click on it
    // goes from one to the other on the film. Otherwise a new window.
    const tabs = this.tabs;
    const switching = Boolean(
      tabs &&
      tabs.active !== which &&
      tabs.fresh[which] &&
      tabs.urls[which] === url,
    );
    const page = switching
      ? tabs.pages[which]
      : await this.openWindow(plan, index, which, url);

    const film = new Take();
    const clock = () => film.clock();
    const urls = [];
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame())
        urls.push({ atMs: clock(), url: bare(frame.url()) });
    });
    const fail = (action, error) =>
      problems.push(
        "chapter " +
          (index + 1) +
          ' "' +
          chapter.title +
          '": ' +
          action.do +
          " " +
          (action.target || action.path || "") +
          ": " +
          String(error?.message).split("\n")[0],
      );
    await this.show("browser");
    // Until its tab is clicked, the chapter still shows the other app.
    const shownFrom = switching ? await this.switchTab(which, clock, marks) : 0;
    this.tabs.active = which;
    this.tabs.fresh[which] = false;
    await this.actOver(
      page,
      app.url,
      chapter.actions,
      target,
      clock,
      marks,
      fail,
    );
    await sleep(Math.max(target, clock() + 1000) - clock());
    const title = await page.title().catch(() => "");
    film.pause();
    // The poster shows the change: the app after it, else its proof run.
    if (!before && !state.poster) state.poster = this.still();
    if (!state.first) state.first = this.still();
    return {
      take: film,
      problems,
      chapter: {
        url: bare(url),
        urls,
        page: title || null,
        before,
        // The app as it was, still on screen until the tab is clicked.
        beforeMs: switching && !before ? shownFrom : 0,
        marks,
      },
    };
  }

  /** The chapter's actions, spread over what is said, so the gestures land on the words. */
  /**
   * The chapter's gestures spread over its voice. Live, `hold` waits while
   * the member holds the presentation, and `clock` stops meanwhile.
   */
  async actOver(page, base, actions = [], target, clock, marks, fail, hold) {
    const lead = Math.max(700, clock());
    if (clock() < lead) await sleep(lead - clock());
    for (const [i, action] of actions.entries()) {
      const due =
        lead + (target - lead) * 0.85 * (i / Math.max(actions.length, 1));
      const end = clock() + Math.min(due - clock(), 3000);
      while (clock() < end) {
        await sleep(Math.min(end - clock(), 200));
        await hold?.();
      }
      await hold?.();
      try {
        await this.act(page, base, action, marks, clock);
      } catch (error) {
        fail(action, error);
      }
    }
  }

  /**
   * Off the film: a new window on the chapter's page, as a first visit sees
   * it, over the last one, which then closes. With the app as it was in the
   * plan, the window holds both, as a developer keeps main and their branch
   * open side by side: the app as it was in the first tab, as it is now in
   * the second, the other one on the next chapter's page when it shows it.
   */
  async openWindow(plan, index, which, url) {
    const other = which === "before" ? "after" : "before";
    let twins = Boolean(
      plan.apps?.before?.url &&
      plan.apps?.after?.url &&
      plan.chapters.some(
        (chapter) => chapter.tab === "app" && chapter.app === "before",
      ),
    );
    // One sign-in serves both: a cookie of localhost is every port's.
    const storage =
      plan.apps?.[which]?.storage || (twins && plan.apps[other].storage);
    const context = await this.browser.newContext({
      viewport: null,
      colorScheme: "light",
      bypassCSP: true,
      ...(storage ? { storageState: storage } : {}),
    });
    await context.addInitScript(overlay, { real: true });
    await serveDocuments(context, this.documents);
    const browserWindow = (w) => !/yarrowterm|yarrowdesktop/i.test(w.wmClass);
    const first = await context.newPage();
    const id = await this.opened(browserWindow, 15000);
    if (!id) throw new Error("the browser window did not open");
    this.place(id, WINDOWS.browser);
    const pages = { [twins ? "before" : which]: first };
    if (twins) {
      const second = await context.newPage();
      // A second window instead of a tab: one app a window, as before.
      const apart = await this.opened(browserWindow, 800);
      if (apart) {
        log("a new page opened a window, not a tab: one app a window");
        await second.close().catch(() => {});
        twins = false;
        pages[which] = first;
        delete pages[other];
      } else pages.after = second;
    }
    const next = plan.chapters
      .slice(index + 1)
      .find((chapter) => chapter.tab === "app" && chapter.device !== "phone");
    const urls = { [which]: url };
    if (twins)
      urls[other] = join(
        plan.apps[other].url,
        next && (next.app || "after") === other ? next.path : undefined,
      );
    await Promise.all(
      Object.entries(pages).map(async ([name, page]) => {
        await page.goto(urls[name], { waitUntil: "load", timeout: 45000 });
        await page
          .waitForLoadState("networkidle", { timeout: 6000 })
          .catch(() => {});
        await page.evaluate(() => document.fonts.ready).catch(() => {});
      }),
    );
    const page = pages[which];
    await page.bringToFront();
    await this.tabs?.context.close().catch(() => {});
    this.tabs = {
      context,
      pages,
      urls,
      active: which,
      fresh: { before: true, after: true },
    };
    this.ids.browser = id;
    // Each tab's page takes the keyboard from its address bar, the
    // chapter's last, in front.
    for (const name of Object.keys(pages).filter((name) => name !== which)) {
      await pages[name].bringToFront();
      await this.focusPage(pages[name]);
    }
    await page.bringToFront();
    await this.focusPage(page);
    // A terminal used on film stays in front until the chapter shows the browser.
    if (this.front === "terminal" && this.typed) this.raise(this.ids.terminal);
    else this.front = "browser";
    await sleep(500);
    return page;
  }

  /** A row of the screen, as ffmpeg grabs it: its pixels' [r, g, b]. */
  row(y) {
    const result = spawnSync(
      "ffmpeg",
      [
        ...flags("-loglevel error -f x11grab"),
        ...["-video_size", SCREEN.width + "x1"],
        ...["-i", this.env.DISPLAY + "+0," + Math.round(y)],
        ...flags("-frames:v 1 -f rawvideo -pix_fmt rgb24 pipe:1"),
      ],
      { env: this.env, timeout: 5000 },
    );
    const bytes = result.stdout;
    if (result.status !== 0 || !bytes || bytes.length < SCREEN.width * 3)
      return null;
    return Array.from({ length: SCREEN.width }, (_, x) => [
      bytes[x * 3],
      bytes[x * 3 + 1],
      bytes[x * 3 + 2],
    ]);
  }

  /**
   * The browser's tab in front, as the screen shows it: on the strip, low
   * under the titles, the run of pixels unlike the window's frame (the
   * other tabs have its color).
   */
  frontTab(y) {
    const row = this.row(y);
    if (!row) return null;
    // Empty strip, short of the window's buttons.
    const frame = row[SCREEN.width - 260];
    const unlike = (pixel) =>
      Math.abs(pixel[0] - frame[0]) +
        Math.abs(pixel[1] - frame[1]) +
        Math.abs(pixel[2] - frame[2]) >
      24;
    let best = null;
    let start = null;
    for (let x = FULL.x; x <= SCREEN.width; x++) {
      const on = x < SCREEN.width && unlike(row[x]);
      if (on && start === null) start = x;
      if (!on && start !== null) {
        if (!best || x - start > best.end - best.start)
          best = { start, end: x };
        start = null;
      }
    }
    return best && best.end - best.start > 80 ? best : null;
  }

  /**
   * The other app's tab, clicked: aimed from the tab in front as the screen
   * shows it, checked on the screen after, clicked again if it missed.
   */
  async switchTab(which, clock, marks) {
    const page = this.tabs.pages[which];
    // From X, not the page: a tab behind gives its page's corner as the
    // window's, the strip aimed 110 px low, in the app.
    const frame = this.corner(this.ids.browser, WINDOWS.browser);
    const low = frame.y + (TABS.y + 9) * ZOOM;
    const front = this.frontTab(low);
    let tab = TABS.width * ZOOM;
    let left = frame.x + TABS.left * ZOOM + tab * TWINS.indexOf(which);
    if (front) {
      tab = front.end - front.start;
      const step = TWINS.indexOf(which) - TWINS.indexOf(this.tabs.active);
      left = front.start + tab * step;
    }
    // Its title's side, away from its close button.
    const spot = { x: left + tab * 0.35, y: frame.y + TABS.y * ZOOM };
    const on = (shown) => shown && shown.start <= spot.x && spot.x < shown.end;
    let at = 0;
    for (let attempt = 0; attempt < 2; attempt++) {
      await this.glide(spot.x, spot.y, 800);
      await sleep(150);
      if (attempt === 0)
        marks.push({
          atMs: clock(),
          kind: "click",
          box: { x: left, y: spot.y - 14, width: tab, height: 28 },
        });
      at = clock();
      await this.click();
      // Down off the strip, its tab's preview with it.
      await this.glide(spot.x + 220, spot.y + 320, 650);
      // Unread, the screen cannot tell: Playwright's word stands.
      if (!front || on(this.frontTab(low))) return Math.round(at);
      log("the tab click missed" + (attempt ? " again" : ""));
    }
    log("the tab clicks missed: Playwright switched");
    await page.bringToFront();
    return Math.round(at);
  }

  async settle(page) {
    await page
      .waitForLoadState("networkidle", { timeout: this.brisk ? 800 : 4000 })
      .catch(() => {});
    await sleep(this.brisk ? 80 : 400);
  }

  async act(page, base, action, marks, clock) {
    const kind = action.do;
    if (kind === "wait")
      return sleep(Math.min(Number(action.ms) || 1000, 8000));
    if (kind === "goto")
      return this.address(page, join(base, action.path), marks, clock);
    if (kind === "reload") return this.reload(page, marks, clock);
    if (kind === "press") {
      await page.keyboard.press(action.key);
      return this.settle(page);
    }
    if (kind === "scroll" && !action.target) {
      await page.evaluate(
        (y) => window.scrollBy({ top: y, behavior: "smooth" }),
        Number(action.y) || 400,
      );
      return sleep(this.brisk ? 450 : 900);
    }
    if (action.at) {
      for (let i = 0; i < repeats(action); i++) {
        const spot = await aim(page, action.at);
        if (!spot) throw new Error("nothing to aim at");
        await this.glideTo(page, spot.x, spot.y, 260);
        // A moving target: aimed again once the pointer is there.
        const now = (await aim(page, action.at, 0)) || spot;
        if (kind !== "click") {
          marks.push({ atMs: clock(), kind: "point", box: around(now) });
          await sleep(Math.min(Number(action.ms) || 1600, 6000));
          continue;
        }
        if (now !== spot) {
          const there = await this.screenOf(page, now.x, now.y);
          await this.glide(there.x, there.y, 60);
        }
        marks.push({ atMs: clock(), kind: "click", box: around(now) });
        await this.click();
        await sleep(Math.min(Number(action.ms) || 120, 3000));
      }
      return;
    }
    const locator = page.locator(action.target).first();
    await locator.waitFor({ state: "visible", timeout: 8000 });
    if (kind === "scroll") {
      await locator.evaluate((element) =>
        element.scrollIntoView({ behavior: "smooth", block: "center" }),
      );
      return sleep(this.brisk ? 450 : 900);
    }
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    if (!box) throw new Error("not on screen");
    const shown = {
      x: Math.round(box.x),
      y: Math.round(box.y),
      width: Math.round(box.width),
      height: Math.round(box.height),
    };
    if (kind === "circle") {
      marks.push({ atMs: clock(), kind: "point", box: shown });
      await this.circle(page, box);
      return sleep(this.brisk ? 0 : 300);
    }
    const x = box.x + Math.min(box.width * 0.6, box.width - 6);
    const y = box.y + Math.min(box.height * 0.65, box.height - 4);
    await this.glideTo(page, x, y);
    const at = clock();
    if (kind === "point" || kind === "hover") {
      marks.push({ atMs: at, kind: "point", box: shown });
      await sleep(
        Math.min(Number(action.ms) || (this.brisk ? 500 : 1600), 6000),
      );
      return;
    }
    await page.evaluate(([cx, cy]) => window.__yarrow?.tap(cx, cy), [x, y]);
    if (kind === "click") {
      marks.push({ atMs: at, kind: "click", box: shown });
      await this.press(page, locator);
      return this.settle(page);
    }
    if (kind === "select") {
      marks.push({ atMs: at, kind: "click", box: shown });
      await locator.selectOption(String(action.value));
      return this.settle(page);
    }
    // fill / type: typed where one sees it.
    marks.push({ atMs: at, kind: "type", box: shown });
    await this.press(page, locator);
    await locator.fill("");
    await locator.pressSequentially(String(action.text ?? ""), {
      delay: this.brisk ? 22 : 55,
    });
    await sleep(this.brisk ? 60 : 300);
  }

  /** A page by its address, typed in the browser's own address bar. */
  async address(page, url, marks, clock) {
    const frame = await page.evaluate(() => ({
      x: window.screenX,
      y: window.screenY,
      width: window.outerWidth,
    }));
    const bar = {
      x: (frame.x + Math.round(frame.width * 0.4)) * ZOOM,
      y: (frame.y + TOOLBAR.y) * ZOOM,
    };
    await this.glide(bar.x, bar.y, 750);
    marks.push({
      atMs: clock(),
      kind: "click",
      box: { x: bar.x - 160, y: bar.y - 16, width: 320, height: 32 },
    });
    await this.click();
    await sleep(150);
    this.key("ctrl+l");
    this.x("xdotool", ["type", "--delay", "35", bare(url)]);
    // What the address bar would complete it to goes: the address as typed.
    this.key("Delete");
    await sleep(200);
    const target = new URL(url);
    const arrived = page
      .waitForURL(
        (now) => now.pathname === target.pathname && now.host === target.host,
        { timeout: 8000 },
      )
      .then(
        () => true,
        () => false,
      );
    this.key("Return");
    if (!(await arrived)) await page.goto(url, { waitUntil: "load" });
    await this.settle(page);
  }

  /** A reload with the browser's own button, else its key. */
  async reload(page, marks, clock) {
    const frame = await page.evaluate(() => ({
      x: window.screenX,
      y: window.screenY,
    }));
    const button = {
      x: (frame.x + TOOLBAR.reload) * ZOOM,
      y: (frame.y + TOOLBAR.y) * ZOOM,
    };
    await this.glide(button.x, button.y, 700);
    marks.push({
      atMs: clock(),
      kind: "click",
      box: { x: button.x - 16, y: button.y - 16, width: 32, height: 32 },
    });
    const loaded = page.waitForEvent("load", { timeout: 3000 }).then(
      () => true,
      () => false,
    );
    await this.click();
    if (!(await loaded)) {
      log("the reload button missed: Playwright reloaded");
      await page.reload({ waitUntil: "load" });
    }
    // Off the button, its tooltip with it.
    await this.glide(button.x + 90, button.y + 150, 450);
    await this.settle(page);
  }

  /** What the terminal showed after `from` (its transcript's length then), as text. */
  terminalSince(from) {
    try {
      const all = fs.readFileSync(this.transcript);
      return (
        all
          .subarray(from)
          .toString("utf8")
          // Colours, cursor moves and titles out; what they framed stays.
          .replace(
            // eslint-disable-next-line no-control-regex
            /\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[()][0-9A-B]|\r/g,
            "",
          )
      );
    } catch {
      return "";
    }
  }

  terminalSize() {
    try {
      return fs.statSync(this.transcript).size;
    } catch {
      return 0;
    }
  }

  /**
   * Live on the stage, `state` is null (no stills) and the voice gives
   * `target`; the run stops after `limitMs`, and its output comes back.
   */
  async recordTerminal(
    chapter,
    state,
    target = estimateMs(chapter.say),
    limitMs = 240000,
  ) {
    const before = chapter.before === true;
    const marks = [];
    const problems = [];
    const cwd =
      chapter.cwd ||
      (fs.existsSync("/workspace/repo") ? "/workspace/repo" : process.cwd());
    const film = new Take();
    const clock = () => film.clock();
    await this.show("terminal");
    if (this.activeId() !== this.ids.terminal) this.raise(this.ids.terminal);
    if (this.typed) {
      this.key("ctrl+l");
      await sleep(250);
    }
    await sleep(350);
    const text =
      (cwd !== this.cwd ? "cd " + quote(cwd) + " && " : "") + chapter.command;
    const shown = this.prompt();
    const from = this.terminalSize();
    const delay = Math.round(
      Math.max(12, Math.min(40, 1500 / Math.max(text.length, 1))),
    );
    this.x("xdotool", ["type", "--delay", String(delay), text]);
    await sleep(250);
    log("running: " + chapter.command);
    // Its output shows from here (a long run is cut): the chapter keeps it.
    const box = WINDOWS.terminal;
    marks.push({
      atMs: clock(),
      kind: "type",
      box: { x: box.x, y: box.y, width: box.width, height: box.height },
    });
    this.key("Return");
    this.typed = true;
    this.cwd = cwd;
    // A run longer than a few seconds is cut: its start, then its end.
    const started = Date.now();
    let done = null;
    while (Date.now() - started < limitMs) {
      const now = this.prompt();
      if (now && (!shown || now.count > shown.count)) {
        done = now;
        break;
      }
      if (Date.now() - started > 1500) film.pause();
      await sleep(100);
    }
    if (!done) {
      this.key("ctrl+c");
      problems.push(
        '"' +
          chapter.title +
          '": still running after ' +
          Math.round(limitMs / 1000) +
          " s, stopped",
      );
      await sleep(600);
    }
    film.resume();
    if (!state)
      return {
        take: film,
        problems,
        chapter: null,
        output: this.terminalSince(from),
        status: done?.status ?? null,
      };
    await sleep(Math.max(target - clock(), 1800));
    film.pause();
    if (!before && !state.run) state.run = this.still();
    if (!state.first) state.first = this.still();
    return {
      take: film,
      problems,
      chapter: { url: chapter.command, urls: [], page: null, before, marks },
    };
  }

  /** Ends the film and cuts each chapter out of it. */
  async finish() {
    const problems = [];
    if (this.ffmpeg && this.ffmpeg.exitCode === null) {
      const closed = new Promise((resolve) => this.ffmpeg.on("close", resolve));
      this.ffmpeg.stdin.write("q");
      if (!(await Promise.race([closed.then(() => true), sleep(15000)])))
        this.ffmpeg.kill("SIGINT");
      await Promise.race([closed, sleep(5000)]);
    }
    await this.browser?.close().catch(() => {});
    const cutting = Date.now();
    for (const job of this.jobs) {
      const inputs = job.parts.flatMap(([from, to]) => [
        "-ss",
        ((from - this.zero) / 1000).toFixed(3),
        "-to",
        ((to - this.zero) / 1000).toFixed(3),
        "-i",
        this.master,
      ]);
      const joined =
        job.parts.length > 1
          ? [
              "-filter_complex",
              job.parts.map((_, i) => "[" + i + ":v]").join("") +
                "concat=n=" +
                job.parts.length +
                ":v=1:a=0[v]",
              "-map",
              "[v]",
            ]
          : [];
      const result = spawnSync(
        "ffmpeg",
        [
          ...flags("-y -loglevel error"),
          ...inputs,
          ...joined,
          ...flags("-c:v libx264 -preset veryfast -crf 21 -pix_fmt yuv420p"),
          ...flags("-movflags +faststart -an"),
          path.join(DIR, job.name),
        ],
        { encoding: "utf8", timeout: 300000 },
      );
      if (result.status !== 0)
        problems.push(
          job.name +
            ": the cut failed (" +
            String(result.stderr).trim().split("\n")[0] +
            ")",
        );
    }
    log(
      this.jobs.length +
        " chapter(s) cut in " +
        ((Date.now() - cutting) / 1000).toFixed(1) +
        " s",
    );
    this.close();
    return problems;
  }

  close() {
    this.server?.close();
    for (const child of this.children.reverse())
      if (child.exitCode === null) child.kill("SIGKILL");
    this.children = [];
  }
}

// ---------- The stage: the app live on the desktop ----------

/** The screen over VNC, and as a WebSocket, where the brain's Stage reaches it. */
const VNC_PORT = 5900;
const SCREEN_PORT = 6080;

const listening = (port) =>
  new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1");
    socket.once("connect", () => {
      socket.end();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });

/**
 * The seeded user's session, saved for the browser's window. True when the
 * page stopped asking for a password: signed in.
 */
async function signIn(browser, base, how, file) {
  const context = await browser.newContext({ viewport: null });
  try {
    const page = await context.newPage();
    await page.goto(join(base, how.path), {
      waitUntil: "load",
      timeout: 45000,
    });
    await fillSignIn(page, how);
    await context.storageState({ path: file });
    const asked = page.locator("input[type=password]").first();
    return !(await asked.isVisible().catch(() => false));
  } finally {
    await context.close().catch(() => {});
  }
}

/** The recipe's sign-in form, filled and sent on the page showing it. */
async function fillSignIn(page, how) {
  const fields = Object.entries(how.fields);
  for (const [selector, value] of fields) await page.fill(selector, value);
  await Promise.all([
    page.waitForLoadState("load").catch(() => {}),
    how.submit ? page.click(how.submit) : page.press(fields.at(-1)[0], "Enter"),
  ]);
  await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {});
}

/**
 * A page as a person reads it: its elements as text, without the refs and
 * pointer hints that change from one reading to the next.
 */
async function pageText(page) {
  const snapshot = await page
    .ariaSnapshot({ mode: "ai", timeout: 5000 })
    .catch(() => "");
  return snapshot.replace(/ \[(?:ref=[^\]]*|cursor=[^\]]*|active)\]/g, "");
}

/** Same address: the page a tab shows and the one a chapter asks for. */
function samePage(a, b) {
  try {
    const [x, y] = [new URL(a), new URL(b)];
    const route = (u) => u.host + u.pathname.replace(/\/$/, "") + u.search;
    return route(x) === route(y);
  } catch {
    return false;
  }
}

/** Answers at all: up, whatever it says. */
async function answers(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(3000), redirect: "manual" });
    return true;
  } catch {
    return false;
  }
}

/** Gestures that leave the page as it was. */
const ONLY_SHOWS = new Set(["wait", "point", "hover", "circle"]);

/**
 * A chapter's gesture done at once, for what it leaves on the page: what
 * only shows something (a point, a circle, a wait) leaves nothing.
 */
async function quickly(page, base, action) {
  const kind = action.do;
  if (ONLY_SHOWS.has(kind)) return;
  if (kind === "goto")
    await page.goto(join(base, action.path), {
      waitUntil: "load",
      timeout: 20000,
    });
  else if (kind === "reload") await page.reload({ waitUntil: "load" });
  else if (kind === "press") await page.keyboard.press(action.key);
  else if (kind === "scroll" && !action.target)
    await page.evaluate((y) => window.scrollBy(0, y), Number(action.y) || 400);
  else {
    const locator = page.locator(action.target).first();
    if (kind === "scroll")
      await locator.scrollIntoViewIfNeeded({ timeout: 8000 });
    else if (kind === "click") await locator.click({ timeout: 8000 });
    else if (kind === "select")
      await locator.selectOption(String(action.value), { timeout: 8000 });
    else await locator.fill(String(action.text ?? ""), { timeout: 8000 });
  }
  await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
}

/** A chapter cut short: the agent leads the presentation from here. */
class Stopped extends Error {}

/**
 * The presentation played live on the stage, a chapter at a time, as the
 * page asks: the voice plays there, the gestures here, spread over it.
 */
class Presenter {
  constructor(desktop, plan, signIn = null, reopen = null) {
    this.desktop = desktop;
    this.plan = plan;
    /** How the seeded user signs in: the recipe's form, or none. */
    this.signIn = signIn;
    /** The app alone on the recipe's page, in a new window. */
    this.reopen = reopen;
    /** A member's mouse and keyboard are on the app: the agent looks only. */
    this.controlled = false;
    /** How many times the agent showed something, in writing. */
    this.showings = 0;
    /** The opening is on screen, nothing played since: it stays. */
    this.untouched = false;
    /** The chapter playing: its index, null between chapters. */
    this.playing = null;
    /**
     * Held while the member talks: the chapter waits at its next gesture,
     * the screen as it was then kept to come back to.
     */
    this.hold = null;
    /** How long the presentation was held, every hold together. */
    this.heldMs = 0;
    /**
     * The recorded presentation is over: the member talked, and the agent
     * leads the rest. A chapter cut by it stops at its next gesture.
     */
    this.over = false;
    this.round = 0;
    /** The chapters shown in full. */
    this.shown = new Set();
    /** The chapter the talk cut, if one was playing. */
    this.cut = null;
    /** The chapter the film was paused in, the stage brought to it. */
    this.film = null;
    /** How far the film's gestures got here: a chapter, how many of its. */
    this.reached = null;
    /** The gestures the agent wrote in its words, until their word is said. */
    this.beats = new Map();
  }

  /** The presentation's own time: it stands still while held. */
  now() {
    return (
      Date.now() - this.heldMs - (this.hold ? Date.now() - this.hold.since : 0)
    );
  }

  /** Waits while the presentation is held. */
  async held() {
    while (this.hold) await this.hold.resumed;
  }

  /** Waits while held; throws once the presentation `round` is over. */
  async going(round) {
    await this.held();
    if (round !== this.round) throw new Stopped();
  }

  /** The presentation ends here, the screen as the talk left it. */
  async stop() {
    this.round++;
    this.beats.clear();
    const hold = this.hold;
    if (hold) {
      this.heldMs += Date.now() - hold.since;
      this.hold = null;
      hold.release();
    }
    if (this.over) return [];
    this.over = true;
    this.cut = this.playing;
    log(
      "the agent leads" +
        (this.cut === null ? "" : ", chapter " + (this.cut + 1) + " cut"),
    );
    return [];
  }

  async pause() {
    if (this.hold) return [];
    const { tabs, front } = this.desktop;
    const tab = tabs?.active ?? null;
    let release;
    const resumed = new Promise((resolve) => (release = resolve));
    const hold = {
      since: Date.now(),
      resumed,
      release,
      front,
      tab,
      url: tab ? (tabs.pages[tab]?.url() ?? null) : null,
      /** Each tab as the presentation shows it, to put back after the talk. */
      pages: {},
    };
    this.hold = hold;
    log(
      "held" +
        (this.playing === null ? "" : " in chapter " + (this.playing + 1)),
    );
    hold.read = (async () => {
      for (const [which, page] of Object.entries(tabs?.pages ?? {}))
        hold.pages[which] = { url: page.url(), screen: await pageText(page) };
    })();
    await hold.read;
    return [];
  }

  /**
   * While held: each tab the talk changed, as it was and as it is. An
   * address changed is typed back first; what still differs is told, for
   * the brain's agent to put back (src/runner/stage-restore.ts).
   */
  async changes() {
    const hold = this.hold;
    if (!hold) return { problems: [], changes: [] };
    await hold.read;
    const { desktop } = this;
    const changes = [];
    for (const [which, then] of Object.entries(hold.pages)) {
      const page = desktop.tabs?.pages[which];
      if (!page) continue;
      if (!samePage(page.url(), then.url)) {
        await this.bring(which);
        await desktop.address(page, then.url, [], () => 0);
      }
      await page
        .waitForLoadState("networkidle", { timeout: 3000 })
        .catch(() => {});
      const screen = await pageText(page);
      if (screen !== then.screen)
        changes.push({ window: which, then, now: { url: page.url(), screen } });
    }
    log(
      changes.length
        ? "changed while held: " + changes.map((c) => c.window).join(", ")
        : "nothing changed while held",
    );
    return { problems: [], changes };
  }

  /** The recipe's sign-in on the window in front: the seeded user in again. */
  async signInAgain() {
    const { desktop, plan, signIn } = this;
    const which = desktop.tabs?.active;
    const page = which && desktop.tabs.pages[which];
    const problems = [];
    if (!signIn) problems.push("the app has no sign-in in its recipe");
    else if (desktop.front !== "browser" || !page)
      problems.push("the browser is not in front");
    else
      try {
        const first = Object.keys(signIn.fields)[0];
        const shown = await page
          .locator(first)
          .first()
          .isVisible()
          .catch(() => false);
        if (!shown) {
          const base = plan.apps[which]?.url ?? new URL(page.url()).origin;
          await desktop.address(page, join(base, signIn.path), [], () => 0);
        }
        await fillSignIn(page, signIn);
        log("signed in again");
      } catch (error) {
        problems.push("sign in: " + String(error?.message).split("\n")[0]);
      }
    return { problems, screen: await this.look() };
  }

  /** Back to the screen as the talk found it, then the chapter goes on. */
  async resume() {
    const hold = this.hold;
    if (!hold) return [];
    const problems = [];
    const { desktop } = this;
    try {
      const marks = [];
      const clock = () => 0;
      if (
        hold.front === "browser" &&
        hold.tab &&
        desktop.tabs?.pages[hold.tab]
      ) {
        await desktop.show("browser");
        if (desktop.tabs.active !== hold.tab) {
          await desktop.switchTab(hold.tab, clock, marks);
          desktop.tabs.active = hold.tab;
        }
        const page = desktop.tabs.pages[hold.tab];
        await page.bringToFront();
        if (hold.url && !samePage(page.url(), hold.url))
          await desktop.address(page, hold.url, marks, clock);
      } else if (hold.front === "terminal") await desktop.show("terminal");
    } catch (error) {
      problems.push(
        "back to the presentation: " + String(error?.message).split("\n")[0],
      );
    }
    this.heldMs += Date.now() - hold.since;
    this.hold = null;
    hold.release();
    log("resumed");
    return problems;
  }

  /** Where the presentation stands, for the agent the member talks to. */
  state() {
    const chapter =
      this.playing === null ? null : this.plan.chapters[this.playing];
    return {
      chapter: chapter ? { index: this.playing, title: chapter.title } : null,
      held: Boolean(this.hold),
      chapters: this.plan.chapters.length,
      over: this.over,
      shown: [...this.shown].sort((a, b) => a - b),
      cut: this.cut,
      film: this.film,
      control: this.controlled,
      showing: this.showings,
    };
  }

  /**
   * A member's mouse and keyboard on the app, until they give it back or
   * their page stops asking (CONTROL_MS). Its browser is alone on the
   * screen before the screen takes any input, and the agent acts again
   * after (serve). The app's window, closed, opens again.
   */
  async control(on) {
    const { desktop } = this;
    clearTimeout(this.lease);
    if (on) {
      this.lease = setTimeout(
        () =>
          this.control(false).catch((error) =>
            log("control not ended: " + String(error?.message).split("\n")[0]),
          ),
        CONTROL_MS,
      );
      if (this.playing !== null) await this.stop();
      const open = Object.values(desktop.tabs?.pages ?? {}).some(
        (page) => !page.isClosed(),
      );
      if (!open) await this.reopen();
      if (!open || !this.controlled) {
        // The pull request's app, whatever the film showed: the old one is
        // a tab away.
        const app = desktop.tabs.pages.after;
        if (app && !app.isClosed()) {
          desktop.tabs.active = "after";
          await app.bringToFront();
        }
        desktop.alone(true);
      }
    }
    if (on === this.controlled) return [];
    if (on) desktop.tell("noviewonly", "cursorshape");
    else {
      desktop.tell("viewonly", "nocursorshape");
      desktop.alone(false);
    }
    this.controlled = on;
    return [];
  }

  /**
   * The stage as the film shows it at this moment, for the agent to go on
   * from: the chapters before it and the part of its own already seen
   * (`part`, 0 to 1), done at once, off the film (no pointer gliding,
   * nothing typed a letter at a time). From where it last got to, as the
   * film plays on and nothing else moved the screen; from the opening if not.
   */
  async reach(index, part) {
    const { desktop, plan } = this;
    const chapters = plan.chapters.slice(0, index + 1);
    if (!chapters.length) return ["no chapter " + (index + 1)];
    const started = Date.now();
    const count = Math.round((chapters[index].actions?.length ?? 0) * part);
    const last = this.reached;
    const onward =
      last &&
      (last.index < index || (last.index === index && last.count <= count));
    if (!onward) await this.set();
    const from = onward ? last : { index: 0, count: 0, fresh: true };
    // The member speaking meanwhile stops nothing of it.
    this.over = true;
    this.untouched = false;
    const problems = [];
    for (const [i, chapter] of chapters.entries()) {
      if (i < from.index) continue;
      // Gone on from here: its page is open, its first gestures done.
      const going = i === from.index && !from.fresh;
      // The film's ticket or given output: the stage stays as it was.
      if (!chapter.tab) {
        if (i < index) this.shown.add(i);
        continue;
      }
      const actions = chapter.actions ?? [];
      const done = (i < index ? actions : actions.slice(0, count)).slice(
        going ? from.count : 0,
      );
      if (chapter.tab === "terminal") {
        // Its command once, as the film ran it, only when it shows now.
        if (i === index && !going) {
          const ran = await desktop.recordTerminal(chapter, null, 0);
          problems.push(...ran.problems);
        }
        continue;
      }
      const { which, app } = shownIn(plan, chapter);
      const page = desktop.tabs?.pages[which];
      if (!page || !app) {
        problems.push("chapter " + (i + 1) + ": its app is not open");
        continue;
      }
      if (i === index) {
        await desktop.show("browser");
        desktop.tabs.active = which;
      }
      await page.bringToFront();
      const url = join(app.url, chapter.path);
      if (!going && !samePage(page.url(), url))
        await page
          .goto(url, { waitUntil: "load", timeout: 20000 })
          .catch((error) =>
            problems.push(
              "chapter " +
                (i + 1) +
                ": " +
                String(error?.message).split("\n")[0],
            ),
          );
      desktop.tabs.urls[which] = url;
      for (const action of done)
        try {
          await quickly(page, app.url, action);
        } catch (error) {
          problems.push(
            "chapter " +
              (i + 1) +
              ": " +
              action.do +
              " " +
              (action.target || action.path || "") +
              ": " +
              String(error?.message).split("\n")[0],
          );
        }
      desktop.tabs.seen = { ...desktop.tabs.seen, [which]: page.url() };
      if (i < index) this.shown.add(i);
    }
    // The tab in front last, whatever the others' pages did.
    const front =
      chapters[index].tab === "app" || chapters[index].tab === "document"
        ? shownIn(plan, chapters[index]).which
        : null;
    if (front) await desktop.tabs?.pages[front]?.bringToFront();
    this.cut = index;
    this.film = index;
    this.reached = { index, count };
    log(
      "reached chapter " +
        (index + 1) +
        " in " +
        ((Date.now() - started) / 1000).toFixed(1) +
        " s",
    );
    return problems;
  }

  /**
   * The screen as text for the agent: the window in front, its address,
   * and the page as its elements, each with a ref (e12) to act on.
   */
  async look() {
    const { desktop } = this;
    if (desktop.front === "terminal") {
      const tail = desktop.terminalSince(
        Math.max(0, desktop.terminalSize() - 6000),
      );
      return (
        "In front: the terminal, in " +
        desktop.cwd +
        ". Its last lines:\n" +
        tail.split("\n").slice(-40).join("\n")
      );
    }
    const which = desktop.tabs?.active;
    const page = which && desktop.tabs.pages[which];
    if (!page) return "In front: nothing the agent can read.";
    const tabs = Object.keys(desktop.tabs.pages);
    const snapshot = await page
      .ariaSnapshot({ mode: "ai", timeout: 5000 })
      .catch(
        (error) =>
          "(unreadable: " + String(error?.message).split("\n")[0] + ")",
      );
    const clipped =
      snapshot.length > 12000
        ? snapshot.slice(0, 12000) + "\n[…cut]"
        : snapshot;
    return (
      "In front: the browser, " +
      (which === "before"
        ? "the app as it was before the change"
        : "the app as it is on the branch") +
      (tabs.length > 1
        ? " (its other tab: the app " +
          (which === "before" ? "as it is" : "as it was") +
          ")"
        : "") +
      ".\nAddress: " +
      page.url() +
      "\nTitle: " +
      (await page.title().catch(() => "")) +
      "\n" +
      clipped
    );
  }

  /** A gesture written in the agent's words, there for when its word comes. */
  gesture(n, actions) {
    this.beats.set(n, actions);
  }

  /**
   * The agent's gestures as their word is said (src/core/stage.ts), those
   * before it first; all that are left without `n`, its voice done.
   */
  async beat(n) {
    const problems = [];
    for (const k of [...this.beats.keys()].sort((a, b) => a - b)) {
      if (n !== null && k > n) break;
      const actions = this.beats.get(k);
      this.beats.delete(k);
      problems.push(...(await this.act(actions, false)).problems);
    }
    return problems;
  }

  /** The member's words reached the agent: its pointer stirs, as one looks up. */
  async stir() {
    const { desktop } = this;
    const { x, y } = desktop.pointer;
    await desktop.glide(
      x + (x > SCREEN.width / 2 ? -48 : 48),
      y + (y > SCREEN.height / 2 ? -28 : 28),
      200,
    );
    return [];
  }

  /** The agent's gestures on the window in front, then the screen after. */
  async act(actions, read = true) {
    const { desktop, plan } = this;
    const problems = [];
    const which = desktop.tabs?.active;
    const page = which && desktop.tabs.pages[which];
    if (desktop.front !== "browser" || !page)
      return {
        problems: ["the browser is not in front"],
        screen: await this.look(),
      };
    const base = plan.apps[which]?.url ?? new URL(page.url()).origin;
    const marks = [];
    const started = Date.now();
    const clock = () => Date.now() - started;
    await page.bringToFront();
    if (actions.some((action) => !ONLY_SHOWS.has(action.do)))
      this.reached = null;
    desktop.brisk = true;
    for (const action of actions) {
      // A ref from the last look (e16, or f5e16 in a frame): the element it named.
      const target =
        typeof action.target === "string" &&
        /^(f\d+)?e\d+$/.test(action.target.trim())
          ? "aria-ref=" + action.target.trim()
          : action.target;
      try {
        await desktop.act(page, base, { ...action, target }, marks, clock);
      } catch (error) {
        problems.push(
          action.do +
            " " +
            (action.target || action.path || "") +
            ": " +
            String(error?.message).split("\n")[0],
        );
        break;
      }
    }
    desktop.brisk = false;
    return read ? { problems, screen: await this.look() } : { problems };
  }

  /** A window in front: the app as it is, as it was, or the terminal. */
  async show(window) {
    const { desktop } = this;
    if (window === "terminal") {
      await desktop.show("terminal");
      return { problems: [], screen: await this.look() };
    }
    const which = window === "before" ? "before" : "after";
    if (!desktop.tabs?.pages[which])
      return {
        problems: [
          "the app " + (which === "before" ? "as it was " : "") + "is not open",
        ],
        screen: await this.look(),
      };
    await this.bring(which);
    return { problems: [], screen: await this.look() };
  }

  /** The browser in front, on this tab, at once: the pointer's trip took 6 s. */
  async bring(which) {
    const { desktop } = this;
    await desktop.show("browser");
    desktop.tabs.active = which;
    await desktop.tabs.pages[which].bringToFront();
  }

  /** A command typed in the terminal, as the member watches: its output. */
  async run(command, cwd) {
    const result = await this.desktop.recordTerminal(
      { title: command, command, cwd: cwd || null, say: "" },
      null,
      0,
      120000,
    );
    const output = result.output.trim();
    return {
      problems: result.problems,
      screen:
        "Ran: " +
        command +
        (result.status === null ? "" : " (exit " + result.status + ")") +
        "\n" +
        (output.length > 6000
          ? "[…]\n" + output.slice(-6000)
          : output || "(no output)"),
    };
  }

  /**
   * The opening: a new window as a first visit sees it, on the first app
   * chapter's page (and the other app's tab beside it), the hand at rest.
   */
  async set() {
    const { desktop, plan } = this;
    // Played again: the recorded presentation leads anew.
    this.over = false;
    this.round++;
    this.shown = new Set();
    this.cut = null;
    this.film = null;
    this.reached = null;
    if (this.untouched) return [];
    const started = Date.now();
    const first = plan.chapters.findIndex((chapter) => chapter.tab === "app");
    const which = first < 0 ? "after" : plan.chapters[first].app || "after";
    if (
      plan.chapters.some((chapter) => chapter.app === "before") &&
      !(plan.apps.before && (await answers(plan.apps.before.url)))
    )
      throw new Error("the app as it was does not answer");
    await desktop.openWindow(
      plan,
      Math.max(first, 0),
      which,
      join(plan.apps[which].url, plan.chapters[first]?.path),
    );
    desktop.tabs.seen = Object.fromEntries(
      Object.entries(desktop.tabs.pages).map(([name, page]) => [
        name,
        page.url(),
      ]),
    );
    await desktop.glide(SCREEN.width * 0.6, SCREEN.height * 0.55, 500);
    this.untouched = true;
    log("opening in " + ((Date.now() - started) / 1000).toFixed(1) + " s");
    return [];
  }

  /** Chapter `index`, over `voiceMs` of voice: what failed, if anything. */
  async chapter(index, voiceMs) {
    const chapter = this.plan.chapters[index];
    if (!chapter) throw new Error("no chapter " + (index + 1));
    this.untouched = false;
    log("live chapter " + (index + 1) + ": " + chapter.title);
    // Held before it began (the member spoke between chapters): it waits.
    const round = this.round;
    try {
      await this.going(round);
    } catch {
      return [];
    }
    this.playing = index;
    try {
      const problems = !chapter.tab
        ? []
        : chapter.tab === "terminal"
          ? (await this.desktop.recordTerminal(chapter, null, voiceMs)).problems
          : await this.app(chapter, index, voiceMs, round);
      this.shown.add(index);
      return problems;
    } catch (error) {
      if (error instanceof Stopped) return [];
      throw error;
    } finally {
      this.playing = null;
    }
  }

  async app(chapter, index, voiceMs, round) {
    const { desktop, plan } = this;
    const { which, app } = shownIn(plan, chapter);
    const tabs = desktop.tabs;
    if (!app || !tabs?.pages[which])
      throw new Error(
        "the app " + (which === "before" ? "as it was " : "") + "is not open",
      );
    const url = join(app.url, chapter.path);
    const problems = [];
    const marks = [];
    const started = this.now();
    const clock = () => this.now() - started;
    const fail = (action, error) =>
      problems.push(
        "chapter " +
          (index + 1) +
          ": " +
          action.do +
          " " +
          (action.target || action.path || "") +
          ": " +
          String(error?.message).split("\n")[0],
      );
    await desktop.show("browser");
    if (tabs.active !== which) {
      await desktop.switchTab(which, clock, marks);
      tabs.active = which;
    }
    const page = tabs.pages[which];
    // Every tab tells Playwright it is visible: in front, whatever the click did.
    await page.bringToFront();
    // Where the last chapter left it (a redirect included), or there already.
    const there =
      (tabs.urls[which] === url && tabs.seen?.[which] === page.url()) ||
      samePage(page.url(), url);
    if (!there) {
      await desktop.address(page, url, marks, clock);
      tabs.urls[which] = url;
      tabs.seen = { ...tabs.seen, [which]: page.url() };
    }
    await desktop.actOver(
      page,
      app.url,
      chapter.actions,
      voiceMs,
      clock,
      marks,
      fail,
      () => this.going(round),
    );
    for (const [name, shown] of Object.entries(tabs.pages))
      log(
        name +
          (name === which ? " (in front)" : "") +
          ": " +
          shown.url() +
          ", " +
          (await shown.title().catch(() => "?")),
      );
    return problems;
  }
}

/** Where the page's requests reach the presenter, through the brain's Stage. */
const PRESENTER_PORT = 7070;
/** A member's control ends this long after their page last asked for it. */
const CONTROL_MS = 45000;
/** What moves the screen, refused while a member has control of it. */
const ACTS = new Set([
  "/set",
  "/chapter",
  "/reach",
  "/act",
  "/beat",
  "/stir",
  "/window",
  "/run",
  "/sign-in",
]);
/** What leaves the screen otherwise than the film left it. */
const MOVES = new Set(["/chapter", "/window", "/run", "/sign-in", "/control"]);

/**
 * The page's cues, one at a time, in order: a chapter never starts over
 * another. The agent the member talks to has its own line (what it does
 * on the screen, one thing at a time), and holding or reading where the
 * presentation stands answers at once, a chapter playing or not.
 */
function serve(presenter) {
  const lines = { show: Promise.resolve(), hands: Promise.resolve() };
  const LINE = {
    "/set": "show",
    "/chapter": "show",
    "/look": "hands",
    "/act": "hands",
    "/beat": "hands",
    "/stir": "hands",
    "/window": "hands",
    "/run": "hands",
    "/resume": "hands",
    "/changes": "hands",
    "/sign-in": "hands",
    // The agent's hands wait for the stage to be where the film was paused.
    "/reach": "hands",
    "/control": "hands",
  };
  const answer = async (url, asked) => {
    if (presenter.controlled && ACTS.has(url))
      return {
        ok: false,
        problems: ["The member has control of the app: look, do not act."],
      };
    if (MOVES.has(url)) presenter.reached = null;
    try {
      switch (url) {
        case "/set":
          return { ok: true, problems: await presenter.set() };
        case "/chapter":
          return {
            ok: true,
            problems: await presenter.chapter(
              Number(asked.index),
              Number(asked.voiceMs) || 4000,
            ),
          };
        case "/pause":
          return { ok: true, problems: await presenter.pause() };
        case "/reach":
          return {
            ok: true,
            problems: await presenter.reach(
              Number(asked.index) || 0,
              Math.min(1, Math.max(0, Number(asked.part) || 0)),
            ),
          };
        case "/control":
          return {
            ok: true,
            problems: await presenter.control(asked.on === true),
          };
        case "/stop":
          return {
            ok: true,
            problems: await presenter.stop(),
            state: presenter.state(),
          };
        case "/resume":
          return { ok: true, problems: await presenter.resume() };
        case "/changes":
          return { ok: true, ...(await presenter.changes()) };
        case "/sign-in":
          return { ok: true, ...(await presenter.signInAgain()) };
        case "/state":
          return { ok: true, problems: [], state: presenter.state() };
        case "/showing":
          presenter.showings++;
          return { ok: true, problems: [] };
        case "/look":
          return { ok: true, problems: [], screen: await presenter.look() };
        case "/act":
          return {
            ok: true,
            ...(await presenter.act(
              Array.isArray(asked.actions) ? asked.actions : [],
            )),
          };
        case "/gesture":
          presenter.gesture(
            Number(asked.n),
            Array.isArray(asked.actions) ? asked.actions : [],
          );
          return { ok: true, problems: [] };
        case "/beat":
          return {
            ok: true,
            problems: await presenter.beat(
              typeof asked.n === "number" ? asked.n : null,
            ),
          };
        case "/stir":
          return { ok: true, problems: await presenter.stir() };
        case "/window":
          return { ok: true, ...(await presenter.show(asked.window)) };
        case "/run":
          return {
            ok: true,
            ...(await presenter.run(String(asked.command ?? ""), asked.cwd)),
          };
        default:
          return { ok: false, problems: ["no such request: " + url] };
      }
    } catch (error) {
      return { ok: false, problems: [String(error?.message).split("\n")[0]] };
    }
  };
  const server = http.createServer((request, response) => {
    // The brain's Stage says so; a page in the stage's browser cannot.
    if (!request.headers["x-yarrow-stage"]) {
      response.writeHead(403).end();
      return;
    }
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      const reply = async () => {
        let asked = {};
        try {
          asked = body ? JSON.parse(body) : {};
        } catch {
          // An empty request.
        }
        // What the presenter logs while a chapter plays goes back with it.
        const show = LINE[request.url] === "show";
        if (show) heard = [];
        const result = { ...(await answer(request.url, asked)) };
        if (show) {
          result.notes = heard;
          heard = null;
        }
        for (const problem of result.problems)
          console.error("problem: " + problem);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(result));
      };
      const line = LINE[request.url];
      if (!line) return void reply().catch(() => {});
      lines[line] = lines[line].then(reply).catch(() => {});
    });
  });
  // Every interface, as websockify: the brain's Stage reaches the machine from outside.
  server.listen(PRESENTER_PORT);
  return server;
}

/**
 * What the stage's browser refuses, a member's to use once they take
 * control: the machine's files, its own pages, its developer tools. By
 * address: the policy that forbids those tools forbids Playwright too. It
 * reads this as it starts.
 */
function lockBrowser() {
  const dir = "/etc/opt/chrome_for_testing/policies/managed";
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "yarrow.json"),
    JSON.stringify({
      URLBlocklist: [
        "file://*",
        "chrome://*",
        "view-source:*",
        "javascript://*",
        "devtools://*",
        "chrome-devtools://*",
      ],
    }),
  );
}

/**
 * `--stage`: the same desktop as the films, the app in its browser and
 * signed in, its screen served over VNC (the pointer drawn into it, watched
 * only until a member takes control) and as a WebSocket (websockify) until
 * the container stops. Nothing is filmed.
 * The stage file gives the app ({ url, path, signIn: { path, fields,
 * submit } | null }), `ready`, written once the screen can be watched,
 * `session`, written with the browser's session once it signed in, and
 * the presentation to play live (`script`: { apps, chapters } | null),
 * which the presenter plays as asked on PRESENTER_PORT.
 */
async function stage(spec) {
  browsersPath();
  const playwright = loadPlaywright();
  const desktop = new Desktop();
  process.on("exit", () => desktop.close());
  for (const signal of ["SIGTERM", "SIGINT"])
    process.on(signal, () => process.exit(0));
  lockBrowser();
  await desktop.start(playwright, { film: false });
  let storage;
  if (spec.signIn) {
    storage = path.join(desktop.dir, "after-state.json");
    // Read by the preview, for a visit to open signed in; empty, it cannot.
    let session = "{}";
    try {
      if (await signIn(desktop.browser, spec.url, spec.signIn, storage))
        session = fs.readFileSync(storage, "utf8");
    } catch (error) {
      log("not signed in: " + String(error?.message).split("\n")[0]);
      storage = undefined;
    }
    if (spec.session) fs.writeFileSync(spec.session, session);
    // The sign-in's window is gone: the next one is the app's.
    desktop.known = new Set(desktop.windows().map((w) => w.id));
  }
  // One sign-in serves both: a cookie of localhost is every port's.
  const app = (url) => (url ? { url, ...(storage && { storage }) } : undefined);
  const script = spec.script;
  const plan = {
    apps: {
      after: app(script?.apps.after ?? spec.url),
      before: app(script?.apps.before),
    },
    chapters: script ? script.chapters : [],
  };
  // Each document as the film showed it.
  for (const chapter of plan.chapters)
    if (chapter.document)
      desktop.documents.set(chapter.path, chapter.document.html);
  // The app alone, on the recipe's page.
  const plain = () =>
    desktop.openWindow(
      { apps: { after: plan.apps.after }, chapters: [] },
      0,
      "after",
      join(plan.apps.after.url, spec.path),
    );
  const presenter = new Presenter(desktop, plan, spec.signIn ?? null, plain);
  if (script)
    await presenter.set().catch((error) => {
      log("no opening: " + String(error?.message).split("\n")[0]);
      return plain();
    });
  else await plain();
  serve(presenter);
  accentKeyboard(desktop.env.DISPLAY);
  desktop.spawn("x11vnc", "x11vnc", [
    ...["-display", desktop.env.DISPLAY, "-rfbport", String(VNC_PORT)],
    // No cursor shapes: the pointer the agent moves is drawn into the screen.
    ...flags(
      "-viewonly -forever -shared -nopw -quiet -noxrecord -nocursorshape -nocursorpos",
    ),
  ]);
  if (!(await until(() => listening(VNC_PORT), 15000)))
    throw new Error("the screen is not served (x11vnc)");
  desktop.spawn("websockify", "websockify", [
    String(SCREEN_PORT),
    "127.0.0.1:" + VNC_PORT,
  ]);
  if (!(await until(() => listening(SCREEN_PORT), 15000)))
    throw new Error("the screen is not served as a WebSocket (websockify)");
  fs.writeFileSync(
    spec.ready,
    JSON.stringify({ display: desktop.env.DISPLAY, at: Date.now() }),
  );
  log("stage up: " + spec.url);
  await new Promise(() => {});
}

/**
 * What the stage plays live (workers/stage.ts), as the plan had it: the
 * desktop's chapters only (a ticket, a phone or a given output has none).
 */
const liveOf = (chapter) => {
  if (!onDesktop(chapter)) return null;
  const doc = chapter.tab === "document" ? documentOf(chapter) : null;
  return {
    app: !doc && chapter.app === "before" ? "before" : "after",
    path: doc ? doc.path : (chapter.path ?? null),
    actions: chapter.actions || [],
    command: chapter.command ?? null,
    cwd: chapter.cwd ?? null,
    before: chapter.before === true,
    document: doc && { file: doc.file, html: doc.html },
  };
};

/** A chapter's tab in the browser and its app: a document opens in the app's tab. */
function shownIn(plan, chapter) {
  if (chapter.tab === "document")
    return { which: "after", app: { ...plan.apps?.after, url: FILES } };
  const which = chapter.app || "after";
  return { which, app: plan.apps?.[which] };
}

/** Chapters the desktop films; a phone or a given output stays a clip. */
const onDesktop = (chapter) =>
  ((chapter.tab === "app" || chapter.tab === "document") &&
    chapter.device !== "phone") ||
  (chapter.tab === "terminal" && typeof chapter.output !== "string");

async function main() {
  const [file, flag] = process.argv.slice(2);
  if (!file) throw new Error("usage: node present.mjs plan.json [--check]");
  const plan = JSON.parse(fs.readFileSync(file, "utf8"));
  if (flag === "--stage") return stage(plan);
  const problems = check(plan);
  if (problems.length) {
    for (const problem of problems) console.error("plan: " + problem);
    process.exit(1);
  }
  if (flag === "--check") return log("the plan is fine");

  browsersPath();
  const playwright = loadPlaywright();
  fs.rmSync(DIR, { recursive: true, force: true });
  fs.mkdirSync(DIR, { recursive: true });
  let desktop = null;
  if (process.env.YARROW_DESKTOP !== "0" && plan.chapters.some(onDesktop)) {
    desktop = new Desktop();
    process.on("exit", () => desktop?.close());
    try {
      await desktop.start(playwright);
    } catch (error) {
      log(
        "no desktop (" +
          String(error?.message).split("\n")[0] +
          "): each chapter is a clip of its page",
      );
      desktop.close();
      desktop = null;
    }
  }
  // The page alone: the ticket, a phone, a given output, or no desktop.
  let browser = null;
  const clips = async () => {
    if (!browser) {
      browser = await launch(playwright);
      await ensureVideo(browser, playwright);
    }
    return browser;
  };
  const take = Date.now().toString(36).slice(-6);
  const state = { poster: null, run: null, first: null };
  const chapters = [];
  const failed = [];
  for (const [index, chapter] of plan.chapters.entries()) {
    log("chapter " + (index + 1) + ": " + chapter.title);
    try {
      const result =
        desktop && desktop.alive() && onDesktop(chapter)
          ? await desktop.record(plan, chapter, index, take, state)
          : await record(await clips(), plan, chapter, index, take, state);
      chapters.push({ ...result.chapter, live: liveOf(chapter) });
      failed.push(...result.problems);
    } catch (error) {
      failed.push(
        "chapter " +
          (index + 1) +
          ' "' +
          chapter.title +
          '": ' +
          String(error?.message).split("\n")[0],
      );
    }
  }
  if (desktop) failed.push(...(await desktop.finish()));
  await browser?.close();
  // A chapter whose clip could not be cut is left out.
  const filmed = chapters.filter((chapter) =>
    fs.existsSync(path.join(OUTPUTS, chapter.clip)),
  );
  const poster = state.poster || state.run || state.first;
  if (poster) fs.writeFileSync(path.join(DIR, take + "-poster.jpg"), poster);
  const ticket = plan.ticket;
  fs.writeFileSync(
    path.join(DIR, "presentation.json"),
    JSON.stringify(
      {
        version: 1,
        title: plan.title,
        ticket: {
          source: ticket.source || "ticket",
          title: ticket.title,
          url: ticket.url || "",
        },
        poster: poster ? "presentation/" + take + "-poster.jpg" : null,
        apps: {
          before: plan.apps?.before?.url ?? null,
          after: plan.apps?.after?.url ?? null,
        },
        chapters: filmed,
      },
      null,
      2,
    ),
  );
  for (const chapter of filmed)
    log(
      chapter.clip +
        ": " +
        (chapter.durationMs / 1000).toFixed(1) +
        " s, " +
        chapter.marks.length +
        " gesture(s)",
    );
  if (failed.length) {
    for (const problem of failed) console.error("problem: " + problem);
    console.error("recorder: fix the plan (or the app) and run it again");
    process.exit(2);
  }
  log("done: " + filmed.length + " chapter(s) in " + DIR);
}

main().catch((error) => {
  console.error("recorder: " + (error?.stack || error));
  process.exit(1);
});
