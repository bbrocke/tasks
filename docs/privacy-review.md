# Privacy review — September 17, 2026

Status: **the existing database access rules do not keep lists or tasks private.**

The repository's `.env.example` identifies the `todo-tracker` Supabase project.
Read-only inspection of that project confirmed:

- Row-level security is enabled on `public.lists` and `public.tasks`.
- Each table has a permissive `ALL` policy for `PUBLIC`, with `USING (true)`
  and `WITH CHECK (true)` (`Allow all on lists` and `Allow all on tasks`).
- Both `anon` and `authenticated` have SELECT, INSERT, UPDATE, and DELETE
  privileges, plus additional table privileges.
- A read-only transaction using `SET LOCAL ROLE anon` successfully counted
  existing lists and tasks. No task text was retrieved and no rows were changed.
- Neither table contains an owner/user column. The app has no sign-in flow.
- No public views or public SECURITY DEFINER functions were found.
- The security advisor returned no findings. This does **not** establish privacy:
  the explicit unrestricted policies still permit anonymous access.

The policy and grant combination authorizes signed-out reads and writes via the
app's public Supabase connection. Write permissions were inspected, not exercised
on production data. This review does not establish whether anyone has misused access.
Live Vercel environment values and its browser bundle were not audited.

## Required follow-up

Before treating this as a private planner, roll out authentication and ownership
together:

1. Establish the intended owner's account and a working sign-in/sign-out flow.
   Do not assign existing data to the first person who signs up.
2. Add list ownership and explicitly assign existing lists to the verified owner.
   Task access should follow the owning list, including when inserting or moving tasks.
3. Replace unrestricted policies with owner-scoped SELECT, INSERT, UPDATE, and
   DELETE policies, including update `USING` and `WITH CHECK` predicates.
4. Revoke anonymous access and remove unused client privileges. Keep the backend
   service key out of browser code.
5. Verify signed-out denial, owner access, and cross-account denial for every
   operation before deploying the coordinated app/database change.

The navigation/save fix does not change production permissions. Revoking access
alone would leave the current app unable to load or save tasks because it has no
login flow. This remains a known issue requiring a separate coordinated rollout.

Reference: [Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security).
