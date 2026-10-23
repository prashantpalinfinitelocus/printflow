# Deploying to the provisioned GCP environments

Request REQNEW00737, app id AI0017287, code `dca`, region `asia-northeast1`. This replaces the proposed `tccc-pf-*` layout in `GCP_INFRA.md`, which the cloud team did not use.

| | Test | Prod |
|---|---|---|
| Project | `ai0017287-dca-diet-coke-test` | `ai0017287-dca-diet-coke-prod` |
| Backend (api) | `tccc-dca-test-cloudrun-backend` | `tccc-dca-prod-cloudrun-backend` |
| Frontend (web) | `tccc-dca-test-cloudrun-frontend` | `tccc-dca-prod-cloudrun-frontend` |
| Artifact Registry | `tccc-dca-test-cloud-build-repo` | `tccc-dca-prod-cloud-build-repo` |
| Worker pool | `tccc-dca-test-private-workerpool` | `tccc-dca-prod-private-workerpool` |
| Cloud SQL (private IP) | `tccc-dca-test-sql` (10.2.0.3) | `tccc-dca-prod-sql` (10.2.0.3) |
| Bucket mounted at `/data` | `tccc-dca-test-bucket-mount-500ced56` | `tccc-dca-prod-bucket-mount-ec1fd48f` |
| Hostname | `diet-coke-test.coke2home.com` | `diet-coke.coke2home.com` |
| Pipelines | `cloudbuild-api.yaml`, `cloudbuild-web.yaml` | `cloudbuild-prod-api.yaml`, `cloudbuild-prod-web.yaml` |

## How the pipelines deploy

The Cloud Build service account only has `run.services.get` and `run.services.update`, so the pipelines run `gcloud run services update` on the services the cloud team created. They cannot create services. Ingress, VPC egress, Cloud SQL, the runtime service account and the public invoker binding come from Terraform and are not set by the pipeline.

Each pipeline sets: image, port, startup probe, CPU and memory, concurrency, timeout, instance limits, the Cloud Storage volume (api only), environment variables and secrets (api only). The provisioned services start with the hello image, a TCP probe on port 8080 and 512 MiB, so the pipeline replaces all of those.

Order: run the **api** pipeline first, then **web** (web looks up the backend URL while building).

## Moderation uses Vertex AI

Company policy forbids API keys. The backend runs with `PRINTFLOW_MODERATION_USE_VERTEX=true` and authenticates as its service account, which already has the org role `ConsumerVertexAIPredict`. `GEMINI_API_KEY` is no longer set in either environment. Location defaults to `global` (substitution `_VERTEX_LOCATION`); change it if the approved model must stay in a region.

## Secrets the api needs before the first run

Both must exist in Secret Manager in each project, or the update fails:

- `PRINTFLOW_JWT_SECRET`: random signing key, same value on every instance.
- `PRINTFLOW_DATABASE_URL`: `postgresql+psycopg://printflow:<password>@10.2.0.3:5432/printflow`.

Only the default `postgres` database and user exist on the Cloud SQL instances, so create the `printflow` database and user first. The runtime service account already has project-level `secretmanager.secretAccessor`.

## First run checklist

1. Create the database, user and the two secrets in each project.
2. Create the Cloud Build triggers (none exist yet), one per file, using the project's Cloud Build service account.
3. Run api, then web. Keep the first api revision at one instance (the schema is created on start), then raise the limit.
4. Create the first admin user, copy fonts and PSDs into the mounted bucket under `fonts/` and `psd/`.
5. SSL, DNS and load balancer routes are separate requests: test certificate REQSSL04602, DNS records for both hostnames, and a load balancer route change if `/backend/*` should be reachable.

## Assumptions to confirm

- The bucket mounted at `/data` is the `bucket-mount-*` one, not `bucket-data`. Change `_DATA_BUCKET` if the cloud team intended the other.
- Moderation location `global` and model `gemini-3.5-flash`.
- The web app reaches the backend over its `run.app` URL through the VPC, which needs Private Google Access (it is on).

## CSV upload and the load balancer's WAF

The Cloud Armor policy (rule 110, SQL injection at sensitivity 2) returns 403 for multipart CSV bodies, so the normal upload cannot work through the load balancer. Until the cloud team exempts the upload paths, CSV Intake uploads straight to the bucket instead:

1. The page asks `POST /csv/upload-url` for a signed form (V4 POST policy, 10 minutes, content type and size capped).
2. The browser posts the file to `storage.googleapis.com` directly. A form POST needs no CORS setup on the bucket.
3. The page imports the file from the inbox (`/csv/import-from-inbox`), retrying for a few seconds while the Cloud Storage mount catches up.

This needs `PRINTFLOW_UPLOAD_BUCKET` (set by the pipelines to the mounted bucket), the IAM Credentials API, and `roles/iam.serviceAccountTokenCreator` on the runtime service account, which are all in place. Without the bucket variable the page falls back to the plain upload (local dev).

`infra/load-csv.sh test|prod file.csv` copies a CSV into an inbox by hand if the page is unavailable. PSD and font uploads still go through the load balancer and are still blocked by the same rule.
