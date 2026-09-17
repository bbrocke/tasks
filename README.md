# Tasks

A color-coded, multi-list to-do app with streaks for recurring tasks. Built with React + Vite + Supabase.

**Privacy:** The current database permits anonymous access to lists and tasks.
See [the privacy review](docs/privacy-review.md) for verified findings and the
authentication/ownership rollout needed before using this as a private planner.

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
- `lists` — id, name, color, tape, sort_order
- `tasks` — id, list_id, text, done, recur, streak, created_at

## Verification

Use Node.js 22.12 or newer with the locked dependencies:

```sh
npm ci
npm test
npm run build
```

Regression tests use a mocked Supabase client; they never write to the live database.
They cover saved links, browser history, malformed routes, overlapping saves,
rejected/zero-row writes, delete confirmation, and drafts across list navigation.

Only one save per task runs at a time in a browser tab. Other tasks remain usable.
Updates and deletes require a returned row before they count as successful.
Drafts stay in memory per list until an add succeeds; they do not survive refresh.
This does not add offline synchronization or conflict resolution between devices.
