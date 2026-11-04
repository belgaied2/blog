#!/bin/sh
# Refresh the cached Sessionize profile used by the /speaking/ page.
#
#   scripts/refresh-sessionize.sh
#
# The API is cached in data/sessionize.json rather than fetched at build time,
# so a Sessionize outage cannot block a deploy and every change is reviewable
# in the pull request diff.
set -eu

url="https://sessionize.com/api/speaker/json/35pdct2euy"
out="data/sessionize.json"
tmp="$(mktemp)"

curl -fsS --max-time 20 "$url" -o "$tmp"
python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$tmp"
python3 -m json.tool "$tmp" > "$out"
rm -f "$tmp"
echo "wrote $out"
