#!/usr/bin/env bash
# Put a CSV into an environment's server inbox, so it can be imported from the app.
#
# Manual fallback. The CSV Intake page normally uploads straight to the bucket itself (signed form),
# because the load balancer's Cloud Armor policy blocks multipart CSV uploads (SQL injection rules
# 942430 and 942440 return 403). Use this if the page is unavailable. The app watches /data/inbox, which is the `inbox/` folder of the
# environment's mounted bucket.
#
# Usage:   ./infra/load-csv.sh test|prod path/to/orders.csv
# Then:    open CSV Intake -> "Server inbox" -> Import next to the file.
set -euo pipefail

ENV="${1:?usage: $0 test|prod path/to/file.csv}"
FILE="${2:?usage: $0 test|prod path/to/file.csv}"

case "$ENV" in test|prod) ;; *) echo "env must be test or prod" >&2; exit 1 ;; esac
[ -f "$FILE" ] || { echo "not a file: $FILE" >&2; exit 1; }
case "$(printf '%s' "$FILE" | tr '[:upper:]' '[:lower:]')" in *.csv) ;; *) echo "only .csv files are accepted" >&2; exit 1 ;; esac

PROJECT="ai0017287-dca-diet-coke-${ENV}"
NAME="$(basename "$FILE")"

# The bucket name carries a random suffix, so look it up.
BUCKET="$(gcloud storage buckets list --project="$PROJECT" --format='value(name)' | grep -E "^tccc-dca-${ENV}-bucket-mount-" | head -1)"
[ -n "$BUCKET" ] || { echo "mount bucket not found in $PROJECT" >&2; exit 1; }

# Do not silently replace a file that was already staged under the same name.
if gcloud storage ls "gs://${BUCKET}/inbox/${NAME}" --project="$PROJECT" >/dev/null 2>&1; then
  echo "gs://${BUCKET}/inbox/${NAME} already exists. Rename the file or remove the old one first." >&2
  exit 1
fi

gcloud storage cp "$FILE" "gs://${BUCKET}/inbox/${NAME}" --project="$PROJECT"
echo
echo "Loaded ${NAME} into the ${ENV} inbox. Import it from CSV Intake -> Server inbox."
