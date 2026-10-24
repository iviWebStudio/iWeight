-- Performance (Supabase advisor auth_rls_initplan): evaluate auth.uid() once per statement
-- instead of once per row by wrapping it in a scalar subquery. Same rules as before.
alter policy profiles_own on public.profiles
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
alter policy prefs_own on public.user_preferences
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy weights_own on public.weight_entries
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy goals_own on public.goals
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy conversations_own on public.conversations
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy messages_own on public.messages
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.conversations c where c.id = conversation_id and c.user_id = (select auth.uid()))
  );
alter policy memory_own on public.agent_memory
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy runs_own on public.agent_runs
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Advisor unindexed_foreign_keys: agent_runs.conversation_id (ON DELETE SET NULL scans it).
create index if not exists agent_runs_conversation_idx on public.agent_runs (conversation_id);
