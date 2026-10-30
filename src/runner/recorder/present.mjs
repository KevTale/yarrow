// Yarrow's recorder: the agent writes a plan of its presentation, this plays
// it in a real browser and records each chapter as a clip. It runs in the
// implementer's sandbox, mounted at /mnt/session/uploads/yarrow/present.mjs
// (src/runner/recorder/source.ts carries it; pnpm recorder:embed after an edit).
//
//   node present.mjs plan.json           record every chapter
//   node present.mjs plan.json --check   check the plan, record nothing
//
// Writes presentation/presentation.json, one .webm per chapter and a poster
// under the session's outputs. The brain voices it after the review.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const OUTPUTS = process.env.YARROW_OUTPUTS || "/mnt/session/outputs";
const DIR = path.join(OUTPUTS, "presentation");
// As estimateSpeechMs in src/core/presentation.ts.
const WORDS_PER_SECOND = 2.6;
const DESKTOP = { width: 1280, height: 800 };
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

function findChromium() {
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
      const full = path.join(root, entry, binary);
      if (entry.startsWith("chromium") && fs.existsSync(full))
        candidates.push({ full, revision, shell: entry.includes("headless") });
    }
  }
  candidates.sort(
    (a, b) => Number(a.shell) - Number(b.shell) || b.revision - a.revision,
  );
  return candidates[0]?.full ?? null;
}

async function launch({ pw, cli }) {
  const attempts = [
    () => pw.chromium.launch(),
    () => {
      const executablePath = findChromium();
      if (!executablePath)
        throw new Error(
          "no Chromium under " + process.env.PLAYWRIGHT_BROWSERS_PATH,
        );
      return pw.chromium.launch({ executablePath });
    },
    () => {
      log("installing Chromium for this Playwright");
      run(process.execPath, [cli, "install", "chromium"]);
      return pw.chromium.launch();
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

/** Runs in every page: the agent's cursor and the ring around what it shows. */
function overlay() {
  if (window.top !== window) return;
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
    root.append(ring, ripple, cursor);
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

const CIRCLE =
  '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>';
const CHECKED =
  '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>';
const DASHED =
  '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10.1 2.18a9.93 9.93 0 0 1 3.8 0"/><path d="M17.6 3.71a9.95 9.95 0 0 1 2.69 2.7"/><path d="M21.82 10.1a9.93 9.93 0 0 1 0 3.8"/><path d="M20.29 17.6a9.95 9.95 0 0 1-2.7 2.69"/><path d="M13.9 21.82a9.94 9.94 0 0 1-3.8 0"/><path d="M6.4 20.29a9.95 9.95 0 0 1-2.69-2.7"/><path d="M2.18 13.9a9.93 9.93 0 0 1 0-3.8"/><path d="M3.71 6.4a9.95 9.95 0 0 1 2.7-2.69"/></svg>';

function ticketPage(ticket) {
  const criteria = (ticket.criteria || []).slice(0, 8);
  const sources = {
    github: "GitHub",
    jira: "Jira",
    linear: "Linear",
    trello: "Trello",
  };
  const source = sources[String(ticket.source).toLowerCase()] || ticket.source;
  const reference = [source, ticket.number ? "#" + ticket.number : null]
    .filter(Boolean)
    .join(" ");
  return htmlPage(
    '<main><p class="by">' +
      escape(reference) +
      "</p><h1>" +
      escape(ticket.title) +
      "</h1>" +
      (ticket.summary
        ? '<p class="sum">' +
          escape(String(ticket.summary).slice(0, 420)) +
          "</p>"
        : "") +
      (criteria.length
        ? "<h2>Done when</h2><ul>" +
          criteria
            .map(
              (item, i) =>
                '<li id="c' +
                i +
                '" data-ok="' +
                (item.verified === false ? "no" : "yes") +
                '"><i>' +
                CIRCLE +
                "</i><span>" +
                escape(item.text) +
                "</span></li>",
            )
            .join("") +
          "</ul>"
        : "") +
      "</main><script>window.tick=function(i){var li=document.getElementById('c'+i);if(!li)return;var ok=li.dataset.ok==='yes';li.className=ok?'ok':'warn';li.querySelector('i').innerHTML=ok?" +
      JSON.stringify(CHECKED) +
      ":" +
      JSON.stringify(DASHED) +
      ";}</script>",
    "main{box-sizing:border-box;height:100%;padding:64px 88px 96px;display:flex;flex-direction:column;justify-content:center;gap:22px}" +
      ".by{margin:0;color:" +
      COLORS.muted +
      ";font-size:18px}" +
      "h1{margin:0;font:500 44px/1.15 Jost,Geist,sans-serif;letter-spacing:-.02em;max-width:1000px}" +
      ".sum{margin:0;max-width:960px;color:" +
      COLORS.secondary +
      ";font-size:23px;line-height:1.55}" +
      "h2{margin:14px 0 0;font-size:17px;font-weight:500;color:" +
      COLORS.muted +
      "}" +
      "ul{list-style:none;margin:0;padding:0;display:grid;gap:16px}" +
      "li{display:flex;gap:14px;align-items:center;font-size:24px;color:" +
      COLORS.secondary +
      ";transition:color .3s}" +
      "li i{display:grid;color:" +
      COLORS.muted +
      "}li.ok{color:" +
      COLORS.text +
      "}li.ok i{color:" +
      COLORS.green +
      "}" +
      "li.warn,li.warn i{color:" +
      COLORS.amber +
      "}",
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
    const count = (plan.ticket.criteria || []).slice(0, 8).length;
    await page.waitForTimeout(600);
    if (chapter.checked)
      for (let i = 0; i < count; i++) {
        await page.evaluate((n) => window.tick(n), i);
        await page.waitForTimeout(
          Math.max(500, Math.min(1600, (target - 1200) / Math.max(count, 1))),
        );
      }
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
      url: tab === "app" ? url.replace(/^https?:\/\//, "") : url,
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
  const browser = await launch(playwright);
  await ensureVideo(browser, playwright);
  fs.rmSync(DIR, { recursive: true, force: true });
  fs.mkdirSync(DIR, { recursive: true });
  const take = Date.now().toString(36).slice(-6);
  const state = { poster: null, run: null, first: null };
  const chapters = [];
  const failed = [];
  for (const [index, chapter] of plan.chapters.entries()) {
    log("chapter " + (index + 1) + ": " + chapter.title);
    try {
      const result = await record(browser, plan, chapter, index, take, state);
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
  await browser.close();
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
        chapters,
      },
      null,
      2,
    ),
  );
  for (const chapter of chapters)
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
  log("done: " + chapters.length + " chapter(s) in " + DIR);
}

main().catch((error) => {
  console.error("recorder: " + (error?.stack || error));
  process.exit(1);
});
