#!/usr/bin/env bash
# Creates a campaign admin (or resets that admin's password) on a deployed environment.
#
# The campaign admin signs in at /user-campaign/admin/login with its own user ID and password. These
# accounts are separate from the PrintFlow (/offline-store) staff users; nothing here touches those.
#
# The database is on a private IP, so the account is created by a short-lived Cloud Run job that runs
# `python -m scripts.create_campaign_admin` from the API's own image, with the API's database secret.
# The password goes in through a temporary Secret Manager secret, never on a command line or in a job
# setting, and is stored only as a bcrypt hash. Both the job and the secret are deleted afterwards,
# whether the run succeeds or fails, so no copy of the password is left in GCP. It is printed once.
#
# Needs: `gcloud auth login` as someone who can use Cloud Run jobs and Secret Manager in the project.
#
#   infra/create-campaign-admin.sh                       # test project, user ID "campaign-admin", generated password
#   USER_ID=ankit infra/create-campaign-admin.sh         # a different user ID
#   CAMPAIGN_ADMIN_PASSWORD='...' infra/create-campaign-admin.sh   # choose the password (10+ characters)
#   DRY_RUN=1 infra/create-campaign-admin.sh             # print what would run, change nothing
#
# Running it again for the same user ID sets a new password and signs that admin out everywhere.
set -euo pipefail

PROJECT="${PROJECT:-ai0017287-dca-diet-coke-test}"
REGION="${REGION:-asia-northeast1}"
SERVICE="${SERVICE:-tccc-dca-test-cloudrun-backend}"     # the API service whose image and network the job copies
APP_URL="${APP_URL:-https://diet-coke-test.coke2home.com}"
USER_ID="$(printf '%s' "${USER_ID:-campaign-admin}" | tr '[:upper:]' '[:lower:]')"
SECRET="PRINTFLOW_CAMPAIGN_ADMIN_PASSWORD_BOOTSTRAP"
JOB="campaign-admin-bootstrap"
DRY_RUN="${DRY_RUN:-0}"

[[ -n "$USER_ID" && ${#USER_ID} -le 64 ]] || { echo "USER_ID must be 1 to 64 characters" >&2; exit 2; }

if [[ -n "${CAMPAIGN_ADMIN_PASSWORD:-}" ]]; then
  PASSWORD="$CAMPAIGN_ADMIN_PASSWORD"
else
  PASSWORD="$(python3 -c 'import secrets; print(secrets.token_urlsafe(18))')"
fi
[[ ${#PASSWORD} -ge 10 ]] || { echo "The password must be at least 10 characters" >&2; exit 2; }

g() {  # run gcloud (silently when Q=1), or just show it
  if [[ "$DRY_RUN" == "1" ]]; then
    printf 'DRY RUN: gcloud'; printf ' %q' "$@"; printf '\n'
  elif [[ "${Q:-}" == "1" ]]; then
    gcloud "$@" >/dev/null 2>&1
  else
    gcloud "$@"
  fi
}

echo "Project $PROJECT, region $REGION: campaign admin '$USER_ID'"

# 1. What the API service runs: its image, service account and VPC network (the job needs the same to reach the database).
if [[ "$DRY_RUN" == "1" ]]; then
  IMAGE="<image of $SERVICE>"; SA="<service account of $SERVICE>"; NETWORK_ARGS=(--network "<network>" --subnet "<subnet>" --vpc-egress all-traffic)
else
  SERVICE_JSON="$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format=json)"
  read -r IMAGE SA NET SUBNET EGRESS < <(printf '%s' "$SERVICE_JSON" | python3 -c '
import json, sys
d = json.load(sys.stdin)
t = d["spec"]["template"]
ann = t.get("metadata", {}).get("annotations", {})
ifaces = json.loads(ann.get("run.googleapis.com/network-interfaces", "[]"))
net = ifaces[0].get("network", "") if ifaces else ""
sub = ifaces[0].get("subnetwork", "") if ifaces else ""
print(t["spec"]["containers"][0]["image"], t["spec"].get("serviceAccountName", ""), net or "-", sub or "-", ann.get("run.googleapis.com/vpc-access-egress", "all-traffic"))
')
  [[ -n "$IMAGE" && -n "$SA" ]] || { echo "Could not read the image and service account of $SERVICE" >&2; exit 1; }
  NETWORK_ARGS=()
  if [[ "$NET" != "-" ]]; then NETWORK_ARGS=(--network "$NET" --subnet "$SUBNET" --vpc-egress "$EGRESS"); fi
  echo "Using image $IMAGE as $SA"
fi

cleanup() {  # the password must not outlive this run
  set +e
  echo "Cleaning up the temporary job and secret..."
  Q=1 g run jobs delete "$JOB" --project "$PROJECT" --region "$REGION" --quiet
  Q=1 g secrets delete "$SECRET" --project "$PROJECT" --quiet
}
trap cleanup EXIT

# 2. The password, in a temporary secret the job (and only the job's service account) can read.
if [[ "$DRY_RUN" == "1" ]]; then
  echo "DRY RUN: create secret $SECRET with the password on stdin; grant secretAccessor to the service account"
else
  gcloud secrets delete "$SECRET" --project "$PROJECT" --quiet >/dev/null 2>&1 || true
  printf '%s' "$PASSWORD" | gcloud secrets create "$SECRET" --project "$PROJECT" --replication-policy=automatic --data-file=- >/dev/null
  gcloud secrets add-iam-policy-binding "$SECRET" --project "$PROJECT" --member "serviceAccount:$SA" --role roles/secretmanager.secretAccessor >/dev/null
fi

# 3. A one-off job from the API image. The data directories point at /tmp: this job mounts no bucket and writes nothing there.
Q=1 g run jobs delete "$JOB" --project "$PROJECT" --region "$REGION" --quiet || true
g run jobs create "$JOB" --project "$PROJECT" --region "$REGION" \
  --image "${IMAGE:-}" --service-account "${SA:-}" \
  --command python --args "-m,scripts.create_campaign_admin,$USER_ID" \
  --set-secrets "PRINTFLOW_DATABASE_URL=PRINTFLOW_DATABASE_URL:latest,PRINTFLOW_JWT_SECRET=PRINTFLOW_JWT_SECRET:latest,CAMPAIGN_ADMIN_PASSWORD=$SECRET:latest" \
  --set-env-vars "PRINTFLOW_DATA_DIR=/tmp/pf,PRINTFLOW_INBOX_DIR=/tmp/pf/inbox,PRINTFLOW_PSD_DIR=/tmp/pf/psd,PRINTFLOW_OUTPUT_DIR=/tmp/pf/output,PRINTFLOW_FONTS_DIR=/tmp/pf/fonts" \
  "${NETWORK_ARGS[@]}" --max-retries 0 --task-timeout 300

# 4. Run it and wait; the script prints "Created campaign admin ..." (or "Updated the password for ...").
g run jobs execute "$JOB" --project "$PROJECT" --region "$REGION" --wait

if [[ "$DRY_RUN" == "1" ]]; then echo "DRY RUN done; nothing was changed."; exit 0; fi

cat <<EOF

Campaign admin ready.

  Sign-in : $APP_URL/user-campaign/admin/login
  User ID : $USER_ID
  Password: $PASSWORD

Share it through a password manager, not chat or email. The database holds only a bcrypt hash and no copy of
the password remains in GCP. To change it, run this script again for the same user ID.
EOF
