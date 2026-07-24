# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A lightweight internal admin tool for Purple Spark to manage users in the **main application's** Supabase database during the beta test. It is a standalone Node.js + Express service — no build step, no framework, no tests. The UI is served from `public/` as a set of static pages (dashboard + a Say–Do Gap visualizer).

This microservice is a *satellite* of a larger Next.js application (the "main app"). It shares that app's Supabase project but has its own repo and deploy. `SAY_DO_GAP.md` and `SAYDO_VIZ_SPEC.md` describe the **main app's** Say–Do Gap feature (its `lib/...`, `services/...`, production tables) — that source is not in this repo. What *is* here is a read-only visualizer of that data (see `src/routes/saydo.js` and `public/saydo.html`), which re-implements the gap math in plain JS against the shared Supabase.

## Commands

```bash
npm install     # install deps (Node 22.x)
npm start       # run the server (alias: npm run dev — same thing, no watch/reload)
```

There is **no build, lint, or test tooling**. `npm start` and `npm run dev` both just run `node server.js`. Requires a populated `.env` (see the vars listed under Deploy) or the server throws on boot. Then open `http://localhost:3000`.

Two standalone maintenance scripts (run directly with `node`, not via npm; both load `.env` and use the service-role client):

```bash
node scripts/inspect-schema.js            # READ-ONLY: enumerate/fingerprint Supabase tables via PostgREST OpenAPI
node scripts/seed-saydo-demo.js           # seed Say-layer demo scores for one hard-coded user
node scripts/seed-saydo-demo.js --remove  # tear that seed back down (idempotent)
```

`seed-saydo-demo.js` is the **only write path in this repo other than the users PATCH** — it upserts into `user_say_component_scores` for a single hard-coded `USER_ID`, and nothing else.

## Architecture

Request flow: `server.js` (app setup, session, static serving) → route modules in `src/routes/` → the shared Supabase client in `src/supabase.js`. Auth lives in `src/auth.js`.

- **`server.js`** — wires up `express-session` (8h cookie, `secure` in production, `trust proxy` for Railway's TLS termination), mounts routers, and gates the dashboard: `/` and `/index.html` redirect to `/login.html` unless `req.session.authed`. Static assets are served with `index:false` so `/` always hits the gated route. Throws on boot if `SESSION_SECRET` is missing.
- **`src/auth.js`** — shared-credential login (single `ADMIN_USERNAME`/`ADMIN_PASSWORD`, not per-user accounts). Compares with `crypto.timingSafeEqual`. Exports `requireAuth` middleware; all `/api/*` routes except `/api/login`, `/api/logout`, `/api/me` are protected. Throws on boot if credentials are unset.
- **`src/supabase.js`** — single Supabase client created with the **service role key**, which bypasses RLS. This is server-side only and must never reach the browser. `SUPABASE_URL` falls back to `NEXT_PUBLIC_SUPABASE_URL` (a convenience for sharing env with the main app).
- **`src/routes/users.js`** — the core: list users (with org/team names resolved via Supabase nested selects, plus a per-user Helmsman simulation summary), PATCH a user, and read simulation history.
- **`src/routes/lookups.js`** — read-only `organizations` and `teams` lists for the dropdowns.
- **`src/routes/saydo.js`** — mounted at `/api/saydo`; unlike the others it applies `requireAuth` inside the router itself (server.js mounts it without wrapping). Read-only endpoints: `GET /users` (users with Say and/or Do data), `GET /:email` (per-trait gap payload + transcript). Plus an **optional, display-only** `POST /:email/score-turn` that calls Gemini to score one conversation turn live and **writes nothing** — it returns `503` unless a Gemini key is set, so it can never fail-hard in a demo. The gap math mirrors the main app: `gap = |do − say|`, with an unscored side neutral-filled to `5.0`.
- **`public/`** — `index.html` (dashboard) + `app.js`; `saydo.html` (Say–Do Gap visualizer) + `saydo.js`; `login.html`; `styles.css`. All client logic is vanilla JS, no framework. The dashboard links to the visualizer via the "Say–Do Gap" button.

## Data model (in the main app's Supabase)

Email is the user primary key and is referenced across tables, so **this tool never edits email**. Each user has exactly one organization and one team, stored directly on the `users` row.

| Concern | Table | Key columns |
| --- | --- | --- |
| Users | `users` | `email` (PK), `name`, `role`, `organization_id` (FK), `team_id` (FK), `org_membership_status` |
| Organizations | `organizations` | `id`, `name` |
| Teams | `teams` | `id`, `name`, `organization_id` |
| Simulations | `helmsman_sessions` | `user_id` (→ `users.email`), `scenario_id`, `status`, `started_at`, `completed_at`, `difficulty`, `attempt_number` |
| Trait catalogue | `trait_components` | `id` (UUID), `component_id` (human code, e.g. `C001`), `name`, `tier`, `what_it_is`, `is_active` |
| **Do** scores (revealed behavior) | `user_component_scores` | `user_id` (→ `users.email`), `component_id` (→ `trait_components.id`), `score` |
| **Say** scores (stated) | `user_say_component_scores` | `user_id`, `component_id`, `score`, `evidence_count`, `last_message_id`, `updated_at` |
| Conversation transcript | `navigator_messages` | `user_id` (→ `users.email`); role/content/timestamp column names vary, so `saydo.js` selects `*` and normalizes |

The Say/Do tables join on `trait_components.id` (a UUID) — note that `user_*_component_scores.component_id` holds that UUID, while `trait_components.component_id` is the human-readable code shown in the UI.

## Conventions and constraints

- **Editable user fields** are exactly `role`, `organization_id`, `team_id`, `org_membership_status` — kept in sync between the client (`EDITABLE_FIELDS` in `public/app.js`) and the PATCH handler in `src/routes/users.js`. Changing the set means editing both.
- **`role`** is constrained to `admin | leader | general` (`ALLOWED_ROLES`, validated server-side).
- **Team/org integrity**: PATCH validates that a chosen `team_id` belongs to the effective organization (the org being set in the same request, else the user's current org). The client mirrors this by filtering the team dropdown by selected org and clearing an invalid team. Keep both checks when touching this logic.
- **Empty string → null**: both client and server convert `''` selections to `null` before persisting.
- PATCH stamps `updated_at`; simulation `duration_seconds` is computed on read from `started_at`/`completed_at` (never stored).
- Client escapes all interpolated HTML via `escapeHtml`; on any `401` the client redirects to `/login.html`.

## Deploy

Deployed on **Railway** from GitHub. Railway auto-detects Node, runs `npm install` then `npm start`, injects `PORT` (do not set it), and sets `NODE_ENV=production` (enables secure cookies). Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `SESSION_SECRET` in the service Variables. Optionally set `GEMINI_API_KEY` (or `GOOGLE_API_KEY` / `VERTEX_API_KEY`, and `VERTEX_GEMINI_MODEL` to override the default `gemini-1.5-flash`) to enable the display-only live-scoring endpoint; leave it unset and that endpoint stays disabled. `.env` is gitignored and must never be committed; rotate the service role key in Supabase if it is ever exposed.
