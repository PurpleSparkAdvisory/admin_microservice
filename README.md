# Purple Spark Admin Microservice

A lightweight internal admin tool to manage users in the Supabase database during the beta test.
Node.js + Express backend, a single static page UI, and `@supabase/supabase-js` for all DB access.

## Features

- List users with their admin level (`role`), organization, and team.
- Change a user's admin level (`admin` / `leader` / `general`).
- Reassign a user's organization and team (one each, matching the schema).
- Dropdowns populated from the live `organizations` and `teams` tables (team list is filtered by the selected org).
- View per-user Purple Spark (Helmsman) simulation history, read-only, with computed duration.
- Shared username/password login for managers.

## Data model (as discovered in Supabase)

| Concern | Table | Key columns |
| --- | --- | --- |
| Users | `users` | `email` (PK), `name`, `role`, `organization_id` (FK), `team_id` (FK), `org_membership_status` |
| Organizations | `organizations` | `id`, `name` |
| Teams | `teams` | `id`, `name`, `organization_id` (a team belongs to one org) |
| Simulations | `helmsman_sessions` | `user_id` (FK -> `users.email`), `scenario_id`, `status`, `started_at`, `completed_at`, `difficulty`, `attempt_number` |

Each user has exactly one organization and one team (stored directly on the `users` row). Email is the
primary key and is referenced by other tables, so this tool does not allow editing email.

## API endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/login` | Log in with shared username/password; sets a session cookie. |
| POST | `/api/logout` | End the session. |
| GET | `/api/me` | Current auth status. |
| GET | `/api/users?search=&organization_id=` | List users with resolved org/team names. |
| PATCH | `/api/users/:email` | Update `role`, `organization_id`, `team_id`, and/or `org_membership_status`. |
| GET | `/api/users/:email/simulations` | Read-only simulation history with `duration_seconds`. |
| GET | `/api/organizations` | Organizations for dropdowns. |
| GET | `/api/teams?organization_id=` | Teams for dropdowns (optionally filtered by org). |

All routes except `/api/login` require an authenticated session.

## Environment variables

See [`.env.example`](.env.example). Required:

| Variable | Description |
| --- | --- |
| `SUPABASE_URL` | Supabase project URL (falls back to `NEXT_PUBLIC_SUPABASE_URL`). |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key. Server-side only — bypasses RLS, never expose to the browser. |
| `ADMIN_USERNAME` | Shared admin username for the login form. |
| `ADMIN_PASSWORD` | Shared admin password. |
| `SESSION_SECRET` | Long random string used to sign the session cookie. |
| `PORT` | Optional. Defaults to `3000` locally; Railway sets this automatically. |

## Run locally

```bash
npm install
# create .env from .env.example and fill in the values
npm start
```

Then open `http://localhost:3000` and log in with `ADMIN_USERNAME` / `ADMIN_PASSWORD`.

## Deploy to Railway

1. Make sure `.env` is **not** committed (it is in `.gitignore`). Push the code to GitHub.
2. In Railway, create a new project -> **Deploy from GitHub repo** and select this repo.
3. Railway auto-detects Node, runs `npm install`, then `npm start` (from `package.json`).
4. Under the service's **Variables**, add:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `ADMIN_USERNAME`
   - `ADMIN_PASSWORD`
   - `SESSION_SECRET`
   (Do **not** set `PORT`; Railway injects it.)
5. Generate a public domain under **Settings -> Networking**. The app trusts the proxy and uses
   secure cookies when `NODE_ENV=production` (Railway sets this), so HTTPS sessions work out of the box.

## Security notes

- The service role key grants full database access. The entire tool sits behind the login; keep the
  Railway URL private and rotate `ADMIN_PASSWORD` after the beta.
- Never commit `.env`. If a key is ever exposed, rotate it in the Supabase dashboard.
