// Structural checks for data/*.json. Runs before every deploy and before a
// candidate pull request is opened. Exits non-zero with a list of problems.
import { readFile } from "node:fs/promises";

const problems = [];
const load = async (f) => {
  try {
    return JSON.parse(await readFile(`data/${f}`, "utf8"));
  } catch (err) {
    problems.push(`${f}: ${err.message}`);
    return null;
  }
};

const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const isText = (s, max) => typeof s === "string" && s.trim().length > 0 && (!max || s.length <= max);
const isUrl = (s) => {
  try {
    return ["https:", "http:"].includes(new URL(s).protocol);
  } catch {
    return false;
  }
};

function checkSources(where, sources) {
  if (!Array.isArray(sources) || sources.length === 0) return problems.push(`${where}: needs at least one source`);
  sources.forEach((s, i) => {
    if (!isText(s.publisher) || !isText(s.title) || !isUrl(s.url)) problems.push(`${where}: source ${i + 1} needs publisher, title and a valid url`);
  });
}

function checkList(file, list, { textFields, tags }) {
  if (!Array.isArray(list)) return problems.push(`${file}: must be an array`);
  const ids = new Set();
  list.forEach((e, i) => {
    const where = `${file}[${i}] ${e?.id ?? "(no id)"}`;
    if (!/^[a-z0-9][a-z0-9-]*$/.test(e.id ?? "")) problems.push(`${where}: id must be kebab-case`);
    if (ids.has(e.id)) problems.push(`${where}: duplicate id`);
    ids.add(e.id);
    if (!isDate(e.date)) problems.push(`${where}: date must be YYYY-MM-DD`);
    if (!isText(e.title, 120)) problems.push(`${where}: title missing or too long`);
    if (!isText(e.who, 120)) problems.push(`${where}: who missing or too long`);
    for (const [field, max] of Object.entries(textFields)) {
      if (!isText(e[field], max)) problems.push(`${where}: ${field} missing or longer than ${max}`);
    }
    if (tags && !tags.includes(e.tag)) problems.push(`${where}: tag must be one of ${tags.join(", ")}`);
    if ("cost" in e && !isText(e.cost, 160)) problems.push(`${where}: cost must be non-empty text when present`);
    if ("added" in e && !isDate(e.added)) problems.push(`${where}: added must be YYYY-MM-DD`);
    checkSources(where, e.sources);
  });
}

const [site, entries, good, stats, help] = await Promise.all(
  ["site.json", "entries.json", "good.json", "stats.json", "help.json"].map(load),
);

if (site && (!isText(site.domain) || !/^[\w.-]+\/[\w.-]+$/.test(site.repo ?? ""))) problems.push("site.json: needs domain and repo (owner/name)");
if (entries) checkList("entries.json", entries, { textFields: { what: 280, quip: 170 }, tags: ["ai", "same-money"] });
if (good) checkList("good.json", good, { textFields: { what: 280, why: 170 } });

if (stats) {
  for (const key of ["deaths", "newCases", "aiCapex", "cancerFunding"]) {
    const s = stats[key];
    if (!s || typeof s.value !== "number" || s.value <= 0 || !isText(s.label)) problems.push(`stats.json: ${key} needs a positive value and a label`);
    else checkSources(`stats.json ${key}`, s.sources);
  }
  for (const key of ["curable", "aiCured"]) {
    if (!isText(stats[key]?.text)) problems.push(`stats.json: ${key} needs text`);
    else checkSources(`stats.json ${key}`, stats[key].sources);
  }
}

if (help) {
  if (!Array.isArray(help) || help.length === 0) problems.push("help.json: must be a non-empty array");
  else help.forEach((h, i) => {
    if (!isText(h.name) || !isUrl(h.url) || !isText(h.what, 140)) problems.push(`help.json[${i}]: needs name, url and what (max 140)`);
  });
}

if (problems.length) {
  console.error(`Data problems:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log(`Data OK: ${entries.length} entries, ${good.length} good, ${help.length} places to help.`);
