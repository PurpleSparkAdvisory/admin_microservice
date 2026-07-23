// One-off, READ-ONLY schema inspector.
// Uses the existing service-role client. Enumerates public tables via the
// PostgREST OpenAPI root, then samples the interesting ones. Writes nothing.
require('dotenv').config();

const { supabase } = require('../src/supabase');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Category matchers for step 2.
const CATEGORIES = [
  { label: 'conversations / chat', re: /conversation|chat|message|navigator/i },
  { label: 'fingerprint / traits', re: /trait|fingerprint|profile|component|vector/i },
  { label: 'say / do / gap scoring', re: /say|_do_|(^|_)do($|_)|gap|score|z_?score/i },
];

function categoriesFor(name) {
  return CATEGORIES.filter((c) => c.re.test(name)).map((c) => c.label);
}

// Pull the OpenAPI (Swagger) root PostgREST serves at /rest/v1/.
// Its `definitions` gives us every exposed table AND its columns (even when empty).
async function fetchOpenApi() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!res.ok) throw new Error(`OpenAPI root ${res.status}: ${await res.text()}`);
  return res.json();
}

function tablesFromOpenApi(spec) {
  const out = {};
  const defs = spec.definitions || {};
  for (const [name, def] of Object.entries(defs)) {
    out[name] = Object.keys((def && def.properties) || {});
  }
  // Fall back to paths if definitions is empty for some PostgREST versions.
  if (Object.keys(out).length === 0 && spec.paths) {
    for (const p of Object.keys(spec.paths)) {
      if (p.length > 1 && !p.startsWith('/rpc/')) out[p.slice(1)] = [];
    }
  }
  return out;
}

async function sampleRow(table) {
  const { data, error } = await supabase.from(table).select('*').limit(1);
  if (error) return { error: error.message };
  return { row: (data && data[0]) || null };
}

async function countRows(table) {
  const { count, error } = await supabase
    .from(table)
    .select('*', { count: 'exact', head: true });
  if (error) return { error: error.message };
  return { count };
}

async function main() {
  console.log('SUPABASE_URL:', SUPABASE_URL);
  console.log('='.repeat(72));

  const spec = await fetchOpenApi();
  const tables = tablesFromOpenApi(spec);
  const names = Object.keys(tables).sort();

  // ---- Step 1: all tables in public schema ----
  console.log(`\n[1] PUBLIC-SCHEMA TABLES (${names.length})\n`);
  for (const n of names) {
    const cats = categoriesFor(n);
    console.log(`  - ${n}${cats.length ? '   << ' + cats.join(', ') : ''}`);
  }

  // ---- Step 2: fingerprint interesting tables ----
  const interesting = names.filter((n) => categoriesFor(n).length > 0);
  console.log(`\n${'='.repeat(72)}`);
  console.log(`\n[2] FINGERPRINT OF INTERESTING TABLES (${interesting.length})`);
  for (const t of interesting) {
    console.log(`\n${'-'.repeat(60)}`);
    console.log(`TABLE: ${t}   [${categoriesFor(t).join(', ')}]`);
    console.log('columns:', tables[t].length ? tables[t].join(', ') : '(none reported)');
    const { count } = await countRows(t);
    console.log('row count:', count === undefined ? '(unknown)' : count);
    const { row, error } = await sampleRow(t);
    if (error) console.log('sample error:', error);
    else console.log('sample row:', row ? JSON.stringify(row, null, 2) : '(empty table)');
  }

  // ---- Step 3: 54-trait do/say specifics ----
  console.log(`\n${'='.repeat(72)}`);
  console.log('\n[3] 54-TRAIT SCORING: DO vs SAY');

  const doTable = 'user_component_scores';
  const sayTable = 'user_say_component_scores';
  const catalogue = 'trait_components';

  for (const [role, t] of [['CATALOGUE', catalogue], ['DO-scores', doTable], ['SAY-scores', sayTable]]) {
    console.log(`\n${role}: ${t}`);
    if (!(t in tables)) {
      console.log('  >> table NOT present in public schema (not exposed / does not exist)');
      continue;
    }
    console.log('  columns:', tables[t].join(', '));
    const { count, error: cErr } = await countRows(t);
    console.log('  row count:', cErr ? `error: ${cErr}` : count);
    const { row } = await sampleRow(t);
    console.log('  sample row:', row ? JSON.stringify(row) : '(empty table)');
  }

  const sayExists = sayTable in tables;
  const { count: sayCount } = sayExists ? await countRows(sayTable) : { count: 0 };
  console.log(`\nCONCLUSION: say-scores table ${sayExists ? 'EXISTS' : 'does NOT exist'}; ` +
    `${sayExists ? (sayCount > 0 ? `has ${sayCount} rows` : 'has 0 rows') : 'n/a'}.`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
