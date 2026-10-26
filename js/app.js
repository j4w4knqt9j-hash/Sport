import * as Strava from './strava.js';
import { demoActivities } from './demo.js';
import {
  SPORTS, SPORT_KEYS, normalize, isoDay, addDays, currentMonday, mondayOf,
  weekTotals, weeklySeries, previousAverage, loadRatio, paceSeries, records,
  annotatePace, averageSpeed, paceValue,
  fmtDuration, fmtDistance, fmtPace, fmtPaceValue, fmtShortPace,
  fmtActivityDate, fmtWeekRange, fmtDayMonth, fmtNumber,
} from './stats.js';

const STORE = 'trisuivi.activities';
const PREFS = 'trisuivi.prefs';

// Seules les activités à partir de cette date sont prises en compte
const START_DATE = '2026-09-01';
const START_EPOCH = Math.floor(new Date(`${START_DATE}T00:00:00`).getTime() / 1000);
const START_MONDAY = mondayOf(new Date(`${START_DATE}T00:00:00Z`));

// Nombre de semaines à afficher : 12 au plus, sans remonter avant la date de début
function chartWeeks(monday) {
  return Math.max(1, Math.min(12, Math.round((monday - START_MONDAY) / (7 * 864e5)) + 1));
}

const TITLES = { week: 'Semaine', progress: 'Progrès', list: 'Sorties', settings: 'Réglages' };

const state = {
  view: 'week',
  weekOffset: 0,
  chartMode: 'time',
  progSport: 'run',
  listFilter: 'all',
  syncing: false,
};

let charts = [];
const $view = document.getElementById('view');

// ---------- Stockage ----------

function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS)) || {}; }
  catch { return {}; }
}

function savePrefs(p) {
  localStorage.setItem(PREFS, JSON.stringify({ ...loadPrefs(), ...p }));
}

function storedActivities() {
  try { return JSON.parse(localStorage.getItem(STORE)) || []; }
  catch { return []; }
}

let paceInfo = { ref: null, limit: 0 };

function activities() {
  const prefs = loadPrefs();
  const all = prefs.demo ? demoActivities().map(normalize).filter(Boolean) : storedActivities();
  const acts = all.filter(a => a.local >= START_DATE);
  paceInfo = annotatePace(acts, {
    excluded: new Set(prefs.excluded || []),
    tolerance: prefs.tolerance ?? 0.12,
  });
  return acts;
}

// ---------- Utilitaires ----------

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function iconBox(sport) {
  const s = SPORTS[sport];
  return `<div class="sport-icon" style="background:${s.color}22">${s.icon}</div>`;
}

function destroyCharts() {
  charts.forEach(c => c.destroy());
  charts = [];
}

function chartDefaults() {
  if (!window.Chart) return;
  Chart.defaults.color = cssVar('--muted');
  Chart.defaults.borderColor = cssVar('--border');
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.plugins.legend.display = false;
}

function emptyState() {
  return `
    <div class="empty">
      <div class="emoji">🏊🚴🏃</div>
      <h3>Aucune activité pour l'instant</h3>
      <p>Connecte ton compte Strava ou active le mode démo dans les réglages.</p>
      <button class="btn primary" data-goto="settings">Aller aux réglages</button>
    </div>`;
}

function demoBanner() {
  return loadPrefs().demo ? '<div class="banner">Mode démo : données fictives</div>' : '';
}

// ---------- Vue Semaine ----------

function renderWeek(acts) {
  const monday = currentMonday(state.weekOffset);
  const key = isoDay(monday);
  const cur = weekTotals(acts, key);
  const prev = weekTotals(acts, isoDay(addDays(monday, -7)));
  const avg = previousAverage(acts, monday);
  const isCurrent = state.weekOffset === 0;
  const load = loadRatio(acts, monday);
  const label = state.weekOffset === 0 ? 'Cette semaine'
    : state.weekOffset === -1 ? 'Semaine dernière'
    : `Il y a ${-state.weekOffset} semaines`;

  const sportCards = SPORT_KEYS.map(s => {
    const t = cur[s];
    const p = prev[s];
    const pct = p.time ? Math.round((t.time / p.time) * 100) : null;
    const prevTxt = p.count ? `${fmtDuration(p.time)} · ${fmtDistance(p.distance, s)}` : 'rien';
    const avgTxt = avg[s].time ? ` · moy. 4 sem. ${fmtDuration(avg[s].time)}` : '';
    return `
      <div class="card sport-card">
        ${iconBox(s)}
        <div>
          <div class="name">${SPORTS[s].label}</div>
          <div class="meta">${t.count} séance${t.count > 1 ? 's' : ''} · ${t.paceTime ? fmtPace(t.paceDistance, t.paceTime, s) : '–'}</div>
        </div>
        <div class="val">
          <strong>${t.count ? fmtDistance(t.distance, s) : '–'}</strong>
          <span>${t.count ? fmtDuration(t.time) : ''}</span>
        </div>
        <div class="bar"><i style="width:${Math.min(100, pct ?? 0)}%;background:${SPORTS[s].color}"></i></div>
        <div class="bar-caption">Sem. ${isCurrent ? 'dernière' : 'précédente'} : ${prevTxt}${avgTxt}</div>
        ${sportGoal(acts, s, t, p, monday, isCurrent)}
      </div>`;
  }).join('');

  const loadCard = load ? `
    <div class="card">
      <h2>Charge d'entraînement</h2>
      <div class="load-gauge">
        <div class="ratio" style="color:${{ low: cssVar('--ride'), good: cssVar('--good'), warn: cssVar('--warn'), bad: cssVar('--bad') }[load.level]}">${fmtNumber(load.ratio)}</div>
        <div class="txt">
          <strong>${load.text}</strong>
          <span>Effort relatif ${Math.round(load.cur)} cette semaine, contre ${Math.round(load.prev)} en moyenne sur 4 sem.</span>
        </div>
      </div>
    </div>` : '';

  const modes = [['time', 'Temps'], ...SPORT_KEYS.map(s => [s, SPORTS[s].label])];

  $view.innerHTML = `
    ${demoBanner()}
    <div class="week-nav">
      <button data-week="-1" aria-label="Semaine précédente">‹</button>
      <div class="label"><strong>${label}</strong><span>${fmtWeekRange(monday)}</span></div>
      <button data-week="1" aria-label="Semaine suivante" ${state.weekOffset >= 0 ? 'disabled' : ''}>›</button>
    </div>

    <div class="card hero">
      <div class="big">${fmtDuration(cur.all.time)}</div>
      <div class="sub">d'entraînement · sem. ${isCurrent ? 'dernière' : 'précédente'} : <b>${fmtDuration(prev.all.time)}</b></div>
      ${prev.all.time ? `<div class="hero-bar"><i style="width:${Math.min(100, cur.all.time / prev.all.time * 100)}%"></i></div>` : ''}
      <div class="hero-goal">${heroGoal(cur.all.time, prev.all.time, isCurrent)}</div>
      <div class="row">
        <div><strong>${cur.all.count}</strong>séances</div>
        <div><strong>${Math.round(cur.all.elevation)} m</strong>D+</div>
        ${cur.all.effort ? `<div><strong>${Math.round(cur.all.effort)}</strong>effort relatif</div>` : ''}
      </div>
    </div>

    ${sportCards}
    ${loadCard}

    <div class="card">
      <h2>${chartWeeks(monday)} dernières semaines</h2>
      <div class="segmented full">
        ${modes.map(([k, l]) => `<button data-mode="${k}" class="${state.chartMode === k ? 'active' : ''}">${l}</button>`).join('')}
      </div>
      <div class="chart-box"><canvas id="weekly-chart"></canvas></div>
    </div>`;

  drawWeeklyChart(acts, monday);
}

function heroGoal(cur, prev, isCurrent) {
  if (!prev) return isCurrent ? 'Aucun entraînement la semaine dernière' : 'Aucun entraînement la semaine précédente';
  const diff = prev - cur;
  if (diff > 0) {
    return isCurrent
      ? `Reste <b>${fmtDuration(diff)}</b> pour égaler la semaine dernière`
      : `${fmtDuration(diff)} de moins que la semaine précédente`;
  }
  return `🎉 Semaine ${isCurrent ? 'dernière' : 'précédente'} dépassée${diff < 0 ? ` de <b>${fmtDuration(-diff)}</b>` : ''}`;
}

// Temps restant pour égaler la semaine précédente, converti en distance avec l'allure moyenne
function sportGoal(acts, sport, cur, prev, monday, isCurrent) {
  if (!prev.time) return '';
  const diff = prev.time - cur.time;
  if (diff <= 0) {
    return `<div class="goal done">✓ Dépassée${diff < 0 ? ` de ${fmtDuration(-diff)}` : ''}</div>`;
  }
  const speed = averageSpeed(acts, sport, monday);
  let dist = '';
  if (speed) {
    const step = { swim: 50, run: 500, ride: 1000 }[sport];
    const meters = Math.max(step, Math.round(diff * speed / step) * step);
    dist = ` ≈ <b>${fmtDistance(meters, sport)}</b> <span>à ${fmtPaceValue(paceValue(speed, sport), sport)}</span>`;
  }
  return `<div class="goal">${isCurrent ? 'Reste' : 'Manquait'} <b>${fmtDuration(diff)}</b>${dist}</div>`;
}

function drawWeeklyChart(acts, monday) {
  if (!window.Chart) return;
  const series = weeklySeries(acts, monday, chartWeeks(monday));
  const labels = series.map(w => fmtDayMonth(w.monday));
  const mode = state.chartMode;
  let datasets, unit;

  if (mode === 'time') {
    unit = 'h';
    datasets = SPORT_KEYS.map(s => ({
      label: SPORTS[s].label,
      data: series.map(w => +(w.totals[s].time / 3600).toFixed(2)),
      backgroundColor: SPORTS[s].color,
      borderRadius: 4,
      stack: 'v',
    }));
  } else {
    const swim = mode === 'swim';
    unit = swim ? 'm' : 'km';
    datasets = [{
      label: SPORTS[mode].label,
      data: series.map(w => swim ? w.totals[mode].distance : +(w.totals[mode].distance / 1000).toFixed(1)),
      backgroundColor: SPORTS[mode].color,
      borderRadius: 6,
    }];
  }

  charts.push(new Chart(document.getElementById('weekly-chart'), {
    type: 'bar',
    data: { labels, datasets },
    options: {
      maintainAspectRatio: false,
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 6 } },
        y: { stacked: true, beginAtZero: true, ticks: { callback: v => `${fmtNumber(v)} ${unit}` } },
      },
      plugins: {
        legend: { display: mode === 'time', position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true } },
        tooltip: {
          callbacks: {
            label: c => mode === 'time'
              ? `${c.dataset.label} : ${fmtDuration(c.raw * 3600)}`
              : `${fmtNumber(c.raw)} ${unit}`,
          },
        },
      },
    },
  }));
}

// ---------- Vue Progrès ----------

function renderProgress(acts) {
  const sport = state.progSport;
  const rec = records(acts, sport);
  const pts = paceSeries(acts, sport);

  let trend = '–';
  if (pts.length >= 6) {
    const mean = arr => arr.reduce((s, p) => s + p.value, 0) / arr.length;
    const last = mean(pts.slice(-5));
    const before = mean(pts.slice(-10, -5));
    const diff = last - before;
    const better = sport === 'ride' ? diff > 0 : diff < 0;
    const abs = Math.abs(diff);
    const txt = sport === 'ride' ? `${fmtNumber(abs)} km/h` : `${Math.round(abs)} s`;
    trend = `<span style="color:${better ? cssVar('--good') : cssVar('--bad')}">${better ? '▲' : '▼'} ${txt}</span>`;
  }

  $view.innerHTML = `
    ${demoBanner()}
    <div class="segmented full">
      ${SPORT_KEYS.map(s => `<button data-sport="${s}" class="${sport === s ? 'active' : ''}">${SPORTS[s].icon} ${SPORTS[s].label}</button>`).join('')}
    </div>

    <div class="card">
      <h2>Repères</h2>
      <div class="tiles">
        <div class="tile"><span>Meilleure allure</span><strong>${rec.best ? fmtPaceValue(rec.best.v, sport) : '–'}</strong><small>${rec.best ? esc(fmtActivityDate(rec.best.a.local).split(' · ')[0]) : ''}</small></div>
        <div class="tile"><span>Plus longue sortie</span><strong>${rec.longest ? fmtDistance(rec.longest.distance, sport) : '–'}</strong><small>${rec.longest ? esc(fmtActivityDate(rec.longest.local).split(' · ')[0]) : ''}</small></div>
        <div class="tile"><span>Cumul ${new Date().getFullYear()}</span><strong>${fmtDistance(rec.yearDistance, sport)}</strong><small>${fmtDuration(rec.yearTime)} · ${rec.yearCount} séances</small></div>
        <div class="tile"><span>Tendance allure</span><strong>${trend}</strong><small>5 dernières vs 5 précédentes</small></div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h2>Allure par sortie</h2><span class="muted">${sport === 'ride' ? 'km/h' : sport === 'run' ? 'min/km' : 'min/100 m'}</span></div>
      ${pts.length ? '<div class="chart-box"><canvas id="pace-chart"></canvas></div>' : '<p class="muted">Pas encore assez de sorties.</p>'}
      <p class="muted" style="margin:10px 0 0">Points : chaque sortie. Ligne : moyenne glissante sur 5 sorties.</p>
    </div>

    <div class="card">
      <h2>Distance par sortie</h2>
      ${pts.length ? '<div class="chart-box"><canvas id="dist-chart"></canvas></div>' : '<p class="muted">Pas encore assez de sorties.</p>'}
    </div>`;

  if (pts.length && window.Chart) drawProgressCharts(pts.slice(-40), sport);
}

function drawProgressCharts(pts, sport) {
  const color = SPORTS[sport].color;
  const labels = pts.map(p => fmtActivityDate(p.act.local).split(' · ')[0].replace(/^\S+ /, ''));
  const tooltipTitle = items => pts[items[0].dataIndex].act.name;

  charts.push(new Chart(document.getElementById('pace-chart'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { data: pts.map(p => p.value), showLine: false, pointRadius: 4, pointBackgroundColor: color + '88', pointBorderWidth: 0 },
        { data: pts.map(p => p.avg), borderColor: color, borderWidth: 3, pointRadius: 0, tension: 0.35 },
      ],
    },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 5 } },
        y: { reverse: sport !== 'ride', ticks: { callback: v => fmtShortPace(v, sport) } },
      },
      plugins: {
        tooltip: {
          callbacks: {
            title: tooltipTitle,
            label: c => `${c.datasetIndex ? 'Moyenne' : 'Sortie'} : ${fmtPaceValue(c.raw, sport)}`,
          },
        },
      },
    },
  }));

  const swim = sport === 'swim';
  charts.push(new Chart(document.getElementById('dist-chart'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: pts.map(p => swim ? p.act.distance : +(p.act.distance / 1000).toFixed(1)),
        backgroundColor: color,
        borderRadius: 4,
      }],
    },
    options: {
      maintainAspectRatio: false,
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 5 } },
        y: { beginAtZero: true, ticks: { callback: v => `${fmtNumber(v)} ${swim ? 'm' : 'km'}` } },
      },
      plugins: {
        tooltip: { callbacks: { title: tooltipTitle, label: c => `${fmtNumber(c.raw)} ${swim ? 'm' : 'km'}` } },
      },
    },
  }));
}

// ---------- Vue Sorties ----------

function renderList(acts) {
  const f = state.listFilter;
  const list = acts
    .filter(a => f === 'all' || a.sport === f)
    .sort((a, b) => b.local.localeCompare(a.local))
    .slice(0, 150);

  let html = '';
  let lastWeek = null;
  for (const a of list) {
    if (a.week !== lastWeek) {
      if (lastWeek) html += '</div>';
      lastWeek = a.week;
      html += `<div class="list-week">${fmtWeekRange(new Date(a.week + 'T00:00:00Z'))}</div><div class="card" style="padding:4px 16px">`;
    }
    html += `
      <div class="act">
        ${iconBox(a.sport)}
        <div style="min-width:0">
          <div class="title">${esc(a.name)}</div>
          <div class="date">${fmtActivityDate(a.local)}</div>
          <div class="stats">
            <div><b>${fmtDistance(a.distance, a.sport)}</b><span>Distance</span></div>
            <div><b>${fmtDuration(a.time)}</b><span>Temps</span></div>
            <div><b>${a.pace ? fmtPace(a.pace.distance, a.pace.time, a.sport) : '–'}</b><span>${a.sport === 'ride' ? 'Vitesse' : 'Allure'}</span></div>
            ${a.sport !== 'swim' ? `<div><b>${Math.round(a.elevation)} m</b><span>D+</span></div>` : ''}
          </div>
          <div class="act-foot">
            ${a.paceNote ? `<span class="note">⚠ ${esc(a.paceNote)}</span>` : '<span></span>'}
            <button class="link" data-exclude="${esc(a.id)}">${a.paceNote === 'Exclue manuellement' ? 'Réintégrer' : 'Exclure de l\'allure'}</button>
          </div>
        </div>
      </div>`;
  }
  if (lastWeek) html += '</div>';

  $view.innerHTML = `
    ${demoBanner()}
    <div class="chips">
      ${[['all', 'Tout'], ...SPORT_KEYS.map(s => [s, `${SPORTS[s].icon} ${SPORTS[s].label}`])]
        .map(([k, l]) => `<button data-filter="${k}" class="${f === k ? 'active' : ''}">${l}</button>`).join('')}
    </div>
    ${html || '<p class="muted">Aucune sortie.</p>'}`;
}

// ---------- Vue Réglages ----------

function renderSettings() {
  activities(); // calcule l'allure de référence affichée plus bas
  const auth = Strava.getAuth();
  const prefs = loadPrefs();
  const connected = Strava.isConnected();
  const count = storedActivities().length;
  const last = prefs.lastSync ? new Date(prefs.lastSync).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : 'jamais';

  $view.innerHTML = `
    <div class="card">
      <h2>Compte Strava</h2>
      <div class="status">
        <span class="dot ${connected ? 'on' : ''}"></span>
        <div>
          <strong>${connected ? `Connecté${auth.athlete ? ` : ${esc(auth.athlete.firstname)} ${esc(auth.athlete.lastname)}` : ''}` : 'Non connecté'}</strong>
          <div class="muted">${count} activités enregistrées · dernière synchro : ${last}</div>
        </div>
      </div>
      ${connected ? `
        <button class="btn primary" data-action="sync">Synchroniser</button>
        <button class="btn ghost" data-action="full-sync">Tout resynchroniser</button>
        <button class="btn danger" data-action="logout">Se déconnecter</button>` : ''}
    </div>

    ${connected ? '' : `
    <div class="card">
      <h2>Connexion</h2>
      <label class="field"><span>Client ID</span><input id="client-id" inputmode="numeric" autocomplete="off" value="${esc(auth.clientId || '')}"></label>
      <label class="field"><span>Client Secret</span><input id="client-secret" type="password" autocomplete="off" value="${esc(auth.clientSecret || '')}"></label>
      <button class="btn primary" data-action="connect">Se connecter avec Strava</button>
      <p class="muted">L'ID et le secret restent uniquement sur ce téléphone.</p>
    </div>

    <div class="card">
      <h2>Première configuration</h2>
      <ol class="steps">
        <li>Va sur <code>strava.com/settings/api</code> et crée une application.</li>
        <li>Dans « Authorization Callback Domain », mets <code>${esc(location.hostname)}</code></li>
        <li>Copie le Client ID et le Client Secret ci-dessus, puis connecte-toi.</li>
      </ol>
    </div>`}

    <div class="card">
      <h2>Filtre natation</h2>
      <p class="muted" style="margin-top:0">Les séries nettement plus rapides que ton allure habituelle (bug de la montre, longueurs fantômes) sont retirées des stats d'allure. Elles comptent toujours dans le volume.</p>
      <label class="field"><span>Écarter les séries plus rapides que ton habitude de</span>
        <select id="tolerance">
          ${[0.08, 0.10, 0.12, 0.15, 0.20].map(v => `<option value="${v}" ${Math.abs((prefs.tolerance ?? 0.12) - v) < 1e-6 ? 'selected' : ''}>${Math.round(v * 100)} %${v === 0.12 ? ' (conseillé)' : ''}</option>`).join('')}
        </select>
      </label>
      ${paceInfo.ref ? `<p class="muted">Allure habituelle : <b>${fmtPaceValue(paceInfo.ref, 'swim')}</b> → séries écartées si plus rapides que <b>${fmtPaceValue(paceInfo.limit, 'swim')}</b></p>` : ''}
      <p class="muted">Tu peux aussi exclure une sortie à la main depuis l'onglet Sorties.</p>
    </div>

    <div class="card">
      <div class="switch-row">
        <div><strong>Mode démo</strong><small>Affiche des données fictives pour tester l'appli</small></div>
        <label class="switch"><input type="checkbox" id="demo-toggle" ${prefs.demo ? 'checked' : ''}><i></i></label>
      </div>
    </div>

    <p class="muted" style="text-align:center">TriSuivi · natation, vélo, course<br>Activités prises en compte depuis le 1<sup>er</sup> septembre 2026</p>`;
}

// ---------- Rendu ----------

function render() {
  destroyCharts();
  chartDefaults();
  document.getElementById('title').textContent = TITLES[state.view];
  document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.view === state.view));

  const acts = activities();
  if (state.view === 'settings') renderSettings();
  else if (!acts.length) $view.innerHTML = emptyState();
  else if (state.view === 'week') renderWeek(acts);
  else if (state.view === 'progress') renderProgress(acts);
  else renderList(acts);
}

// ---------- Synchronisation ----------

async function sync(full = false) {
  if (state.syncing) return;
  if (loadPrefs().demo) return toast('Désactive le mode démo pour synchroniser');
  if (!Strava.isConnected()) {
    state.view = 'settings';
    render();
    return toast('Connecte-toi à Strava d\'abord');
  }
  state.syncing = true;
  const btn = document.getElementById('sync-btn');
  btn.classList.add('spinning');
  try {
    const existing = full ? [] : storedActivities();
    const after = existing.reduce((m, a) => Math.max(m, a.epoch - 1), START_EPOCH);
    const raw = await Strava.fetchActivities(after);
    const fresh = raw.map(normalize).filter(Boolean);
    const byId = new Map(existing.map(a => [a.id, a]));
    let added = 0;
    for (const a of fresh) {
      const old = byId.get(a.id);
      if (!old) added++;
      byId.set(a.id, old?.laps ? { ...a, laps: old.laps } : a);
    }
    // détail des séries de natation, pour filtrer les longueurs fantômes
    for (const a of byId.values()) {
      if (a.sport !== 'swim' || a.laps || a.local < START_DATE) continue;
      try { a.laps = await Strava.fetchLaps(a.id); }
      catch { break; } // on réessaiera à la prochaine synchro
    }
    const kept = [...byId.values()].filter(a => a.local >= START_DATE);
    localStorage.setItem(STORE, JSON.stringify(kept));
    savePrefs({ lastSync: Date.now() });
    toast(added ? `${added} nouvelle${added > 1 ? 's' : ''} activité${added > 1 ? 's' : ''}` : 'Déjà à jour');
    render();
  } catch (e) {
    toast(e.message);
  } finally {
    state.syncing = false;
    btn.classList.remove('spinning');
  }
}

async function handleOAuthReturn() {
  const params = new URLSearchParams(location.search);
  if (!params.has('code') && !params.has('error')) return false;
  history.replaceState(null, '', location.pathname);
  if (params.get('error')) {
    toast('Connexion Strava annulée');
    return false;
  }
  if (!(params.get('scope') || '').includes('activity:read')) {
    toast('Autorise l\'accès aux activités pour utiliser l\'appli');
    return false;
  }
  try {
    await Strava.exchangeCode(params.get('code'));
    savePrefs({ demo: false });
    return true;
  } catch (e) {
    toast(e.message);
    return false;
  }
}

// ---------- Événements ----------

document.querySelector('.tabbar').addEventListener('click', e => {
  const b = e.target.closest('button[data-view]');
  if (!b) return;
  state.view = b.dataset.view;
  render();
  window.scrollTo(0, 0);
});

document.getElementById('sync-btn').addEventListener('click', () => sync());

$view.addEventListener('click', e => {
  const t = e.target.closest('button');
  if (!t) return;
  const d = t.dataset;
  if (d.week) { state.weekOffset = Math.min(0, state.weekOffset + Number(d.week)); render(); }
  else if (d.mode) { state.chartMode = d.mode; render(); }
  else if (d.sport) { state.progSport = d.sport; render(); }
  else if (d.filter) { state.listFilter = d.filter; render(); }
  else if (d.goto) { state.view = d.goto; render(); }
  else if (d.exclude) {
    const set = new Set(loadPrefs().excluded || []);
    set.has(d.exclude) ? set.delete(d.exclude) : set.add(d.exclude);
    savePrefs({ excluded: [...set] });
    toast(set.has(d.exclude) ? 'Sortie exclue des stats d\'allure' : 'Sortie réintégrée');
    render();
  }
  else if (d.action === 'sync') sync();
  else if (d.action === 'full-sync') sync(true);
  else if (d.action === 'logout') {
    if (!confirm('Se déconnecter de Strava et effacer les activités enregistrées ?')) return;
    Strava.logout();
    localStorage.removeItem(STORE);
    savePrefs({ lastSync: null });
    render();
  } else if (d.action === 'connect') {
    const id = document.getElementById('client-id').value;
    const secret = document.getElementById('client-secret').value;
    if (!id.trim() || !secret.trim()) return toast('Renseigne le Client ID et le Client Secret');
    Strava.setCredentials(id, secret);
    location.href = Strava.authorizeUrl();
  }
});

$view.addEventListener('change', e => {
  if (e.target.id === 'tolerance') {
    savePrefs({ tolerance: Number(e.target.value) });
    render();
    return;
  }
  if (e.target.id === 'demo-toggle') {
    savePrefs({ demo: e.target.checked });
    toast(e.target.checked ? 'Mode démo activé' : 'Mode démo désactivé');
  }
});

// balayage gauche/droite pour changer de semaine
let touchX = null;
$view.addEventListener('touchstart', e => { touchX = e.touches[0].clientX; }, { passive: true });
$view.addEventListener('touchend', e => {
  if (touchX == null || state.view !== 'week' || e.target.closest('canvas')) return;
  const dx = e.changedTouches[0].clientX - touchX;
  touchX = null;
  if (Math.abs(dx) < 70) return;
  const next = Math.min(0, state.weekOffset + (dx > 0 ? -1 : 1));
  if (next !== state.weekOffset) { state.weekOffset = next; render(); }
});

// ---------- Démarrage ----------

(async function start() {
  const justConnected = await handleOAuthReturn();
  render();
  const last = loadPrefs().lastSync || 0;
  if (Strava.isConnected() && !loadPrefs().demo && (justConnected || Date.now() - last > 30 * 60 * 1000)) {
    sync(justConnected);
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
