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
