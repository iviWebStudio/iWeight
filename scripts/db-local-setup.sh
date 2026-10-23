#!/usr/bin/env bash
# Creates local dev + test databases on plain Postgres (no Docker needed) and applies:
#   1. db/local/00_supabase_shim.sql   (local only — Supabase already has these objects)
#   2. supabase/migrations/*.sql        (identical SQL that goes to Supabase)
#   3. db/local/10_local_grants.sql     (local only — lets the API role use the shim auth table)
# Usage: PGHOST=localhost PGUSER=postgres bash scripts/db-local-setup.sh [dbname...]
set -euo pipefail
cd "$(dirname "$0")/.."
PSQL="${PSQL:-psql}"
API_ROLE_PASSWORD="${API_ROLE_PASSWORD:-weight_api_local}"
DBS=("$@")
[ ${#DBS[@]} -eq 0 ] && DBS=(weight_ai_dev weight_ai_test)

$PSQL -v ON_ERROR_STOP=1 -d postgres -q <<SQL
do \$\$ begin
  if not exists (select 1 from pg_roles where rolname = 'weight_api') then
    create role weight_api login password '${API_ROLE_PASSWORD}';
  end if;
end \$\$;
SQL

for db in "${DBS[@]}"; do
  echo "→ recreating $db"
  $PSQL -v ON_ERROR_STOP=1 -d postgres -q -c "drop database if exists $db with (force)" -c "create database $db"
  $PSQL -v ON_ERROR_STOP=1 -d "$db" -q -f db/local/00_supabase_shim.sql
  for f in supabase/migrations/*.sql; do
    echo "  applying $f"
    $PSQL -v ON_ERROR_STOP=1 -d "$db" -q -f "$f"
  done
  $PSQL -v ON_ERROR_STOP=1 -d "$db" -q -f db/local/10_local_grants.sql
done
echo "done"
