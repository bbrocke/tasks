# Private access rollout

## Activation record — September 17, 2026

Production activation is complete. The owner chose and verified their email;
PR #2 was merged and its production deployment succeeded. The migration was
applied and legacy lists were assigned to that verified account. Pre/post content
fingerprints matched for all existing lists and tasks (excluding the new owner
column). No existing task content was changed.

Live database tests passed for owner reads and task create/update/delete;
verification writes were rolled back. Anonymous reads were denied and write
grants removed. A different authenticated identity could not read, update, delete,
insert into, or claim the owner's data. These tests used database roles and
simulated JWT claims, not a second real account's API token. The owner separately
confirmed successful email-link sign-in. All 51 automated tests and the build passed.

The security advisor reported no table/RLS issues. Its remaining warning is
[leaked-password protection disabled](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection);
the app uses email links rather than password sign-in.

The instructions below remain the procedure for a new environment. **Merging the
frontend alone does not secure a database.** Coordinate the migration and account
assignment with deployment.

## Account prerequisite

The September 17 review found no Supabase Auth accounts. The owner must choose an
email address and verify it using the app's email link. Do not infer ownership
from a Git commit, the first signup, or editable user metadata.

## Prepare email sign-in

1. In the `todo-tracker` Supabase dashboard, verify Email authentication and
   email confirmation are enabled. Keep anonymous sign-ins disabled.
2. Set the Site URL to the production app URL from Vercel. At review time the
   production alias was `https://tasks-alpha-neon.vercel.app`.
3. Add the **exact** auth-preview URL and production URL to Redirect URLs. Avoid
   broad wildcard allowlists. Remove the preview redirect when rollout finishes.
4. Use the default magic-link email template with its `ConfirmationURL` link.
   Check mail delivery before switching access. Supabase's default mail sender
   may be restricted to organization member addresses; use verified custom SMTP
   if the intended owner is outside those recipients.
5. Open the preview, enter the chosen email, and open the received link in that
   same browser. The client uses PKCE. A different browser cannot complete that
   browser's pending PKCE flow; request a fresh link in the browser you will use.
6. Verify that exact email in `auth.users` has `email_confirmed_at` set and
   `is_anonymous = false`. Do not publish account IDs, emails, or tokens in Git.

The preview includes owner filters. Until the migration is applied, authenticated
list loading fails because `owner_id` does not exist; this does not block account
verification. Signing up never assigns legacy lists automatically.

## Coordinated production cutover

1. Confirm the preview tests/build and verified owner account are ready. Record
   the current list/task counts and unowned list count (five existing lists were
   present during the initial inspection; recheck at cutover).
2. Deploy the authenticated frontend. This gates the UI, but the old database
   remains public until the next step; keep this interval short.
3. Apply `supabase/migrations/20260917053518_private_task_ownership.sql`. The
   migration replaces unrestricted policies, revokes anonymous grants, and gives
   each task the access rules of its owning list. Unassigned rows remain intact
   and hidden. Expect a brief setup interval until ownership is assigned.
4. In a privileged transaction, set `tasks.owner_email` to the explicitly chosen,
   verified email and `tasks.expected_unowned_lists` to the reviewed count, then
   execute `scripts/assign-owner.sql`. It aborts if the account is unverified,
   missing, or ambiguous, or the number of unassigned lists changed.
5. Verify the owner sees all existing lists/tasks, and that totals and contents
   are preserved. Test add/complete/uncomplete/delete using a disposable task
   created for the check, not an existing task.
6. Verify signed-out requests are denied and a different authenticated account
   cannot read or modify the owner's rows. Run Supabase security advisors and
   inspect the final policies/grants. Advisor silence alone is insufficient.

If email delivery or ownership verification is unavailable, stop before cutover.
After hardening, do not restore unrestricted policies as a rollback. Keep the
data private and repair the login/deployment instead.

## Design and validation

- A nullable `lists.owner_id` preserves legacy data until explicit assignment.
  Clients cannot read, claim, or modify unowned rows.
- New lists default to `auth.uid()`. RLS checks both the old and new owner on
  updates. Tasks must refer to an owned list both before and after updates.
- Policies use the authenticated user ID and the server-issued anonymous flag,
  never `user_metadata`. No SECURITY DEFINER function or claim RPC is introduced.
- Authenticated users can manage only their own data. Anonymous-auth users are
  also denied. Client TRUNCATE and other unnecessary grants are removed.
- UI reads wait for authentication, and changing accounts destroys cached
  tasks/drafts. RLS remains the authorization boundary, not the UI filters.
- `npm test` includes a local PostgreSQL-compatible PGlite database executing the
  exact migration against a fixture matching the observed tables. Tests exercise
  signed-out denial, owner operations, cross-account denial, reassignment,
  anonymous-auth denial, and explicit verified backfill. This is not a substitute
  for final live JWT/API checks after cutover.

References: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security),
[email-link authentication](https://supabase.com/docs/guides/auth/auth-email-passwordless),
[default email sender restrictions](https://supabase.com/docs/guides/auth/auth-smtp).
