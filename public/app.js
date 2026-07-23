const ROLES = ['admin', 'leader', 'general'];
const STATUSES = ['active', 'pending', 'inactive'];
const EDITABLE_FIELDS = ['role', 'organization_id', 'team_id', 'org_membership_status'];

let orgs = [];
let teams = [];
let users = [];
let displayUsers = [];
const sort = { key: null, dir: 'asc' };

const msgEl = document.getElementById('msg');
const usersBody = document.getElementById('usersBody');
const orgFilter = document.getElementById('orgFilter');
const roleFilter = document.getElementById('roleFilter');
const searchInput = document.getElementById('search');
const countPill = document.getElementById('countPill');
const saveAllBtn = document.getElementById('saveAllBtn');
const idsModal = document.getElementById('idsModal');
const idsBackdrop = document.getElementById('idsBackdrop');
const idsBody = document.getElementById('idsBody');
const idsSearch = document.getElementById('idsSearch');

function showMsg(text, type) {
  msgEl.textContent = text;
  msgEl.className = 'msg ' + type;
  if (type === 'success') {
    setTimeout(() => { msgEl.className = 'msg'; }, 3000);
  }
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (res.status === 401) {
    window.location.href = '/login.html';
    throw new Error('Unauthorized');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function optionList(values, selected) {
  return values
    .map((v) => `<option value="${escapeHtml(v)}" ${v === selected ? 'selected' : ''}>${escapeHtml(v)}</option>`)
    .join('');
}

function orgOptions(selectedId) {
  let html = '<option value="">— none —</option>';
  html += orgs
    .map((o) => `<option value="${o.id}" ${o.id === selectedId ? 'selected' : ''}>${escapeHtml(o.name)}</option>`)
    .join('');
  return html;
}

function teamOptions(orgId, selectedId) {
  const filtered = teams.filter((t) => !orgId || t.organization_id === orgId);
  let html = '<option value="">— none —</option>';
  html += filtered
    .map((t) => `<option value="${t.id}" ${t.id === selectedId ? 'selected' : ''}>${escapeHtml(t.name)}</option>`)
    .join('');
  return html;
}

function statusOptions(selected) {
  const values = [...STATUSES];
  if (selected && !values.includes(selected)) values.unshift(selected);
  return optionList(values, selected);
}

function compareValues(a, b) {
  const av = a == null ? '' : a;
  const bv = b == null ? '' : b;
  if (typeof av === 'number' && typeof bv === 'number') return av - bv;
  return String(av).localeCompare(String(bv), undefined, { sensitivity: 'base' });
}

function getSortValue(u, key) {
  if (key === 'completed') return u.sim_summary?.completed || 0;
  return u[key];
}

function applyClientFilters() {
  let list = [...users];
  if (roleFilter.value) list = list.filter((u) => u.role === roleFilter.value);
  return list;
}

function applySort(list) {
  if (!sort.key) return list;
  return [...list].sort((a, b) => {
    const cmp = compareValues(getSortValue(a, sort.key), getSortValue(b, sort.key));
    return sort.dir === 'asc' ? cmp : -cmp;
  });
}

function updateSortHeaders() {
  document.querySelectorAll('th.sortable').forEach((th) => {
    const key = th.dataset.sort;
    const icon = th.querySelector('.sort-icon');
    const active = sort.key === key;
    th.classList.toggle('sort-active', active);
    icon.textContent = active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕';
  });
}

function refreshDisplay() {
  displayUsers = applySort(applyClientFilters());
  renderUsers();
}

function onSortClick(key) {
  if (sort.key === key) {
    sort.dir = sort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    sort.key = key;
    sort.dir = 'asc';
  }
  refreshDisplay();
}

function completedSimsCell(u) {
  const s = u.sim_summary;
  if (!s || !s.completed) return '<span class="muted">None</span>';
  let html = `<strong>${s.completed}</strong>`;
  if (s.last_scenario) {
    html += ` <span class="muted">(latest: ${escapeHtml(s.last_scenario)})</span>`;
  }
  if (s.in_progress) {
    html += ` <span class="muted">· ${s.in_progress} in progress</span>`;
  }
  return html;
}

function renderUsers() {
  const rows = displayUsers;
  const total = rows.length;

  updateSortHeaders();

  if (!total) {
    usersBody.innerHTML = '<tr><td colspan="7" class="empty">No users match your filters.</td></tr>';
    countPill.textContent = '';
    updateSaveAllState();
    return;
  }

  countPill.textContent = `${total} user${total === 1 ? '' : 's'}`;

  usersBody.innerHTML = rows
    .map(
      (u) => `
    <tr data-email="${escapeHtml(u.email)}">
      <td>
        <div class="email-cell">${escapeHtml(u.email)}</div>
        <div class="name-cell">${escapeHtml(u.name || '')}</div>
      </td>
      <td><select data-field="role">${optionList(ROLES, u.role)}</select></td>
      <td><select data-field="organization_id">${orgOptions(u.organization_id)}</select></td>
      <td><select data-field="team_id">${teamOptions(u.organization_id, u.team_id)}</select></td>
      <td><select data-field="org_membership_status">${statusOptions(u.org_membership_status)}</select></td>
      <td>${completedSimsCell(u)}</td>
      <td class="row-actions">
        <button data-action="save" disabled>Save</button>
        <button class="secondary" data-action="sims">Sims</button>
      </td>
    </tr>`
    )
    .join('');

  attachRowHandlers();
  updateSaveAllState();
}

function rowOriginal(email) {
  return users.find((u) => u.email === email);
}

function rowIsDirty(tr, original) {
  return EDITABLE_FIELDS.some((f) => {
    const el = tr.querySelector(`[data-field="${f}"]`);
    return (el.value || '') !== (original[f] || '');
  });
}

function rowPatchBody(tr) {
  const original = rowOriginal(tr.dataset.email);
  const body = {};
  EDITABLE_FIELDS.forEach((f) => {
    const el = tr.querySelector(`[data-field="${f}"]`);
    const current = el.value || '';
    const orig = original[f] || '';
    if (current !== orig) body[f] = current === '' ? null : current;
  });
  return body;
}

function getDirtyRows() {
  return [...usersBody.querySelectorAll('tr[data-email]')].filter((tr) => {
    const original = rowOriginal(tr.dataset.email);
    return original && rowIsDirty(tr, original);
  });
}

function updateSaveAllState() {
  const n = getDirtyRows().length;
  saveAllBtn.disabled = n === 0;
  saveAllBtn.textContent = n ? `Save all (${n})` : 'Save all';
}

function refreshDirtyState(tr) {
  const original = rowOriginal(tr.dataset.email);
  const saveBtn = tr.querySelector('[data-action="save"]');
  saveBtn.disabled = !rowIsDirty(tr, original);
  EDITABLE_FIELDS.forEach((f) => {
    const el = tr.querySelector(`[data-field="${f}"]`);
    el.classList.toggle('dirty', (el.value || '') !== (original[f] || ''));
  });
  updateSaveAllState();
}

function attachRowHandlers() {
  usersBody.querySelectorAll('tr[data-email]').forEach((tr) => {
    const orgSelect = tr.querySelector('[data-field="organization_id"]');
    const teamSelect = tr.querySelector('[data-field="team_id"]');

    tr.querySelectorAll('select').forEach((sel) => {
      sel.addEventListener('change', () => {
        if (sel === orgSelect) {
          const currentTeam = teamSelect.value;
          teamSelect.innerHTML = teamOptions(orgSelect.value, currentTeam);
          const stillValid = teams.some(
            (t) => t.id === currentTeam && t.organization_id === orgSelect.value
          );
          if (!stillValid) teamSelect.value = '';
        }
        refreshDirtyState(tr);
      });
    });

    tr.querySelector('[data-action="save"]').addEventListener('click', () => saveRow(tr));
    tr.querySelector('[data-action="sims"]').addEventListener('click', () => toggleSims(tr));
  });
}

// Saves one row's pending changes in place (without re-rendering the table,
// so other rows keep their unsaved edits). Returns true on success.
async function commitRow(tr) {
  const email = tr.dataset.email;
  const body = rowPatchBody(tr);
  if (!Object.keys(body).length) return true;

  const updated = await api(`/api/users/${encodeURIComponent(email)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  const idx = users.findIndex((u) => u.email === email);
  if (idx !== -1) users[idx] = updated;
  refreshDirtyState(tr);
  return true;
}

async function saveRow(tr) {
  const email = tr.dataset.email;
  const saveBtn = tr.querySelector('[data-action="save"]');
  if (!Object.keys(rowPatchBody(tr)).length) return;

  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';

  try {
    await commitRow(tr);
    showMsg(`Saved ${email}.`, 'success');
  } catch (err) {
    showMsg(err.message, 'error');
    refreshDirtyState(tr);
  } finally {
    saveBtn.textContent = 'Save';
  }
}

async function saveAll() {
  const rows = getDirtyRows();
  if (!rows.length) return;

  saveAllBtn.disabled = true;
  saveAllBtn.textContent = 'Saving...';

  let saved = 0;
  const errors = [];
  for (const tr of rows) {
    const email = tr.dataset.email;
    try {
      await commitRow(tr);
      saved += 1;
    } catch (err) {
      errors.push(`${email}: ${err.message}`);
    }
  }

  updateSaveAllState();
  if (errors.length) {
    showMsg(`Saved ${saved}, ${errors.length} failed — ${errors[0]}`, 'error');
  } else {
    showMsg(`Saved ${saved} user${saved === 1 ? '' : 's'}.`, 'success');
  }
}

function fmtDuration(seconds) {
  if (seconds == null) return '—';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  return `${m}m ${seconds % 60}s`;
}

function fmtDate(iso) {
  return iso ? new Date(iso).toLocaleString() : '—';
}

async function toggleSims(tr) {
  const email = tr.dataset.email;
  const existing = tr.nextElementSibling;
  if (existing?.classList.contains('sim-row')) {
    existing.remove();
    return;
  }

  const simRow = document.createElement('tr');
  simRow.className = 'sim-row';
  simRow.innerHTML = '<td colspan="7"><div class="sim-panel muted">Loading...</div></td>';
  tr.after(simRow);

  try {
    const sims = await api(`/api/users/${encodeURIComponent(email)}/simulations`);
    const panel = simRow.querySelector('.sim-panel');
    const completed = sims.filter((s) => s.status === 'completed');

    if (!sims.length) {
      panel.innerHTML = 'No simulations yet.';
      return;
    }

    panel.classList.remove('muted');
    panel.innerHTML = `
      <div class="sim-panel-title">${completed.length} completed · ${sims.length - completed.length} other</div>
      <table class="sim-table">
        <thead>
          <tr>
            <th>Scenario</th>
            <th>Status</th>
            <th>Difficulty</th>
            <th>Attempt</th>
            <th>Duration</th>
            <th>Completed</th>
          </tr>
        </thead>
        <tbody>
          ${sims
            .map(
              (s) => `
            <tr class="${s.status === 'completed' ? 'sim-done' : ''}">
              <td>${escapeHtml(s.scenario_id)}</td>
              <td>${escapeHtml(s.status)}</td>
              <td>${escapeHtml(s.difficulty || '—')}</td>
              <td>${s.attempt_number ?? '—'}</td>
              <td>${fmtDuration(s.duration_seconds)}</td>
              <td>${fmtDate(s.completed_at)}</td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>`;
  } catch (err) {
    simRow.querySelector('.sim-panel').textContent = err.message;
  }
}

async function loadUsers() {
  usersBody.innerHTML = '<tr><td colspan="7" class="empty">Loading users...</td></tr>';
  const params = new URLSearchParams();
  if (searchInput.value.trim()) params.set('search', searchInput.value.trim());
  if (orgFilter.value) params.set('organization_id', orgFilter.value);

  try {
    users = await api(`/api/users?${params.toString()}`);
    refreshDisplay();
  } catch (err) {
    showMsg(err.message, 'error');
    usersBody.innerHTML = '<tr><td colspan="7" class="empty">Failed to load users.</td></tr>';
  }
}

async function init() {
  try {
    const me = await api('/api/me');
    document.getElementById('whoami').textContent = me.username ? `Signed in as ${me.username}` : '';
  } catch {
    return;
  }

  try {
    [orgs, teams] = await Promise.all([api('/api/organizations'), api('/api/teams')]);
    orgFilter.innerHTML =
      '<option value="">All organizations</option>' +
      orgs.map((o) => `<option value="${o.id}">${escapeHtml(o.name)}</option>`).join('');
  } catch (err) {
    showMsg('Failed to load orgs/teams: ' + err.message, 'error');
  }

  await loadUsers();
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    document.body.removeChild(ta);
    return ok;
  }
}

function flashButton(btn, text) {
  const original = btn.dataset.label || btn.textContent;
  btn.dataset.label = original;
  btn.textContent = text;
  setTimeout(() => {
    btn.textContent = btn.dataset.label;
  }, 1200);
}

function teamsByOrg() {
  const map = {};
  teams.forEach((t) => {
    (map[t.organization_id] = map[t.organization_id] || []).push(t);
  });
  return map;
}

function renderIdsReference() {
  const f = idsSearch.value.trim().toLowerCase();
  const byOrg = teamsByOrg();

  const matches = (name) => !f || (name || '').toLowerCase().includes(f);

  const cards = orgs
    .map((o) => {
      const orgTeams = byOrg[o.id] || [];
      const orgMatch = matches(o.name);
      const shownTeams = orgMatch ? orgTeams : orgTeams.filter((t) => matches(t.name));
      if (!orgMatch && !shownTeams.length) return '';

      const teamRows = shownTeams.length
        ? shownTeams
            .map(
              (t) => `
        <div class="id-row id-team">
          <div class="id-info">
            <div class="id-name">${escapeHtml(t.name)}</div>
            <code class="id-value">${escapeHtml(t.id)}</code>
          </div>
          <button class="secondary id-copy" type="button" data-copy="${escapeHtml(t.id)}">Copy ID</button>
        </div>`
            )
            .join('')
        : '<div class="id-empty muted">No teams in this organization.</div>';

      return `
      <div class="id-card">
        <div class="id-row id-org">
          <div class="id-info">
            <div class="id-label">Organization</div>
            <div class="id-name">${escapeHtml(o.name)}</div>
            <code class="id-value">${escapeHtml(o.id)}</code>
          </div>
          <button class="secondary id-copy" type="button" data-copy="${escapeHtml(o.id)}">Copy ID</button>
        </div>
        <div class="id-teams">${teamRows}</div>
      </div>`;
    })
    .join('');

  idsBody.innerHTML = cards || '<div class="muted" style="padding:16px">No matches.</div>';

  idsBody.querySelectorAll('.id-copy').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await copyText(btn.dataset.copy);
      flashButton(btn, ok ? 'Copied!' : 'Copy failed');
    });
  });
}

function buildCopyAllText() {
  const byOrg = teamsByOrg();
  return orgs
    .map((o) => {
      const orgTeams = byOrg[o.id] || [];
      const lines = [`${o.name} (org): ${o.id}`];
      orgTeams.forEach((t) => lines.push(`  ${t.name} (team): ${t.id}`));
      return lines.join('\n');
    })
    .join('\n\n');
}

function openIdsModal() {
  idsSearch.value = '';
  renderIdsReference();
  idsModal.classList.remove('hidden');
  idsBackdrop.classList.remove('hidden');
  document.body.classList.add('modal-open');
  idsSearch.focus();
}

function closeIdsModal() {
  idsModal.classList.add('hidden');
  idsBackdrop.classList.add('hidden');
  document.body.classList.remove('modal-open');
}

document.getElementById('idsBtn').addEventListener('click', openIdsModal);
document.getElementById('idsClose').addEventListener('click', closeIdsModal);
idsBackdrop.addEventListener('click', closeIdsModal);
idsSearch.addEventListener('input', renderIdsReference);
document.getElementById('copyAllBtn').addEventListener('click', async (e) => {
  const ok = await copyText(buildCopyAllText());
  flashButton(e.currentTarget, ok ? 'Copied!' : 'Copy failed');
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !idsModal.classList.contains('hidden')) closeIdsModal();
});

document.getElementById('saydoBtn').addEventListener('click', () => {
  window.location.href = '/saydo.html';
});
document.getElementById('refreshBtn').addEventListener('click', loadUsers);
document.getElementById('clearBtn').addEventListener('click', () => {
  searchInput.value = '';
  orgFilter.value = '';
  roleFilter.value = '';
  sort.key = null;
  sort.dir = 'asc';
  loadUsers();
});
roleFilter.addEventListener('change', refreshDisplay);
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loadUsers();
});
document.querySelectorAll('th.sortable').forEach((th) => {
  th.addEventListener('click', () => onSortClick(th.dataset.sort));
});
saveAllBtn.addEventListener('click', saveAll);
document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/login.html';
});

init();
