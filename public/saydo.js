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
    chart: document.getElementById('chart'),
    rSay: document.getElementById('r-say'),
    rDo: document.getElementById('r-do'),
    rBoth: document.getElementById('r-both'),
    rGap: document.getElementById('r-gap'),
  };
  var liveEnabled = false;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Turn an internal trait name like "Integrity - Overt Action Signals" into a
  // clean primary label plus a plain-language qualifier, so the UI shows product
  // language instead of the internal taxonomy.
  var QUAL = {
    'Overt Action Signals': 'in action',
    'Inferred State Signals': 'beneath the surface',
    'Self-Report Signals': 'self-reported',
    'Self-Report': 'self-reported',
  };
  function splitName(name) {
    var i = String(name || '').indexOf(' - ');
    if (i === -1) return { primary: name || '', qual: '' };
    var rest = name.slice(i + 3);
    return { primary: name.slice(0, i), qual: QUAL[rest] || rest.toLowerCase() };
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

  // A single 0–10 bar. Self-contained HTML/CSS — no charting library.
  function bar(cls, tag, score) {
    var pct = Math.max(0, Math.min(100, (score / 10) * 100));
    return '<div class="bar ' + cls + '">' +
      '<div class="bar-fill" style="width:' + pct + '%"></div>' +
      '<span class="bar-tag">' + tag + '<b>' + score.toFixed(1) + '</b></span>' +
    '</div>';
  }

  // Top traits by gap that have BOTH a Say and a Do score (a real comparison).
  function renderChart(traits) {
    var rows = traits.filter(function (t) { return t.bothSided; }).slice(0, TOP_N);
    if (!rows.length) {
      els.chart.innerHTML = '<div class="state">No trait has both a Say and a Do score yet.</div>';
      return;
    }
    els.chart.innerHTML = rows.map(function (t) {
      var sp = splitName(t.name);
      var big = t.gap >= 3;
      return '<div class="bar-row">' +
        '<div class="bar-head">' +
          '<span class="bar-name">' + esc(sp.primary) +
            (sp.qual ? '<span class="bar-qual">' + esc(sp.qual) + '</span>' : '') +
          '</span>' +
          '<span class="bar-delta' + (big ? ' big' : '') + '">Gap <b>' + t.gap.toFixed(1) + '</b></span>' +
        '</div>' +
        bar('say', 'Say', t.sayScore) +
        bar('do', 'Do', t.doScore) +
      '</div>';
    }).join('') + '<div class="bar-scale"><span>0</span><span>5</span><span>10</span></div>';
  }

  function renderLeaderboard(traits) {
    var rows = traits.filter(function (t) { return t.bothSided; }).slice(0, 12).map(function (t) {
      var sayPct = ((t.sayScore == null ? 5 : t.sayScore) / 10) * 100;
      var doPct = ((t.doScore == null ? 5 : t.doScore) / 10) * 100;
      var lo = Math.min(sayPct, doPct), hi = Math.max(sayPct, doPct);
      var big = t.gap >= 3;
      var sp = splitName(t.name);
      return '' +
        '<div class="row">' +
          '<div class="top">' +
            '<span class="name">' + esc(sp.primary) + '</span>' +
            (sp.qual ? '<span class="qual">' + esc(sp.qual) + '</span>' : '') +
            '<span class="gapval">Gap <b style="color:' + (big ? 'var(--flare)' : 'var(--fg)') + '">' + t.gap.toFixed(1) + '</b></span>' +
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
      els.transcript.innerHTML = '<div class="state">No reflection stored for this leader.</div>';
      els.tsub.textContent = 'The leader’s own written reflection.';
      return;
    }
    els.tsub.textContent = 'The leader’s own written reflection. Their stated values are drawn from the turns they wrote.';

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
    if (!email) { showState('Choose a leader above to see how their stated values line up with their decisions under pressure.'); return; }
    showState('Charting bearings…');
    try {
      var data = await api('/api/saydo/' + encodeURIComponent(email));
      liveEnabled = !!data.meta.liveScoringEnabled;
      if (!data.meta.hasTraitComparison) {
        showState('No trait has been scored on both sides yet for this leader, so there is no gap to chart. A gap needs at least one trait with both a Say and a Do score.', true);
        return;
      }
      els.state.hidden = true;
      els.content.hidden = false;
      renderReadouts(data.meta);
      renderChart(data.traits);
      renderLeaderboard(data.traits);
      renderTranscript(data.transcript, email);
    } catch (e) {
      if (e.message !== 'unauth') showState('Could not load this leader. ' + e.message, true);
    }
  }

  els.user.addEventListener('change', function () { loadUser(els.user.value); });
  loadUsers();
})();
