# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A lightweight internal admin tool for Purple Spark to manage users in the **main application's** Supabase database during the beta test. It is a standalone Node.js + Express service — no build step, no framework, no tests. The UI is a single static page served from `public/`.

This microservice is a *satellite* of a larger Next.js application (the "main app"). It shares that app's Supabase project but has its own repo and deploy. `SAY_DO_GAP.md` documents a feature that lives in the **main app**, not here — its tables/files (`lib/...`, `services/...`, `scripts/...`) are not part of this repo.

## Commands

```bash
npm install     # install deps (Node 22.x)
npm start       # run the server (alias: npm run dev — same thing, no watch/reload)
```

There is **no build, lint, or test tooling**. `npm start` and `npm run dev` both just run `node server.js`. Requires a populated `.env` (copy from `.env.example`) or the server throws on boot. Then open `http://localhost:3000`.

## Architecture

Request flow: `server.js` (app setup, session, static serving) → route modules in `src/routes/` → the shared Supabase client in `src/supabase.js`. Auth lives in `src/auth.js`.

- **`server.js`** — wires up `express-session` (8h cookie, `secure` in production, `trust proxy` for Railway's TLS termination), mounts routers, and gates the dashboard: `/` and `/index.html` redirect to `/login.html` unless `req.session.authed`. Static assets are served with `index:false` so `/` always hits the gated route. Throws on boot if `SESSION_SECRET` is missing.
- **`src/auth.js`** — shared-credential login (single `ADMIN_USERNAME`/`ADMIN_PASSWORD`, not per-user accounts). Compares with `crypto.timingSafeEqual`. Exports `requireAuth` middleware; all `/api/*` routes except `/api/login`, `/api/logout`, `/api/me` are protected. Throws on boot if credentials are unset.
- **`src/supabase.js`** — single Supabase client created with the **service role key**, which bypasses RLS. This is server-side only and must never reach the browser. `SUPABASE_URL` falls back to `NEXT_PUBLIC_SUPABASE_URL` (a convenience for sharing env with the main app).
- **`src/routes/users.js`** — the core: list users (with org/team names resolved via Supabase nested selects, plus a per-user Helmsman simulation summary), PATCH a user, and read simulation history.
- **`src/routes/lookups.js`** — read-only `organizations` and `teams` lists for the dropdowns.
- **`public/`** — `index.html` (dashboard), `login.html`, `app.js` (all client logic, vanilla JS, no framework), `styles.css`.

## Data model (in the main app's Supabase)

Email is the user primary key and is referenced across tables, so **this tool never edits email**. Each user has exactly one organization and one team, stored directly on the `users` row.

| Concern | Table | Key columns |
| --- | --- | --- |
| Users | `users` | `email` (PK), `name`, `role`, `organization_id` (FK), `team_id` (FK), `org_membership_status` |
| Organizations | `organizations` | `id`, `name` |
| Teams | `teams` | `id`, `name`, `organization_id` |
| Simulations | `helmsman_sessions` | `user_id` (→ `users.email`), `scenario_id`, `status`, `started_at`, `completed_at`, `difficulty`, `attempt_number` |

## Conventions and constraints

- **Editable user fields** are exactly `role`, `organization_id`, `team_id`, `org_membership_status` — kept in sync between the client (`EDITABLE_FIELDS` in `public/app.js`) and the PATCH handler in `src/routes/users.js`. Changing the set means editing both.
- **`role`** is constrained to `admin | leader | general` (`ALLOWED_ROLES`, validated server-side).
- **Team/org integrity**: PATCH validates that a chosen `team_id` belongs to the effective organization (the org being set in the same request, else the user's current org). The client mirrors this by filtering the team dropdown by selected org and clearing an invalid team. Keep both checks when touching this logic.
- **Empty string → null**: both client and server convert `''` selections to `null` before persisting.
- PATCH stamps `updated_at`; simulation `duration_seconds` is computed on read from `started_at`/`completed_at` (never stored).
- Client escapes all interpolated HTML via `escapeHtml`; on any `401` the client redirects to `/login.html`.

## Deploy

Deployed on **Railway** from GitHub. Railway auto-detects Node, runs `npm install` then `npm start`, injects `PORT` (do not set it), and sets `NODE_ENV=production` (enables secure cookies). Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `SESSION_SECRET` in the service Variables. `.env` is gitignored and must never be committed; rotate the service role key in Supabase if it is ever exposed.
