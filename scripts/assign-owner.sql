-- Administrator-only backfill; never expose this as an RPC or client query.
-- Run inside a transaction AFTER confirming the email with the actual owner:
--   begin;
--   set local tasks.owner_email = '<confirmed owner email>';
--   set local tasks.expected_unowned_lists = '<reviewed number of legacy lists>';
--   [execute this file]
--   commit;
-- Do not use auth metadata or the first account that happens to register.
do $$
declare
  owner_email text := nullif(current_setting('tasks.owner_email', true), '');
  expected_count integer := nullif(current_setting('tasks.expected_unowned_lists', true), '')::integer;
  owner_user uuid;
  actual_count integer;
begin
  if owner_email is null or expected_count is null or expected_count < 1 then
    raise exception 'Provide the confirmed owner email and reviewed legacy list count';
  end if;

  select id into strict owner_user from auth.users
  where lower(email) = lower(owner_email)
    and email_confirmed_at is not null and is_anonymous = false;

  lock table public.lists in share row exclusive mode;
  select count(*) into actual_count from public.lists where owner_id is null;
  if actual_count <> expected_count then
    raise exception 'Unowned list count changed; review before assigning ownership';
  end if;
  update public.lists set owner_id = owner_user where owner_id is null;
end $$;
