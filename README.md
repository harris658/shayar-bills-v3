# Shayar Tex — Bills (v3)

Desktop-first bill-book web app for Shayar Tex. Static HTML/JS (no build step) backed by Supabase (auth + Postgres + RLS).

## Run

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000

## Test

```bash
node --test
```

(run from the app root — `node --test tests/` does not work on this machine's Node version)

## Database

Schema lives in `supabase/schema.sql` — paste into the Supabase SQL Editor for a new project.

## Live URL

https://harris658.github.io/shayar-bills-v3/

Login works once `js/config.js` carries the real Supabase project credentials.
