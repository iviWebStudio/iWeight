-- Weight AI — initial schema.
-- Conventions: weights are integer grams; measured_on is the calendar date in the user's
-- time zone; every user-owned row carries user_id and is protected by RLS (user_id = auth.uid()).

create extension if not exists pgcrypto;

-- ------------------------------------------------------------------ helpers
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function public.is_valid_timezone(tz text) returns boolean
language plpgsql stable as $$
begin
  perform now() at time zone tz;
  return true;
exception when others then
  return false;
end $$;

-- ------------------------------------------------------------------ profiles
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 80),
  timezone text not null default 'UTC' check (public.is_valid_timezone(timezone)),
  weight_unit text not null default 'kg' check (weight_unit in ('kg', 'lb')),
  height_cm smallint check (height_cm between 80 and 260),
  onboarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------ user_preferences
-- Agent- and report-facing settings (kept apart from identity/units in profiles so the
-- agent tool can be granted access to these without touching the profile).
create table public.user_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  language text not null default 'ru' check (language in ('ru', 'en', 'hy')),
  report_format text not null default 'standard' check (report_format in ('brief', 'standard', 'detailed')),
  agent_tone text not null default 'neutral' check (agent_tone in ('neutral', 'supportive', 'concise')),
  memory_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger user_preferences_updated_at before update on public.user_preferences
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------ weight_entries
create table public.weight_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  measured_on date not null check (measured_on >= date '1900-01-01'),
  measured_at timestamptz,
  weight_g integer not null check (weight_g between 20000 and 400000),
  note text check (char_length(note) <= 500),
  source text not null default 'web' check (source in ('web', 'android', 'chat', 'import')),
  -- Client-generated id for idempotent retries and offline sync.
  client_entry_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index weight_entries_user_date_idx on public.weight_entries (user_id, measured_on desc, measured_at);
create unique index weight_entries_client_id_uq on public.weight_entries (user_id, client_entry_id)
  where client_entry_id is not null;
create unique index weight_entries_instant_uq on public.weight_entries (user_id, measured_at)
  where measured_at is not null;
create trigger weight_entries_updated_at before update on public.weight_entries
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------ goals
-- Goal history is kept: changing a goal marks the old row 'replaced' and inserts a new one.
create table public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  start_weight_g integer not null check (start_weight_g between 20000 and 400000),
  target_weight_g integer not null check (target_weight_g between 20000 and 400000),
  start_date date not null,
  status text not null default 'active' check (status in ('active', 'replaced', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  ended_at timestamptz
);
create unique index goals_one_active_uq on public.goals (user_id) where status = 'active';
create index goals_user_idx on public.goals (user_id, created_at desc);

-- ------------------------------------------------------------------ conversations / messages
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text check (char_length(title) <= 120),
  -- Rolling context summary (memory level 6). Never authoritative for weights/goals.
  summary text check (char_length(summary) <= 4000),
  summary_message_count integer not null default 0,
  -- A destructive action proposed by the agent, awaiting the user's confirmation in a later turn.
  pending_action jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index conversations_user_idx on public.conversations (user_id, updated_at desc);
create trigger conversations_updated_at before update on public.conversations
  for each row execute function public.set_updated_at();

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) <= 8000),
  -- For assistant messages: tools called and their verified outcomes.
  tool_events jsonb,
  client_message_id uuid,
  created_at timestamptz not null default now()
);
create index messages_conversation_idx on public.messages (conversation_id, created_at);
create unique index messages_client_id_uq on public.messages (user_id, client_message_id)
  where client_message_id is not null;

-- ------------------------------------------------------------------ agent_memory
-- Structured, user-visible long-term memory (memory level 3). Weights and goals are NOT stored here.
create table public.agent_memory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('preference', 'rule', 'fact')),
  content text not null check (char_length(content) between 1 and 500),
  source text not null default 'user' check (source in ('user', 'agent')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index agent_memory_user_idx on public.agent_memory (user_id, created_at);
create trigger agent_memory_updated_at before update on public.agent_memory
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------ agent_config_versions
-- Global, versioned agent configuration (memory level 1 and 7). Managed by operators.
create table public.agent_config_versions (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  system_prompt text not null,
  model_override text,
  allowed_tools text[] not null,
  max_tool_iterations smallint not null default 6 check (max_tool_iterations between 1 and 20),
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index agent_config_one_active_uq on public.agent_config_versions ((true)) where is_active;

-- ------------------------------------------------------------------ agent_runs
create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete set null,
  config_version text,
  model text not null,
  status text not null check (status in ('ok', 'error', 'limited')),
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_usd_micros bigint not null default 0,
  tool_calls jsonb not null default '[]'::jsonb,
  iterations smallint not null default 0,
  error_code text,
  latency_ms integer,
  created_at timestamptz not null default now()
);
create index agent_runs_user_idx on public.agent_runs (user_id, created_at desc);

-- ------------------------------------------------------------------ new-user bootstrap
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  insert into public.user_preferences (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------------ account deletion
-- Deletes the calling user; all owned rows go via ON DELETE CASCADE.
create or replace function public.delete_current_user() returns void
language plpgsql security definer set search_path = public, auth as $$
declare uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  delete from auth.users where id = uid;
end $$;
revoke all on function public.delete_current_user() from public;
grant execute on function public.delete_current_user() to authenticated;

-- ------------------------------------------------------------------ privileges
revoke all on public.profiles, public.user_preferences, public.weight_entries, public.goals,
  public.conversations, public.messages, public.agent_memory, public.agent_config_versions,
  public.agent_runs from anon, authenticated;

grant usage on schema public to authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, timezone, weight_unit, height_cm, onboarded_at) on public.profiles to authenticated;
grant select on public.user_preferences to authenticated;
grant update (language, report_format, agent_tone, memory_enabled) on public.user_preferences to authenticated;
grant select, insert, delete on public.weight_entries to authenticated;
grant update (measured_on, measured_at, weight_g, note) on public.weight_entries to authenticated;
grant select, insert on public.goals to authenticated;
grant update (status, ended_at) on public.goals to authenticated;
grant select, insert, delete on public.conversations to authenticated;
grant update (title, summary, summary_message_count, pending_action) on public.conversations to authenticated;
grant select, insert, delete on public.messages to authenticated;
grant select, insert, delete on public.agent_memory to authenticated;
grant update (kind, content) on public.agent_memory to authenticated;
grant select on public.agent_config_versions to authenticated;
grant select, insert on public.agent_runs to authenticated;

-- ------------------------------------------------------------------ row level security
alter table public.profiles enable row level security;
alter table public.user_preferences enable row level security;
alter table public.weight_entries enable row level security;
alter table public.goals enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.agent_memory enable row level security;
alter table public.agent_config_versions enable row level security;
alter table public.agent_runs enable row level security;

create policy profiles_own on public.profiles for all to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy prefs_own on public.user_preferences for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy weights_own on public.weight_entries for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy goals_own on public.goals for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy conversations_own on public.conversations for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy messages_own on public.messages for all to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.conversations c where c.id = conversation_id and c.user_id = auth.uid())
  );
create policy memory_own on public.agent_memory for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy config_read on public.agent_config_versions for select to authenticated using (true);
create policy runs_own on public.agent_runs for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
