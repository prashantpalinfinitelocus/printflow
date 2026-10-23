#!/usr/bin/env bash
# Cloud Armor policy for PrintFlow (attach to the WEB backend service of the global HTTPS LB).
#
# Goal: block common attacks without breaking uploads of large PSDs, fonts and CSVs.
#
# How uploads are protected from false positives
#   1. Upload routes are matched by exact path and get their own rate-limit rule at a LOW priority
#      number. A throttle rule is terminal for requests under the limit (conform-action allow), so
#      multipart/binary bodies never reach the managed WAF rules below. Requests over the limit get 429.
#   2. Uploads are still safe to exempt: every route behind the proxy needs a valid JWT, PSD/font
#      files are parsed by psd-tools/fonttools (never executed), and CSV rows are validated and moderated.
#   3. All other traffic goes through OWASP preconfigured WAF rules at sensitivity 1 (lowest false-positive rate).
#
# Usage:
#   POLICY=tccc-pf-test-waf-ruleset BACKEND=<web-backend-service-name> ./cloud-armor.sh
#   Rules start in PREVIEW. Watch the logs (see bottom), then run:  ./cloud-armor.sh enforce
set -euo pipefail

POLICY="${POLICY:?set POLICY, e.g. tccc-pf-test-waf-ruleset}"
BACKEND="${BACKEND:-}"      # web backend service name; required for the first run
PROJECT="${PROJECT:-$(gcloud config get-value project)}"

# Paths as seen by the load balancer. The browser only calls /api/proxy/<api path>.
# Web app routes (browser -> web) and API routes (direct, under the load balancer's /backend prefix).
LOGIN_RE='^(/api/auth/login|/backend/auth/login)$'
UPLOAD_RE='^(/api/proxy|/backend)/(print-formats/upload-psd|print-formats/upload-font|csv/upload)$'

WAF_SETS=(sqli-v33-stable xss-v33-stable lfi-v33-stable rfi-v33-stable rce-v33-stable
          protocolattack-v33-stable scannerdetection-v33-stable)

if [[ "${1:-}" == "enforce" ]]; then
  prio=3000
  for set in "${WAF_SETS[@]}"; do
    gcloud compute security-policies rules update "$prio" --security-policy "$POLICY" --project "$PROJECT" --no-preview
    prio=$((prio + 10))
  done
  echo "WAF rules now enforcing."
  exit 0
fi

gcloud compute security-policies create "$POLICY" --project "$PROJECT" \
  --description "PrintFlow WAF: rate limits, upload exemption, OWASP rules at sensitivity 1"

# 1000: login brute force. 10 POSTs per minute per IP, then 429.
gcloud compute security-policies rules create 1000 --security-policy "$POLICY" --project "$PROJECT" \
  --description "Throttle login" \
  --expression "request.method == 'POST' && request.path.matches('${LOGIN_RE}')" \
  --action throttle --rate-limit-threshold-count 10 --rate-limit-threshold-interval-sec 60 \
  --conform-action allow --exceed-action deny-429 --enforce-on-key IP

# 1100: uploads of PSD, font and CSV. Throttled, then allowed without managed WAF inspection.
gcloud compute security-policies rules create 1100 --security-policy "$POLICY" --project "$PROJECT" \
  --description "Upload routes: throttle, skip managed WAF (binary bodies cause false positives)" \
  --expression "request.method == 'POST' && request.path.matches('${UPLOAD_RE}')" \
  --action throttle --rate-limit-threshold-count 30 --rate-limit-threshold-interval-sec 60 \
  --conform-action allow --exceed-action deny-429 --enforce-on-key IP

# 3000+: OWASP managed rules for everything else, sensitivity 1, in preview first.
prio=3000
for set in "${WAF_SETS[@]}"; do
  gcloud compute security-policies rules create "$prio" --security-policy "$POLICY" --project "$PROJECT" \
    --description "OWASP ${set} (sensitivity 1)" \
    --expression "evaluatePreconfiguredWaf('${set}', {'sensitivity': 1})" \
    --action deny-403 --preview
  prio=$((prio + 10))
done

# Default rule (2147483647) stays "allow".

if [[ -n "$BACKEND" ]]; then
  gcloud compute backend-services update "$BACKEND" --global --project "$PROJECT" --security-policy "$POLICY"
fi

cat <<'EOF'

Next: test, then enforce.
  1. Upload a ~30 MB PSD, a font, and a CSV containing quotes, <, >, & and non-Latin text.
     Also run a print (DOWNLOAD) and a fit-text call from the admin UI.
  2. Look for would-be blocks in the LB logs (LB logging must be enabled on the web backend service):
       resource.type="http_load_balancer"
       jsonPayload.enforcedSecurityPolicy.name="<POLICY>" OR jsonPayload.previewSecurityPolicy.name="<POLICY>"
       jsonPayload.previewSecurityPolicy.outcome="DENY"
  3. For a rule that flags legitimate traffic, either lower nothing further (sensitivity is already 1) and
     opt out that one rule id:  evaluatePreconfiguredWaf('sqli-v33-stable', {'sensitivity': 1, 'opt_out_rule_ids': ['owasp-crs-v030301-id942100-sqli']})
     or add a narrow allow rule for that exact path at a priority below 3000.
  4. When preview shows no false positives, run: POLICY=<POLICY> ./cloud-armor.sh enforce
EOF
