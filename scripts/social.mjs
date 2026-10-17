// Renders Instagram slides from data/*.json in the site's newspaper style:
// a carousel (1080x1350), a Story and a Reel cover (1080x1920), plus a caption
// and a sources comment. Uses a local Chrome/Chromium for pixel-exact text layout.
//
//   npm run social                    # launch carousel with the 5 newest entries
//   npm run social -- --latest 8      # ... with the 8 newest
//   npm run social -- --week          # "This week in misplaced AI": entries added in the last 7 days
//   npm run social -- --since 2026-10-01
//   npm run social -- --out somewhere/
//
// Output goes to social/<date>-<mode>/ (git-ignored). CHROME_PATH overrides browser detection.
import { writeFile, mkdir, mkdtemp, rm, access } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { root, readJson, esc, fmtDate, money, byDateDesc } from "./format.mjs";

const run = promisify(execFile);
const MAX_ENTRY_SLIDES = 15; // Instagram carousels hold 20 slides

// --- options --------------------------------------------------------------------

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : (args[i + 1] ?? true);
};
const today = new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

const site = await readJson("site.json");
const stats = await readJson("stats.json");
const good = (await readJson("good.json")).sort(byDateDesc);
const all = (await readJson("entries.json")).sort(byDateDesc);

let mode = "launch";
let since;
if (opt("week")) [mode, since] = ["week", daysAgo(7)];
if (typeof opt("since") === "string") [mode, since] = ["since", opt("since")];

const picked = since
  ? all.filter((e) => (e.added ?? e.date) >= since)
  : all.slice(0, Number(opt("latest") ?? 5));
const entries = picked.slice(0, MAX_ENTRY_SLIDES);
if (!entries.length) {
  console.error(`No entries ${since ? `added since ${since}` : "found"}. Nothing to render.`);
  process.exit(1);
}

const outDir = path.resolve(typeof opt("out") === "string" ? opt("out") : path.join(root, "social", `${today}-${mode}`));

// --- look ---------------------------------------------------------------------------

const CSS = `
:root {
  --paper: #f5f2ea; --ink: #151413; --muted: #5f5b53; --hair: #d6d0c2; --red: #c8102e;
  --display: "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif;
  --serif: Charter, "Bitstream Charter", "Sitka Text", Cambria, Georgia, serif;
  --mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
}
* { box-sizing: border-box; margin: 0; }
html, body { width: var(--w); height: var(--h); overflow: hidden; background: var(--paper); color: var(--ink); }
body { display: flex; flex-direction: column; padding: var(--pad-y) 84px; font-family: var(--serif); -webkit-font-smoothing: antialiased; }
.top, .bottom { display: flex; justify-content: space-between; align-items: baseline; font: 400 24px/1 var(--mono); letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); }
.top { padding-bottom: 20px; border-bottom: 7px double var(--ink); }
.bottom { padding-top: 22px; border-top: 2px solid var(--ink); text-transform: none; letter-spacing: 0.04em; }
.bottom strong { color: var(--ink); font-weight: 700; }
.main { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 28px; }
.center { text-align: center; align-items: center; }
.kicker { font: 400 26px/1.2 var(--mono); letter-spacing: 0.16em; text-transform: uppercase; color: var(--muted); }
.question { font: italic 400 132px/1.02 var(--display); letter-spacing: -0.01em; text-wrap: balance; }
.no { font: 700 500px/0.8 var(--display); letter-spacing: -0.045em; }
.dot { display: inline-block; width: 0.16em; height: 0.16em; margin-left: 0.04em; border-radius: 50%; background: var(--red); }
.note { font: 400 40px/1.4 var(--serif); color: var(--muted); max-width: 22em; text-wrap: balance; }
.swipe { font: 700 28px/1 var(--mono); letter-spacing: 0.12em; text-transform: uppercase; }
.figure { font: 700 112px/1 var(--display); letter-spacing: -0.02em; }
.figure.red { color: var(--red); }
.label { font: 400 28px/1.35 var(--mono); color: var(--muted); }
.bar { height: 64px; background: var(--ink); }
.bar.red { background: var(--red); min-width: 8px; }
.ratio { font: italic 400 44px/1.3 var(--serif); }
.ratio strong { font-style: normal; }
.meta { display: flex; gap: 18px; align-items: center; font: 400 28px/1 var(--mono); color: var(--muted); }
.tag { font-size: 22px; letter-spacing: 0.12em; text-transform: uppercase; padding: 8px 12px; border: 2px solid currentColor; }
.tag.money { color: var(--red); }
.title { font: 700 96px/1.02 var(--display); letter-spacing: -0.015em; text-wrap: balance; }
.title.long { font-size: 80px; }
.who { font: 400 28px/1.3 var(--mono); color: var(--muted); }
.what { font: 400 42px/1.38 var(--serif); }
.cost { font: 700 30px/1.35 var(--mono); color: var(--red); }
.quip { font: italic 400 46px/1.32 var(--serif); }
.quip::before { content: "\\2014\\00a0"; }
.src { font: 400 24px/1.3 var(--mono); color: var(--muted); }
.section { font: 700 104px/1.04 var(--display); letter-spacing: -0.015em; text-wrap: balance; }
.good { border-top: 2px solid var(--ink); padding-top: 24px; }
.good h3 { font: 700 52px/1.1 var(--display); }
.good p { font: 700 36px/1.35 var(--serif); margin-top: 10px; }
.domain { font: 700 64px/1.1 var(--display); letter-spacing: -0.01em; white-space: nowrap; }
.motto { font: italic 400 60px/1.2 var(--display); }
`;

function page({ w, h, padY = 72, top = ["", ""], bottom = ["", ""], body, center = false }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${CSS}
:root { --w: ${w}px; --h: ${h}px; --pad-y: ${padY}px; }</style></head><body>
${top[0] || top[1] ? `<div class="top"><span>${top[0]}</span><span>${top[1]}</span></div>` : ""}
<div class="main${center ? " center" : ""}">${body}</div>
${bottom[0] || bottom[1] ? `<div class="bottom"><span>${bottom[0]}</span><span>${bottom[1]}</span></div>` : ""}
</body></html>`;
}

// --- slides ---------------------------------------------------------------------------

const dateline = fmtDate(today, { day: "numeric", month: "long", year: "numeric" });
const ratio = Math.round(stats.aiCapex.value / stats.cancerFunding.value);
const barPct = Math.max((stats.cancerFunding.value / stats.aiCapex.value) * 100, 0.6);
const domain = `<strong>${esc(site.domain)}</strong>`;
const weekRange = since ? `${fmtDate(since, { day: "numeric", month: "short" })} – ${fmtDate(today, { day: "numeric", month: "short" })}` : "";

const cover =
  mode === "launch"
    ? `<p class="kicker">A simple question</p><h1 class="question">Have we cured cancer yet?</h1>`
    : `<p class="kicker">This week in misplaced AI · ${esc(weekRange)}</p><h1 class="question">Have we cured cancer yet?</h1>`;

const slides = [
  { name: "cover", top: ["Est. 2026", dateline], body: `${cover}<p class="swipe">Swipe &rarr;</p>`, center: true },
  {
    name: "answer",
    top: ["The answer", dateline],
    body: `<p class="no">No<span class="dot"></span></p>
      <p class="note">Some cancers are curable today, thanks to decades of research. None has been cured by AI.</p>`,
    center: true,
  },
  {
    name: "ledger",
    top: ["The ledger", String(stats.aiCapex.year)],
    body: `<p class="kicker">One year of Big Tech&rsquo;s AI build-out</p>
      <p class="figure">${money(stats.aiCapex.value)}</p>
      <div class="bar"></div>
      <p class="kicker">The world&rsquo;s biggest cancer research budget</p>
      <p class="figure red">${money(stats.cancerFunding.value)}</p>
      <div class="bar red" style="width:${barPct.toFixed(2)}%"></div>
      <p class="ratio">Drawn to scale. That&rsquo;s roughly <strong>${ratio}&times;</strong>.</p>
      <p class="label">${esc(stats.aiCapex.short ?? stats.aiCapex.label)} vs. ${esc(stats.cancerFunding.short ?? stats.cancerFunding.label)}</p>`,
  },
  ...entries.map((e, i) => ({
    name: `entry-${String(i + 1).padStart(2, "0")}-${e.id}`.slice(0, 60),
    top: ["Meanwhile, we pointed AI at", `${i + 1} of ${entries.length}`],
    body: `<div class="meta"><span>${fmtDate(e.date)}</span>${
      e.tag === "same-money" ? `<span class="tag money">Same money, different toy</span>` : `<span class="tag">AI</span>`
    }</div>
      <h2 class="title${e.title.length > 34 ? " long" : ""}">${esc(e.title)}</h2>
      <p class="who">${esc(e.who)}</p>
      <p class="what">${esc(e.what)}</p>
      ${e.cost && e.cost.length <= 110 ? `<p class="cost">${esc(e.cost)}</p>` : ""}
      <p class="quip">${esc(e.quip)}</p>
      <p class="src">Source: ${[...new Set(e.sources.map((s) => s.publisher))].map(esc).join(", ")}</p>`,
  })),
  {
    name: "aim",
    top: ["Not anti-AI", dateline],
    body: `<h2 class="section">It&rsquo;s not the tool. It&rsquo;s the aim.</h2>
      ${good
        .slice(0, 2)
        .map((g) => `<div class="good"><h3>${esc(g.title)}</h3><p>${esc(g.why)}</p></div>`)
        .join("")}`,
  },
  {
    name: "cta",
    top: ["Every claim is sourced", ""],
    body: `<p class="kicker">The full, running list</p><p class="domain">${esc(site.domain)}</p>
      <p class="swipe">Link in bio</p><p class="motto">Not anti-AI. Pro-aim.</p>`,
    center: true,
  },
];

const carousel = slides.map((s, i) =>
  page({ w: 1080, h: 1350, top: s.top, bottom: [domain, `${i + 1} / ${slides.length}`], body: s.body, center: s.center }),
);

// Stories: keep clear of the top ~250px and bottom ~340px (Instagram's own UI), and leave room for the link sticker.
const story = page({
  w: 1080,
  h: 1920,
  padY: 250,
  body: `<h1 class="question" style="font-size:92px">Have we cured cancer yet?</h1>
    <p class="no" style="font-size:420px">No<span class="dot"></span></p>
    <p class="ratio">Big Tech AI spending, ${stats.aiCapex.year}: <strong>${money(stats.aiCapex.value)}</strong>.<br>
    The world&rsquo;s biggest cancer research budget: <strong>${money(stats.cancerFunding.value)}</strong>.</p>
    <p class="swipe" style="margin-top:60px">See what we pointed AI at instead &darr;</p>
    <div style="height:180px"></div>`,
  center: true,
});

// Reel cover: the profile grid crops to the middle 1080x1440, so everything important sits there.
const reelCover = page({
  w: 1080,
  h: 1920,
  padY: 260,
  body: `<p class="kicker">${mode === "launch" ? "A simple question" : `This week in misplaced AI · ${esc(weekRange)}`}</p>
    <h1 class="question" style="font-size:100px">Have we cured cancer yet?</h1>
    <p class="no" style="font-size:440px">No<span class="dot"></span></p>`,
  center: true,
});

// --- caption & sources comment ------------------------------------------------------------

const hashtags = "#CancerResearch #AI #TechEthics #ArtificialIntelligence #ScienceFunding";
const caption =
  mode === "launch"
    ? `Have we cured cancer yet? No.

This year Big Tech will spend about ${money(stats.aiCapex.value)} on AI. The world's biggest cancer research budget is ${money(stats.cancerFunding.value)}. Swipe for what we pointed AI at instead.

Not anti-AI. Pro-aim. Every claim is sourced: link in bio.

${hashtags}`
    : `This week in misplaced AI (${weekRange}): ${entries.map((e) => e.title).join(", ")}.

Have we cured cancer yet? Still no.

Not anti-AI. Pro-aim. Every claim is sourced: link in bio.

${hashtags}`;

const sourcesComment = `Sources, slide by slide:
${entries.map((e, i) => `${i + 4}. ${e.title}: ${e.sources.map((s) => `${s.publisher} ${s.url}`).join(" · ")}`).join("\n")}
Figures: ${[...stats.aiCapex.sources, ...stats.cancerFunding.sources].map((s) => `${s.publisher} ${s.url}`).join(" · ")}
Full list: https://${site.domain}/`;

// --- render ---------------------------------------------------------------------------------

async function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      await access(c);
      return c;
    } catch {}
  }
  throw new Error("No Chrome, Chromium or Edge found. Install one or set CHROME_PATH.");
}

const chrome = await findChrome();
const tmp = await mkdtemp(path.join(os.tmpdir(), "hwcy-social-"));
const profile = path.join(tmp, "profile"); // throwaway profile: never touches your own browser

async function shoot(html, file, w, h) {
  const src = path.join(tmp, `${path.basename(file, ".png")}.html`);
  await writeFile(src, html);
  await run(chrome, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    `--user-data-dir=${profile}`,
    "--force-device-scale-factor=1",
    `--window-size=${w},${h}`,
    "--virtual-time-budget=2000",
    `--screenshot=${file}`,
    `file://${src}`,
  ]);
}

await rm(outDir, { recursive: true, force: true });
await mkdir(path.join(outDir, "carousel"), { recursive: true });

for (const [i, html] of carousel.entries()) {
  await shoot(html, path.join(outDir, "carousel", `${String(i + 1).padStart(2, "0")}-${slides[i].name}.png`), 1080, 1350);
}
await shoot(story, path.join(outDir, "story.png"), 1080, 1920);
await shoot(reelCover, path.join(outDir, "reel-cover.png"), 1080, 1920);
await writeFile(path.join(outDir, "caption.txt"), `${caption}\n`);
await writeFile(path.join(outDir, "first-comment.txt"), `${sourcesComment}\n`);
await rm(tmp, { recursive: true, force: true });

console.log(`Rendered ${carousel.length} carousel slides, a Story and a Reel cover to ${path.relative(process.cwd(), outDir) || outDir}`);
