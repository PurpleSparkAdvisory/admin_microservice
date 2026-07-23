# Say–Do Gap Visualization — implementation spec (for Claude Code)

> **What this is.** A self-contained build spec for a new page in the **admin
> microservice** (the Node + Express satellite service described in `CLAUDE.md`),
> that visualizes the Say–Do Gap for a demo. It reads the main app's Supabase data;
> it does **not** modify the main app. The full, verified source of every file is in
> the appendix — treat it as authoritative and reproduce it exactly, then only
> adapt imports/column names to the real repo.

---

## 0. Hard guardrails (read before doing anything)

1. **This is the admin microservice repo only.** Do not touch, import from, or
   depend on the main Next.js app. `lib/…`, `services/…`, `scripts/…` referenced in
   `SAY_DO_GAP.md` live in the other repo and are out of scope here.
2. **The database is READ-ONLY for this feature.** No `insert`, `update`, `upsert`,
   or `delete` against any table. The only exception is *nothing* — even the live
   scoring endpoint must write nothing.
3. **No new build step, framework, or test tooling.** Match the existing style:
   vanilla client JS, Express routers, the shared service-role Supabase client.
   The only external asset is Chart.js via CDN in the static page.
4. **No new npm dependencies.** Gemini calls use Node 22's built-in `fetch`.
5. **Never expose the service-role key or any API key to the browser.** All Supabase
   and Gemini calls happen server-side in the route.
6. **Fail soft.** Every endpoint returns a clear JSON error and never throws into a
   crash. The client redirects to `/login.html` on 401, matching `app.js`.

---

## 1. Why this exists (context)

Purple Spark scores every leader on the same trait catalogue from two sides:
**Say** (what they state in the Navigator reflective chat) and **Do** (what they
choose in Helmsman simulations). The product's core insight is the *gap* between
them per trait: `gap = |say − do|`, with an unscored side neutral-filled to `5.0`.
This page lets someone filter to one leader and see their conversation, their
say-vs-do scores as a chart, and the biggest divergences — for an investor demo.

**Trait count caveat:** it is **not** 54. `54` is only the Do *vector* dimension;
the active `trait_components` catalogue is ~81 rows, and both sides score against the
full active set. The page shows the **top ~8 traits by gap** on the radar so it stays
legible, plus a longer leaderboard.

---

## 2. Data it reads (all in the main app's Supabase, via the service-role client)

| Purpose | Table | Columns used |
|---|---|---|
| Trait catalogue | `trait_components` | `id` (uuid PK), `component_id` (text code e.g. `A086`), `name`, `tier`, `what_it_is`, `is_active` |
| Do scores | `user_component_scores` | `user_id` (= email), `component_id` (uuid → `trait_components.id`), `score` (0–10) |
| Say scores | `user_say_component_scores` | `user_id`, `component_id` (uuid), `score` (0–10), `evidence_count` |
| Conversation | `navigator_messages` | `user_id` (= email), `role`, `content`, `created_at` |
| User names | `users` | `email` (PK), `name` |

`user_id` is the user's **email** on every table. The score tables' `component_id`
column holds the trait's **UUID** (`trait_components.id`), not the text code.

> **If `user_say_component_scores` is empty, the feature cannot demo.** The Say
> migration in the main app must be applied by hand and a real Navigator conversation
> (≥2 messages) must exist. Verify with the SQL in §5 before building anything else.

---

## 3. What to build

Three files (full source in the appendix):

| File | Path in this repo | Role |
|---|---|---|
| Route | `src/routes/saydo.js` | 3 endpoints; read-only; optional display-only scoring |
| Page | `public/saydo.html` | Instrument-panel UI: radar + leaderboard + transcript |
| Client | `public/saydo.js` | Fetch + render; 401 → `/login.html` |

Plus a **one-line mount** in `server.js`.

### Endpoint contracts (under `/api/saydo`, all behind `requireAuth`)

- `GET /users` → `{ users: [{ email, name, hasSay, hasDo, hasBoth }] }`, both-sided
  users sorted first (they're the valid demos).
- `GET /:email` → `{ email, meta, traits[], transcript[] }` where `meta` includes
  `hasTraitComparison`, `sayTraitCount`, `doTraitCount`, `comparableTraitCount`,
  `avgGap`, and `liveScoringEnabled`; each `traits[]` entry has
  `{ componentId, name, tier, doScore, sayScore, gap, bothSided }` sorted by `gap`
  descending; `transcript[]` is `{ id, role, content, createdAt }` in time order.
- `POST /:email/score-turn` (optional, display-only) → body `{ question, answer }`,
  returns `{ impacts: [{ componentId, name, impact, rationale }], persisted: false }`.
  Returns **503** if no Gemini key is set. **Writes nothing.**

---

## 4. Visual intent (so it looks intentional, not templated)

Ground the look in the product's nautical vernacular (Navigator/Helmsman): a dark
instrument-panel page where the radar is a compass and Say vs Do are two bearings.
- **Say = teal** (`--say #38D6C4`, stated/aspirational, cool).
- **Do = amber** (`--do #F0A63C`, revealed/real, warm).
- **Large gaps flare red** (`--flare #E86A5C`).
- Numbers render in a monospace face as gauge readouts.
Keep everything else quiet; the compass radar is the one signature element. The exact
CSS is in the appendix — use it as-is.

---

## 5. Verification SQL (run FIRST, before writing code)

```sql
select
  (select count(*) from user_say_component_scores) as say_rows,
  (select count(*) from user_component_scores)      as do_rows,
  (select count(*) from navigator_messages)         as msg_rows;

-- leaders with BOTH sides (the valid demo users):
select s.user_id,
       count(distinct s.component_id) as say_traits,
       count(distinct d.component_id) as do_traits
from user_say_component_scores s
join user_component_scores d on d.user_id = s.user_id
group by s.user_id
order by say_traits desc;
```

- If `say_rows = 0`: stop — the Say pipeline hasn't populated. Apply the main app's
  Say migration and run a ≥2-message Navigator conversation, then re-check.
- Pick a `user_id` from the second query as the demo default.

---

## 6. Acceptance criteria

- [ ] `npm start` boots with no new errors; `/saydo.html` loads.
- [ ] Visiting `/saydo.html` unauthenticated → API 401 → client redirects to login.
- [ ] The leader dropdown lists users; both-sided users are tagged and sorted first.
- [ ] Selecting a both-sided leader renders: 4 readout tiles, the say-vs-do radar
      (top 8 by gap), the divergence leaderboard, and the Navigator transcript.
- [ ] A one-sided leader shows a clear "only one side has data" message, not a crash.
- [ ] No table is written to. Grep the diff for `insert`/`update`/`upsert`/`delete`
      against Supabase and confirm there are none.
- [ ] If no Gemini key: the "Score this turn" button is absent and `/score-turn`
      returns 503. If a key is set: clicking it reveals per-trait impacts and the
      response body has `persisted: false`.

---

## 7. Environment (only if enabling live scoring)

Add to `.env` locally and to the Railway service Variables (never commit `.env`):

```
GEMINI_API_KEY=...                      # or GOOGLE_API_KEY / VERTEX_API_KEY
VERTEX_GEMINI_MODEL=gemini-1.5-flash    # optional
```

For exact parity with production scoring, port the prompt from the main app's
`lib/navigator/sayTraitJudge.ts` into the `score-turn` handler; the appendix prompt
is a faithful reconstruction sufficient for a demo.

---

## 8. Rollback

The feature is additive: one router file, two static files, one mount line. To
remove it, delete the three files and the two `server.js` lines. No schema or data
changes exist to reverse.

---

# Appendix — verified source (reproduce exactly)


## Appendix A — `src/routes/saydo.js`

```js
// src/routes/saydo.js
//
// Say–Do Gap visualization endpoints. READ-ONLY against the main app's Supabase
// (via the shared service-role client, which bypasses RLS). Mounted at /api/saydo
// and protected by requireAuth in server.js.
//
// It replicates getSayDoTraitGap() from the main app in plain JS:
//   gap(trait) = |do - say|, with an unscored side neutral-filled to 5.0.
//
// The optional POST /:email/score-turn does DISPLAY-ONLY live scoring: it calls
// Gemini and returns per-trait impacts, and WRITES NOTHING. It is disabled (503)
// unless a Gemini key is present, so it can never fail-hard in a demo.

const express = require('express');

// Match your repo's export style. src/supabase.js may `module.exports = client`
// or `module.exports = { supabase: client }` — this handles both.
const supa = require('../supabase');
const db = supa.supabase || supa.default || supa;

const { requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth);

const NEUTRAL = 5.0; // same neutral-fill convention as assemble_profile_vector

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uniqueUserIds(rows) {
  const s = new Set();
  for (const r of rows || []) if (r && r.user_id) s.add(r.user_id);
  return s;
}

// ---------------------------------------------------------------------------
// GET /api/saydo/users
// Returns everyone who has Say and/or Do data, so the dropdown only offers
// users worth demoing. hasBoth=true is your safe pick.
// ---------------------------------------------------------------------------
router.get('/users', async (req, res) => {
  try {
    const [say, doo, users] = await Promise.all([
      db.from('user_say_component_scores').select('user_id'),
      db.from('user_component_scores').select('user_id'),
      db.from('users').select('email, name'),
    ]);
    if (say.error) throw say.error;
    if (doo.error) throw doo.error;
    if (users.error) throw users.error;

    const sayIds = uniqueUserIds(say.data);
    const doIds = uniqueUserIds(doo.data);
    const nameByEmail = new Map((users.data || []).map((u) => [u.email, u.name]));

    const all = new Set([...sayIds, ...doIds]);
    const list = [...all]
      .map((email) => ({
        email,
        name: nameByEmail.get(email) || null,
        hasSay: sayIds.has(email),
        hasDo: doIds.has(email),
        hasBoth: sayIds.has(email) && doIds.has(email),
      }))
      // both-sided users first (the meaningful demos), then alphabetical
      .sort((a, b) => (b.hasBoth - a.hasBoth) || a.email.localeCompare(b.email));

    res.json({ users: list });
  } catch (err) {
    console.error('[saydo] /users failed:', err.message);
    res.status(500).json({ error: 'Could not load users.' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/saydo/:email
// The core payload: the trait-by-trait gap plus the conversation transcript.
// ---------------------------------------------------------------------------
router.get('/:email', async (req, res) => {
  const email = req.params.email;
  try {
    const [traitsRes, doRes, sayRes, msgRes] = await Promise.all([
      db
        .from('trait_components')
        .select('id, component_id, name, tier, what_it_is, is_active')
        .eq('is_active', true),
      db
        .from('user_component_scores')
        .select('component_id, score')
        .eq('user_id', email),
      db
        .from('user_say_component_scores')
        .select('component_id, score, evidence_count')
        .eq('user_id', email),
      // navigator_messages keys to the user by user_id (= email). Select * so we
      // tolerate column-name differences; we normalize below.
      db.from('navigator_messages').select('*').eq('user_id', email),
    ]);

    if (traitsRes.error) throw traitsRes.error;
    if (doRes.error) throw doRes.error;
    if (sayRes.error) throw sayRes.error;
    if (msgRes.error) throw msgRes.error;

    const doMap = new Map((doRes.data || []).map((r) => [r.component_id, Number(r.score)]));
    const sayMap = new Map(
      (sayRes.data || []).map((r) => [r.component_id, { score: Number(r.score), n: r.evidence_count }]),
    );

    const traits = (traitsRes.data || [])
      .map((t) => {
        const doScore = doMap.has(t.id) ? doMap.get(t.id) : null;
        const say = sayMap.get(t.id);
        const sayScore = say ? say.score : null;
        const doFill = doScore == null ? NEUTRAL : doScore;
        const sayFill = sayScore == null ? NEUTRAL : sayScore;
        return {
          componentId: t.component_id, // human code, e.g. "A086"
          name: t.name,
          tier: t.tier,
          whatItIs: t.what_it_is || null,
          doScore,
          sayScore,
          evidenceCount: say ? say.n : 0,
          gap: Math.abs(doFill - sayFill),
          bothSided: doScore != null && sayScore != null,
        };
      })
      .sort((a, b) => b.gap - a.gap);

    // Normalize transcript regardless of exact column names.
    const transcript = (msgRes.data || [])
      .map((m) => ({
        id: m.id,
        role: m.role || m.sender || 'user',
        content: m.content || m.text || m.message || '',
        createdAt: m.created_at || m.createdAt || m.inserted_at || null,
      }))
      .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));

    const bothSided = traits.filter((t) => t.bothSided);
    const avgGap = bothSided.length
      ? bothSided.reduce((s, t) => s + t.gap, 0) / bothSided.length
      : null;

    res.json({
      email,
      meta: {
        hasTraitComparison: bothSided.length > 0,
        sayTraitCount: traits.filter((t) => t.sayScore != null).length,
        doTraitCount: traits.filter((t) => t.doScore != null).length,
        comparableTraitCount: bothSided.length,
        avgGap,
        liveScoringEnabled: Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.VERTEX_API_KEY),
      },
      traits,
      transcript,
    });
  } catch (err) {
    console.error(`[saydo] /:email (${email}) failed:`, err.message);
    res.status(500).json({ error: 'Could not load say-do data for this user.' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/saydo/:email/score-turn   (OPTIONAL, display-only)
// Body: { question, answer }  — scores one turn live and returns impacts.
// WRITES NOTHING. Returns 503 if no Gemini key, so the UI degrades gracefully.
//
// NOTE: for exact parity with production, port the real prompt from the main app's
// lib/navigator/sayTraitJudge.ts. The prompt below is a faithful reconstruction
// from SAY_DO_GAP.md (sparse, signed impacts in [-1,1], capped at 8, valid codes).
// ---------------------------------------------------------------------------
router.post('/:email/score-turn', async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.VERTEX_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'Live scoring is off. Set GEMINI_API_KEY to enable it.' });
  }

  const { question = '', answer = '' } = req.body || {};
  if (!answer.trim()) return res.status(400).json({ error: 'Need an answer to score.' });

  try {
    const { data: traits, error } = await db
      .from('trait_components')
      .select('component_id, name, what_it_is')
      .eq('is_active', true);
    if (error) throw error;

    const catalogue = (traits || [])
      .map((t) => `${t.component_id} — ${t.name}: ${t.what_it_is || t.name}`)
      .join('\n');

    const validCodes = new Set((traits || []).map((t) => t.component_id));
    const nameByCode = new Map((traits || []).map((t) => [t.component_id, t.name]));

    const model = process.env.VERTEX_GEMINI_MODEL || 'gemini-1.5-flash';
    const prompt = [
      'You are a leadership-trait judge. Read the coach question and the leader\'s answer,',
      'then return ONLY signed evidence for traits the answer genuinely demonstrates.',
      'Rules: only use trait codes from the catalogue; impact is a number in [-1, 1]',
      '(positive = the answer shows the trait, negative = shows its opposite);',
      'include at most 8 traits, only ones with real evidence; one-sentence rationale each.',
      '',
      'CATALOGUE (code — name: definition):',
      catalogue,
      '',
      `COACH QUESTION: ${question}`,
      `LEADER ANSWER: ${answer}`,
      '',
      'Return JSON only: {"impacts":[{"component_id":"A086","impact":0.9,"rationale":"..."}]}',
    ].join('\n');

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const gemResp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
      }),
    });

    if (!gemResp.ok) {
      const detail = await gemResp.text();
      console.error('[saydo] Gemini error:', gemResp.status, detail.slice(0, 300));
      return res.status(502).json({ error: 'The scoring model did not respond. Try again.' });
    }

    const payload = await gemResp.json();
    const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    let parsed;
    try {
      parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    } catch {
      return res.status(502).json({ error: 'Could not read the model response.' });
    }

    const impacts = (parsed.impacts || [])
      .filter((i) => validCodes.has(i.component_id))
      .map((i) => ({
        componentId: i.component_id,
        name: nameByCode.get(i.component_id) || i.component_id,
        impact: Math.max(-1, Math.min(1, Number(i.impact) || 0)),
        rationale: i.rationale || '',
      }))
      .sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact))
      .slice(0, 8);

    res.json({ impacts, persisted: false });
  } catch (err) {
    console.error('[saydo] score-turn failed:', err.message);
    res.status(500).json({ error: 'Live scoring failed.' });
  }
});

module.exports = router;
```

## Appendix B — `public/saydo.html`

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Say–Do Gap · Purple Spark</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=Space+Mono:wght@400;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
  <script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.3/chart.umd.min.js"></script>
  <style>
    :root {
      --ink:      #0B1622;
      --panel:    #12212F;
      --panel-2:  #17293A;
      --line:     rgba(201,162,75,0.20);
      --line-soft:rgba(234,241,246,0.08);
      --haze:     #8AA0B4;
      --fg:       #EAF1F6;
      --say:      #38D6C4;  /* stated  — cool */
      --say-fill: rgba(56,214,196,0.16);
      --do:       #F0A63C;  /* revealed — warm */
      --do-fill:  rgba(240,166,60,0.14);
      --flare:    #E86A5C;  /* big divergence */
      --brass:    #C9A24B;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; background: var(--ink); color: var(--fg); }
    body {
      font-family: Inter, system-ui, sans-serif;
      background:
        radial-gradient(1200px 600px at 78% -10%, rgba(56,214,196,0.06), transparent 60%),
        radial-gradient(900px 500px at 12% 110%, rgba(240,166,60,0.05), transparent 55%),
        var(--ink);
      min-height: 100vh;
    }
    .eyebrow {
      font: 500 11px/1 'Space Mono', monospace;
      letter-spacing: 0.24em; text-transform: uppercase; color: var(--brass);
    }

    header.bar {
      display: flex; align-items: center; gap: 24px;
      padding: 20px 28px; border-bottom: 1px solid var(--line);
      position: sticky; top: 0; z-index: 5;
      background: rgba(11,22,34,0.86); backdrop-filter: blur(8px);
    }
    .brand { display: flex; flex-direction: column; gap: 4px; }
    .brand h1 {
      font: 700 20px/1 'Space Grotesk', sans-serif; margin: 0; letter-spacing: -0.01em;
    }
    .spacer { flex: 1; }
    .picker { display: flex; align-items: center; gap: 10px; }
    .picker label { font: 500 11px/1 'Space Mono', monospace; letter-spacing: 0.18em; text-transform: uppercase; color: var(--haze); }
    select {
      appearance: none; background: var(--panel-2); color: var(--fg);
      border: 1px solid var(--line); border-radius: 8px; padding: 9px 34px 9px 12px;
      font: 500 14px Inter, sans-serif; min-width: 260px; cursor: pointer;
      background-image: linear-gradient(45deg, transparent 50%, var(--brass) 50%), linear-gradient(135deg, var(--brass) 50%, transparent 50%);
      background-position: calc(100% - 18px) 18px, calc(100% - 13px) 18px; background-size: 5px 5px; background-repeat: no-repeat;
    }
    select:focus-visible { outline: 2px solid var(--say); outline-offset: 1px; }

    main { max-width: 1240px; margin: 0 auto; padding: 26px 28px 60px; }

    /* readout strip */
    .readouts { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 22px; }
    .readout {
      background: var(--panel); border: 1px solid var(--line-soft); border-radius: 12px; padding: 16px 18px;
    }
    .readout .k { font: 700 11px/1 'Space Mono', monospace; letter-spacing: 0.16em; text-transform: uppercase; color: var(--haze); }
    .readout .v { font: 700 30px/1.1 'Space Mono', monospace; margin-top: 10px; }
    .readout .v small { font-size: 14px; color: var(--haze); font-weight: 400; }
    .readout.flare .v { color: var(--flare); }

    .grid { display: grid; grid-template-columns: 1fr 1.05fr; gap: 22px; }
    @media (max-width: 980px) { .grid { grid-template-columns: 1fr; } .readouts { grid-template-columns: repeat(2,1fr);} }

    .card {
      background: var(--panel); border: 1px solid var(--line-soft); border-radius: 14px;
      padding: 20px; min-height: 120px;
    }
    .card h2 {
      font: 700 14px/1 'Space Grotesk', sans-serif; letter-spacing: 0.02em; margin: 0 0 4px;
    }
    .card .sub { font-size: 12.5px; color: var(--haze); margin: 0 0 16px; }

    .legend { display: flex; gap: 18px; margin: 4px 0 8px; }
    .legend span { display: inline-flex; align-items: center; gap: 7px; font: 500 12px 'Space Mono', monospace; letter-spacing: 0.04em; }
    .dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
    .dot.say { background: var(--say); }
    .dot.do  { background: var(--do); }

    .chart-wrap { position: relative; height: 380px; }

    /* divergence leaderboard */
    .lead { display: flex; flex-direction: column; gap: 2px; }
    .row { padding: 11px 4px; border-bottom: 1px solid var(--line-soft); }
    .row:last-child { border-bottom: 0; }
    .row .top { display: flex; align-items: baseline; gap: 8px; margin-bottom: 9px; }
    .row .name { font: 600 13.5px Inter, sans-serif; }
    .tier { font: 700 9px 'Space Mono', monospace; letter-spacing: 0.1em; padding: 2px 6px; border-radius: 4px; border: 1px solid var(--line); color: var(--haze); }
    .row .gapval { margin-left: auto; font: 700 15px 'Space Mono', monospace; }
    .track { position: relative; height: 8px; border-radius: 999px; background: var(--panel-2); }
    .track .span { position: absolute; height: 100%; border-radius: 999px; opacity: 0.45; }
    .track .mk { position: absolute; top: 50%; width: 12px; height: 12px; border-radius: 50%; transform: translate(-50%,-50%); border: 2px solid var(--panel); }
    .track .mk.say { background: var(--say); }
    .track .mk.do  { background: var(--do); }
    .scaleline { display: flex; justify-content: space-between; font: 400 9.5px 'Space Mono', monospace; color: var(--haze); margin-top: 5px; }

    /* transcript */
    .transcript { display: flex; flex-direction: column; gap: 12px; max-height: 560px; overflow: auto; padding-right: 4px; }
    .msg { max-width: 82%; padding: 11px 14px; border-radius: 12px; font-size: 13.5px; line-height: 1.5; position: relative; }
    .msg .who { font: 700 9.5px 'Space Mono', monospace; letter-spacing: 0.14em; text-transform: uppercase; opacity: 0.7; margin-bottom: 5px; }
    .msg.user { align-self: flex-end; background: var(--panel-2); border: 1px solid var(--line-soft); }
    .msg.assistant { align-self: flex-start; background: rgba(56,214,196,0.06); border: 1px solid rgba(56,214,196,0.18); }
    .score-btn {
      margin-top: 9px; font: 700 10px 'Space Mono', monospace; letter-spacing: 0.08em;
      background: transparent; color: var(--brass); border: 1px solid var(--line); border-radius: 6px;
      padding: 5px 9px; cursor: pointer;
    }
    .score-btn:hover { background: rgba(201,162,75,0.12); }
    .score-btn[disabled] { opacity: 0.35; cursor: default; }
    .impacts { margin-top: 10px; display: none; flex-direction: column; gap: 6px; }
    .impacts.show { display: flex; }
    .impact { font: 400 12px Inter, sans-serif; display: flex; gap: 8px; align-items: baseline; opacity: 0; transform: translateY(4px); transition: all 0.35s ease; }
    .impact.in { opacity: 1; transform: none; }
    .impact .imp-v { font: 700 12px 'Space Mono', monospace; min-width: 46px; }
    .impact .pos { color: var(--say); }
    .impact .neg { color: var(--flare); }
    .impact .rat { color: var(--haze); font-style: italic; }

    .state { text-align: center; color: var(--haze); padding: 60px 20px; font-size: 14px; }
    .state.err { color: var(--flare); }

    ::-webkit-scrollbar { width: 8px; } ::-webkit-scrollbar-thumb { background: var(--line); border-radius: 8px; }
    @media (prefers-reduced-motion: reduce) { .impact { transition: none; } }
  </style>
</head>
<body>
  <header class="bar">
    <div class="brand">
      <span class="eyebrow">Purple Spark · Leadership Signal</span>
      <h1>The Say–Do Gap</h1>
    </div>
    <div class="spacer"></div>
    <div class="picker">
      <label for="user">Leader</label>
      <select id="user"><option value="">Loading…</option></select>
    </div>
  </header>

  <main>
    <div id="readouts" class="readouts" hidden>
      <div class="readout"><div class="k">Say traits</div><div class="v" id="r-say">–</div></div>
      <div class="readout"><div class="k">Do traits</div><div class="v" id="r-do">–</div></div>
      <div class="readout"><div class="k">Comparable</div><div class="v" id="r-both">–</div></div>
      <div class="readout flare"><div class="k">Avg divergence</div><div class="v" id="r-gap">–<small>/10</small></div></div>
    </div>

    <div id="state" class="state">Select a leader to chart their say–do gap.</div>

    <div id="content" class="grid" hidden>
      <section class="card">
        <h2>Bearing chart · stated vs revealed</h2>
        <p class="sub">The wider the shapes pull apart, the further this leader's words sit from their choices under pressure. Top traits by divergence.</p>
        <div class="legend">
          <span><i class="dot say"></i> Say — what they state</span>
          <span><i class="dot do"></i> Do — what they did</span>
        </div>
        <div class="chart-wrap"><canvas id="radar"></canvas></div>
      </section>

      <section class="card">
        <h2>Divergence leaderboard</h2>
        <p class="sub">Per trait: teal marks the stated score, amber marks the revealed score, the shaded span is the gap.</p>
        <div id="lead" class="lead"></div>
      </section>

      <section class="card" style="grid-column: 1 / -1;">
        <h2>Navigator conversation</h2>
        <p class="sub" id="tsub">The reflective chat scored by the Say judge. User turns are the ones assessed.</p>
        <div id="transcript" class="transcript"></div>
      </section>
    </div>
  </main>

  <script src="/saydo.js"></script>
</body>
</html>
```

## Appendix C — `public/saydo.js`

```js
// public/saydo.js — client for the Say–Do Gap demo page. Vanilla, no framework.
(function () {
  'use strict';

  var TOP_N = 8; // traits shown on the radar (most divergent)
  var els = {
    user: document.getElementById('user'),
    state: document.getElementById('state'),
    content: document.getElementById('content'),
    readouts: document.getElementById('readouts'),
    lead: document.getElementById('lead'),
    transcript: document.getElementById('transcript'),
    tsub: document.getElementById('tsub'),
    rSay: document.getElementById('r-say'),
    rDo: document.getElementById('r-do'),
    rBoth: document.getElementById('r-both'),
    rGap: document.getElementById('r-gap'),
  };
  var chart = null;
  var liveEnabled = false;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  async function api(path, opts) {
    var res = await fetch(path, opts);
    if (res.status === 401) { window.location.href = '/login.html'; throw new Error('unauth'); }
    if (!res.ok) {
      var body = {};
      try { body = await res.json(); } catch (e) {}
      throw new Error(body.error || ('Request failed (' + res.status + ')'));
    }
    return res.json();
  }

  function showState(msg, isErr) {
    els.state.textContent = msg;
    els.state.className = 'state' + (isErr ? ' err' : '');
    els.state.hidden = false;
    els.content.hidden = true;
    els.readouts.hidden = true;
  }

  // --- load user list ------------------------------------------------------
  async function loadUsers() {
    try {
      var data = await api('/api/saydo/users');
      var opts = ['<option value="">Choose a leader…</option>'];
      data.users.forEach(function (u) {
        var label = (u.name ? u.name + ' — ' : '') + u.email;
        var tag = u.hasBoth ? '  ✓ say+do' : (u.hasSay ? '  · say only' : '  · do only');
        opts.push('<option value="' + esc(u.email) + '"' + (u.hasBoth ? '' : ' data-partial="1"') + '>' + esc(label + tag) + '</option>');
      });
      els.user.innerHTML = opts.join('');
      if (!data.users.length) showState('No say or do data found yet. Apply the migration and run a Navigator conversation first.', true);
    } catch (e) {
      if (e.message !== 'unauth') showState('Could not load users. ' + e.message, true);
    }
  }

  // --- render --------------------------------------------------------------
  function renderReadouts(meta) {
    els.rSay.textContent = meta.sayTraitCount;
    els.rDo.textContent = meta.doTraitCount;
    els.rBoth.textContent = meta.comparableTraitCount;
    els.rGap.innerHTML = (meta.avgGap == null ? '–' : meta.avgGap.toFixed(1)) + '<small>/10</small>';
    els.readouts.hidden = false;
  }

  function renderRadar(traits) {
    var top = traits.slice(0, TOP_N);
    var labels = top.map(function (t) { return t.name; });
    var sayData = top.map(function (t) { return t.sayScore == null ? 5 : t.sayScore; });
    var doData = top.map(function (t) { return t.doScore == null ? 5 : t.doScore; });

    var cs = getComputedStyle(document.documentElement);
    var say = cs.getPropertyValue('--say').trim();
    var sayFill = cs.getPropertyValue('--say-fill').trim();
    var doo = cs.getPropertyValue('--do').trim();
    var doFill = cs.getPropertyValue('--do-fill').trim();
    var haze = cs.getPropertyValue('--haze').trim();

    if (chart) chart.destroy();
    chart = new Chart(document.getElementById('radar'), {
      type: 'radar',
      data: {
        labels: labels,
        datasets: [
          { label: 'Do', data: doData, borderColor: doo, backgroundColor: doFill, pointBackgroundColor: doo, borderWidth: 2, pointRadius: 3 },
          { label: 'Say', data: sayData, borderColor: say, backgroundColor: sayFill, pointBackgroundColor: say, borderWidth: 2, pointRadius: 3 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          r: {
            min: 0, max: 10, ticks: { stepSize: 2, color: haze, backdropColor: 'transparent', font: { family: 'Space Mono', size: 9 } },
            grid: { color: 'rgba(234,241,246,0.10)' },
            angleLines: { color: 'rgba(234,241,246,0.10)' },
            pointLabels: { color: '#EAF1F6', font: { family: 'Inter', size: 11 } },
          },
        },
      },
    });
  }

  function renderLeaderboard(traits) {
    var rows = traits.slice(0, 12).map(function (t) {
      var sayPct = ((t.sayScore == null ? 5 : t.sayScore) / 10) * 100;
      var doPct = ((t.doScore == null ? 5 : t.doScore) / 10) * 100;
      var lo = Math.min(sayPct, doPct), hi = Math.max(sayPct, doPct);
      var big = t.gap >= 3;
      return '' +
        '<div class="row">' +
          '<div class="top">' +
            '<span class="name">' + esc(t.name) + '</span>' +
            '<span class="tier">' + esc(t.tier) + esc(t.componentId ? ' · ' + t.componentId : '') + '</span>' +
            '<span class="gapval" style="color:' + (big ? 'var(--flare)' : 'var(--fg)') + '">Δ ' + t.gap.toFixed(1) + '</span>' +
          '</div>' +
          '<div class="track">' +
            '<div class="span" style="left:' + lo + '%;width:' + (hi - lo) + '%;background:' + (big ? 'var(--flare)' : 'var(--brass)') + '"></div>' +
            '<div class="mk say" style="left:' + sayPct + '%" title="Say ' + (t.sayScore == null ? 'n/a' : t.sayScore.toFixed(1)) + '"></div>' +
            '<div class="mk do" style="left:' + doPct + '%" title="Do ' + (t.doScore == null ? 'n/a' : t.doScore.toFixed(1)) + '"></div>' +
          '</div>' +
          '<div class="scaleline"><span>0</span><span>5</span><span>10</span></div>' +
        '</div>';
    });
    els.lead.innerHTML = rows.join('') || '<div class="state">No comparable traits yet.</div>';
  }

  function renderTranscript(transcript, email) {
    if (!transcript.length) {
      els.transcript.innerHTML = '<div class="state">No Navigator conversation stored for this leader.</div>';
      els.tsub.textContent = 'The reflective chat scored by the Say judge.';
      return;
    }
    els.tsub.textContent = liveEnabled
      ? 'User turns are the ones assessed. Hit “Score this turn” to watch the judge read it live.'
      : 'User turns are the ones assessed by the Say judge.';

    var html = [];
    for (var i = 0; i < transcript.length; i++) {
      var m = transcript[i];
      var isUser = m.role === 'user';
      var prevQ = '';
      for (var j = i - 1; j >= 0; j--) { if (transcript[j].role !== 'user') { prevQ = transcript[j].content; break; } }
      html.push(
        '<div class="msg ' + (isUser ? 'user' : 'assistant') + '">' +
          '<div class="who">' + esc(isUser ? 'Leader' : 'Navigator') + '</div>' +
          '<div>' + esc(m.content) + '</div>' +
          (isUser && liveEnabled
            ? '<button class="score-btn" data-i="' + i + '" data-q="' + esc(prevQ) + '">Score this turn ▸</button>' +
              '<div class="impacts" id="imp-' + i + '"></div>'
            : '') +
        '</div>'
      );
    }
    els.transcript.innerHTML = html.join('');

    els.transcript.querySelectorAll('.score-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { scoreTurn(btn, email, transcript); });
    });
  }

  // --- live, display-only turn scoring ------------------------------------
  async function scoreTurn(btn, email, transcript) {
    var i = Number(btn.getAttribute('data-i'));
    var q = btn.getAttribute('data-q') || '';
    var answer = transcript[i].content;
    var box = document.getElementById('imp-' + i);
    btn.disabled = true; btn.textContent = 'Scoring…';
    box.className = 'impacts show';
    box.innerHTML = '';
    try {
      var data = await api('/api/saydo/' + encodeURIComponent(email) + '/score-turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, answer: answer }),
      });
      if (!data.impacts.length) { box.innerHTML = '<div class="impact in"><span class="rat">No strong trait evidence in this turn.</span></div>'; }
      data.impacts.forEach(function (imp, k) {
        var row = document.createElement('div');
        row.className = 'impact';
        var sign = imp.impact >= 0 ? 'pos' : 'neg';
        var val = (imp.impact >= 0 ? '+' : '') + imp.impact.toFixed(2);
        row.innerHTML = '<span class="imp-v ' + sign + '">' + val + '</span>' +
          '<span><strong>' + esc(imp.name) + '</strong> ' +
          '<span class="rat">' + esc(imp.rationale) + '</span></span>';
        box.appendChild(row);
        setTimeout(function () { row.classList.add('in'); }, 90 * k + 40); // staggered reveal
      });
      btn.textContent = 'Scored (not saved)';
    } catch (e) {
      if (e.message !== 'unauth') { box.innerHTML = '<div class="impact in"><span class="rat">' + esc(e.message) + '</span></div>'; btn.disabled = false; btn.textContent = 'Score this turn ▸'; }
    }
  }

  // --- load one user -------------------------------------------------------
  async function loadUser(email) {
    if (!email) { showState('Select a leader to chart their say–do gap.'); return; }
    showState('Charting bearings…');
    try {
      var data = await api('/api/saydo/' + encodeURIComponent(email));
      liveEnabled = !!data.meta.liveScoringEnabled;
      if (!data.meta.hasTraitComparison) {
        showState('This leader has data on only one side, so there is no gap to chart yet. Pick a leader marked “say+do”.', true);
        return;
      }
      els.state.hidden = true;
      els.content.hidden = false;
      renderReadouts(data.meta);
      renderRadar(data.traits);
      renderLeaderboard(data.traits);
      renderTranscript(data.transcript, email);
    } catch (e) {
      if (e.message !== 'unauth') showState('Could not load this leader. ' + e.message, true);
    }
  }

  els.user.addEventListener('change', function () { loadUser(els.user.value); });
  loadUsers();
})();
```
