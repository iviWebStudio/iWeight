-- API database role (ADR-005) and tightened function privileges.
--
-- weight_api: the role the API logs in as (through the Supabase pooler in production). It owns no
-- table privileges itself (NOINHERIT + membership WITH INHERIT FALSE); every request runs
-- `SET LOCAL ROLE authenticated`, so RLS always applies. It is created without a password: set one
-- in the SQL editor (`alter role weight_api with password '…'`) — never in a migration.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'weight_api') then
    create role weight_api login noinherit;
  end if;
end $$;
grant authenticated to weight_api with inherit false, set true;
grant anon to weight_api with inherit false, set true;

-- Supabase grants EXECUTE on new functions to anon/authenticated by default; internal helpers
-- must not be callable through the REST API.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.delete_current_user() from anon;

-- Fixed search_path for every function (security advisor: function_search_path_mutable).
alter function public.set_updated_at() set search_path = '';
alter function public.is_valid_timezone(text) set search_path = '';
