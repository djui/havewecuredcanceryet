# havewecuredcanceryet.org

**Have we cured cancer yet? No.** A running, sourced log of what we point AI at instead. Not anti-AI. Pro-aim.

## How it works

- `data/*.json` holds everything on the page: the misuse feed (`entries.json`), the good stuff (`good.json`), the headline numbers (`stats.json`), where to help (`help.json`) and site settings (`site.json`).
- `scripts/build.mjs` renders `dist/` (HTML, RSS, admin page). No dependencies.
- **Deploy:** every push to `main` validates the data, builds and publishes to GitHub Pages (`.github/workflows/deploy.yml`).
- **Finding new misuse:** `.github/workflows/find-misuse.yml` runs daily at 06:17 UTC, and on demand. It asks Claude Sonnet 5.5 (with up to 15 web searches) for up to 5 new, sourced entries, focusing on 3 of 12 rotating areas each day (gadgets, companions, AI slop, synthetic celebrities, AI ads, talent-war pay, no-product valuations, robots doing party tricks, billionaire vanity tech, …), checks the links, and opens a pull request labelled `misuse-candidate`. Each run's page on GitHub shows a summary with the model's notes. **Merge = publish. Close = discard.** You can edit wording in the PR before merging.
- **Asking on demand:** open `/admin/` on the site, paste a GitHub token once, optionally type a hint, press the button. Or use *Actions → Find latest misuse → Run workflow* on GitHub.

## One-time setup

1. **Anthropic API key** (the daily search runs on it):
   ```bash
   gh secret set ANTHROPIC_API_KEY --repo djui/havewecuredcanceryet
   ```
2. **Let Actions open pull requests:** repo *Settings → Actions → General → Workflow permissions* → "Allow GitHub Actions to create and approve pull requests" (the setup command below does this).
3. **Verify the domain with GitHub** (prevents takeovers): github.com/settings/pages → *Add a domain* → `havewecuredcanceryet.org`. Copy the TXT value it shows.
4. **DNS at Gandi:** create a Gandi personal access token limited to this domain with *Manage domain technical configurations*, then:
   ```bash
   GH_CHALLENGE=<value from step 3> ./scripts/gandi-dns.sh
   ```
   It shows the current records and the plan, and asks before changing anything. Mail records are left alone. Then press *Verify* on GitHub.
5. **HTTPS:** once DNS resolves and GitHub has issued the certificate (minutes to an hour):
   ```bash
   gh api -X PUT repos/djui/havewecuredcanceryet/pages -F https_enforced=true
   ```
6. **Admin token** for `/admin/`: a fine-grained token with *Only select repositories → havewecuredcanceryet* and *Actions: Read and write*. Nothing else.

## Local

```bash
npm install
node scripts/validate.mjs && node scripts/build.mjs
python3 -m http.server 4321 -d dist
ANTHROPIC_API_KEY=... HINT="optional lead" node scripts/find-misuse.mjs   # edits data/entries.json locally
```

`npm run og` re-renders `public/og.png` from `public/og.svg` (needs `rsvg-convert`).

## Notes

- GitHub pauses scheduled workflows in repos with no activity for 60 days. Merging a candidate counts as activity.
- Each search run prints its token and search usage in the Action log and the PR footer.
- Analytics: GoatCounter (`site.json → goatcounter`), cookie-free. Set it to `""` to turn it off.
