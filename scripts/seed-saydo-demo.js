// scripts/seed-saydo-demo.js
//
// Demo seed for the Say–Do Gap page. Adds Say-layer scores for an existing user
// on traits they ALREADY have Do scores for, so the two sides overlap and the gap
// actually renders. This is the ONLY write path in this repo and it touches ONLY
// `user_say_component_scores` for one user — nothing else.
//
//   Seed:     node scripts/seed-saydo-demo.js
//   Teardown: node scripts/seed-saydo-demo.js --remove
//
// Idempotent: seeding upserts on (user_id, component_id); teardown deletes exactly
// the component_ids listed below and leaves the user's pre-existing Say rows intact.

require('dotenv').config();
const { supabase } = require('../src/supabase');

const USER_ID = 'omilaherath1@gmail.com';
// A real user message id from this user's transcript (satisfies the FK if enforced).
const LAST_MESSAGE_ID = 'msg_roiqbvv2mqueee5d';

// Each entry: the trait's UUID (component_id in the score table), a human label for
// logging, the Say score to set, and how many "turns" of evidence to show.
// `do` is the user's real Do score at seed time, kept here only to document the story.
const SEED = [
  // ── Red flares: says it, doesn't do it (say >> do) ─────────────────────────
  { id: 'c2444fd5-fcf6-4949-982a-32e17b7e2e24', label: 'C001 Integrity',            do: 1.29, say: 9.2, n: 6 },
  { id: '6e778ce3-aeed-4ea4-b620-8db44cedb2a9', label: 'C002 Decisiveness',         do: 0.00, say: 7.0, n: 4 },
  { id: 'c50fb8f7-f11c-4d72-8509-b3026d039d88', label: 'C004 Courage',              do: 0.70, say: 7.5, n: 3 },
  { id: '44a89da5-2cdf-4c83-9e66-b8f0d91a7272', label: 'C008 Accountability',       do: 1.34, say: 8.0, n: 4 },
  { id: '4ca800d5-bac9-411c-b6d0-8e4490e88028', label: 'C038 Decision Reasoning',   do: 5.03, say: 8.5, n: 4 },
  // ── Quiet strengths: does it, doesn't claim it (do >> say) ─────────────────
  { id: '06bac06c-f1cf-425a-a8bb-3ecb18f6a6bc', label: 'C012 Active Listening',     do: 10.0, say: 4.5, n: 5 },
  { id: '515c0428-012f-4502-a0c3-f8c7d157f701', label: 'C010 Follow-Through',       do: 6.96, say: 3.0, n: 3 },
  // ── Aligned: words match actions (small gap → credibility) ─────────────────
  { id: 'b72e967c-caa5-4ac6-bc0a-c85329d4235a', label: 'C031 Stakeholder Reading',  do: 10.0, say: 9.0, n: 4 },
  { id: '7494d5ad-1386-4cd8-92d1-9e7be3cdb4db', label: 'C035 Values Articulation',  do: 9.28, say: 8.5, n: 5 },
  { id: '16031075-438c-48b4-a73c-33edfc685c79', label: 'C023 Strategic Foresight',  do: 5.18, say: 5.2, n: 3 },
  { id: 'c9f004d9-9b66-4562-a906-1d06bfeff7d9', label: 'C036 Limits Awareness',     do: 0.53, say: 1.2, n: 2 },
];

const REMOVE = process.argv.includes('--remove');

async function main() {
  console.log('Target user:', USER_ID);
  console.log('Table:', 'user_say_component_scores', '(only)');
  const ids = SEED.map((s) => s.id);

  if (REMOVE) {
    console.log(`\nTEARDOWN — deleting ${ids.length} seeded Say rows...`);
    const { error } = await supabase
      .from('user_say_component_scores')
      .delete()
      .eq('user_id', USER_ID)
      .in('component_id', ids);
    if (error) throw error;
    console.log('Removed. The user\'s pre-existing Say rows were untouched.');
    return;
  }

  const now = new Date().toISOString();
  const rows = SEED.map((s) => ({
    user_id: USER_ID,
    component_id: s.id,
    score: s.say,
    evidence_count: s.n,
    last_message_id: LAST_MESSAGE_ID,
    updated_at: now,
  }));

  console.log(`\nSEED — upserting ${rows.length} Say rows...\n`);
  const { error } = await supabase
    .from('user_say_component_scores')
    .upsert(rows, { onConflict: 'user_id,component_id' });
  if (error) throw error;

  console.log('  trait                          do     say    gap');
  console.log('  ' + '-'.repeat(48));
  SEED.slice()
    .sort((a, b) => Math.abs(b.do - b.say) - Math.abs(a.do - a.say))
    .forEach((s) => {
      const gap = Math.abs(s.do - s.say).toFixed(1);
      console.log(
        '  ' + s.label.padEnd(30),
        String(s.do.toFixed(1)).padStart(4),
        String(s.say.toFixed(1)).padStart(6),
        String(gap).padStart(6),
      );
    });
  console.log('\nDone. Open /saydo.html and pick ' + USER_ID + '.');
  console.log('To undo: node scripts/seed-saydo-demo.js --remove');
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
