// Newsroom page: starts the "find-misuse" workflow and lists its pull requests.
// Talks only to api.github.com. The token stays in this browser (and only if "Remember" is ticked).

const repo = document.body.dataset.repo;
const workflow = "find-misuse.yml";
const api = `https://api.github.com/repos/${repo}`;
const storeKey = "hwcy:gh-token";
const $ = (id) => document.getElementById(id);

const store = {
  get: () => { try { return localStorage.getItem(storeKey) ?? ""; } catch { return ""; } },
  set: (v) => { try { localStorage.setItem(storeKey, v); } catch {} },
  clear: () => { try { localStorage.removeItem(storeKey); } catch {} },
};

const tokenInput = $("token");
const remember = $("remember");
tokenInput.value = store.get();
remember.checked = Boolean(tokenInput.value);

function status(text, isError = false) {
  $("status").textContent = text;
  $("status").classList.toggle("error", isError);
}

async function gh(path, init = {}) {
  const token = tokenInput.value.trim();
  const headers = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...init.headers };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${api}${path}`, { ...init, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`${res.status} ${body.message ?? res.statusText}`);
  }
  return res.status === 204 ? null : res.json();
}

const ago = (iso) => {
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
};

function renderList(el, items, empty) {
  el.replaceChildren();
  if (!items.length) {
    const li = document.createElement("li");
    li.className = "small";
    li.textContent = empty;
    el.append(li);
    return;
  }
  for (const { href, text, detail } of items) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = href;
    a.rel = "noopener";
    a.textContent = text;
    const small = document.createElement("span");
    small.className = "small";
    small.textContent = detail;
    li.append(a, small);
    el.append(li);
  }
}

async function refresh() {
  try {
    const prs = await gh("/pulls?state=open&per_page=30");
    renderList(
      $("prs"),
      prs
        .filter((pr) => pr.labels.some((l) => l.name === "misuse-candidate"))
        .map((pr) => ({ href: pr.html_url, text: pr.title, detail: `#${pr.number} · opened ${ago(pr.created_at)}` })),
      "Nothing waiting. Either the world behaved, or nobody looked yet.",
    );
  } catch (err) {
    renderList($("prs"), [], `Couldn't load pull requests: ${err.message}`);
  }
  try {
    const { workflow_runs: runs } = await gh(`/actions/workflows/${workflow}/runs?per_page=6`);
    renderList(
      $("runs"),
      runs.map((r) => ({
        href: r.html_url,
        text: `${r.event === "schedule" ? "Daily search" : "Manual search"} · ${r.status === "completed" ? r.conclusion : r.status.replace("_", " ")}`,
        detail: ago(r.created_at),
      })),
      "No searches yet.",
    );
  } catch (err) {
    renderList($("runs"), [], `Couldn't load searches: ${err.message}`);
  }
}

$("run").addEventListener("click", async () => {
  const token = tokenInput.value.trim();
  if (!token) return status("Paste a GitHub token first.", true);
  if (remember.checked) store.set(token); else store.clear();
  $("run").disabled = true;
  status("Starting…");
  try {
    await gh(`/actions/workflows/${workflow}/dispatches`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref: "main", inputs: { hint: $("hint").value.trim() } }),
    });
    status("Started. A pull request appears below in a few minutes if anything new turns up.");
    setTimeout(refresh, 4000);
  } catch (err) {
    status(`Couldn't start the search: ${err.message}`, true);
  } finally {
    $("run").disabled = false;
  }
});

remember.addEventListener("change", () => (remember.checked ? store.set(tokenInput.value.trim()) : store.clear()));
$("forget").addEventListener("click", () => {
  store.clear();
  tokenInput.value = "";
  remember.checked = false;
  status("Token forgotten on this device.");
});

refresh();
setInterval(refresh, 60000);
