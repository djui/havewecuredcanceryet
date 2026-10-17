// Asks Claude (with web search) for new "misuse" entries, checks them, and adds
// them to data/entries.json. The workflow then opens a pull request for a human
// to approve. Writes the PR body and step outputs for the workflow.
//
// Env: ANTHROPIC_API_KEY (required), HINT (optional), GITHUB_TOKEN + GITHUB_REPOSITORY
// (optional, to skip candidates already waiting in open pull requests).
import Anthropic from "@anthropic-ai/sdk";
import { readFile, writeFile, appendFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const MODEL = "claude-sonnet-5-5";
const MAX_SEARCHES = 8;
const MAX_FETCHES = 6;
const MAX_CANDIDATES = 3;
const MAX_TURNS = 6; // includes resumed server-tool turns (pause_turn)
const MAX_NUDGES = 2; // "please submit now" reminders when the model stops without submitting
const ENTRIES = "data/entries.json";

const today = new Date().toISOString().slice(0, 10);
const hint = (process.env.HINT ?? "").trim().slice(0, 500);
const entries = JSON.parse(await readFile(ENTRIES, "utf8"));

// --- what we already have -------------------------------------------------------

const normUrl = (u) => {
  try {
    const x = new URL(u);
    return `${x.hostname.replace(/^www\./, "")}${x.pathname.replace(/\/$/, "")}`.toLowerCase();
  } catch {
    return String(u).toLowerCase();
  }
};
const normTitle = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

async function pendingCandidates() {
  const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repo } = process.env;
  if (!repo) return [];
  const res = await fetch(`https://api.github.com/repos/${repo}/pulls?state=open&per_page=50`, {
    headers: { Accept: "application/vnd.github+json", ...(token && { Authorization: `Bearer ${token}` }) },
  });
  if (!res.ok) return [];
  const prs = await res.json();
  return prs.flatMap((pr) => {
    const m = /<!-- candidates: (.*?) -->/s.exec(pr.body ?? "");
    try {
      return m ? JSON.parse(m[1]) : [];
    } catch {
      return [];
    }
  });
}

const pending = await pendingCandidates();
const known = [...entries.map((e) => ({ title: e.title, who: e.who, urls: e.sources.map((s) => s.url) })), ...pending];
const knownUrls = new Set(known.flatMap((k) => k.urls.map(normUrl)));
const knownTitles = new Set(known.map((k) => normTitle(k.title)));

// --- the request ----------------------------------------------------------------------

const SYSTEM = `You research entries for havewecuredcanceryet.org, a deadpan, facts-first website. Its message: AI is powerful and not the enemy, but we keep pointing it, and the money and talent behind it, at frivolous things while cancer still kills about 10 million people a year. The site is not anti-AI; it also celebrates AI that genuinely helps against cancer.

Your job: find new, real, recent examples of AI talent, compute or capital spent on frivolous or absurd things, and submit them with the submit_candidates tool.

What qualifies ("frivolous, not harmful"):
- AI products or features that are trivial, absurd or wasteful: AI in toothbrushes, fridges, mattresses or pet collars; companion and girlfriend bots; feeds of AI-generated slop video; AI gadgets that flopped; huge funding rounds or acquisitions for trivial products; AI spectacles and stunts.
- tag "same-money": not AI itself, but vanity tech funded by the same AI billionaires or AI capital (e.g. a hypercar with rocket thrusters from the CEO of an AI company).

What does NOT qualify:
- Harmful uses: deepfake abuse, scams, surveillance, weapons, harm to minors, election manipulation. Those change the message from "priorities" to "AI is dangerous". Skip them.
- Serious or useful AI work, even if commercial.
- Rumours, unreleased concepts without a public announcement, satire, or anything you cannot back with a reputable source.
- Anything already on the site (listed below).

Rules for each candidate:
- Prefer things announced or launched in the last 45 days; never older than 18 months unless the editor's hint asks for it.
- "date" is the launch or announcement date (YYYY-MM-DD) as reported by the source.
- "what": 1-2 neutral, factual sentences, at most 240 characters. Nothing that isn't in the sources.
- "quip": one deadpan line of opinion about the thing, at most 140 characters. Dry, not mean. No insults, no claims about people's motives, no new facts.
- "cost": a publicly reported money figure with context (price, funding raised, amount spent), or an empty string if none is reported.
- "sources": 1-3 reputable sources (established news outlets or the company's own announcement) whose URLs you actually saw in search results or fetched. Never construct or guess a URL.
- "who": the company; add a person only if they are central to the story.

Submit between 0 and ${MAX_CANDIDATES} candidates, best first. Quality over quantity: an empty list is a fine answer on a slow news day. Finish by calling submit_candidates exactly once.`;

const SUBMIT_TOOL = {
  name: "submit_candidates",
  description: "Submit the final list of new misuse candidates (possibly empty). Call exactly once, at the end.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["notes", "candidates"],
    properties: {
      notes: {
        type: "string",
        description: "2-4 sentences for the editor: what you searched for, what you considered, and why these qualify or why nothing did.",
      },
      candidates: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["date", "title", "who", "tag", "what", "quip", "cost", "sources"],
          properties: {
            date: { type: "string", description: "YYYY-MM-DD launch or announcement date" },
            title: { type: "string" },
            who: { type: "string" },
            tag: { type: "string", enum: ["ai", "same-money"] },
            what: { type: "string" },
            quip: { type: "string" },
            cost: { type: "string", description: "Reported money figure with context, or empty string" },
            sources: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["publisher", "title", "url"],
                properties: {
                  publisher: { type: "string" },
                  title: { type: "string" },
                  url: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
  },
};

const alreadyListed = known.map((k) => `- ${k.title} (${k.who})`).join("\n");
const userPrompt = `Today is ${today}.

Already on the site or waiting for review (do not submit these again):
${alreadyListed || "- (nothing yet)"}

${hint ? `Editor's hint, treat it as a lead to check, not as a fact: <hint>${hint}</hint>` : "No hint today: find whatever is newest."}

Search the news, verify, and call submit_candidates.`;

const client = new Anthropic();
const messages = [{ role: "user", content: userPrompt }];
const usage = { input: 0, output: 0, searches: 0 };
let submitted = null;
let editorNotes = "";
let outcome = "never submitted";
let lastText = "";
let nudges = 0;

for (let turn = 0; turn < MAX_TURNS && !submitted; turn++) {
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium" },
    system: SYSTEM,
    tools: [
      { type: "web_search_20260209", name: "web_search", max_uses: MAX_SEARCHES },
      { type: "web_fetch_20260209", name: "web_fetch", max_uses: MAX_FETCHES },
      SUBMIT_TOOL,
    ],
    messages,
  });

  usage.input += response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0);
  usage.output += response.usage.output_tokens;
  usage.searches += response.usage.server_tool_use?.web_search_requests ?? 0;

  const call = response.content.find((b) => b.type === "tool_use" && b.name === "submit_candidates");
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join(" ").trim();
  if (text) lastText = text;
  console.log(`Turn ${turn + 1}: stop=${response.stop_reason}, searches so far=${usage.searches}, submitted=${Boolean(call)}`);

  if (response.stop_reason === "refusal") {
    outcome = `declined (${response.stop_details?.category ?? "no category"})`;
    break;
  }

  if (call) {
    submitted = call.input.candidates;
    editorNotes = call.input.notes ?? "";
    outcome = `submitted ${submitted.length} candidate${submitted.length === 1 ? "" : "s"}`;
    break;
  }

  messages.push({ role: "assistant", content: response.content });
  if (response.stop_reason === "pause_turn") continue;
  if (++nudges > MAX_NUDGES) break;
  messages.push({ role: "user", content: "Please finish now: call submit_candidates with your final list (it may be empty)." });
}

console.log(`Usage: ${usage.input} input tokens, ${usage.output} output tokens, ${usage.searches} searches.`);

// --- check what came back ---------------------------------------------------------------

async function checkUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return "bad";
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; havewecuredcanceryet.org link check)" },
    });
    if (res.ok) return "ok";
    // Many news sites block bots; a human can still open these.
    if ([401, 403, 429, 451].includes(res.status)) return "blocked";
    return "bad";
  } catch {
    return "bad";
  }
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
const ids = new Set(entries.map((e) => e.id));
const accepted = [];
const rejected = [];

for (const c of (submitted ?? []).slice(0, MAX_CANDIDATES)) {
  const why = [];
  const d = new Date(`${c.date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.date) || Number.isNaN(d.getTime())) why.push("invalid date");
  else if (c.date > today) why.push("date in the future");
  if (!c.title?.trim() || !c.who?.trim() || !c.what?.trim() || !c.quip?.trim()) why.push("missing text");
  if (c.what?.length > 280 || c.quip?.length > 170) why.push("text too long");
  if (knownTitles.has(normTitle(c.title)) || c.sources.some((s) => knownUrls.has(normUrl(s.url)))) why.push("already listed");

  const sources = [];
  const notes = [];
  for (const s of c.sources.slice(0, 3)) {
    const state = await checkUrl(s.url);
    if (state === "bad") notes.push(`dropped unreachable source ${s.url}`);
    else {
      sources.push({ publisher: s.publisher, title: s.title, url: s.url });
      if (state === "blocked") notes.push(`${s.publisher} blocks link checkers; open it yourself`);
    }
  }
  if (!sources.length) why.push("no reachable source");

  if (why.length) {
    rejected.push({ title: c.title, why });
    continue;
  }

  let id = slug(`${c.date.slice(0, 7)}-${c.title}`);
  while (ids.has(id)) id = `${id}-x`;
  ids.add(id);

  const ageDays = Math.round((Date.now() - d.getTime()) / 86400000);
  if (ageDays > 60) notes.push(`${ageDays} days old`);

  const entry = { id, date: c.date, title: c.title.trim(), who: c.who.trim(), tag: c.tag, what: c.what.trim(), quip: c.quip.trim() };
  if (c.cost?.trim()) entry.cost = c.cost.trim();
  entry.sources = sources;
  entry.added = today;
  accepted.push({ entry, notes });
}

// --- write results -------------------------------------------------------------------------

const outputs = { count: String(accepted.length), title: "" };

if (accepted.length) {
  const next = [...accepted.map((a) => a.entry), ...entries].sort((a, b) => b.date.localeCompare(a.date));
  await writeFile(ENTRIES, `${JSON.stringify(next, null, 2)}\n`);

  const names = accepted.map((a) => a.entry.title);
  outputs.title = `Misuse: ${names.join(", ")}`.slice(0, 120);

  const body = [
    `${accepted.length} new candidate${accepted.length > 1 ? "s" : ""} found ${hint ? `with the hint "${hint.replace(/[<>]/g, "")}"` : "by the daily search"}.`,
    "",
    "**Merge** to publish, **close** to discard. You can edit the wording in this pull request before merging (Files changed → edit `data/entries.json`).",
    "",
    ...(editorNotes ? [`**Searcher's notes:** ${editorNotes}`, ""] : []),
    ...accepted.flatMap(({ entry: e, notes }) => [
      `### ${e.title}`,
      `${e.who} · ${e.date} · ${e.tag === "same-money" ? "Same money, different toy" : "AI"}${e.cost ? ` · ${e.cost}` : ""}`,
      "",
      `> ${e.what}`,
      ">",
      `> *— ${e.quip}*`,
      "",
      ...e.sources.map((s) => `- [${s.publisher}: ${s.title}](${s.url})`),
      ...(notes.length ? ["", `⚠️ ${notes.join("; ")}`] : []),
      "",
    ]),
    ...(rejected.length ? ["<details><summary>Rejected automatically</summary>", "", ...rejected.map((r) => `- ${r.title}: ${r.why.join(", ")}`), "", "</details>", ""] : []),
    `<sub>${MODEL}, ${usage.searches} searches, ${usage.input} input / ${usage.output} output tokens.</sub>`,
    "",
    `<!-- candidates: ${JSON.stringify(accepted.map(({ entry: e }) => ({ title: e.title, who: e.who, urls: e.sources.map((s) => s.url) }))).replace(/--/g, "- -")} -->`,
  ].join("\n");

  await writeFile(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), "pr-body.md"), body);
}

for (const r of rejected) console.log(`Rejected "${r.title}": ${r.why.join(", ")}`);
const neverSubmitted = submitted === null && !outcome.startsWith("declined");
const verdict = accepted.length
  ? `Added ${accepted.length}: ${accepted.map((a) => a.entry.title).join(" | ")}`
  : neverSubmitted
    ? "Problem: the model never returned a list, so this run can't say whether anything new exists."
    : outcome.startsWith("declined")
      ? `The model ${outcome}; no candidates.`
      : submitted.length
        ? "The model suggested candidates, but all were rejected by the checks above."
        : "The model searched and found nothing new that qualifies.";
console.log(`Outcome: ${outcome}.`);
if (editorNotes) console.log(`Searcher's notes: ${editorNotes}`);
if (neverSubmitted && lastText) console.log(`Model's last words: ${lastText.slice(0, 600)}`);
console.log(verdict);

// Shown at the top of the run's page on GitHub, so nobody has to read the log.
if (process.env.GITHUB_STEP_SUMMARY) {
  const summary = [
    `### ${accepted.length ? "New candidates: pull request opened" : neverSubmitted ? "⚠️ Search didn't finish properly" : "Nothing new"}`,
    "",
    verdict,
    "",
    hint ? `**Hint:** ${hint}` : "**Hint:** none (daily search)",
    `**Model:** ${outcome} · ${usage.searches} searches · ${usage.input} input / ${usage.output} output tokens`,
    ...(editorNotes ? ["", `**Searcher's notes:** ${editorNotes}`] : []),
    ...(rejected.length ? ["", "**Rejected:**", ...rejected.map((r) => `- ${r.title}: ${r.why.join(", ")}`)] : []),
    ...(neverSubmitted && lastText ? ["", `**Model's last words:** ${lastText.slice(0, 600)}`] : []),
    "",
  ].join("\n");
  await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
}
if (neverSubmitted) process.exitCode = 1;

if (process.env.GITHUB_OUTPUT) {
  const title = outputs.title.replace(/[\r\n]/g, " ");
  await appendFile(process.env.GITHUB_OUTPUT, `count=${outputs.count}\ntitle=${title}\n`);
}
