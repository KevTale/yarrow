// Yarrow's recorder: the agent writes a plan of its presentation, this plays
// it in a real browser and records each chapter as a clip. It runs in the
// implementer's sandbox, mounted at /mnt/session/uploads/yarrow/present.mjs
// (src/runner/recorder/source.ts carries it; pnpm recorder:embed after an edit).
//
//   node present.mjs plan.json           record every chapter
//   node present.mjs plan.json --check   check the plan, record nothing
//
// Writes presentation/presentation.json, one clip per chapter and a poster
// under the session's outputs. The brain voices it after the review.
//
// It films a real desktop when it can (see "The desktop" below): the browser
// and the terminal in their windows, a dock, the real pointer. Otherwise, or
// with YARROW_DESKTOP=0, each chapter is a clip of the page alone.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const OUTPUTS = process.env.YARROW_OUTPUTS || "/mnt/session/outputs";
const DIR = path.join(OUTPUTS, "presentation");
// As estimateSpeechMs in src/core/presentation.ts.
const WORDS_PER_SECOND = 2.6;
// The player shows it in a browser window on a 16:10 stage.
const DESKTOP = { width: 1280, height: 720 };
const PHONE = { width: 390, height: 844 };
const ACTIONS = [
  "point",
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

const log = (message) => console.log("recorder: " + message);

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
    if (!chapter.say || chapter.say.length > 400)
      problems.push(at + ".say: 1 to 400 characters");
    if (!["app", "ticket", "terminal"].includes(chapter.tab))
      problems.push(at + ".tab: app, ticket or terminal");
    if (chapter.tab === "app") {
      const app = (plan.apps || {})[chapter.app || "after"];
      if (!app || !app.url)
        problems.push(
          at + ': apps["' + (chapter.app || "after") + '"].url is missing',
        );
      else if (app.storage && !fs.existsSync(app.storage))
        problems.push(at + ": " + app.storage + " does not exist");
      for (const [j, action] of (chapter.actions || []).entries()) {
        if (!ACTIONS.includes(action.do))
          problems.push(
            at + ".actions[" + j + "].do: one of " + ACTIONS.join(", "),
          );
        const needs = [
          "point",
          "hover",
          "click",
          "fill",
          "type",
          "select",
        ].includes(action.do);
        if (needs && !action.target)
          problems.push(
            at + ".actions[" + j + "].target: a Playwright selector",
          );
      }
    }
    if (chapter.tab === "terminal" && !chapter.command)
      problems.push(at + ".command: missing");
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
 * Runs in every page: the agent's cursor and the ring around what it shows.
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
    const ring = css(
      document.createElement("div"),
      "position:fixed;border:3px solid #f2b544;border-radius:12px;box-shadow:0 0 0 5px rgba(242,181,68,.18);opacity:0;transition:opacity .25s ease",
    );
    ring.id = "__yarrow_ring";
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
    root.append(ring, ripple);
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
    ring(box) {
      const ring = get("__yarrow_ring");
      ring.style.left = box.x - 7 + "px";
      ring.style.top = box.y - 7 + "px";
      ring.style.width = box.width + 8 + "px";
      ring.style.height = box.height + 8 + "px";
      ring.style.opacity = "1";
    },
    unring() {
      get("__yarrow_ring").style.opacity = "0";
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
  const locator = page.locator(action.target).first();
  await locator.waitFor({ state: "visible", timeout: 8000 });
  await locator.scrollIntoViewIfNeeded();
  if (kind === "scroll") return page.waitForTimeout(600);
  const box = await locator.boundingBox();
  if (!box) throw new Error("not on screen");
  const x = box.x + Math.min(box.width * 0.6, box.width - 6);
  const y = box.y + Math.min(box.height * 0.65, box.height - 4);
  await moveTo(page, x, y, 750);
  const at = clock();
  const shown = {
    x: Math.round(box.x),
    y: Math.round(box.y),
    width: Math.round(box.width),
    height: Math.round(box.height),
  };
  if (kind === "point" || kind === "hover") {
    marks.push({ atMs: at, kind: "point", box: shown });
    await page.evaluate((b) => window.__yarrow?.ring(b), shown);
    await page.waitForTimeout(Math.min(Number(action.ms) || 1600, 6000));
    await page.evaluate(() => window.__yarrow?.unring());
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
      "window.mark_=function(pattern){if(!pattern)return;for(var el of t.children){if(!el.classList.contains('cmd')&&el.textContent.toLowerCase().indexOf(pattern.toLowerCase())>=0)el.classList.add('hl')}};" +
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
      "}" +
      ".hl{margin:0 -10px;padding:0 10px;border-radius:8px;box-shadow:inset 0 0 0 3px " +
      COLORS.amber +
      "}",
  );
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
  const app = tab === "app" ? plan.apps[chapter.app || "after"] : null;
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
  if (tab === "app") await context.addInitScript(overlay);
  const page = await context.newPage();
  const born = Date.now();
  const problems = [];
  const marks = [];
  const target = estimateMs(chapter.say);
  let url = null;
  if (tab === "app") {
    url = join(app.url, chapter.path);
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
  if (tab === "app") {
    url = bare(page.url());
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame())
        urls.push({ atMs: clock(), url: bare(frame.url()) });
    });
  }

  if (tab === "app") {
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
    await page.evaluate((p) => window.mark_(p), chapter.highlight || "");
  }

  await page.waitForTimeout(Math.max(target, clock() + 1000) - clock());
  const title = tab === "app" ? await page.title().catch(() => "") : null;
  // The poster shows the change: the app after it, else its proof run.
  const before = chapter.app === "before" || chapter.before === true;
  if (!before && tab === "app" && !state.poster)
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
// A virtual screen (Xvfb) and a window manager (openbox); Yarrow's desktop
// page under every window (the wallpaper and the dock, in a Chromium app
// window); the browser, driven by Playwright, and a terminal (xterm) in
// their windows. The pointer is the real one, moved and clicked by xdotool,
// and a click on the dock raises the app for real. ffmpeg films the whole
// screen; each chapter is cut from that film, its waits taken out.

const SCREEN = { width: 1440, height: 900 };
const WINDOWS = {
  browser: { x: 56, y: 20, width: 1328, height: 786 },
  terminal: { x: 168, y: 60, width: 1104, height: 704 },
};
const DOCK_APPS = ["browser", "terminal"];
const DOCK = { icon: 54, gap: 14, pad: 10, bottom: 10 };
// Chromium's toolbar, from the window's top left: the address, the reload button.
const TOOLBAR = { y: 63, reload: 98 };
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
  "picom",
  "dmz-cursor-theme",
  "fonts-inter",
  "fonts-jetbrains-mono",
  "fonts-dejavu-core",
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// A command's flags, written as one would type them.
const flags = (text) => text.trim().split(/\s+/);

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
  const desktop = { x: 0, y: 0, ...SCREEN };
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
    "<margins><top>0</top><bottom>0</bottom><left>0</left><right>0</right></margins>" +
    "<mouse><dragThreshold>4</dragThreshold><doubleClickTime>300</doubleClickTime>" +
    press("Client") +
    '<context name="Titlebar"><mousebind button="Left" action="Press"><action name="Focus"/><action name="Raise"/></mousebind><mousebind button="Left" action="Drag"><action name="Move"/></mousebind></context>' +
    "</mouse><applications>" +
    rule('title="Yarrow desktop*"', desktop, under) +
    rule('class="YarrowDesktop"', desktop, under) +
    rule('class="YarrowBrowser"', WINDOWS.browser) +
    rule('class="YarrowTerm"', WINDOWS.terminal) +
    "</applications></openbox_config>\n"
  );
}

// Rounded corners and a soft shadow under each window; the desktop page
// itself stays flat, edge to edge.
const PICOM = `backend = "xrender";
vsync = false;
fading = false;
corner-radius = 12;
rounded-corners-exclude = [ "name = 'Yarrow desktop'", "class_g = 'YarrowDesktop'", "window_type = 'tooltip'", "window_type = 'menu'", "window_type = 'dropdown_menu'", "window_type = 'popup_menu'" ];
shadow = true;
shadow-radius = 36;
shadow-opacity = 0.34;
shadow-offset-x = -36;
shadow-offset-y = -26;
shadow-exclude = [ "name = 'Yarrow desktop'", "class_g = 'YarrowDesktop'" ];
`;

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

const GLOBE =
  '<svg viewBox="0 0 54 54"><defs><linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5d9bff"/><stop offset="1" stop-color="#2b5fe0"/></linearGradient></defs><rect width="54" height="54" rx="13" fill="url(#b)"/><g fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" transform="translate(13 13)"><circle cx="14" cy="14" r="11"/><path d="M3 14h22M14 3c3.2 3.2 4.8 7 4.8 11s-1.6 7.8-4.8 11c-3.2-3.2-4.8-7-4.8-11s1.6-7.8 4.8-11z"/></g></svg>';
const PROMPT =
  '<svg viewBox="0 0 54 54"><defs><linearGradient id="t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2c2f36"/><stop offset="1" stop-color="#15171a"/></linearGradient></defs><rect width="54" height="54" rx="13" fill="url(#t)"/><rect x=".5" y=".5" width="53" height="53" rx="12.5" fill="none" stroke="rgba(255,255,255,.14)"/><path d="M15 19l8 7-8 7" fill="none" stroke="#e8e9ec" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M27 34h12" stroke="#f2b544" stroke-width="3" stroke-linecap="round"/></svg>';

/** Where the dock and its icons are on the screen. */
function dockLayout() {
  const count = DOCK_APPS.length;
  const width = count * DOCK.icon + (count - 1) * DOCK.gap + 2 * DOCK.pad;
  const height = DOCK.icon + 2 * DOCK.pad;
  const left = Math.round((SCREEN.width - width) / 2);
  const top = SCREEN.height - DOCK.bottom - height;
  return {
    left,
    top,
    width,
    height,
    icons: DOCK_APPS.map((app, i) => ({
      app,
      x: left + DOCK.pad + i * (DOCK.icon + DOCK.gap),
      y: top + DOCK.pad,
      size: DOCK.icon,
    })),
  };
}

/** The wallpaper and the dock: the page under every window. */
function desktopPage() {
  const dock = dockLayout();
  const art = { browser: GLOBE, terminal: PROMPT };
  const icons = dock.icons
    .map(
      (icon) =>
        '<button class="app" data-app="' +
        icon.app +
        '" style="left:' +
        (icon.x - dock.left) +
        "px;top:" +
        (icon.y - dock.top) +
        'px">' +
        art[icon.app] +
        "<i></i></button>",
    )
    .join("");
  return (
    '<!doctype html><html><head><meta charset="utf-8"><title>Yarrow desktop</title><style>' +
    "html,body{margin:0;width:" +
    SCREEN.width +
    "px;height:" +
    SCREEN.height +
    "px;overflow:hidden;cursor:default;user-select:none}" +
    "body{background:radial-gradient(900px 560px at 84% 106%,rgba(230,174,56,.2),transparent 70%)," +
    "radial-gradient(820px 560px at 4% -10%,rgba(110,150,255,.13),transparent 70%)," +
    "linear-gradient(160deg,#181a1f 0%,#0f1013 55%,#0b0c0e 100%)}" +
    ".dock{position:absolute;left:" +
    dock.left +
    "px;top:" +
    dock.top +
    "px;width:" +
    dock.width +
    "px;height:" +
    dock.height +
    "px;border-radius:22px;background:rgba(34,36,42,.5);box-shadow:inset 0 0 0 1px rgba(255,255,255,.1),0 12px 32px rgba(0,0,0,.4);backdrop-filter:blur(24px) saturate(140%)}" +
    ".app{position:absolute;width:" +
    DOCK.icon +
    "px;height:" +
    DOCK.icon +
    "px;padding:0;border:0;background:none;cursor:default}" +
    ".app svg{display:block;width:100%;height:100%;filter:drop-shadow(0 3px 6px rgba(0,0,0,.35));transition:transform .15s ease,filter .1s}" +
    ".app:hover svg{transform:translateY(-2px)}.app:active svg{filter:brightness(.8)}" +
    ".app i{position:absolute;left:50%;bottom:-7px;width:4px;height:4px;margin-left:-2px;border-radius:50%;background:rgba(255,255,255,.8);opacity:0;transition:opacity .3s}" +
    ".app.on i{opacity:1}" +
    ".app.hop svg{animation:hop .55s cubic-bezier(.3,.7,.4,1)}" +
    "@keyframes hop{35%{transform:translateY(-10px)}65%{transform:none}82%{transform:translateY(-3px)}}" +
    '</style></head><body><div class="dock">' +
    icons +
    "</div><script>" +
    "var apps=document.querySelectorAll('.app');" +
    "apps.forEach(function(a){a.addEventListener('click',function(){a.classList.remove('hop');void a.offsetWidth;a.classList.add('hop');fetch('/raise?app='+a.dataset.app,{method:'POST'}).catch(function(){})})});" +
    "(function poll(){fetch('/state').then(function(r){return r.json()}).then(function(s){apps.forEach(function(a){a.classList.toggle('on',s.running.indexOf(a.dataset.app)>=0)})}).catch(function(){}).then(function(){setTimeout(poll,200)})})();" +
    "</script></body></html>"
  );
}

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
    this.typed = false;
    this.cwd = null;
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

  place(id, box) {
    const hex = "0x" + id.toString(16);
    try {
      this.x("wmctrl", [
        "-i",
        "-r",
        hex,
        "-e",
        "0," + box.x + "," + box.y + "," + box.width + "," + box.height,
      ]);
    } catch {
      // openbox's rule placed it already.
    }
  }

  raise(id) {
    try {
      this.x("wmctrl", ["-i", "-a", "0x" + id.toString(16)]);
    } catch {
      // Gone: the next chapter opens it again.
    }
  }

  key(keys) {
    this.x("xdotool", ["key", "--clearmodifiers", keys]);
  }

  async start(playwright) {
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
    if (has("picom")) {
      const picom = path.join(home, ".config/picom.conf");
      fs.writeFileSync(picom, PICOM);
      // The legacy xrender backend: the new one paints the cut corners of
      // an opaque window (the terminal) black. A picom without it runs
      // the new one.
      const legacy = this.spawn("picom", "picom", [
        "--legacy-backends",
        "--config",
        picom,
      ]);
      await sleep(600);
      if (legacy.exitCode !== null)
        this.spawn("picom", "picom", ["--config", picom]);
    }
    await sleep(600);

    // The desktop page, and the dock's way to raise an app.
    this.server = http.createServer((request, response) => {
      const url = new URL(request.url, "http://localhost");
      if (url.pathname === "/raise") {
        const app = url.searchParams.get("app");
        if (this.ids[app]) {
          this.raise(this.ids[app]);
          this.front = app;
        }
        response.writeHead(204).end();
      } else if (url.pathname === "/state") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({ front: this.front, running: Object.keys(this.ids) }),
        );
      } else {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(desktopPage());
      }
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
        "--window-position=" + box.x + "," + box.y,
        "--window-size=" + box.width + "," + box.height,
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
    const rcfile = path.join(this.dir, "bashrc");
    fs.writeFileSync(rcfile, bashrc(this.state, this.cwd));
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
        "-class YarrowTerm -T Terminal -n Terminal -fa monospace -fs 13",
      ),
      ...flags(
        "-bg #0f1013 -fg #d5d7dc -cr #f2b544 -b 20 +sb -geometry 100x28",
      ),
      ...resources.flatMap((line) => ["-xrm", "XTerm*" + line]),
      ...["-e", "bash", "--rcfile", rcfile, "-i"],
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
    await this.startFilm();
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
    if (!(await until(() => this.zero !== null, 10000)))
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
    this.x("xdotool", [
      "mousemove",
      String(Math.round(aim.x)),
      String(Math.round(aim.y)),
    ]);
    await this.click();
    this.x("xdotool", ["mousemove", String(at.x), String(at.y)]);
    await sleep(150);
  }

  /** Where a point of the page is on the screen. */
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
    return { x: left + x, y: top + y };
  }

  /** The pointer onto a point of the page, corrected once the page saw it. */
  async glideTo(page, x, y, ms = 750) {
    const aim = await this.screenOf(page, x, y);
    await this.glide(aim.x, aim.y, ms);
    await sleep(40);
    const seen = await this.screenOf(page, x, y);
    if (Math.abs(seen.x - aim.x) > 1 || Math.abs(seen.y - aim.y) > 1)
      await this.glide(seen.x, seen.y, 120);
  }

  /** The app in front, by its icon in the dock: the film shows the switch. */
  async show(app, clock, marks) {
    if (this.front === app && this.activeId() === this.ids[app]) return;
    const icon = dockLayout().icons.find((item) => item.app === app);
    await this.glide(icon.x + icon.size / 2, icon.y + icon.size / 2, 850);
    await sleep(120);
    marks.push({
      atMs: clock(),
      kind: "click",
      box: { x: icon.x, y: icon.y, width: icon.size, height: icon.size },
    });
    await this.click();
    if (!(await until(() => this.activeId() === this.ids[app], 1500, 50))) {
      log("the dock missed " + app + ": raised directly");
      this.raise(this.ids[app]);
    }
    this.front = app;
    // Off the dock, into the window, where the hand rests.
    const box = WINDOWS[app];
    await this.glide(box.x + box.width * 0.72, box.y + box.height * 0.62, 600);
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
      chapter.tab === "app"
        ? await this.recordApp(plan, chapter, index, state)
        : await this.recordTerminal(chapter, state);
    const parts = result.take.end();
    this.jobs.push({ name, parts });
    const durationMs = parts.reduce((sum, [from, to]) => sum + to - from, 0);
    return {
      chapter: {
        ...result.chapter,
        title: chapter.title,
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
    const app = plan.apps[chapter.app || "after"];
    const before = chapter.app === "before" || chapter.before === true;
    const target = estimateMs(chapter.say);
    const problems = [];
    const marks = [];
    // Off the film: a new window on the chapter's page, as a first visit
    // sees it; it opens over the last one, which then closes.
    const context = await this.browser.newContext({
      viewport: null,
      colorScheme: "light",
      bypassCSP: true,
      ...(app.storage ? { storageState: app.storage } : {}),
    });
    await context.addInitScript(overlay, { real: true });
    const page = await context.newPage();
    const id = await this.opened(
      (w) => !/yarrowterm|yarrowdesktop/i.test(w.wmClass),
      15000,
    );
    if (!id) throw new Error("the browser window did not open");
    this.place(id, WINDOWS.browser);
    const url = join(app.url, chapter.path);
    await page.goto(url, { waitUntil: "load", timeout: 45000 });
    await page
      .waitForLoadState("networkidle", { timeout: 6000 })
      .catch(() => {});
    await page.evaluate(() => document.fonts.ready).catch(() => {});
    const last = this.page;
    this.page = page;
    this.ids.browser = id;
    if (last)
      await last
        .context()
        .close()
        .catch(() => {});
    await this.focusPage(page);
    // A terminal used on film stays in front: the dock brings the browser up.
    if (this.front === "terminal" && this.typed) this.raise(this.ids.terminal);
    else this.front = "browser";
    await sleep(500);

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
    await this.show("browser", clock, marks);
    const actions = chapter.actions || [];
    const lead = Math.max(700, clock());
    if (clock() < lead) await sleep(lead - clock());
    for (const [i, action] of actions.entries()) {
      // Spread over what is said, so the gestures land on the words.
      const due =
        lead + (target - lead) * 0.85 * (i / Math.max(actions.length, 1));
      const wait = due - clock();
      if (wait > 0) await sleep(Math.min(wait, 3000));
      try {
        await this.act(page, app.url, action, marks, clock);
      } catch (error) {
        fail(action, error);
      }
    }
    await sleep(Math.max(target, clock() + 1000) - clock());
    const title = await page.title().catch(() => "");
    film.pause();
    // The poster shows the change: the app after it, else its proof run.
    if (!before && !state.poster) state.poster = this.still();
    if (!state.first) state.first = this.still();
    return {
      take: film,
      problems,
      chapter: { url: bare(url), urls, page: title || null, before, marks },
    };
  }

  async settle(page) {
    await page
      .waitForLoadState("networkidle", { timeout: 4000 })
      .catch(() => {});
    await sleep(400);
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
      return sleep(900);
    }
    const locator = page.locator(action.target).first();
    await locator.waitFor({ state: "visible", timeout: 8000 });
    if (kind === "scroll") {
      await locator.evaluate((element) =>
        element.scrollIntoView({ behavior: "smooth", block: "center" }),
      );
      return sleep(900);
    }
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    if (!box) throw new Error("not on screen");
    const x = box.x + Math.min(box.width * 0.6, box.width - 6);
    const y = box.y + Math.min(box.height * 0.65, box.height - 4);
    await this.glideTo(page, x, y);
    const at = clock();
    const shown = {
      x: Math.round(box.x),
      y: Math.round(box.y),
      width: Math.round(box.width),
      height: Math.round(box.height),
    };
    if (kind === "point" || kind === "hover") {
      marks.push({ atMs: at, kind: "point", box: shown });
      await page.evaluate((b) => window.__yarrow?.ring(b), shown);
      await sleep(Math.min(Number(action.ms) || 1600, 6000));
      await page.evaluate(() => window.__yarrow?.unring());
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
    await locator.pressSequentially(String(action.text ?? ""), { delay: 55 });
    await sleep(300);
  }

  /** A page by its address, typed in the browser's own address bar. */
  async address(page, url, marks, clock) {
    const frame = await page.evaluate(() => ({
      x: window.screenX,
      y: window.screenY,
      width: window.outerWidth,
    }));
    const bar = {
      x: frame.x + Math.round(frame.width * 0.4),
      y: frame.y + TOOLBAR.y,
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
    const button = { x: frame.x + TOOLBAR.reload, y: frame.y + TOOLBAR.y };
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

  async recordTerminal(chapter, state) {
    const target = estimateMs(chapter.say);
    const before = chapter.before === true;
    const marks = [];
    const problems = [];
    const cwd =
      chapter.cwd ||
      (fs.existsSync("/workspace/repo") ? "/workspace/repo" : process.cwd());
    const film = new Take();
    const clock = () => film.clock();
    await this.show("terminal", clock, marks);
    if (this.activeId() !== this.ids.terminal) this.raise(this.ids.terminal);
    if (this.typed) {
      this.key("ctrl+l");
      await sleep(250);
    }
    await sleep(350);
    const text =
      (cwd !== this.cwd ? "cd " + quote(cwd) + " && " : "") + chapter.command;
    const shown = this.prompt();
    const delay = Math.round(
      Math.max(12, Math.min(40, 1500 / Math.max(text.length, 1))),
    );
    this.x("xdotool", ["type", "--delay", String(delay), text]);
    await sleep(250);
    log("running: " + chapter.command);
    this.key("Return");
    this.typed = true;
    this.cwd = cwd;
    // A run longer than a few seconds is cut: its start, then its end.
    const started = Date.now();
    let done = null;
    while (Date.now() - started < 240000) {
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
        '"' + chapter.title + '": still running after four minutes, stopped',
      );
      await sleep(600);
    }
    film.resume();
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

/** Chapters the desktop films; a phone or a given output stays a clip. */
const onDesktop = (chapter) =>
  (chapter.tab === "app" && chapter.device !== "phone") ||
  (chapter.tab === "terminal" && typeof chapter.output !== "string");

async function main() {
  const [file, flag] = process.argv.slice(2);
  if (!file) throw new Error("usage: node present.mjs plan.json [--check]");
  const plan = JSON.parse(fs.readFileSync(file, "utf8"));
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
      chapters.push(result.chapter);
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
