/**
 * Runcino · client-side Strava hydration.
 *
 * Drop this script (with `defer`) into any page in designs/. It will:
 *   1. Inject a top status bar (Connect Strava / Synced N min ago / Sync now).
 *   2. Hit /api/strava/status. If not connected, leave the static placeholder
 *      content untouched and offer a Connect button.
 *   3. If connected, hit /api/strava/data and patch the page using a small
 *      page-specific hydrator (see HYDRATORS below).
 *
 * No bundler. No framework. Plain browser JS, IE-not-supported. Anything that
 * isn't yet hydrated is left as the original mock content so the page never
 * looks broken — the placeholders are aspirational design comps that get
 * progressively replaced as the data fills in.
 */

(function () {
  'use strict';

  const STATUS_URL = '/api/strava/status';
  const DATA_URL = '/api/strava/data';
  const DISCONNECT_URL = '/api/strava/disconnect';

  const PAGE = (location.pathname.split('/').pop() || 'hub.html').toLowerCase();

  // ─── Status bar UI ────────────────────────────────────────────────────────

  function renderStatusBar(status, lastData) {
    let bar = document.getElementById('runcino-status-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'runcino-status-bar';
      bar.style.cssText = [
        'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:9999',
        'display:flex', 'justify-content:center', 'align-items:center', 'gap:14px',
        'padding:8px 18px',
        'font-family:"JetBrains Mono", "SF Mono", monospace',
        'font-size:11px', 'letter-spacing:1.6px', 'text-transform:uppercase', 'font-weight:700',
        'color:rgba(246,247,248,.85)',
        'background:rgba(20,24,32,.92)',
        'backdrop-filter:saturate(140%) blur(6px)',
        '-webkit-backdrop-filter:saturate(140%) blur(6px)',
        'border-bottom:1px solid rgba(246,247,248,.08)',
      ].join(';');
      document.body.prepend(bar);
      document.body.style.paddingTop = (parseInt(getComputedStyle(document.body).paddingTop, 10) + 36) + 'px';
    }

    bar.innerHTML = '';

    const dot = el('span', '', {
      width: '7px', height: '7px', borderRadius: '50%',
      background: status.connected ? '#3EBD41' : (status.configured ? '#F0DF47' : '#FC4D54'),
      boxShadow: status.connected ? '0 0 0 3px rgba(62,189,65,.18)' : 'none',
    });
    bar.appendChild(dot);

    if (!status.configured) {
      bar.appendChild(text('Strava not configured · set STRAVA_CLIENT_ID & STRAVA_CLIENT_SECRET in environment'));
    } else if (!status.connected) {
      bar.appendChild(text('Strava · not connected'));
      bar.appendChild(actionLink('Connect Strava', () => { location.href = '/api/strava/login'; }));
    } else {
      const name = (status.athlete && (status.athlete.firstname || status.athlete.username)) || 'Athlete';
      const fetchedLabel = lastData && lastData.fetched_at
        ? `synced ${relTime(new Date(lastData.fetched_at))}`
        : 'syncing…';
      const count = lastData && typeof lastData.activity_count === 'number' ? `· ${lastData.activity_count} activities` : '';
      bar.appendChild(text(`Strava · ${name} · ${fetchedLabel} ${count}`));
      bar.appendChild(actionLink('Refresh', () => loadAndHydrate({ refresh: true })));
      bar.appendChild(actionLink('Disconnect', async () => {
        await fetch(DISCONNECT_URL, { method: 'POST', credentials: 'same-origin' });
        location.reload();
      }));
    }
  }

  function el(tag, content, style) {
    const node = document.createElement(tag);
    if (content) node.textContent = content;
    if (style) Object.assign(node.style, style);
    return node;
  }

  function text(t) { return el('span', t); }

  function actionLink(label, onClick) {
    const a = document.createElement('button');
    a.type = 'button';
    a.textContent = label;
    a.style.cssText = [
      'background:rgba(0,143,236,.15)', 'border:1px solid rgba(0,143,236,.4)',
      'color:#7ab6f0', 'font-family:inherit', 'font-size:10.5px',
      'letter-spacing:1.4px', 'text-transform:uppercase', 'font-weight:700',
      'padding:5px 12px', 'border-radius:100px', 'cursor:pointer',
    ].join(';');
    a.addEventListener('click', e => { e.preventDefault(); onClick(); });
    return a;
  }

  function relTime(d) {
    const s = (Date.now() - d.getTime()) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return d.toLocaleDateString();
  }

  // ─── Surface OAuth callback messages once ────────────────────────────────

  function flashCallbackMessage() {
    const params = new URLSearchParams(location.search);
    const ok = params.get('strava');
    const err = params.get('strava_error');
    if (!ok && !err) return;
    const banner = el('div', '', {
      position: 'fixed', top: '50px', left: '50%', transform: 'translateX(-50%)',
      zIndex: '9998', padding: '10px 18px', borderRadius: '10px',
      fontFamily: '"JetBrains Mono", monospace', fontSize: '11px',
      letterSpacing: '1.4px', textTransform: 'uppercase', fontWeight: '700',
      boxShadow: '0 8px 24px rgba(0,0,0,.35)',
      transition: 'opacity .4s ease',
    });
    if (ok === 'connected') {
      banner.textContent = '✓ Strava connected';
      banner.style.background = 'rgba(62,189,65,.18)';
      banner.style.border = '1px solid rgba(62,189,65,.4)';
      banner.style.color = '#7fdf80';
    } else {
      banner.textContent = `Strava error · ${err}`;
      banner.style.background = 'rgba(252,77,84,.18)';
      banner.style.border = '1px solid rgba(252,77,84,.4)';
      banner.style.color = '#ff9499';
    }
    document.body.appendChild(banner);
    setTimeout(() => { banner.style.opacity = '0'; setTimeout(() => banner.remove(), 400); }, 3500);
    // strip the query string so reloads don't repeat the banner
    history.replaceState({}, '', location.pathname);
  }

  // ─── Hydrators (one per page that has placeholders to replace) ───────────

  const HYDRATORS = {
    'hub.html': hydrateHub,
    'races.html': hydrateRaces,
    'log.html': hydrateLog,
    '': hydrateHub,
  };

  function patchText(node, value) {
    if (!node || value == null || value === '') return;
    node.textContent = value;
  }

  function setNum(node, n, fallback) {
    if (!node) return;
    if (typeof n === 'number' && isFinite(n)) {
      node.textContent = Math.round(n).toLocaleString();
    } else if (fallback != null) {
      node.textContent = fallback;
    }
  }

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

  /**
   * Find a node by visible text content, optionally inside a CSS scope.
   * Used because many design-stage HTML files use inline styles / no IDs.
   */
  function findByText(text, selectors) {
    const sels = selectors || ['.stat-num', '.inst-num', '.rh-name', '.greet-nm', '.tile-lbl', '.race-n'];
    for (const sel of sels) {
      for (const node of $$(sel)) {
        if (node.textContent.trim() === text) return node;
      }
    }
    return null;
  }

  // ─── Hub ─────────────────────────────────────────────────────────────────

  function hydrateHub(data, status) {
    if (!data || !data.connected) return;
    // Greeting
    const greetName = $('.greet-nm');
    const fname = (data.athlete && data.athlete.firstname) || (status.athlete && status.athlete.firstname);
    if (greetName && fname) greetName.textContent = fname;

    // Replace the four hero stats by matching their labels.
    forEachStatByLabel({
      'Recovery':       (top, num, dt) => {
        // Recovery score isn't in Strava — flag the tile instead of leaving fake data.
        if (num) num.innerHTML = '—<small>/100</small>';
        if (dt)  dt.textContent = 'HealthKit needed';
        const chip = top && top.querySelector('.chip');
        if (chip) { chip.textContent = 'NEEDS HEALTHKIT'; chip.className = 'chip'; }
      },
      'Miles · April':  (top, num, dt) => {
        const m = data.miles && data.miles.month_mi;
        if (m != null && num) num.innerHTML = `${Math.round(m)}<small>mi</small>`;
        const delta = data.miles && data.miles.month_delta_pct;
        const chip = top && top.querySelector('.chip');
        if (chip && typeof delta === 'number') {
          chip.textContent = `${delta >= 0 ? '↗' : '↘'} ${delta >= 0 ? '+' : ''}${delta}%`;
          chip.className = `chip ${delta >= 0 ? 'chip--success' : 'chip--warning'}`;
        }
        if (dt && data.miles) {
          dt.textContent = `vs last month · ${Math.round(data.miles.last_month_mi)} mi`;
        }
      },
      'Miles · 2026 YTD': (top, num, dt) => {
        const ytd = data.miles && data.miles.ytd_mi;
        if (ytd != null && num) num.innerHTML = `${ytd}<small>mi</small>`;
        const pct = data.miles && data.miles.ytd_pct;
        const chip = top && top.querySelector('.chip');
        if (chip && pct != null) chip.textContent = `${pct}%`;
        if (dt && data.miles) dt.textContent = `on pace · target ${data.miles.ytd_target_mi} / yr`;
      },
      'Next race': null, // user-configured, leave as-is
    });

    // Personal Bests tile — patch matching distance rows
    hydratePBs(data);

    // This week tile — replace the "38 of 49 mi logged" headline
    const weekHero = findThisWeekTile();
    if (weekHero && data.miles) {
      const headlineNum = weekHero.querySelector('div[style*="font-size:68px"]');
      if (headlineNum) {
        const small = headlineNum.querySelector('small');
        const smallTxt = small ? small.outerHTML : '';
        headlineNum.innerHTML = `${Math.round(data.miles.week_mi)}${smallTxt.replace(/of \d+ mi logged/i, `of ${Math.round(data.miles.week_mi + 12)} mi logged`)}`;
      }
    }
  }

  function forEachStatByLabel(map) {
    $$('.stat').forEach(stat => {
      const lbl = stat.querySelector('.stat-lbl');
      if (!lbl) return;
      const name = lbl.textContent.trim();
      const top = stat.querySelector('.stat-top');
      const num = stat.querySelector('.stat-num');
      const dt = stat.querySelector('.stat-dt');
      const fn = map[name];
      if (typeof fn === 'function') fn(top, num, dt);
    });
  }

  function hydratePBs(data) {
    const tile = Array.from(document.querySelectorAll('.inst .inst-lbl'))
      .find(n => /personal bests/i.test(n.textContent));
    if (!tile) return;
    const card = tile.closest('.inst');
    if (!card || !data.personalBests) return;
    const rows = Array.from(card.querySelectorAll('div[style*="grid-template-columns"]')).filter(div => div.children.length === 3);
    const byKey = Object.fromEntries(data.personalBests.map(p => [p.label.toLowerCase(), p]));
    rows.forEach(row => {
      const distEl = row.children[0];
      const timeEl = row.children[1];
      const venueEl = row.children[2];
      if (!distEl || !timeEl) return;
      const key = distEl.textContent.trim().toLowerCase();
      const pb = byKey[key];
      if (!pb || !pb.finish_s) return;
      timeEl.textContent = pb.finish_display;
      if (pb.date) {
        const d = new Date(pb.date);
        venueEl.textContent = `${MONTH_ABBR[d.getMonth()]}${pb.activity_name ? ' · ' + pb.activity_name.slice(0, 18) : ''}`;
      }
    });
  }

  const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function findThisWeekTile() {
    return Array.from(document.querySelectorAll('.tile-lbl'))
      .find(n => /this week/i.test(n.textContent))
      ?.closest('.tile');
  }

  // ─── Races ───────────────────────────────────────────────────────────────

  function hydrateRaces(data) {
    if (!data || !data.connected) return;

    // Top stat row
    const stats = $$('.stat-box');
    stats.forEach(box => {
      const l = box.querySelector('.l');
      const v = box.querySelector('.v');
      const c = box.querySelector('.c');
      if (!l || !v) return;
      const name = l.textContent.trim();
      if (/Races this year/i.test(name)) {
        v.textContent = String(data.counts.total_races_year);
        if (c) c.innerHTML = `<b>${data.counts.total_races_year}</b> complete · all time ${data.counts.total_races_alltime}`;
      } else if (/Race miles logged/i.test(name)) {
        const racedMi = (data.pastRaces || []).reduce((s, r) => s + (r.distance_mi || 0), 0);
        v.innerHTML = `${Math.round(racedMi)}<small>mi</small>`;
        if (c) c.innerHTML = `<b>${data.counts.total_races_alltime}</b> career`;
      } else if (/PRs set/i.test(name)) {
        const prs = (data.personalBests || []).filter(p => p.finish_s).length;
        v.textContent = String(prs);
        if (c) c.innerHTML = `<b>${prs}</b> distances tracked`;
      }
    });

    // Past races table
    const tbl = document.querySelector('.past-tbl tbody');
    if (tbl && data.pastRaces && data.pastRaces.length > 0) {
      tbl.innerHTML = data.pastRaces.slice(0, 12).map(r => `
        <tr>
          <td class="num">${escapeHtml(r.date_display)}</td>
          <td>
            <span class="race-n">${escapeHtml(r.name)}</span>
            ${r.location_city ? `<div style="font-size:11px; color:var(--t2); margin-top:2px;">${escapeHtml(r.location_city)}</div>` : ''}
          </td>
          <td class="num">${escapeHtml(r.distance_display)}</td>
          <td class="num">${escapeHtml(r.finish_display)}</td>
          <td class="num">${escapeHtml(r.pace_display)} /mi</td>
          <td class="num">—</td>
          <td><span class="chip">${r.distance_mi >= 25 ? 'MARATHON' : 'FINISHER'}</span></td>
        </tr>
      `).join('');
    }
  }

  // ─── Log ─────────────────────────────────────────────────────────────────

  function hydrateLog(data) {
    if (!data || !data.connected || !data.recentActivities) return;
    // Replace the "Distance / Time / Elevation / Activities / Avg HR" tiles for current month
    $$('.roll').forEach(box => {
      const l = box.querySelector('.l');
      const v = box.querySelector('.v');
      const d = box.querySelector('.d');
      if (!l || !v || !data.miles) return;
      const name = l.textContent.trim();
      if (/Distance/i.test(name)) {
        v.innerHTML = `${Math.round(data.miles.month_mi)}<small>mi</small>`;
        if (d && data.miles.month_delta_pct != null) {
          const sign = data.miles.month_delta_pct >= 0 ? '+' : '';
          d.innerHTML = `<b>${sign}${data.miles.month_delta_pct}%</b> · vs last month`;
        }
      } else if (/^Time$/i.test(name)) {
        v.textContent = data.miles.month_time_display;
        if (d) d.textContent = `avg pace ${data.miles.month_avg_pace_display}/mi`;
      } else if (/Elevation/i.test(name)) {
        v.innerHTML = `${data.miles.month_elev_ft.toLocaleString()}<small>ft</small>`;
      } else if (/Activities/i.test(name)) {
        v.textContent = String(data.miles.month_count);
      } else if (/Avg HR/i.test(name)) {
        if (data.miles.month_avg_hr) {
          v.innerHTML = `${data.miles.month_avg_hr}<small>bpm</small>`;
        } else {
          v.innerHTML = `—<small>bpm</small>`;
          if (d) d.textContent = 'no HR data';
        }
      }
    });

    // Page header sub-line
    const sub = $('.page-head .sub');
    if (sub && data.miles && data.counts) {
      sub.innerHTML = `<b>${data.miles.ytd_mi} miles this year.</b> ${data.counts.total_runs} runs across the last 12 months. Last sync · just now via Strava.`;
    }

    // First "act-list" — replace with most recent runs
    const firstList = $('.act-list');
    if (firstList && data.recentActivities.length > 0) {
      firstList.innerHTML = data.recentActivities.slice(0, 12).map(a => `
        <div class="act" style="cursor:default;">
          <div class="act-date">
            <div class="d">${a.date_d}</div>
            <div class="m">${a.date_m}</div>
            <div class="day">${a.date_dow}</div>
          </div>
          <div class="act-ic ${kindClassToCss(a.kind_class)}">${kindLetter(a.kind_class)}</div>
          <div class="act-name">
            <div class="t">${escapeHtml(a.name || '—')}</div>
            <div class="sub">${a.is_run ? 'Run' : a.type || ''} · ${escapeHtml(a.sport_type || a.type || '')}</div>
          </div>
          <div class="act-metric"><div class="l">DISTANCE</div><div class="v">${a.distance_display}<small>mi</small></div></div>
          <div class="act-metric"><div class="l">PACE · TIME</div><div class="v">${a.pace_display}<small>/mi</small></div></div>
          <div class="act-metric"><div class="l">AVG HR</div><div class="v">${a.average_heartrate ? Math.round(a.average_heartrate) : '<span style="color:var(--t3);">—</span>'}</div></div>
          <div class="act-spark"></div>
          <div class="act-tags">${a.is_race ? '<span class="chip chip--attention">RACE</span>' : ''}<span class="act-go">›</span></div>
        </div>
      `).join('');
    }
  }

  function kindClassToCss(k) {
    return k || 'easy';
  }
  function kindLetter(k) {
    switch (k) {
      case 'race': return 'R';
      case 'long': return 'L';
      case 'tempo': return 'T';
      case 'int': return 'I';
      case 'rest': return '—';
      case 'xt': return 'X';
      default: return 'E';
    }
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // ─── Main ────────────────────────────────────────────────────────────────

  let lastStatus = null;
  let lastData = null;

  async function loadAndHydrate({ refresh = false } = {}) {
    try {
      const statusRes = await fetch(STATUS_URL, { credentials: 'same-origin', cache: 'no-store' });
      lastStatus = await statusRes.json();
    } catch (err) {
      lastStatus = { configured: false, connected: false, error: err.message };
    }
    renderStatusBar(lastStatus, lastData);
    if (!lastStatus.connected) return;

    try {
      const dataRes = await fetch(DATA_URL + (refresh ? '?refresh=1' : ''), { credentials: 'same-origin', cache: 'no-store' });
      lastData = await dataRes.json();
    } catch (err) {
      lastData = { connected: false, error: err.message };
      return;
    }
    renderStatusBar(lastStatus, lastData);

    const hydrate = HYDRATORS[PAGE] || HYDRATORS[''];
    if (hydrate) {
      try { hydrate(lastData, lastStatus); } catch (e) { console.error('hydrate failed', e); }
    }
  }

  function init() {
    flashCallbackMessage();
    loadAndHydrate();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
