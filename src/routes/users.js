const express = require('express');
const { supabase } = require('../supabase');

const router = express.Router();

const ALLOWED_ROLES = ['admin', 'leader', 'general'];

const EMPTY_SIM_SUMMARY = {
  completed: 0,
  in_progress: 0,
  total: 0,
  last_scenario: null,
  last_activity_at: null,
};

function buildSimSummaryMap(sessions) {
  const map = new Map();
  for (const s of sessions || []) {
    const uid = s.user_id;
    if (!map.has(uid)) {
      map.set(uid, { ...EMPTY_SIM_SUMMARY, completed: 0, in_progress: 0, total: 0 });
    }
    const entry = map.get(uid);
    entry.total += 1;
    if (s.status === 'completed') entry.completed += 1;
    else if (s.status === 'in_progress') entry.in_progress += 1;

    const activityAt = s.completed_at || s.started_at;
    if (
      activityAt &&
      (!entry.last_activity_at || activityAt > entry.last_activity_at)
    ) {
      entry.last_activity_at = activityAt;
      entry.last_scenario = s.scenario_id;
    }
  }
  return map;
}

function mapUserRow(u, simMap) {
  return {
    email: u.email,
    name: u.name,
    role: u.role,
    org_membership_status: u.org_membership_status,
    organization_id: u.organization_id,
    organization_name: u.organizations ? u.organizations.name : null,
    team_id: u.team_id,
    team_name: u.teams ? u.teams.name : null,
    sim_summary: simMap.get(u.email) || { ...EMPTY_SIM_SUMMARY },
  };
}

// GET /api/users[?search=&organization_id=]
// Lists users with resolved organization and team names.
router.get('/', async (req, res) => {
  const { search, organization_id } = req.query;

  let query = supabase
    .from('users')
    .select(
      'email, name, role, org_membership_status, organization_id, team_id, organizations(name), teams(name)'
    )
    .order('email', { ascending: true });

  if (search) {
    query = query.ilike('email', `%${search}%`);
  }
  if (organization_id) {
    query = query.eq('organization_id', organization_id);
  }

  const { data, error } = await query;
  if (error) {
    return res.status(500).json({ error: error.message });
  }

  const { data: sessions, error: sessionsError } = await supabase
    .from('helmsman_sessions')
    .select('user_id, status, scenario_id, completed_at, started_at');

  if (sessionsError) {
    return res.status(500).json({ error: sessionsError.message });
  }

  const simMap = buildSimSummaryMap(sessions);
  const users = (data || []).map((u) => mapUserRow(u, simMap));

  return res.json(users);
});

// PATCH /api/users/:email
// Accepts a partial body: { role?, organization_id?, team_id?, org_membership_status? }
router.patch('/:email', async (req, res) => {
  const email = decodeURIComponent(req.params.email);
  const body = req.body || {};
  const update = {};

  if (Object.prototype.hasOwnProperty.call(body, 'role')) {
    if (!ALLOWED_ROLES.includes(body.role)) {
      return res
        .status(400)
        .json({ error: `Invalid role. Must be one of: ${ALLOWED_ROLES.join(', ')}.` });
    }
    update.role = body.role;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'organization_id')) {
    update.organization_id = body.organization_id || null;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'team_id')) {
    update.team_id = body.team_id || null;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'org_membership_status')) {
    update.org_membership_status = body.org_membership_status || null;
  }

  if (Object.keys(update).length === 0) {
    return res.status(400).json({ error: 'No updatable fields provided.' });
  }

  // Validate that a chosen team belongs to the chosen/effective organization.
  if (update.team_id) {
    const { data: team, error: teamError } = await supabase
      .from('teams')
      .select('id, organization_id')
      .eq('id', update.team_id)
      .single();

    if (teamError || !team) {
      return res.status(400).json({ error: 'Team not found.' });
    }

    // Effective org: the one being set in this request, otherwise the user's current org.
    let effectiveOrgId = update.organization_id;
    if (effectiveOrgId === undefined) {
      const { data: current, error: curErr } = await supabase
        .from('users')
        .select('organization_id')
        .eq('email', email)
        .single();
      if (curErr || !current) {
        return res.status(404).json({ error: 'User not found.' });
      }
      effectiveOrgId = current.organization_id;
    }

    if (team.organization_id !== effectiveOrgId) {
      return res.status(400).json({
        error: 'Selected team does not belong to the selected organization.',
      });
    }
  }

  update.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('users')
    .update(update)
    .eq('email', email)
    .select(
      'email, name, role, org_membership_status, organization_id, team_id, organizations(name), teams(name)'
    )
    .single();

  if (error) {
    return res.status(500).json({ error: error.message });
  }
  if (!data) {
    return res.status(404).json({ error: 'User not found.' });
  }

  const { data: sessions } = await supabase
    .from('helmsman_sessions')
    .select('user_id, status, scenario_id, completed_at, started_at')
    .eq('user_id', email);

  const simMap = buildSimSummaryMap(sessions);

  return res.json(mapUserRow(data, simMap));
});

// GET /api/users/:email/simulations
// Read-only Purple Spark (Helmsman) simulation history with computed duration.
router.get('/:email/simulations', async (req, res) => {
  const email = decodeURIComponent(req.params.email);

  const { data, error } = await supabase
    .from('helmsman_sessions')
    .select('id, scenario_id, status, difficulty, attempt_number, started_at, completed_at')
    .eq('user_id', email)
    .order('started_at', { ascending: false });

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  const sessions = (data || []).map((s) => {
    let durationSeconds = null;
    if (s.started_at && s.completed_at) {
      const ms = new Date(s.completed_at).getTime() - new Date(s.started_at).getTime();
      durationSeconds = ms >= 0 ? Math.round(ms / 1000) : null;
    }
    return { ...s, duration_seconds: durationSeconds };
  });

  return res.json(sessions);
});

module.exports = router;
