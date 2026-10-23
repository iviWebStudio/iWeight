-- LOCAL ONLY. The API connects as `weight_api` and switches to `authenticated` per request
-- (SET LOCAL ROLE), so RLS applies to every query. On Supabase the API connects as the
-- pooler user, which already has this membership.
-- WITH INHERIT FALSE: the API role has no table privileges of its own (fail-closed);
-- it must SET ROLE authenticated, which makes RLS apply.
grant authenticated to weight_api with inherit false, set true;
grant anon to weight_api with inherit false, set true;
-- Local-auth adapter (AUTH_PROVIDER=local, refused in production) manages the shim users table.
grant usage on schema auth to weight_api;
grant select, insert, delete on auth.users to weight_api;
grant update (encrypted_password) on auth.users to weight_api;
