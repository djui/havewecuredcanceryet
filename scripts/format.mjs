// Shared formatting for the site build and the social slides.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const readJson = async (file) => JSON.parse(await readFile(path.join(root, "data", file), "utf8"));

export const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const fmtDate = (iso, opts = { day: "numeric", month: "short", year: "numeric" }) =>
  new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

const oneDecimal = (n) => (n < 10 ? n.toFixed(1).replace(/\.0$/, "") : Math.round(n).toString());
const twoDecimals = (n) => (n < 10 ? n.toFixed(2).replace(/\.?0+$/, "") : Math.round(n).toString());

export function money(v) {
  if (v >= 1e12) return `$${twoDecimals(v / 1e12)} trillion`;
  if (v >= 1e9) return `$${twoDecimals(v / 1e9)} billion`;
  if (v >= 1e6) return `$${twoDecimals(v / 1e6)} million`;
  return `$${v.toLocaleString("en-US")}`;
}

export const people = (v) => (v >= 1e6 ? `${oneDecimal(v / 1e6)} million` : v.toLocaleString("en-US"));

export const byDateDesc = (a, b) => b.date.localeCompare(a.date);
