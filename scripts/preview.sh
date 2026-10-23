#!/bin/sh
# Build a preview of the site and publish it to the staging host.
#
#   scripts/preview.sh 123
#
# Serves the result at https://blog.belgai.de/preview/123/ (noindex, inherited
# from the staging host). Run it from the branch that implements the change.
set -eu

id="${1:?usage: preview.sh <id>}"
base="https://blog.belgai.de/preview/${id}/"
out="/tmp/preview-${id}"

rm -rf "$out"
hugo --minify --baseURL "$base" --destination "$out"

rsync -az --delete "$out/" "root@ionos1:/var/www/previews/${id}/"

echo "$base"
