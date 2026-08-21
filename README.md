# Tasks

A color-coded, multi-list to-do app with streaks for recurring tasks. Built with React + Vite + Supabase.

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
