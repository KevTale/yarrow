import { providerName } from "../src/core/failures";
import type {
  ComputeSummary,
  DailyFundingRow,
  ProviderCompute,
} from "../src/db/admin";

/** Every value printed in the page goes through here. */
export function escape(value: string | number | null | undefined): string {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
}

// Whole dollars stay whole ($15); cents always show two digits ($0.30).
const dollars = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: cents % 100 ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;

const domain = (url: string | null) => {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

function logo(appUrl: string, row: Pick<DailyFundingRow, "logoUrl" | "name">) {
  const initial = escape((row.name ?? "?").trim().charAt(0).toUpperCase());
  const image = row.logoUrl
    ? `<img src="${escape(new URL(row.logoUrl, appUrl).href)}" alt="">`
    : initial;
  return image;
}

/** The fields of a sponsor row, empty for a new one. */
function fields(appUrl: string, row?: DailyFundingRow) {
  return `
    <label class="tile" title="Logo">
      <span class="logo" data-logo>${row ? logo(appUrl, row) : "+"}</span>
      <input type="file" accept="image/png,image/jpeg,image/webp" data-logo-file hidden>
      <input type="hidden" name="logo">
    </label>
    <div class="fields">
      <input name="name" placeholder="Company name" required minlength="2" maxlength="60" value="${escape(row?.name)}">
      <input name="description" placeholder="What it does, in a sentence" maxlength="160" value="${escape(row?.description)}">
      <input name="website" type="url" placeholder="https://" pattern="https://.*" value="${escape(row?.websiteUrl)}">
    </div>
    <label class="amount">
      <span>$</span>
      <input name="amount" type="number" min="1" max="10000" step="1" required value="${row ? row.amountCents / 100 : ""}">
      <span>/ day</span>
    </label>`;
}

function fundingRow(appUrl: string, row: DailyFundingRow) {
  const id = escape(row.userId);
  return `
  <li class="row${row.paused ? " paused" : ""}">
    <div class="view">
      <span class="logo">${logo(appUrl, row)}</span>
      <div class="who">
        <strong>${escape(row.name)}</strong>
        <span class="muted">${escape(row.description)}</span>
        <span class="muted">${escape(domain(row.websiteUrl))}</span>
      </div>
      <div class="numbers">
        <strong>${dollars(row.amountCents)} / day</strong>
        <span class="muted">${dollars(row.creditedCents)} credited · ${dollars(row.spentCents)} spent</span>
        <span class="${row.paused ? "muted" : row.creditedToday ? "ok" : "muted"}">${row.paused ? "Paused" : row.creditedToday ? "Credited today" : "Waiting for midnight UTC"}</span>
      </div>
      <div class="actions">
        <button type="button" class="line" data-edit>Edit</button>
        <form method="post" action="/fundings/${id}/${row.paused ? "resume" : "pause"}">
          <button class="line">${row.paused ? "Resume" : "Pause"}</button>
        </form>
      </div>
    </div>
    <form class="edit" method="post" action="/fundings/${id}" hidden>
      ${fields(appUrl, row)}
      <div class="actions">
        <button type="button" class="line" data-cancel>Cancel</button>
        <button>Save</button>
      </div>
    </form>
  </li>`;
}

const time = (date: Date) =>
  `${new Date(date).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  })} UTC`;

function providerRow(row: ProviderCompute) {
  const spend = (cents: number) => `${row.exact ? "" : "≈"}${dollars(cents)}`;
  const { pause } = row;
  const waiting = pause && new Date(pause.until) > new Date();
  const state = !pause
    ? `<span class="ok">Running</span>`
    : `<span class="alert">Out of credit since ${time(pause.since)}</span>
        <span class="muted">${waiting ? `Next try ${time(pause.until)}` : "Trying again"}</span>`;
  return `
  <li class="row${pause ? " alerting" : ""}">
    <div class="view">
      <div class="who">
        <strong>${providerName[row.provider]}</strong>
        ${state}
      </div>
      <div class="numbers">
        <strong>${spend(row.todayCents)} today</strong>
        <span class="muted">${spend(row.weekCents)} 7 days · ${spend(row.monthCents)} 30 days</span>
      </div>
      ${
        pause
          ? `<div class="actions">
        <form method="post" action="/providers/${row.provider}/resume"><button>Resume</button></form>
      </div>`
          : ""
      }
    </div>
    ${pause ? `<p class="muted said">${escape(pause.message)}</p>` : ""}
  </li>`;
}

function owedRow(compute: ComputeSummary) {
  const { stripe, direct, promo } = compute.owedCents;
  return `
  <li class="row">
    <div class="view">
      <div class="who">
        <strong>Sponsor credit left</strong>
        <span class="muted">Card ${dollars(stripe)} · Direct ${dollars(direct)} · Promo ${dollars(promo)}</span>
      </div>
      <div class="numbers">
        <strong>${dollars(stripe + direct + promo)}</strong>
        <span class="muted">${dollars(compute.absorbedCents)} absorbed · 30 days</span>
      </div>
    </div>
  </li>`;
}

export function adminPage(input: {
  appUrl: string;
  fundings: DailyFundingRow[];
  compute: ComputeSummary;
  error: string | null;
}): string {
  const { appUrl, fundings, compute, error } = input;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Yarrow admin</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500&family=Jost:wght@500&display=swap" rel="stylesheet">
<style>${css}</style>
</head>
<body>
<main>
  <header>
    <a class="brand" href="${escape(appUrl)}">Yarrow</a>
    <span class="muted">admin</span>
  </header>
  ${error ? `<p class="error" role="alert">${escape(error)}</p>` : ""}
  <h1>Compute</h1>
  <ul class="rows">
    ${compute.providers.map(providerRow).join("")}
    ${owedRow(compute)}
  </ul>
  <h1>Daily fundings</h1>
  <ul class="rows">
    ${fundings.map((row) => fundingRow(appUrl, row)).join("")}
    <li class="row new">
      <form method="post" action="/fundings">
        ${fields(appUrl)}
        <div class="actions"><button>Add</button></div>
      </form>
    </li>
  </ul>
</main>
<script>${script}</script>
</body>
</html>`;
}

const css = `
:root {
  --bg: #0c0d0f; --surface: #111215; --elevated: #17191d; --hover: #1b1e23;
  --line: #25282e; --text: #edeef0; --secondary: #bdc1c9; --muted: #8a909b;
  --amber: #f2b544; --green: #5ccb95; --red: #ee7b6e;
  color-scheme: dark;
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.45 Geist, Arial, sans-serif; }
main { max-width: 920px; margin: 0 auto; padding: 32px 16px 64px; }
header { display: flex; align-items: baseline; gap: 8px; margin-bottom: 40px; }
.brand { font: 500 20px Jost, sans-serif; color: var(--text); text-decoration: none; }
h1 { font: 500 28px Jost, sans-serif; margin: 0 0 20px; }
.rows + h1 { margin-top: 48px; }
.muted { color: var(--muted); }
.ok { color: var(--green); }
.alert { color: var(--red); }
.row.alerting { border-color: color-mix(in srgb, var(--red) 45%, var(--line)); }
.said { margin: 10px 0 0; font-size: 13px; overflow-wrap: anywhere; }
.error { color: var(--red); margin: 0 0 16px; }
.rows { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.row { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 14px; }
.row.paused .view > :not(.actions) { opacity: .5; }
.row.new { border-style: dashed; background: transparent; }
.view, form { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.who, .numbers, .fields { display: grid; gap: 2px; min-width: 0; }
.who { flex: 1 1 240px; }
.who span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.numbers { text-align: right; }
.fields { flex: 1 1 280px; gap: 6px; }
.actions { display: flex; gap: 8px; margin-left: auto; }
.logo { width: 44px; height: 44px; flex: none; border-radius: 10px; background: var(--elevated); border: 1px solid var(--line);
  display: grid; place-items: center; overflow: hidden; font: 500 18px Jost, sans-serif; color: var(--secondary); }
.logo img { width: 100%; height: 100%; object-fit: contain; }
.tile { cursor: pointer; }
.tile:hover .logo { border-color: var(--muted); }
input { width: 100%; background: var(--bg); color: var(--text); border: 1px solid var(--line); border-radius: 8px; padding: 7px 10px; font: inherit; }
input:focus { outline: none; border-color: var(--amber); }
.amount { display: flex; align-items: center; gap: 6px; color: var(--muted); }
.amount input { width: 84px; text-align: right; }
button { font: inherit; font-weight: 500; border-radius: 999px; padding: 7px 16px; cursor: pointer; border: 1px solid var(--amber); background: var(--amber); color: var(--bg); }
button.line { background: transparent; color: var(--text); border-color: var(--line); }
button.line:hover { border-color: var(--muted); }
button:focus-visible { outline: 2px solid var(--amber); outline-offset: 2px; }
@media (max-width: 640px) { .numbers { text-align: left; } .actions { margin-left: 0; } }
`;

/** Logos are drawn at 128 px, as on the landing, then sent as a data URL. */
const script = `
const SIZE = 128;
async function draw(file) {
  const source = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = source;
    await image.decode();
    const width = image.naturalWidth || SIZE, height = image.naturalHeight || SIZE;
    const scale = Math.min(SIZE / width, SIZE / height);
    const canvas = document.createElement("canvas");
    canvas.width = SIZE; canvas.height = SIZE;
    const context = canvas.getContext("2d");
    context.imageSmoothingQuality = "high";
    const w = width * scale, h = height * scale;
    context.drawImage(image, (SIZE - w) / 2, (SIZE - h) / 2, w, h);
    return canvas.toDataURL("image/webp", 0.9);
  } finally { URL.revokeObjectURL(source); }
}
document.querySelectorAll("[data-logo-file]").forEach((input) => {
  input.addEventListener("change", async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    const url = await draw(file);
    const tile = input.closest(".tile");
    tile.querySelector("input[name=logo]").value = url;
    const img = document.createElement("img");
    img.src = url; img.alt = "";
    tile.querySelector("[data-logo]").replaceChildren(img);
  });
});
document.querySelectorAll("[data-edit]").forEach((button) => {
  button.addEventListener("click", () => {
    const row = button.closest(".row");
    row.querySelector(".view").hidden = true;
    row.querySelector(".edit").hidden = false;
    row.querySelector(".edit input[name=name]").focus();
  });
});
document.querySelectorAll("[data-cancel]").forEach((button) => {
  button.addEventListener("click", () => {
    const row = button.closest(".row");
    row.querySelector(".edit").reset();
    row.querySelector(".edit").hidden = true;
    row.querySelector(".view").hidden = false;
  });
});
`;
