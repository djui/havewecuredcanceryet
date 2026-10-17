#!/usr/bin/env bash
# Points havewecuredcanceryet.org at GitHub Pages using Gandi's LiveDNS API.
#
#   ./scripts/gandi-dns.sh                      # asks for the token, shows the plan, asks before changing anything
#   GH_CHALLENGE=abc123 ./scripts/gandi-dns.sh  # also adds GitHub's domain-verification TXT record
#
# Token: a Gandi personal access token (admin.gandi.net → Account → Authentication options →
# Personal Access Tokens) restricted to this domain, with "Manage domain technical configurations".
# It's read from the prompt (not your shell history) unless GANDI_TOKEN is already set.
# Mail records (MX, SPF, …) are left alone.
set -euo pipefail

DOMAIN="${DOMAIN:-havewecuredcanceryet.org}"
GH_USER="${GH_USER:-djui}"
GH_CHALLENGE="${GH_CHALLENGE:-}"
TTL=300
API="https://api.gandi.net/v5/livedns/domains/${DOMAIN}/records"

PAGES_A='["185.199.108.153","185.199.109.153","185.199.110.153","185.199.111.153"]'
PAGES_AAAA='["2606:50c0:8000::153","2606:50c0:8001::153","2606:50c0:8002::153","2606:50c0:8003::153"]'
WWW_CNAME="[\"${GH_USER}.github.io.\"]"

if [[ -z "${GANDI_TOKEN:-}" ]]; then
  read -rsp "Gandi personal access token: " GANDI_TOKEN
  echo
fi
[[ -n "$GANDI_TOKEN" ]] || { echo "No token given." >&2; exit 1; }

gandi() { # method path [json]
  local args=(-sS --fail-with-body -X "$1" -H "Authorization: Bearer ${GANDI_TOKEN}" -H "Content-Type: application/json")
  [[ $# -ge 3 ]] && args+=(-d "$3")
  curl "${args[@]}" "${API}$2"
}
pretty() { if command -v jq >/dev/null; then jq -r '.[] | "  \(.rrset_name)\t\(.rrset_type)\t\(.rrset_values | join(" "))"'; else cat; echo; fi; }
types_at() { gandi GET "/$1" | { if command -v jq >/dev/null; then jq -r '.[].rrset_type'; else grep -o '"rrset_type": *"[A-Z]*"' | grep -o '[A-Z]*"$' | tr -d '"'; fi; }; }

echo "Current records for ${DOMAIN} at @ and www:"
{ gandi GET "/@"; } | pretty
{ gandi GET "/www" 2>/dev/null || echo '[]'; } | pretty

# Records that would clash with the new ones (e.g. Gandi's default web-redirect).
conflicts=()
for t in $(types_at "@"); do [[ "$t" =~ ^(ALIAS|CNAME)$ ]] && conflicts+=("@ $t"); done
for t in $( (types_at "www" 2>/dev/null) || true); do [[ "$t" != "CNAME" ]] && conflicts+=("www $t"); done

cat <<EOF

Plan:
  @    A      185.199.108-111.153 (GitHub Pages)
  @    AAAA   2606:50c0:8000-8003::153 (GitHub Pages)
  www  CNAME  ${GH_USER}.github.io.
EOF
[[ -n "$GH_CHALLENGE" ]] && echo "  _github-pages-challenge-${GH_USER}  TXT  \"${GH_CHALLENGE}\""
for c in "${conflicts[@]+"${conflicts[@]}"}"; do echo "  delete $c"; done
echo

read -rp "Apply these changes? [y/N] " ok
[[ "$ok" =~ ^[Yy]$ ]] || { echo "Nothing changed."; exit 0; }

for c in "${conflicts[@]+"${conflicts[@]}"}"; do
  read -r name type <<<"$c"
  gandi DELETE "/${name}/${type}" >/dev/null && echo "deleted $name $type"
done
gandi PUT "/@/A"       "{\"rrset_values\":${PAGES_A},\"rrset_ttl\":${TTL}}" >/dev/null && echo "set @ A"
gandi PUT "/@/AAAA"    "{\"rrset_values\":${PAGES_AAAA},\"rrset_ttl\":${TTL}}" >/dev/null && echo "set @ AAAA"
gandi PUT "/www/CNAME" "{\"rrset_values\":${WWW_CNAME},\"rrset_ttl\":${TTL}}" >/dev/null && echo "set www CNAME"
if [[ -n "$GH_CHALLENGE" ]]; then
  gandi PUT "/_github-pages-challenge-${GH_USER}/TXT" "{\"rrset_values\":[\"\\\"${GH_CHALLENGE}\\\"\"],\"rrset_ttl\":${TTL}}" >/dev/null \
    && echo "set _github-pages-challenge-${GH_USER} TXT"
fi

echo
echo "Done. Check with: dig +short ${DOMAIN} && dig +short www.${DOMAIN}"
echo "Then enforce HTTPS once GitHub has issued the certificate (see README)."
