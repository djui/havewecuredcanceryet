// Renders the static site into dist/ from the JSON files in data/.
// No dependencies: runs on plain Node in the GitHub Pages workflow.
import { readFile, writeFile, mkdir, cp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "dist");
const readJson = async (file) => JSON.parse(await readFile(path.join(root, "data", file), "utf8"));

const site = await readJson("site.json");
const entries = (await readJson("entries.json")).sort((a, b) => b.date.localeCompare(a.date));
const good = (await readJson("good.json")).sort((a, b) => b.date.localeCompare(a.date));
const stats = await readJson("stats.json");
const help = await readJson("help.json");

const url = `https://${site.domain}/`;
const buildDate = new Date().toISOString().slice(0, 10);

// --- formatting -------------------------------------------------------------

const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const fmtDate = (iso, opts = { day: "numeric", month: "short", year: "numeric" }) =>
  new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

const oneDecimal = (n) => (n < 10 ? n.toFixed(1).replace(/\.0$/, "") : Math.round(n).toString());
const twoDecimals = (n) => (n < 10 ? n.toFixed(2).replace(/\.?0+$/, "") : Math.round(n).toString());

function money(v) {
  if (v >= 1e12) return `$${twoDecimals(v / 1e12)} trillion`;
  if (v >= 1e9) return `$${twoDecimals(v / 1e9)} billion`;
  if (v >= 1e6) return `$${twoDecimals(v / 1e6)} million`;
  return `$${v.toLocaleString("en-US")}`;
}

const people = (v) => (v >= 1e6 ? `${oneDecimal(v / 1e6)} million` : v.toLocaleString("en-US"));

// --- footnotes for the headline numbers ------------------------------------

const notes = [];
function cite(sources = []) {
  const refs = sources.map((s) => {
    let n = notes.findIndex((x) => x.url === s.url) + 1;
    if (!n) n = notes.push(s);
    return `<a href="#note-${n}">${n}</a>`;
  });
  return refs.length ? `<sup class="cite">${refs.join(",")}</sup>` : "";
}

const sourceLinks = (sources) =>
  sources
    .map((s) => `<a href="${esc(s.url)}" title="${esc(s.title)}" rel="noopener">${esc(s.publisher)}</a>`)
    .join(", ");

// --- sections ---------------------------------------------------------------

const ratio = Math.round(stats.aiCapex.value / stats.cancerFunding.value);
const perDay = Math.round(stats.deaths.value / 365 / 100) * 100;
const barWidth = Math.max((stats.cancerFunding.value / stats.aiCapex.value) * 1000, 2);

const hero = `
<section class="hero" aria-labelledby="question">
  <p class="kicker">A simple question</p>
  <h1 id="question">Have we cured cancer yet?</h1>
  <p class="answer">No<span class="dot"><span>.</span></span></p>
  <p class="answer-note">
    ${esc(stats.curable.text)}${cite(stats.curable.sources)}
    ${esc(stats.aiCured.text)}${cite(stats.aiCured.sources)}
  </p>
</section>`;

const ledger = `
<section class="ledger" aria-labelledby="ledger-title">
  <h2 id="ledger-title" class="section-kicker">The ledger</h2>
  <div class="figures">
    <div class="figure">
      <p class="figure-value">${people(stats.deaths.value)}</p>
      <p class="figure-label">${esc(stats.deaths.label)}${cite(stats.deaths.sources)}<br>About ${perDay.toLocaleString("en-US")} people a day.</p>
    </div>
    <div class="figure">
      <p class="figure-value">${money(stats.aiCapex.value)}</p>
      <p class="figure-label">${esc(stats.aiCapex.label)}${cite(stats.aiCapex.sources)}</p>
    </div>
    <div class="figure">
      <p class="figure-value">${money(stats.cancerFunding.value)}</p>
      <p class="figure-label">${esc(stats.cancerFunding.label)}${cite(stats.cancerFunding.sources)}</p>
    </div>
  </div>
  <figure class="bars">
    <figcaption>One year of Big Tech&rsquo;s AI build-out versus one year of the world&rsquo;s biggest cancer research budget. <strong>Drawn to scale.</strong></figcaption>
    <div class="bar-row">
      <span class="bar-label">${esc(stats.aiCapex.short ?? stats.aiCapex.label)}</span>
      <svg class="bar" viewBox="0 0 1000 28" preserveAspectRatio="none" aria-hidden="true"><rect class="bar-ai" width="1000" height="28"/></svg>
      <span class="bar-value">${money(stats.aiCapex.value)}</span>
    </div>
    <div class="bar-row">
      <span class="bar-label">${esc(stats.cancerFunding.short ?? stats.cancerFunding.label)}</span>
      <svg class="bar" viewBox="0 0 1000 28" preserveAspectRatio="none" aria-hidden="true"><rect class="bar-cancer" width="${barWidth.toFixed(1)}" height="28"/></svg>
      <span class="bar-value">${money(stats.cancerFunding.value)}</span>
    </div>
    <p class="ratio">That's roughly <strong>${ratio}&times;</strong>. The red line is not a rendering error.</p>
  </figure>
</section>`;

function entryCard(e, i) {
  const tag = e.tag === "same-money" ? `<span class="tag tag-money">Same money, different toy</span>` : `<span class="tag">AI</span>`;
  return `
    <li class="entry${i === 0 ? " lead" : ""}" id="${esc(e.id)}">
      <article>
        <div class="entry-head">
          <p class="meta"><time datetime="${esc(e.date)}">${fmtDate(e.date)}</time>${tag}</p>
          <h3><a href="#${esc(e.id)}">${esc(e.title)}</a></h3>
          <p class="who">${esc(e.who)}</p>
        </div>
        <div class="entry-body">
          <p class="what">${esc(e.what)}</p>
          ${e.cost ? `<p class="cost">${esc(e.cost)}</p>` : ""}
          <p class="quip">${esc(e.quip)}</p>
          <p class="sources">Source${e.sources.length > 1 ? "s" : ""}: ${sourceLinks(e.sources)}</p>
        </div>
      </article>
    </li>`;
}

const feed = `
<section class="feed" id="feed" aria-labelledby="feed-title">
  <h2 id="feed-title">Meanwhile, here&rsquo;s what we pointed AI at instead.</h2>
  <p class="dek">A running log of the most powerful technology of our time, applied with great care to the wrong problems. Every entry is sourced. Newest first.</p>
  <ol class="entries">${entries.map(entryCard).join("")}
  </ol>
</section>`;

const goodSection = `
<section class="good" id="good" aria-labelledby="good-title">
  <h2 id="good-title">It&rsquo;s not the tool. It&rsquo;s the aim.</h2>
  <p class="dek">This is not an anti-AI site. Pointed at the right problem, AI already helps. We would simply like a lot more of this.</p>
  <ul class="good-list">${good
    .map(
      (g) => `
    <li class="good-item" id="${esc(g.id)}">
      <p class="meta"><time datetime="${esc(g.date)}">${fmtDate(g.date)}</time><span class="tag tag-good">Good aim</span></p>
      <h3>${esc(g.title)}</h3>
      <p class="who">${esc(g.who)}</p>
      <p class="what">${esc(g.what)}</p>
      <p class="why">${esc(g.why)}</p>
      <p class="sources">Source${g.sources.length > 1 ? "s" : ""}: ${sourceLinks(g.sources)}</p>
    </li>`,
    )
    .join("")}
  </ul>
</section>`;

const shareText = "Have we cured cancer yet? No. Here's what we pointed AI at instead:";
const enc = encodeURIComponent;
const act = `
<section class="act" id="act" aria-labelledby="act-title">
  <h2 id="act-title">What you can do</h2>
  <div class="act-grid">
    <div>
      <h3>Pass it on</h3>
      <p>The people deciding where AI goes read the same feeds you do.</p>
      <ul class="share">
        <li><button type="button" class="share-native" hidden>Share&hellip;</button></li>
        <li><button type="button" class="copy-link" data-url="${esc(url)}">Copy link</button></li>
        <li><a href="https://bsky.app/intent/compose?text=${enc(`${shareText} ${url}`)}" rel="noopener">Bluesky</a></li>
        <li><a href="https://x.com/intent/post?text=${enc(shareText)}&amp;url=${enc(url)}" rel="noopener">X</a></li>
        <li><a href="https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}" rel="noopener">LinkedIn</a></li>
        <li><a href="mailto:?subject=${enc("Have we cured cancer yet?")}&amp;body=${enc(`${shareText}\n${url}`)}">Email</a></li>
        <li><a href="/rss.xml">RSS feed</a></li>
      </ul>
    </div>
    <div>
      <h3>Point money at the problem</h3>
      <ul class="help-list">${help
        .map((h) => `
        <li><a href="${esc(h.url)}" rel="noopener">${esc(h.name)}</a> <span>${esc(h.what)}</span></li>`)
        .join("")}
      </ul>
    </div>
  </div>
</section>`;

const footer = `
<footer class="colophon">
  <p class="motto">Not anti-AI. Pro-aim.</p>
  <div class="colophon-grid">
    <div>
      <h2>How this page works</h2>
      <p>Every day an AI (Claude, by Anthropic) searches the news for new ways we&rsquo;ve found to spend AI on things that aren&rsquo;t cancer. A human checks every find before it goes up, and every claim links to its source. Yes, we see the irony. That&rsquo;s the point: it&rsquo;s a tool.</p>
      <p>Spotted one we missed, or got something wrong? <a href="https://github.com/${esc(site.repo)}/issues/new">Tell us on GitHub</a>.</p>
      ${site.goatcounter ? `<p>Visits are counted with GoatCounter. No cookies, no tracking.</p>` : ""}
    </div>
    <div>
      <h2>Notes</h2>
      <ol class="notes">${notes
        .map((n, i) => `
        <li id="note-${i + 1}">${esc(n.publisher)}: <a href="${esc(n.url)}" rel="noopener">${esc(n.title)}</a></li>`)
        .join("")}
      </ol>
      ${[stats.aiCapex.note, stats.cancerFunding.note].filter(Boolean).map((n) => `<p class="small">${esc(n)}</p>`).join("\n      ")}
    </div>
  </div>
  <p class="small">Built in the open at <a href="https://github.com/${esc(site.repo)}">github.com/${esc(site.repo)}</a>. Last updated ${fmtDate(buildDate)}.</p>
</footer>`;

// --- page shell -------------------------------------------------------------

const description = "A running, sourced log of what we point AI at instead of cancer. Not anti-AI. Pro-aim.";
const csp = [
  "default-src 'self'",
  `script-src 'self'${site.goatcounter ? " https://gc.zgo.at" : ""}`,
  `connect-src 'self'${site.goatcounter ? ` https://${site.goatcounter}.goatcounter.com` : ""}`,
  `img-src 'self' data:${site.goatcounter ? ` https://${site.goatcounter}.goatcounter.com` : ""}`,
  "style-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>Have we cured cancer yet? No.</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${url}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate" type="application/rss+xml" title="Have we cured cancer yet?" href="/rss.xml">
<meta name="color-scheme" content="light dark">
<meta property="og:type" content="website">
<meta property="og:url" content="${url}">
<meta property="og:title" content="Have we cured cancer yet? No.">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${url}og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="/styles.css">
<script src="/site.js" defer></script>
${site.goatcounter ? `<script data-goatcounter="https://${esc(site.goatcounter)}.goatcounter.com/count" async src="https://gc.zgo.at/count.js"></script>` : ""}
</head>
<body>
<header class="masthead">
  <span class="masthead-left">Est. 2026</span>
  <a class="masthead-name" href="/">havewecuredcanceryet.org</a>
  <span class="masthead-right">As of <time class="today" datetime="${buildDate}">${fmtDate(buildDate, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</time></span>
</header>
<main>
${hero}
${ledger}
${feed}
${goodSection}
${act}
</main>
${footer}
</body>
</html>
`;

// --- RSS ----------------------------------------------------------------------

const rfc822 = (iso) => new Date(`${iso}T12:00:00Z`).toUTCString();
const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>Have we cured cancer yet?</title>
  <link>${url}</link>
  <atom:link href="${url}rss.xml" rel="self" type="application/rss+xml"/>
  <description>${esc(description)}</description>
  <language>en</language>
  <lastBuildDate>${rfc822(buildDate)}</lastBuildDate>
${entries
  .slice(0, 50)
  .map(
    (e) => `  <item>
    <title>${esc(e.title)} (${esc(e.who)})</title>
    <link>${url}#${esc(e.id)}</link>
    <guid isPermaLink="false">${esc(e.id)}</guid>
    <pubDate>${rfc822(e.added || e.date)}</pubDate>
    <description>${esc(`${e.what} ${e.quip} Still no cure for cancer.`)}</description>
  </item>`,
  )
  .join("\n")}
</channel>
</rss>
`;

// --- write --------------------------------------------------------------------

const admin = (await readFile(path.join(root, "admin", "index.html"), "utf8")).replaceAll("{{REPO}}", esc(site.repo));
const notFound = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Not found</title><link rel="stylesheet" href="/styles.css"></head>
<body><main class="not-found"><p class="kicker">404</p><h1>This page doesn&rsquo;t exist.</h1><p>Neither does a cure. <a href="/">Back to the front page</a>.</p></main></body></html>
`;

await rm(out, { recursive: true, force: true });
await mkdir(path.join(out, "admin"), { recursive: true });
await cp(path.join(root, "public"), out, { recursive: true, filter: (src) => !src.endsWith("og.svg") });
await writeFile(path.join(out, "index.html"), page);
await writeFile(path.join(out, "rss.xml"), rss);
await writeFile(path.join(out, "404.html"), notFound);
await writeFile(path.join(out, "admin", "index.html"), admin);
await writeFile(path.join(out, "CNAME"), `${site.domain}\n`);

console.log(`Built dist/: ${entries.length} misuse entries, ${good.length} good ones, ${notes.length} notes.`);
