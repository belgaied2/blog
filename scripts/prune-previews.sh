#!/bin/sh
# Remove preview directories whose pull request is no longer open.
#
# Previews are published by scripts/preview.sh to /var/www/previews/<n>/.
# The repository is public, so the GitHub API answers without a token.
set -eu

repo="belgaied2/blog"
api="https://api.github.com/repos/${repo}/pulls?state=open&per_page=100"

resp=$(curl -fsS --max-time 10 "$api") || { echo "api unreachable, leaving previews alone"; exit 0; }

open=$(printf '%s' "$resp" | python3 -c '
import sys, json
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(2)
if not isinstance(data, list):
    sys.exit(2)
print(" ".join(str(p["number"]) for p in data))
') || { echo "api response not understood, leaving previews alone"; exit 1; }

[ -d /var/www/previews ] || exit 0

for dir in /var/www/previews/*/; do
    [ -d "$dir" ] || continue
    n=$(basename "$dir")
    case " $open " in
        *" $n "*) ;;
        *) echo "removing preview $n"; rm -rf "$dir" ;;
    esac
done
