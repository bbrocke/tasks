-- Apply with the authenticated frontend rollout. Legacy rows remain unowned and
-- invisible until an administrator runs scripts/assign-owner.sql for a verified user.
-- No first-signup claim, email metadata policy, or SECURITY DEFINER endpoint.
alter table public.lists add column owner_id uuid references auth.users(id);
alter table public.lists alter column owner_id set default auth.uid();
create index lists_owner_id_idx on public.lists(owner_id);
create index if not exists tasks_list_id_idx on public.tasks(list_id);

alter table public.lists enable row level security;
alter table public.tasks enable row level security;

-- Permissive policies are ORed, so remove all previous policies on these tables.
do $$
declare old_policy record;
begin
  for old_policy in
    select tablename, policyname from pg_policies
    where schemaname = 'public' and tablename in ('lists', 'tasks')
  loop
    execute format('drop policy %I on public.%I', old_policy.policyname, old_policy.tablename);
  end loop;
end $$;

revoke all on public.lists, public.tasks from public, anon, authenticated;
grant select, insert, update, delete on public.lists, public.tasks to authenticated;
revoke all on sequence public.tasks_id_seq from public, anon, authenticated;
grant usage, select on sequence public.tasks_id_seq to authenticated;

create policy lists_select_owner on public.lists for select to authenticated
using (owner_id = (select auth.uid()) and (select auth.jwt()->>'is_anonymous') = 'false');
create policy lists_insert_owner on public.lists for insert to authenticated
with check (owner_id = (select auth.uid()) and (select auth.jwt()->>'is_anonymous') = 'false');
create policy lists_update_owner on public.lists for update to authenticated
using (owner_id = (select auth.uid()) and (select auth.jwt()->>'is_anonymous') = 'false')
with check (owner_id = (select auth.uid()) and (select auth.jwt()->>'is_anonymous') = 'false');
create policy lists_delete_owner on public.lists for delete to authenticated
using (owner_id = (select auth.uid()) and (select auth.jwt()->>'is_anonymous') = 'false');

-- Lists' own SELECT policy enforces ownership and excludes anonymous Auth users.
create policy tasks_select_owner on public.tasks for select to authenticated
using (exists (select 1 from public.lists where lists.id = tasks.list_id and lists.owner_id = (select auth.uid())));
create policy tasks_insert_owner on public.tasks for insert to authenticated
with check (exists (select 1 from public.lists where lists.id = tasks.list_id and lists.owner_id = (select auth.uid())));
create policy tasks_update_owner on public.tasks for update to authenticated
using (exists (select 1 from public.lists where lists.id = tasks.list_id and lists.owner_id = (select auth.uid())))
with check (exists (select 1 from public.lists where lists.id = tasks.list_id and lists.owner_id = (select auth.uid())));
create policy tasks_delete_owner on public.tasks for delete to authenticated
using (exists (select 1 from public.lists where lists.id = tasks.list_id and lists.owner_id = (select auth.uid())));
