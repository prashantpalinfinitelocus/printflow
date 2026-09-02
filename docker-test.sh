#!/usr/bin/env bash
# Run the API test suite inside the running api container.
#
#   ./docker-test.sh              # whole suite
#   ./docker-test.sh tests/test_placeholder.py -v
#
# The suite needs three things the running container does not have set:
#   PG* vars                  — createdb/dropdb must reach the db service
#   PRINTFLOW_TEST_DATABASE_*  — the throwaway database lives there too
#   PRINTFLOW_PRINTING_ENABLED — the container defaults this off; the tests
#                                stub lp/lpstat, so nothing reaches a printer
set -euo pipefail

DB_USER="${POSTGRES_USER:-printflow}"
DB_PASS="${POSTGRES_PASSWORD:-printflow}"

exec docker compose exec -T \
    -e PGHOST=db \
    -e PGUSER="$DB_USER" \
    -e PGPASSWORD="$DB_PASS" \
    -e PRINTFLOW_PRINTING_ENABLED=true \
    -e PRINTFLOW_TEST_DATABASE_URL="postgresql+psycopg://${DB_USER}:${DB_PASS}@db:5432/printflow_test" \
    api python -m pytest "${@:-tests}" -q
