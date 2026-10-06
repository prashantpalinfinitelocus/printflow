# PrintFlow: GCP Infrastructure Request

Audience: cloud team. Purpose: provision test and prod environments for PrintFlow, following the same pattern as the existing `jiab` and `thums-up` projects.

Names below (`tccc-pf-*`) follow the `tccc-<app>-<env>-<thing>` convention of those projects. `pf` is a proposed app code. Change it if the team prefers another.

The visual diagram is in the companion architecture page (Artifact). Cloud Build files are in the repo root: `cloudbuild-api.yaml`, `cloudbuild-web.yaml`, `cloudbuild-prod-api.yaml`, `cloudbuild-prod-web.yaml`.

---

## 1. What is being deployed

| Component | Tech | Port | Notes |
|---|---|---|---|
| web | Next.js 15 (standalone, Node 22) | 3000 | Only thing browsers talk to. Holds the JWT in an httpOnly cookie and proxies every API call with a Bearer token. |
| api | FastAPI on uvicorn, Python 3.12 | 8000 | Single process. Renders PSD to TIFF/PDF/PNG (numpy, Pillow, psd-tools, tifffile). Synchronous render inside the request. |
| database | PostgreSQL 16 | 5432 | 6 tables. Schema auto-creates on API start. No Alembic. |
| file store | POSIX filesystem at `/data` | n/a | `psd/`, `fonts/`, `inbox/`, `output/`. The database stores absolute paths under `/data/output`, so the mount point must stay `/data`. |
| AI moderation | Gemini API (API key, not Vertex) | 443 | Called from the API during CSV import. Needs outbound internet. |

Printing: the app can call CUPS (`lp`) but **Cloud Run has no CUPS and cannot reach operator printers**. The deployment runs with `PRINTFLOW_PRINTING_ENABLED=false`. Operators use DOWNLOAD (TIFF streamed back through the web proxy, printed on their own PC) and PROOF (render only). No server-side printing is planned.

## 2. Architecture and request flow

Internet to Cloud DNS, to Global external HTTPS Load Balancer with Cloud Armor, to a serverless NEG, to **Cloud Run web**. Web calls **Cloud Run api** over Direct VPC egress (API ingress is `internal`). API reaches **Cloud SQL** on private IP, a **Cloud Storage** bucket mounted at `/data`, and the Gemini API through **Cloud NAT**.

1. Browser to the HTTPS LB. Cloud Armor evaluates rules. TLS ends at the LB.
2. LB to Cloud Run web through the serverless NEG.
3. Web (`/api/proxy/[...path]` or a server component) calls the API with `Authorization: Bearer <JWT>` over the VPC.
4. API reads and writes PostgreSQL over the private IP.
5. API reads PSD and font templates and writes `output/<ORDER>/<ORDER>-v<n>.{tif,pdf,png}` on the Cloud Storage mount. Artifact downloads are streamed back through the same proxy.
6. On CSV upload only: API calls the Gemini API in batches of 25, 4 in parallel, through Cloud NAT.

## 3. GCP services to provision (per environment: test and prod)

Region for everything: `asia-south1`. Two separate GCP projects, test and prod, like `jiab` and `thums-up`.

| # | Service | Resource (proposed name) | Configuration |
|---|---|---|---|
| 1 | Cloud Run (web) | `tccc-pf-<env>-cloudrun-web` | gen2, port 3000, 1 vCPU, 1536 MiB, min 1, max 3 (prod 5), timeout 600s, ingress `internal-and-cloud-load-balancing`, Direct VPC egress all-traffic. |
| 2 | Cloud Run (api) | `tccc-pf-<env>-cloudrun-api` | gen2, port 8000, 4 vCPU, 8 GiB, CPU boost, min 1, max 3 (prod 10), **concurrency 4**, timeout 600s, ingress `internal`, Direct VPC egress all-traffic, Cloud Storage bucket mounted at `/data`. |
| 3 | Cloud SQL for PostgreSQL 16 | `tccc-pf-<env>-pg` | Private IP only (Private Services Access). Test: 1 vCPU / 3.75 GB. Prod: 2 vCPU / 7.5 GB, HA, automated backups, PITR. Database `printflow`, user `printflow`. |
| 4 | Cloud Storage (data bucket) | `tccc-pf-<env>-printflow-data` | One bucket, regional in `asia-south1`, uniform access, mounted at `/data` through GCS FUSE. Prefixes `psd/`, `fonts/`, `inbox/`, `output/`. Mount options `implicit-dirs` and a short metadata cache. See section 5. |
| 5 | VPC, subnet, Cloud Router, Cloud NAT | `tccc-pf-<env>-vpc`, `...-run-subnet` | Subnet sized for Direct VPC egress (/26 or larger). Private Google Access on. Cloud NAT so all-traffic egress can reach the Gemini API. |
| 6 | Global external HTTPS Load Balancer | `tccc-pf-<env>-lb` | Serverless NEG to the web service only. Google-managed certificate. **Backend service timeout 600s** (default 30s is too short for renders and CSV import). HTTP to HTTPS redirect. |
| 7 | Cloud Armor | `tccc-pf-<env>-waf-ruleset` | Attach to the web backend service. Rules are in `infra/cloud-armor.sh` and described in section 4a. Uploads of PSD, font and CSV are exempt from managed WAF rules. |
| 8 | Cloud DNS | record for the app domain | A record to the LB IP. Domain to be confirmed. |
| 9 | Artifact Registry | `tccc-pf-<env>-cloud-build-repo` | Docker repo. Holds `<service>:<SHORT_SHA>` and `:latest`. |
| 10 | Cloud Build | 2 triggers per env (api, web) | See section 7. Prod uses a private worker pool `tccc-pf-prod-private-workerpool`. |
| 11 | Secret Manager | see section 6 | Secret names equal env var names, like the existing projects. |
| 12 | Bucket lifecycle rule | on the data bucket | Delete objects under `output/` after N days (proposal: 30) so rendered files do not grow without bound. |
| 13 | IAM | `tccc-pf-<env>-cloudrun-sa` | See section 8. |
| 14 | Cloud Logging and Monitoring | default | Uptime check on `GET /login` (web) and log-based alert on API 5xx. |

APIs to enable: Cloud Run, Cloud Build, Artifact Registry, Secret Manager, Cloud SQL Admin, Compute Engine, Service Networking, Cloud DNS, Cloud Logging, Cloud Monitoring, Cloud Storage.

Not needed: Pub/Sub, Memorystore, Cloud Scheduler, Strapi, GKE, Vertex AI. The app has no queue, no cache layer and no CMS.

### Capacity assumptions

- Expected user base: up to 1 lakh (100,000) users. Peak concurrent renders is not yet known and must be confirmed with the business.
- Web pages are light. The API render is the limit, because it is CPU and memory heavy and runs inside the request.
- Prod API scales from 1 to 10 instances (4 vCPU, 8 GiB, concurrency 4 each). Test stays at max 3.
- **DB connections:** every API instance keeps its own pool. Small Cloud SQL tiers allow roughly 100 to 200 connections. Cap the SQLAlchemy pool size so that max instances times pool size stays under `max_connections`, or pick a larger tier. The app code has not been checked for pool settings.
- Render time is not documented in the code. Run one load test (20 to 50 parallel renders) before prod, then set final instance count and memory. Include the largest real PSD, because Cloud Storage writes are staged in instance memory.

## 4. Networking

- Only the web service is exposed, and only through the load balancer. The API has ingress `internal`.
- The API can stay `--allow-unauthenticated` at the Cloud Run IAM layer because ingress is internal and every route except `/health` and `/auth/login` requires a valid JWT. The web proxy does not send Google ID tokens, so IAM-authenticated service-to-service would need a code change.
- Web to API requires `--vpc-egress=all-traffic` on the web service, so its server-side calls enter the VPC and count as internal traffic.
- API egress is all-traffic, so the API needs Cloud NAT to call the Gemini API.
- Web to API URL: the pipeline resolves the API service URL and injects it as `API_BASE_URL`.

## 4a. Cloud Armor rules

The script `infra/cloud-armor.sh` creates the policy and attaches it to the web backend service. The browser only calls `/api/proxy/<api path>`, so the rules match those paths.

| Priority | Match | Action | Why |
|---|---|---|---|
| 1000 | `POST /api/auth/login` | Throttle 10 per minute per IP, then 429 | Brute-force protection |
| 1100 | `POST /api/proxy/print-formats/upload-psd`, `/print-formats/upload-font`, `/csv/upload` | Throttle 30 per minute per IP, then 429. Allowed without managed WAF inspection. | PSD and font files are binary and CSVs contain quotes and symbols, which trigger managed WAF false positives |
| 3000 to 3060 | everything else | OWASP managed sets (sqli, xss, lfi, rfi, rce, protocol attack, scanner detection) at sensitivity 1, deny 403 | Standard attack protection |
| default | any | Allow | |

Why the upload exemption is safe: every proxied route needs a valid JWT, PSD and font files are parsed and never executed, CSV rows are validated and moderated, and the throttle still limits abuse.

Rollout: the managed rules are created in **preview**. Test a large PSD, a font and a CSV with special characters, check the load balancer logs for would-be denials, then run `./cloud-armor.sh enforce`. If a legitimate request is flagged, opt out that single rule id or add a narrow allow rule for that exact path.

Two limits this does not change: Cloud Run still caps a request at 32 MiB (see section 10), and Cloud Armor inspects only the start of a request body, so exempting uploads loses little.

## 5. Storage decision for `/data`

Cloud Run container disks are temporary and each instance has its own, so files written there are lost on restart and invisible to other instances. The API keeps PSD templates, fonts, the CSV inbox and every rendered output in `/data`, and the database stores absolute paths under `/data/output`. All of it therefore lives in **Cloud Storage**, mounted at `/data` through GCS FUSE. The code only uses plain file operations (write, read, glob, exists, delete), so no code change is needed.

| Option | Verdict |
|---|---|
| **Cloud Storage bucket mounted at `/data`** | Chosen. Pay for what is stored, no disk to manage, files can be copied in with `gcloud storage cp`, lifecycle rule cleans old output. |
| Filestore (NFS) | Fallback if the load test shows a problem. POSIX behaviour, but a 1 TiB minimum. |
| Local container disk | Not usable. Lost on restart and not shared between instances. |
| GCS SDK in the application | Best long term, but needs an application change. Not in scope. |

Things to verify in the load test: a large TIFF is held in instance memory until the file closes, and open and save are slower than on local disk. Rendered files are cleaned by a lifecycle rule on `output/` (section 3, row 12).

## 6. Secrets and environment variables

Secrets (Secret Manager, mapped with `--set-secrets NAME=NAME:latest`):

| Secret | Used by | Notes |
|---|---|---|
| `PRINTFLOW_JWT_SECRET` | api | HS256 signing key. Same value on all instances. The code default is dev-only and must never ship. |
| `PRINTFLOW_DATABASE_URL` | api | `postgresql+psycopg://printflow:<password>@<cloudsql-private-ip>:5432/printflow` |
| `GEMINI_API_KEY` | api | Not prefixed. With moderation on and no key, every imported row is held as NEEDS_REVIEW. |

Plain env vars set by the pipeline:

| Variable | Value | Service |
|---|---|---|
| `PRINTFLOW_PRINTING_ENABLED` | `false` | api |
| `PRINTFLOW_TIFF_COLORSPACE` | `CMYK` | api |
| `PRINTFLOW_MODERATION_ENABLED` | `true` | api |
| `PRINTFLOW_CORS_ORIGINS` | public web URL | api |
| `API_BASE_URL` | resolved API service URL | web |

Already set in the api image: `PRINTFLOW_DATA_DIR=/data` and the `INBOX`, `PSD`, `OUTPUT`, `FONTS` directories under it. The web image has no `NEXT_PUBLIC_*` variables, so it is built once and configured at runtime.

## 7. CI/CD

Pattern copied from `thums-up-be`: pull `:latest` for cache, build, push `:SHORT_SHA`, push `:latest`, `gcloud run deploy`. Docker BuildKit is disabled so `--cache-from` works, as in the existing files.

| File | Environment | Builder |
|---|---|---|
| `cloudbuild-api.yaml` | test | `E2_HIGHCPU_8` |
| `cloudbuild-web.yaml` | test | `E2_HIGHCPU_8` |
| `cloudbuild-prod-api.yaml` | prod | private worker pool |
| `cloudbuild-prod-web.yaml` | prod | private worker pool |

Triggers: GitHub app connection, one trigger per file. Branch mapping is not stored in the `jiab` or `thums-up` repos, so copy it from the existing triggers in the console (`gcloud builds triggers list`).

Deploy order on the first run: api first, then web (web resolves the API URL during the build).

Placeholders to replace in each file (marked `REPLACE`): project id, network, subnet, data bucket name, public app URL, and the project id inside `workerPool` on the prod files.

Build and deploy checks left out on purpose, to match the existing projects: no test step. If wanted later, the API tests need a Postgres sidecar and the `postgresql-client` tools; they are already in the api image.

## 8. IAM

Runtime service account `tccc-pf-<env>-cloudrun-sa`:
- `roles/secretmanager.secretAccessor`
- `roles/storage.objectAdmin` (on the data bucket only, bucket-level grant)
- `roles/logging.logWriter`

Not needed: `cloudsql.client` (connection is by private IP, no proxy) and Pub/Sub roles.

Cloud Build service account:
- `roles/run.admin`
- `roles/iam.serviceAccountUser` on the runtime service account
- `roles/artifactregistry.writer`
- `roles/logging.logWriter`

## 9. First-time runbook (after infra exists)

1. Create secrets and set values.
2. Run the api trigger, then the web trigger. The API creates the schema on first start (`create_all` plus idempotent `ADD COLUMN IF NOT EXISTS` migrations). Keep max instances at 1 for the very first revision to avoid two instances racing on `create_all`, then raise it.
3. Create the first admin user and initial data. The pipeline does not run the seed script. The app team will add an API endpoint for this, so no extra job or service is needed. Change any default passwords straight away.
4. Copy brand fonts (`data/fonts`, about 1 MB, in the repo) and real PSDs into the data bucket under `fonts/` and `psd/` (`gcloud storage cp`), or upload them in the admin UI.
5. Attach the domain and certificate, then check `GET /login` through the LB.
6. Smoke test: log in as admin, upload a CSV, print an order with delivery DOWNLOAD, download the TIFF.

## 10. Risks and decisions for the cloud team

1. **32 MiB request limit.** Cloud Run HTTP/1 requests are capped at 32 MiB, and uploads go browser to LB to web proxy to API (the proxy buffers the body). Real PSDs can be tens of MB. Until the app moves to signed-URL uploads, large PSDs are copied straight into the data bucket under `psd/`. Confirm the real PSD sizes with the business.
2. **Cloud Storage mount behaviour.** GCS FUSE stages a file in instance memory until it is closed, and TIFFs are written by seeking back in the file. A large TIFF counts against the 8 GiB, and open and save are slower than local disk. Load test with the largest real PSD. If it does not hold up, the fallback is Filestore (NFS, 1 TiB minimum).
3. **Long requests.** Render and CSV import run inside the request. All three timeouts (Cloud Run 600s, LB backend 600s, and any proxy) must match. Render duration has not been measured, so load test before prod.
4. **Memory.** Uploads and renders hold large arrays in memory. 8 GiB with concurrency 4 is a starting point, not a measured figure.
5. **Cloud Armor false positives.** Upload routes are exempt from managed rules (section 4a). Other JSON routes that carry label text could still trip a rule, so run the managed rules in preview first.
6. **Cookie `Secure` flag.** The web app sets it from the request scheme. Verify that Next.js sees `https` behind the LB, otherwise the cookie loses `Secure`.
7. **Gemini dependency.** Outbound internet through Cloud NAT is required. If moderation must stay inside GCP, the code needs a move to Vertex AI.
8. **Domain names** for test and prod are not yet decided.

## 11. Ticket checklist

- [ ] Test and prod projects, APIs enabled
- [ ] VPC, run subnet, Private Services Access range, Cloud Router, Cloud NAT
- [ ] Cloud SQL PostgreSQL 16 (private IP), database and user, password handed over through Secret Manager
- [ ] Data bucket `tccc-pf-<env>-printflow-data` with prefixes, lifecycle rule and bucket-level access for the runtime service account
- [ ] Artifact Registry repo
- [ ] Runtime and Cloud Build IAM as in section 8
- [ ] Secrets created (section 6)
- [ ] Prod private worker pool
- [ ] Cloud Build triggers for api and web, test and prod
- [ ] Global HTTPS LB, serverless NEG to web, managed certificate, backend timeout 600s
- [ ] Cloud Armor policy attached
- [ ] Cloud DNS record
- [ ] Uptime check and 5xx alert
- [ ] Handover of: data bucket name, network and subnet names, project ids, domain
