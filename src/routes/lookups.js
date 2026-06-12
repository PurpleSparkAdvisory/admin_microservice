const express = require('express');
const { supabase } = require('../supabase');

const router = express.Router();

// GET /api/organizations -> [{ id, name }]
router.get('/organizations', async (req, res) => {
  const { data, error } = await supabase
    .from('organizations')
    .select('id, name')
    .order('name', { ascending: true });

  if (error) {
    return res.status(500).json({ error: error.message });
  }
  return res.json(data);
});

// GET /api/teams[?organization_id=...] -> [{ id, name, organization_id }]
router.get('/teams', async (req, res) => {
  const { organization_id } = req.query;

  let query = supabase
    .from('teams')
    .select('id, name, organization_id')
    .order('name', { ascending: true });

  if (organization_id) {
    query = query.eq('organization_id', organization_id);
  }

  const { data, error } = await query;

  if (error) {
    return res.status(500).json({ error: error.message });
  }
  return res.json(data);
});

module.exports = router;
