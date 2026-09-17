# Tasks

A color-coded, multi-list to-do app with streaks for recurring tasks. Built with React + Vite + Supabase.

**Privacy:** Email-link sign-in and owner-only access were activated on September
17, 2026. Existing lists are assigned to their verified owner, and anonymous
database access is denied. See the [rollout record](docs/private-access-rollout.md)
for verification and setup requirements for a new environment.

## Setup

1. Copy `.env.example` to `.env` and paste in your Supabase anon key:
   ```
   cp .env.example .env
   ```
2. Install and run:
   ```
   npm install
   npm run dev
   ```

## Deploying to Vercel

1. Push this repo to GitHub
2. Import the repo at vercel.com/new
3. Add the two env vars from `.env` in Vercel's project settings (Environment Variables)
4. Deploy — every push to `main` auto-deploys after that

## Database

The Supabase project (`todo-tracker`) has two tables:
- `lists` — id, name, color, tape, sort_order, owner_id (after the privacy migration)
- `tasks` — id, list_id, text, done, recur, streak, created_at

## Verification

Use Node.js 22.12 or newer with the locked dependencies:

```sh
npm ci
npm test
npm run build
```

UI regression tests use a mocked Supabase client; database policy tests run in
local PGlite. Neither writes to the live database.
They cover saved links, browser history, malformed routes, overlapping saves,
rejected/zero-row writes, delete confirmation, and drafts across list navigation.
They also check the authentication gate, session changes, and row ownership rules.

Only one save per task runs at a time in a browser tab. Other tasks remain usable.
Updates and deletes require a returned row before they count as successful.
Drafts stay in memory per list until an add succeeds; they do not survive refresh.
This does not add offline synchronization or conflict resolution between devices.
