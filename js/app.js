import * as Strava from './strava.js';
import { demoActivities, demoSplits } from './demo.js';
import * as Detail from './detail.js';
import * as Icu from './intervals.js';
import * as Coach from './coach.js';
import {
  SPORTS, SPORT_KEYS, normalize, isoDay, addDays, currentMonday, mondayOf,
  weekTotals, weeklySeries, previousAverage, loadRatio, paceSeries, records,
  annotatePace, averageSpeed, paceValue,
  fmtDuration, fmtDistance, fmtPace, fmtPaceValue, fmtShortPace, fmtClock,
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

const TITLES = { week: 'Semaine', progress: 'Progrès', list: 'Sorties', coach: 'Coach', settings: 'Réglages' };

const state = {
  view: 'week',
  weekOffset: 0,
  chartMode: 'time',
  progSport: 'run',
  listFilter: 'all',
  syncing: false,
  coachBusy: false,
  detailId: null,
  detailLoading: null,
  aiBusy: null,
  aiPartial: '',
  sheet: null,
  busy: null,
  partial: '',
  nextOpts: {},
  planCount: {},
  fallback: null,
  sendError: null,
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
      <div class="card sport-card" data-next="${s}">
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
        <div class="next-cta">✨ Prochaine séance conseillée <span>›</span></div>
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
      <div class="hero-top">
        <div>
          <div class="big">${fmtDuration(cur.all.time)}</div>
          <div class="sub">${prev.all.time ? `sur <b>${fmtDuration(prev.all.time)}</b> la sem. ${isCurrent ? 'dernière' : 'précédente'}` : `aucun entraînement la sem. ${isCurrent ? 'dernière' : 'précédente'}`} · ${cur.all.count} séance${cur.all.count > 1 ? 's' : ''}</div>
        </div>
        ${heroDelta(cur.all.time, prev.all.time, isCurrent)}
      </div>
      ${prev.all.time ? `<div class="hero-bar"><i style="width:${Math.min(100, cur.all.time / prev.all.time * 100)}%"></i></div>` : ''}
      ${weekCalendar(acts, monday)}
      ${isCurrent ? heroPlanCta(acts) : ''}
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

function heroPlanCta(acts) {
  const plan = Coach.getPlan(isoDay(currentMonday(0)));
  const st = plan && planStatus(plan, acts);
  return `<div class="hero-cta" data-plan>✨ Programme de la semaine${st ? ` · ${st.done}/${st.sessions.length} faites` : ''} <span>›</span></div>`;
}

// Écart compact avec la semaine précédente (à droite du total)
function heroDelta(cur, prev, isCurrent) {
  if (!prev) return '';
  const diff = prev - cur;
  if (diff > 0) {
    return isCurrent
      ? `<div class="hero-delta"><span>reste</span><b>${fmtDuration(diff)}</b></div>`
      : `<div class="hero-delta"><span>écart</span><b>−${fmtDuration(diff)}</b></div>`;
  }
  return `<div class="hero-delta"><span>🎉 dépassée</span><b>+${fmtDuration(-diff)}</b></div>`;
}

// Calendrier de la semaine : séances faites (cochées) et séances prévues au programme
function weekCalendar(acts, monday) {
  const key = isoDay(monday);
  const w = state.weekOffset;
  const t = w === 0 ? todayIndex() : -1;
  const plan = Coach.getPlan(key);
  const planned = plan ? planStatus(plan, acts, w).sessions.filter(x => !x.act) : [];
  const done = acts.filter(a => a.week === key).sort((a, b) => a.local.localeCompare(b.local));
  const letters = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
  const days = letters.map((l, i) => {
    const items = done.filter(a => dayOfAct(a) === i).map(a => `
        <span class="cal-item done" data-cal-act="${esc(a.id)}" title="${esc(a.name)}">${SPORTS[a.sport].icon}<i>✓</i></span>`).join('')
      + planned.filter(x => x.day === i).map(x => `
        <span class="cal-item ${x.status === 'missed' ? 'missed' : 'planned'}" data-cal-sport="${x.sport}" data-cal-day="${i}" title="${esc(x.title)}">${SPORTS[x.sport].icon}</span>`).join('');
    return `<div class="cal-day ${i === t ? 'today' : ''}">
      <span class="cal-l">${l}</span>
      <span class="cal-n">${addDays(monday, i).getUTCDate()}</span>
      <div class="cal-items">${items || '<span class="cal-empty">·</span>'}</div>
    </div>`;
  }).join('');
  return `<div class="week-cal">${days}</div>
    <div class="cal-legend"><span><i class="lg done"></i>fait</span>${plan ? '<span><i class="lg planned"></i>prévu</span>' : ''}</div>`;
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
      <div class="act" data-open="${esc(a.id)}">
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
          ${a.paceNote ? `<div class="act-foot"><span class="note">⚠ ${esc(a.paceNote)}</span></div>` : ''}
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

// ---------- Détail d'une sortie ----------

function renderDetail(acts) {
  const a = acts.find(x => x.id === state.detailId);
  if (!a) { state.detailId = null; return renderList(acts); }
  const sport = a.sport;
  const demo = loadPrefs().demo;

  // tronçons : séries (natation), calculés en démo, ou flux Strava mis en cache
  let detail = Detail.cachedDetail(a.id);
  if (sport !== 'swim' && !detail) {
    if (demo) detail = { splits: demoSplits(a, Detail.SPLIT[sport]) };
    else if (Strava.isConnected()) loadStreams(a);
  }
  const splits = Detail.splitsOf(a, detail);
  const insights = Detail.analyse(a, acts, splits, { swimLimit: paceInfo.limit });
  const isFlagged = x => sport === 'swim' && paceInfo.limit && x.time / x.distance * 100 < paceInfo.limit;
  const hrSplits = splits.filter(x => x.hr);
  const hrAvg = a.hr || (hrSplits.length ? hrSplits.reduce((t, x) => t + x.hr * x.time, 0) / hrSplits.reduce((t, x) => t + x.time, 0) : null);
  const color = SPORTS[sport].color;
  const tones = { good: cssVar('--good'), bad: cssVar('--bad'), info: cssVar('--ride') };
  const icons = { good: '▲', bad: '▼', info: '●' };

  const stat = (label, value) => value ? `<div class="tile"><span>${label}</span><strong>${value}</strong></div>` : '';
  const hrMax = a.maxHr || (splits.some(x => x.hr) ? Math.max(...splits.map(x => x.hr || 0)) : null);

  const splitRows = splits.map((x, i) => {
    const v = paceValue(x.distance / x.time, sport);
    const flagged = isFlagged(x);
    const label = sport === 'swim' ? `${i + 1}. ${fmtDistance(x.distance, sport)}`
      : x.distance < Detail.SPLIT[sport] * 0.95 ? `${fmtDistance(x.distance, sport)}` : `${sport === 'run' ? i + 1 : (i + 1) * 5} km`;
    return `<tr class="${flagged ? 'flag' : ''}">
      <td>${label}</td>
      <td>${fmtShortPace(v, sport)}${flagged ? ' ⚠' : ''}</td>
      <td>${fmtClock(x.time)}</td>
      ${sport !== 'swim' ? `<td>${x.hr ?? '–'}</td><td>${x.gain} m</td>` : ''}
    </tr>`;
  }).join('');

  const splitUnit = sport === 'run' ? 'min/km' : sport === 'ride' ? 'km/h' : 'min/100 m';
  const splitTitle = sport === 'swim' ? 'Séries' : sport === 'run' ? 'Kilomètre par kilomètre' : 'Par tronçon de 5 km';
  let splitBody;
  if (splits.length) {
    splitBody = `
      <div class="chart-box small"><canvas id="split-chart"></canvas></div>
      <table class="splits">
        <thead><tr><th>${sport === 'swim' ? 'Série' : 'Tronçon'}</th><th>${sport === 'ride' ? 'km/h' : 'Allure'}</th><th>Temps</th>${sport !== 'swim' ? '<th>FC</th><th>D+</th>' : ''}</tr></thead>
        <tbody>${splitRows}</tbody>
      </table>
      ${splits.some(isFlagged) ? '<p class="muted">⚠ Série écartée des allures (bug montre probable).</p>' : ''}`;
  } else if (state.detailLoading === a.id) {
    splitBody = '<p class="muted">Chargement du détail depuis Strava…</p>';
  } else if (sport === 'swim') {
    splitBody = '<p class="muted">Pas de détail des séries. Synchronise pour le récupérer.</p>';
  } else {
    splitBody = `<p class="muted">Détail indisponible${Strava.isConnected() ? '' : ' (connecte Strava)'}.</p>${Strava.isConnected() ? '<button class="btn ghost" data-action="reload-detail">Réessayer</button>' : ''}`;
  }

  $view.innerHTML = `
    ${demoBanner()}
    <button class="back" data-action="back">‹ Sorties</button>
    <div class="card detail-head">
      <div class="detail-title">
        ${iconBox(sport)}
        <div style="min-width:0">
          <h2 class="name">${esc(a.name)}</h2>
          <div class="muted">${fmtActivityDate(a.local)}</div>
        </div>
      </div>
      <div class="tiles three">
        ${stat('Distance', fmtDistance(a.distance, sport))}
        ${stat('Temps', fmtDuration(a.time))}
        ${stat(sport === 'ride' ? 'Vitesse' : 'Allure', a.pace ? fmtPace(a.pace.distance, a.pace.time, sport) : '–')}
        ${sport !== 'swim' ? stat('Dénivelé', `${Math.round(a.elevation)} m`) : stat('Séries', splits.length || null)}
        ${stat('FC moy.', hrAvg ? `${Math.round(hrAvg)} bpm` : null)}
        ${stat('FC max', hrMax ? `${Math.round(hrMax)} bpm` : null)}
        ${stat('Effort relatif', a.effort ?? null)}
        ${stat('Temps total', a.elapsed > a.time ? fmtDuration(a.elapsed) : null)}
      </div>
      ${a.paceNote ? `<p class="note-line">⚠ ${esc(a.paceNote)}</p>` : ''}
    </div>

    ${aiCard(a)}

    <div class="card">
      <h2>Stats clés</h2>
      ${insights.length ? insights.map(x => `
        <div class="insight">
          <span class="ico" style="color:${tones[x.tone]}">${icons[x.tone]}</span>
          <div><strong>${esc(x.title)}</strong><p>${esc(x.text)}</p></div>
        </div>`).join('') : '<p class="muted">Pas encore assez de sorties pour comparer.</p>'}
    </div>

    <div class="card">
      <div class="card-head"><h2>${splitTitle}</h2><span class="muted">${splitUnit}</span></div>
      ${splitBody}
    </div>

    <button class="btn ghost" data-exclude="${esc(a.id)}">${a.paceNote === 'Exclue manuellement' ? 'Réintégrer dans les stats d\'allure' : 'Exclure des stats d\'allure'}</button>`;

  if (splits.length && window.Chart) {
    // barres en vitesse (m/s) : plus la barre est haute, plus c'est rapide ; axe affiché en allure
    const vals = splits.map(x => x.distance / x.time);
    const hasHr = splits.some(x => x.hr);
    charts.push(new Chart(document.getElementById('split-chart'), {
      data: {
        labels: splits.map((_, i) => String(sport === 'ride' ? (i + 1) * 5 : i + 1)),
        datasets: [
          { type: 'bar', data: vals, backgroundColor: splits.map(x => isFlagged(x) ? cssVar('--warn') : color), borderRadius: 4, yAxisID: 'y' },
          ...(hasHr ? [{ type: 'line', data: splits.map(x => x.hr), borderColor: cssVar('--bad'), borderWidth: 2, pointRadius: 0, tension: 0.3, yAxisID: 'hr' }] : []),
        ],
      },
      options: {
        maintainAspectRatio: false,
        scales: {
          x: { grid: { display: false } },
          y: {
            min: Math.min(...vals) * 0.9,
            max: Math.max(...vals) * 1.03,
            ticks: { maxTicksLimit: 5, callback: v => fmtShortPace(paceValue(v, sport), sport) },
          },
          ...(hasHr ? { hr: { position: 'right', grid: { display: false }, ticks: { maxTicksLimit: 5 } } } : {}),
        },
        plugins: {
          tooltip: {
            callbacks: {
              label: c => c.dataset.yAxisID === 'hr' ? `FC ${c.raw} bpm` : fmtPaceValue(paceValue(c.raw, sport), sport),
            },
          },
        },
      },
    }));
  }
}

function aiCard(a) {
  let body;
  if (!Coach.getApiKey()) {
    body = `<p class="muted">Ajoute ta clé API Anthropic pour que le coach analyse tes sorties.</p>
      <button class="btn ghost" data-goto="settings">Aller aux réglages</button>`;
  } else if (state.aiBusy === a.id) {
    body = `<div id="ai-body" class="ai-text">${state.aiPartial ? Coach.renderMarkdown(state.aiPartial) : '<div class="msg typing"><i></i><i></i><i></i></div>'}</div>`;
  } else {
    const done = Coach.cachedAnalysis(a.id);
    const waiting = state.detailLoading === a.id;
    body = done
      ? `<div class="ai-text">${Coach.renderMarkdown(done.text)}</div>
         <div class="ai-foot">
           <span class="muted">${esc(Coach.modelLabel(done.model))} · ${new Date(done.at).toLocaleDateString('fr-FR')}</span>
           <button class="link" data-action="ai-analyse">Régénérer</button>
         </div>
         <button class="btn ghost" data-action="ai-discuss">En parler avec le coach</button>`
      : `<p class="muted">Le coach analyse tes tronçons, ta FC et compare avec tes autres séances.</p>
         <button class="btn primary" data-action="ai-analyse" ${waiting || state.aiBusy ? 'disabled' : ''}>✨ Analyser cette sortie</button>`;
  }
  return `<div class="card ai-card"><h2>Analyse du coach</h2>${body}</div>`;
}

async function runAiAnalysis() {
  const acts = activities();
  const a = acts.find(x => x.id === state.detailId);
  if (!a || state.aiBusy) return;
  const sport = a.sport;
  const detail = Detail.cachedDetail(a.id) || (loadPrefs().demo && sport !== 'swim' ? { splits: demoSplits(a, Detail.SPLIT[sport]) } : null);
  const splits = Detail.splitsOf(a, detail).map(x => ({
    ...x,
    flagged: sport === 'swim' && paceInfo.limit && x.time / x.distance * 100 < paceInfo.limit,
  }));
  const insights = Detail.analyse(a, acts, splits, { swimLimit: paceInfo.limit });
  const unit = sport === 'swim' ? 'séries de la montre' : sport === 'run' ? 'par kilomètre' : 'par 5 km';
  const description = Coach.describeActivity(a, splits, insights, unit);

  state.aiBusy = a.id;
  state.aiPartial = '';
  render();
  try {
    await Coach.analyseActivity(a, description, coachContext(acts), partial => {
      state.aiPartial = partial;
      const el = document.getElementById('ai-body');
      if (el) el.innerHTML = Coach.renderMarkdown(partial);
    });
  } catch (e) {
    toast(e.message);
  } finally {
    state.aiBusy = null;
    state.aiPartial = '';
    if (state.view === 'list' && state.detailId === a.id) render();
  }
}

async function loadStreams(a) {
  if (state.detailLoading) return;
  state.detailLoading = a.id;
  try {
    const streams = await Strava.fetchStreams(a.id);
    Detail.saveDetail(a.id, { splits: Detail.splitsFromStreams(streams, Detail.SPLIT[a.sport]) });
  } catch (e) {
    toast(e.message);
  } finally {
    state.detailLoading = null;
    if (state.view === 'list' && state.detailId === a.id) render();
  }
}

// ---------- Programme de la semaine et prochaine séance (fenêtres) ----------

const DAY_SHORT = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];
const TIME_OPTIONS = [null, 30, 45, 60, 90, 120, 180];

function todayUTC() {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

// Jour de la semaine en cours (0 = lundi)
function todayIndex() {
  return (todayUTC().getUTCDay() + 6) % 7;
}

function dayOfAct(a) {
  return (new Date(a.local.slice(0, 10) + 'T00:00:00Z').getUTCDay() + 6) % 7;
}

function fmtMinutes(m) {
  return m == null ? 'Non précisé' : fmtDuration(m * 60);
}

// Rapproche le programme des sorties réellement faites dans la semaine `w` (0 = en cours, 1 = prochaine)
function planStatus(plan, acts, w = 0) {
  const key = isoDay(currentMonday(w));
  const week = acts.filter(a => a.week === key).map(a => ({ a, day: dayOfAct(a), used: false }));
  const sessions = plan.sessions.map(x => ({ ...x, act: null }));
  // d'abord le jour exact, puis à un ou deux jours près
  for (const gap of [0, 1, 2]) {
    for (const w of week) {
      if (w.used) continue;
      const cand = sessions
        .filter(x => !x.act && x.sport === w.a.sport && Math.abs(x.day - w.day) <= gap)
        .sort((x, y) => Math.abs(x.day - w.day) - Math.abs(y.day - w.day))[0];
      if (cand) { cand.act = w.a; w.used = true; }
    }
  }
  const t = w === 0 ? todayIndex() : w < 0 ? 7 : -1;
  sessions.forEach(x => {
    x.status = x.act ? 'done' : x.day < t ? 'missed' : x.day === t ? 'today' : 'todo';
  });
  return {
    sessions,
    extras: week.filter(w => !w.used).map(w => w.a),
    done: sessions.filter(x => x.status === 'done').length,
    missed: sessions.filter(x => x.status === 'missed').length,
  };
}

function planLines(plan, status) {
  const labels = { done: 'fait', missed: 'manqué', today: 'prévu aujourd\'hui', todo: 'à venir' };
  const lines = status.sessions.map(x => {
    const real = x.act ? ` → réalisé : ${fmtDistance(x.act.distance, x.sport)} en ${fmtDuration(x.act.time)}${dayOfAct(x.act) !== x.day ? ` (le ${Coach.DAYS[dayOfAct(x.act)]})` : ''}` : '';
    return `- ${Coach.DAYS[x.day]} · ${SPORTS[x.sport].label} · ${x.title} (${x.minutes} min) : ${x.content} [${labels[x.status]}]${real}`;
  });
  status.extras.forEach(a => lines.push(`- ${Coach.DAYS[dayOfAct(a)]} · ${SPORTS[a.sport].label} · hors programme : « ${a.name.slice(0, 60)} », ${fmtDistance(a.distance, a.sport)} en ${fmtDuration(a.time)}`));
  return lines;
}

// Nombre de séances habituel : moyenne des 3 dernières semaines complètes
function habitualSessions(acts) {
  const monday = currentMonday(0);
  const weeks = weeklySeries(acts, addDays(monday, -7), 3);
  const avg = k => weeks.reduce((t, w) => t + w.totals[k].count, 0) / weeks.length;
  return { weeks, total: Math.max(1, Math.round(avg('all'))), avg };
}

// Nombre de séances choisi pour la semaine `w` : réglé à la main, sinon celui du programme, sinon l'habitude
function planCount(acts, w) {
  const key = isoDay(currentMonday(w));
  state.planCount ??= {};
  return state.planCount[key] ?? Coach.getPlan(key)?.count ?? habitualSessions(acts).total;
}

function doneLines(acts, key) {
  return acts.filter(a => a.week === key).sort((a, b) => a.local.localeCompare(b.local))
    .map(a => `- ${Coach.DAYS[dayOfAct(a)]} · ${SPORTS[a.sport].label} · « ${a.name.slice(0, 60)} », ${fmtDistance(a.distance, a.sport)} en ${fmtDuration(a.time)}${a.effort != null ? `, effort ${a.effort}` : ''}`);
}

function planSituation(acts, adapting, w, count) {
  const t = todayIndex();
  const h = habitualSessions(acts);
  const monday = currentMonday(w);
  const curKey = isoDay(currentMonday(0));
  const lines = [
    `Aujourd'hui : ${Coach.DAYS[t]} (jour ${t + 1}/7 de la semaine en cours).`,
    `Semaine à programmer : ${w === 0 ? 'la semaine en cours' : 'la semaine prochaine'}, du lundi ${fmtDayMonth(monday)} au dimanche ${fmtDayMonth(addDays(monday, 6))}`,
    `Nombre de séances à prévoir sur la semaine : ${count}, choisi par moi (ma moyenne des 3 dernières semaines : ${fmtNumber(h.avg('all'))} ; natation ${fmtNumber(h.avg('swim'))}, vélo ${fmtNumber(h.avg('ride'))}, course ${fmtNumber(h.avg('run'))}).`,
    'Mes 3 dernières semaines complètes :',
    ...h.weeks.map(x => `- ${fmtWeekRange(x.monday)} : ${x.totals.all.count} séances (natation ${x.totals.swim.count}, vélo ${x.totals.ride.count}, course ${x.totals.run.count}), ${fmtDuration(x.totals.all.time)}`),
  ];
  const done = doneLines(acts, curKey);
  lines.push(done.length ? 'Déjà fait cette semaine :' : 'Rien de fait cette semaine pour l\'instant.', ...done);
  const curPlan = Coach.getPlan(curKey);
  if (w === 1 && curPlan) {
    lines.push('', 'Programme de la semaine en cours et suivi (pour enchaîner de façon cohérente) :', ...planLines(curPlan, planStatus(curPlan, acts, 0)));
  }
  const plan = Coach.getPlan(isoDay(monday));
  if (adapting && plan) {
    lines.push('', 'Programme précédent de cette semaine et suivi :', ...planLines(plan, planStatus(plan, acts, w)));
  }
  return lines.join('\n');
}

// Résumé de la situation dans un sport, pour la suggestion de l'IA
function nextSituation(acts, sport, opts) {
  const monday = currentMonday(0);
  const cur = weekTotals(acts, isoDay(monday));
  const prev = weekTotals(acts, isoDay(addDays(monday, -7)));
  const label = SPORTS[sport].label;
  const today = todayUTC();
  const daysAgo = a => {
    const n = Math.round((today - new Date(a.local.slice(0, 10) + 'T00:00:00Z')) / 864e5);
    return n === 0 ? 'aujourd\'hui' : n === 1 ? 'hier' : `il y a ${n} j`;
  };
  const t = todayIndex();
  const target = addDays(today, opts.offset);
  const targetDay = (target.getUTCDay() + 6) % 7;
  const targetWeek = t + opts.offset > 6 ? 1 : 0;
  const sorted = [...acts].sort((a, b) => b.local.localeCompare(a.local));
  const lines = [
    `Sport demandé : ${label}`,
    `Aujourd'hui : ${Coach.DAYS[t]}, jour ${t + 1}/7 de la semaine en cours.`,
    `Jour prévu pour la séance : ${Coach.DAYS[targetDay]} ${fmtDayMonth(target)} (${opts.offset === 0 ? 'aujourd\'hui' : opts.offset === 1 ? 'demain' : `dans ${opts.offset} jours`}${t + opts.offset > 6 ? ', semaine prochaine' : ''}).`,
    `Temps disponible : ${opts.time == null ? 'non précisé (propose une durée adaptée)' : `${fmtDuration(opts.time * 60)} maximum`}.`,
    `Cette semaine en ${label.toLowerCase()} : ${cur[sport].count} séance(s), ${fmtDistance(cur[sport].distance, sport)}, ${fmtDuration(cur[sport].time)} (semaine dernière : ${prev[sport].count} séance(s), ${fmtDuration(prev[sport].time)}).`,
    `Cette semaine tous sports : ${fmtDuration(cur.all.time)} (semaine dernière : ${fmtDuration(prev.all.time)}).`,
  ];
  const load = loadRatio(acts, monday);
  if (load) lines.push(`Effort relatif cumulé cette semaine : ${Math.round(load.cur)} (moyenne des 4 semaines précédentes : ${Math.round(load.prev)} par semaine complète ; semaine en cours, jour ${t + 1}/7).`);
  const speed = averageSpeed(acts, sport, monday);
  if (speed) lines.push(`Allure moyenne récente en ${label.toLowerCase()} : ${fmtPaceValue(paceValue(speed, sport), sport)}.`);
  const lastSport = sorted.filter(a => a.sport === sport).slice(0, 3);
  if (lastSport.length) {
    lines.push(`Dernières séances de ${label.toLowerCase()} :`);
    lastSport.forEach(a => lines.push(`- ${daysAgo(a)} : « ${a.name.slice(0, 60)} », ${fmtDistance(a.distance, sport)} en ${fmtDuration(a.time)}${a.pace ? `, ${fmtPace(a.pace.distance, a.pace.time, sport)}` : ''}${a.effort != null ? `, effort ${a.effort}` : ''}`));
  } else {
    lines.push(`Aucune séance de ${label.toLowerCase()} depuis septembre.`);
  }
  const last = sorted[0];
  if (last) lines.push(`Dernière séance tous sports : ${SPORTS[last.sport].label.toLowerCase()} ${daysAgo(last)}${last.effort != null ? ` (effort ${last.effort})` : ''}.`);
  const curPlan = Coach.getPlan(isoDay(monday));
  const nextPlan = Coach.getPlan(isoDay(currentMonday(1)));
  if (curPlan) lines.push('', `Programme de la semaine en cours : ${curPlan.resume}`, ...planLines(curPlan, planStatus(curPlan, acts, 0)));
  if (targetWeek === 1 && nextPlan) lines.push('', `Programme de la semaine prochaine (celle de la séance) : ${nextPlan.resume}`, ...planLines(nextPlan, planStatus(nextPlan, acts, 1)));
  if (!(targetWeek === 0 ? curPlan : nextPlan)) lines.push('', 'Pas de programme établi pour la semaine de cette séance.');
  return lines.join('\n');
}

function nextStamp(acts) {
  const latest = acts.reduce((m, a) => (a.local > m ? a.local : m), '');
  return `${isoDay(currentMonday(0))}|${new Date().toDateString()}|${latest}|${acts.length}`;
}

function nextOpts(sport, acts) {
  state.nextOpts ??= {};
  if (!state.nextOpts[sport]) {
    // par défaut : la prochaine séance de ce sport prévue au programme, sinon aujourd'hui
    const t = todayIndex();
    let offset = 0;
    for (const w of [0, 1]) {
      const plan = Coach.getPlan(isoDay(currentMonday(w)));
      const planned = plan && planStatus(plan, acts, w).sessions.find(x => x.sport === sport && x.status !== 'done' && x.status !== 'missed');
      if (planned) { offset = planned.day + 7 * w - t; break; }
    }
    state.nextOpts[sport] = { offset, time: null };
  }
  return state.nextOpts[sport];
}

function nextKey(sport, acts) {
  const o = nextOpts(sport, acts);
  const plans = [0, 1].map(w => Coach.getPlan(isoDay(currentMonday(w)))?.at || '');
  return `${nextStamp(acts)}|${o.offset}|${o.time}|${plans.join('|')}`;
}

function openSheet(sheet) {
  state.sheet = sheet;
  state.fallback = null;
  state.sendError = null;
  document.body.classList.add('no-scroll');
  renderSheet();
}

function openNext(sport, offset, from) {
  if (offset != null) {
    nextOpts(sport, activities());
    state.nextOpts[sport].offset = offset;
  }
  openSheet({ type: 'next', sport, from });
}

function closeSheet() {
  state.sheet = null;
  document.body.classList.remove('no-scroll');
  document.getElementById('sheet')?.remove();
  if (state.view === 'week') render();
}

function sheetFrame(icon, sub, title, body) {
  return `
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="sheet-head">
        ${icon}
        <div><span class="muted">${sub}</span><strong>${title}</strong></div>
        <button class="icon-btn" data-sheet="close" aria-label="Fermer">✕</button>
      </div>
      <div class="sheet-body">${body}</div>
    </div>`;
}

const NO_KEY = `<p class="muted">Ajoute ta clé API Anthropic pour que le coach prépare tes séances.</p>
  <button class="btn primary" data-sheet="settings">Aller aux réglages</button>`;

function typing(text) {
  return `<p class="muted">${text}</p><div class="msg typing"><i></i><i></i><i></i></div>`;
}

function renderSheet() {
  const sh = state.sheet;
  if (!sh) return;
  let el = document.getElementById('sheet');
  if (!el) {
    el = document.createElement('div');
    el.id = 'sheet';
    el.className = 'sheet-backdrop enter';
    document.body.appendChild(el);
    setTimeout(() => el.classList.remove('enter'), 300);
  }
  const scroll = el.querySelector('.sheet-body')?.scrollTop || 0;
  el.innerHTML = sh.type === 'plan' ? planSheet() : nextSheet(sh.sport);
  el.querySelector('.sheet-body').scrollTop = scroll;
}

function planSheet() {
  const acts = activities();
  const w = state.sheet.week || 0;
  const monday = currentMonday(w);
  const plan = Coach.getPlan(isoDay(monday));
  const icon = '<div class="sport-icon" style="background:#fc4c0222">🗓️</div>';
  const title = `Semaine du ${fmtDayMonth(monday)}`;
  const h = habitualSessions(acts);
  const count = planCount(acts, w);
  const busy = state.busy ? 'disabled' : '';
  const weekTabs = `
    <div class="segmented full">
      <button data-sheet="plan-week" data-week="0" class="${w === 0 ? 'active' : ''}">Cette semaine</button>
      <button data-sheet="plan-week" data-week="1" class="${w === 1 ? 'active' : ''}">Semaine prochaine</button>
    </div>`;
  const stepper = `
    <div class="stepper-row">
      <div><strong>Nombre de séances</strong><small>Moyenne de tes 3 dernières semaines : ${fmtNumber(h.avg('all'))}</small></div>
      <div class="stepper">
        <button data-sheet="count" data-delta="-1" ${count <= 1 || state.busy ? 'disabled' : ''} aria-label="Moins">−</button>
        <b>${count}</b>
        <button data-sheet="count" data-delta="1" ${count >= 14 || state.busy ? 'disabled' : ''} aria-label="Plus">+</button>
      </div>
    </div>`;
  let body;
  if (!Coach.getApiKey()) body = NO_KEY;
  else if (state.busy?.kind === 'plan' && state.busy.week === w) body = typing('Le coach prépare ton programme…');
  else if (!plan) {
    body = `${stepper}
      <p>Le coach répartit <b>${count} séance${count > 1 ? 's' : ''}</b> entre natation, vélo et course, avec le thème de chaque séance.</p>
      <p class="muted">${w === 0 ? 'Les séances déjà faites cette semaine sont prises en compte.' : 'Il tient compte de ta semaine en cours et de son programme pour enchaîner.'}</p>
      <button class="btn primary" data-sheet="gen-plan" ${busy}>✨ Générer le programme</button>`;
  } else {
    const st = planStatus(plan, acts, w);
    const t = w === 0 ? todayIndex() : -1;
    const badge = { done: '<span class="badge done">✓ Fait</span>', missed: '<span class="badge missed">Manquée</span>', today: '<span class="badge today">Aujourd\'hui</span>', todo: '' };
    const days = Coach.DAYS.map((d, i) => {
      const items = st.sessions.filter(x => x.day === i);
      const extras = st.extras.filter(a => dayOfAct(a) === i);
      const rows = items.map(x => `
        <div class="plan-row ${x.status}" ${x.status === 'done' ? '' : `data-sheet="open-next" data-sport="${x.sport}" data-day="${i + 7 * w}"`}>
          ${iconBox(x.sport)}
          <div>
            <div class="plan-title">${esc(x.title)} <span class="muted">· ${fmtDuration(x.minutes * 60)}</span></div>
            <div class="plan-content">${esc(x.content)}</div>
            ${x.act ? `<div class="plan-real">${fmtDistance(x.act.distance, x.sport)} en ${fmtDuration(x.act.time)}</div>` : ''}
            ${sentBadge(!x.act && Icu.getSent(Icu.externalId(isoDay(addDays(monday, i)), x.sport)))}
          </div>
          <div class="plan-side">${badge[x.status]}${x.status === 'done' ? '' : '<span class="chev">›</span>'}</div>
        </div>`).join('') + extras.map(a => `
        <div class="plan-row extra">
          ${iconBox(a.sport)}
          <div>
            <div class="plan-title">${esc(a.name)}</div>
            <div class="plan-real">${fmtDistance(a.distance, a.sport)} en ${fmtDuration(a.time)}</div>
          </div>
          <div class="plan-side"><span class="badge">Hors programme</span></div>
        </div>`).join('');
      return `<div class="plan-day ${i === t ? 'is-today' : ''}">
        <div class="plan-day-name">${d.charAt(0).toUpperCase() + d.slice(1)} ${addDays(monday, i).getUTCDate()}</div>
        ${rows || '<div class="plan-rest">Repos</div>'}
      </div>`;
    }).join('');
    const changed = count !== (plan.count ?? st.sessions.length);
    body = `
      <p class="plan-resume">${esc(plan.resume)}</p>
      <div class="plan-progress">${w === 0
        ? `<b>${st.done}/${st.sessions.length}</b> séances faites${st.missed ? ` · <span class="missed-txt">${st.missed} manquée${st.missed > 1 ? 's' : ''}</span>` : ''}`
        : `<b>${st.sessions.length}</b> séances prévues`}</div>
      ${days}
      <p class="muted">Touche une séance pour la détailler.</p>
      ${weekWatchBlock(st)}
      ${stepper}
      ${w === 0 ? `<button class="btn ${changed ? 'ghost' : 'primary'}" data-sheet="adapt-plan" ${busy}>Adapter à ma semaine réelle${changed ? ` (${count} séances)` : ''}</button>` : ''}
      <button class="btn ${changed ? 'primary' : 'ghost'}" data-sheet="gen-plan" ${busy}>Refaire le programme avec ${count} séance${count > 1 ? 's' : ''}</button>
      <div class="ai-foot"><span class="muted">${esc(Coach.modelLabel(plan.model))} · ${new Date(plan.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</span></div>`;
  }
  return sheetFrame(icon, 'Programme', title, weekTabs + body);
}

function nextSheet(sport) {
  const acts = activities();
  const o = nextOpts(sport, acts);
  const today = todayUTC();
  const t = todayIndex();
  const dayChips = Array.from({ length: 14 - t }, (_, i) => {
    const d = addDays(today, i);
    const label = i === 0 ? 'Auj.' : i === 1 ? 'Demain' : `${DAY_SHORT[(t + i) % 7]} ${d.getUTCDate()}`;
    return `<button data-sheet="day" data-day="${i}" class="${o.offset === i ? 'active' : ''}">${label}</button>`;
  }).join('');
  const timeChips = TIME_OPTIONS.map(m => `<button data-sheet="time" data-time="${m ?? ''}" class="${o.time === m ? 'active' : ''}">${fmtMinutes(m)}</button>`).join('');

  // séance prévue au programme ce jour-là (semaine en cours ou prochaine)
  const tw = t + o.offset > 6 ? 1 : 0;
  const plan = Coach.getPlan(isoDay(currentMonday(tw)));
  const planned = plan
    && planStatus(plan, acts, tw).sessions.find(x => x.sport === sport && x.day === t + o.offset - 7 * tw && x.status !== 'done');
  const hint = planned
    ? `<div class="plan-hint">🗓️ Au programme : <b>${esc(planned.title)}</b> · ${fmtDuration(planned.minutes * 60)}</div>`
    : plan ? '<div class="plan-hint muted">Pas de séance de ce sport prévue ce jour-là au programme.</div>' : '';

  let body;
  if (!Coach.getApiKey()) body = NO_KEY;
  else if (state.busy?.kind === 'next' && state.busy.sport === sport) {
    body = `<div id="sheet-stream" class="ai-text">${state.partial ? Coach.renderMarkdown(state.partial) : typing('Le coach prépare ta séance…')}</div>`;
  } else {
    const c = Coach.cachedNext(sport, nextKey(sport, acts));
    body = c
      ? `<div class="ai-text">${Coach.renderMarkdown(c.text)}</div>
         <div class="ai-foot">
           <span class="muted">${esc(Coach.modelLabel(c.model))} · ${new Date(c.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</span>
           <button class="link" data-sheet="gen-next" ${state.busy ? 'disabled' : ''}>Autre proposition</button>
         </div>
         ${watchBlock(sport, isoDay(addDays(today, o.offset)))}`
      : `<button class="btn primary" data-sheet="gen-next" ${state.busy ? 'disabled' : ''}>✨ Proposer la séance</button>`;
  }
  return sheetFrame(iconBox(sport), 'Prochaine séance', SPORTS[sport].label, `
    ${state.sheet.from === 'plan' ? '<button class="back" data-sheet="back-plan">‹ Programme</button>' : ''}
    <div class="opt-label">Jour prévu</div>
    <div class="chips">${dayChips}</div>
    <div class="opt-label">Temps disponible</div>
    <div class="chips">${timeChips}</div>
    ${hint}
    ${body}`);
}

// ---------- Envoi sur la montre (via Intervals.icu) ----------

function sentBadge(sent) {
  if (!sent) return '';
  return `<div class="plan-sent">⌚ ${sent.direct ? 'Envoyée sur la montre' : 'Préparée (à coller dans Intervals.icu)'}</div>`;
}

function watchSteps(w, sport, pauses) {
  const pause = '<div class="sp-pause">⏸ Pause libre : appuie sur Lap pour repartir</div>';
  return `<div class="steps-preview">${w.blocks.map((b, i) => `
    ${pauses && i > 0 ? pause : ''}
    <div class="sp-block"><b>${esc(b.label)}${b.repeat > 1 ? ` · ${b.repeat}×` : ''}</b>
      <ul>${b.steps.map((st, j) => `${pauses && Icu.exercisePause(w, i, j) ? '<li class="repos">⏸ Pause libre (Lap)</li>' : ''}<li class="${st.kind}">${esc(Icu.stepLabel(st, sport))}</li>`).join('')}</ul>
    </div>`).join('')}</div>`;
}

function sendErrorBlock() {
  return state.sendError ? `<div class="send-error"><strong>Échec de l'envoi</strong><p>${esc(state.sendError)}</p></div>` : '';
}

function fallbackBlock() {
  const f = state.fallback;
  if (!f) return '';
  return `<div class="fallback">
    <strong>Envoi direct bloqué</strong>
    <p class="muted">Intervals.icu n'accepte pas l'envoi depuis l'appli. Copie chaque séance, puis dans Intervals.icu : calendrier → le jour → <b>Add → Workout</b> → colle le texte dans la description. Elle partira ensuite sur ta Garmin.</p>
    ${f.items.map((x, i) => `
      <div class="fb-item">
        <div class="fb-head"><b>${esc(x.title)}</b><span class="muted">${esc(x.when)}</span></div>
        <textarea readonly rows="6">${esc(x.text)}</textarea>
        <button class="btn ghost" data-sheet="copy" data-i="${i}">Copier</button>
      </div>`).join('')}
  </div>`;
}

function watchBlock(sport, date) {
  if (state.busy?.kind === 'send' && state.busy.sport === sport) return typing('Préparation des étapes pour la montre…');
  const sent = Icu.getSent(Icu.externalId(date, sport));
  const head = sent
    ? `<div class="sent-ok">⌚ Envoyée le ${new Date(sent.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}${sent.direct ? '' : ' (copie manuelle)'}</div>${sent.workout ? watchSteps(sent.workout, sport, sent.pauses ?? false) : ''}`
    : '';
  const btn = Icu.getKey()
    ? `<button class="btn ghost" data-sheet="send-session" ${state.busy ? 'disabled' : ''}>⌚ ${sent ? 'Renvoyer' : 'Envoyer'} sur ma montre</button>`
    : '<button class="btn ghost" data-sheet="settings">⌚ Envoyer sur ma montre : ajoute ta clé Intervals.icu</button>';
  return `<div class="watch">${head}${btn}${state.sheet?.type === 'next' ? sendErrorBlock() : ''}${state.fallback?.sheet === 'next' ? fallbackBlock() : ''}</div>`;
}

function weekWatchBlock(st) {
  const todo = st.sessions.filter(x => x.status === 'todo' || x.status === 'today');
  if (!todo.length) return '';
  if (state.busy?.kind === 'send-week') return typing(`Le coach détaille ${todo.length} séance${todo.length > 1 ? 's' : ''} pour la montre…`);
  const btn = Icu.getKey()
    ? `<button class="btn primary" data-sheet="send-week" ${state.busy ? 'disabled' : ''}>⌚ Envoyer les ${todo.length} séance${todo.length > 1 ? 's' : ''} à venir sur ma montre</button>`
    : '<button class="btn ghost" data-sheet="settings">⌚ Envoyer sur ma montre : ajoute ta clé Intervals.icu</button>';
  return btn + (state.sheet?.type === 'plan' ? sendErrorBlock() : '') + (state.fallback?.sheet === 'plan' ? fallbackBlock() : '');
}

async function sendSession(sport) {
  if (state.busy) return;
  const acts = activities();
  const o = nextOpts(sport, acts);
  const c = Coach.cachedNext(sport, nextKey(sport, acts));
  if (!c) return;
  const date = isoDay(addDays(todayUTC(), o.offset));
  const id = Icu.externalId(date, sport);
  state.busy = { kind: 'send', sport };
  state.fallback = null;
  state.sendError = null;
  renderSheet();
  try {
    const w = await Coach.structureSession(sport, c.text, coachContext(acts));
    const text = Icu.workoutText(w, sport);
    try {
      await Icu.pushEvents([Icu.makeEvent({ date, sport, name: w.name, text, minutes: w.minutes, externalId: id })]);
      Icu.markSent(id, { workout: w, direct: true, pauses: Icu.getPauses() });
      toast(`Séance ajoutée dans Intervals.icu le ${fmtActivityDate(`${date}T00:00`).split(' · ')[0]}`);
    } catch (e) {
      if (!(e instanceof Icu.BrowserBlockedError)) throw e;
      Icu.markSent(id, { workout: w, direct: false, pauses: Icu.getPauses() });
      state.fallback = { sheet: 'next', items: [{ title: w.name, when: fmtActivityDate(`${date}T00:00`).split(' · ')[0], text }] };
    }
  } catch (e) {
    state.sendError = e.message;
  } finally {
    state.busy = null;
    renderSheet();
  }
}

async function sendWeek() {
  if (state.busy) return;
  const acts = activities();
  const w = state.sheet.week || 0;
  const monday = currentMonday(w);
  const plan = Coach.getPlan(isoDay(monday));
  if (!plan) return;
  const items = planStatus(plan, acts, w).sessions.filter(x => x.status === 'todo' || x.status === 'today');
  if (!items.length) return;
  state.busy = { kind: 'send-week' };
  state.fallback = null;
  state.sendError = null;
  renderSheet();
  try {
    const details = await Coach.structureWeek(items, planSituation(acts, false, w, planCount(acts, w)), coachContext(acts));
    const prepared = details
      .map(d => ({ d, item: items[d.numero - 1] }))
      .filter(x => x.item)
      .map(({ d, item }) => {
        const date = isoDay(addDays(monday, item.day));
        return { d, item, date, id: Icu.externalId(date, item.sport), text: Icu.workoutText(d, item.sport) };
      });
    try {
      await Icu.pushEvents(prepared.map(x => Icu.makeEvent({ date: x.date, sport: x.item.sport, name: x.d.name, text: x.text, minutes: x.d.minutes, externalId: x.id })));
      prepared.forEach(x => Icu.markSent(x.id, { workout: x.d, direct: true, pauses: Icu.getPauses() }));
      toast(`${prepared.length} séance${prepared.length > 1 ? 's' : ''} envoyée${prepared.length > 1 ? 's' : ''} : synchronise ta montre`);
    } catch (e) {
      if (!(e instanceof Icu.BrowserBlockedError)) throw e;
      prepared.forEach(x => Icu.markSent(x.id, { workout: x.d, direct: false, pauses: Icu.getPauses() }));
      state.fallback = {
        sheet: 'plan',
        items: prepared.map(x => ({ title: `${SPORTS[x.item.sport].icon} ${x.d.name}`, when: fmtActivityDate(`${x.date}T00:00`).split(' · ')[0], text: x.text })),
      };
    }
  } catch (e) {
    state.sendError = e.message;
  } finally {
    state.busy = null;
    renderSheet();
  }
}

async function runNext(sport) {
  if (state.busy) return;
  const acts = activities();
  const opts = nextOpts(sport, acts);
  const plan = Coach.getPlan(isoDay(currentMonday(0)));
  state.busy = { kind: 'next', sport };
  state.partial = '';
  renderSheet();
  try {
    await Coach.suggestNext(sport, nextSituation(acts, sport, opts), coachContext(acts), nextKey(sport, acts), Boolean(plan), partial => {
      state.partial = partial;
      const el = document.getElementById('sheet-stream');
      if (el) el.innerHTML = Coach.renderMarkdown(partial);
    });
  } catch (e) {
    toast(e.message);
  } finally {
    state.busy = null;
    state.partial = '';
    renderSheet();
  }
}

async function runPlan(adapting) {
  if (state.busy) return;
  const acts = activities();
  const w = state.sheet.week || 0;
  const count = planCount(acts, w);
  state.busy = { kind: 'plan', week: w };
  renderSheet();
  try {
    await Coach.generatePlan(isoDay(currentMonday(w)), planSituation(acts, adapting, w, count), coachContext(acts), { adapting, next: w === 1, count });
    delete state.planCount[isoDay(currentMonday(w))];
    // les suggestions de séance s'aligneront sur le nouveau programme
    state.nextOpts = {};
  } catch (e) {
    toast(e.message);
  } finally {
    state.busy = null;
    renderSheet();
  }
}

document.addEventListener('click', e => {
  const sheet = document.getElementById('sheet');
  if (!sheet || !sheet.contains(e.target)) return;
  const b = e.target.closest('[data-sheet]');
  if (e.target === sheet || b?.dataset.sheet === 'close') return closeSheet();
  if (!b || b.disabled) return;
  const sh = state.sheet;
  const action = b.dataset.sheet;
  if (action === 'gen-next') runNext(sh.sport);
  else if (action === 'send-session') sendSession(sh.sport);
  else if (action === 'send-week') sendWeek();
  else if (action === 'copy') {
    const text = state.fallback?.items[Number(b.dataset.i)]?.text || '';
    navigator.clipboard?.writeText(text).then(() => toast('Séance copiée'), () => toast('Copie impossible : sélectionne le texte'));
  }
  else if (action === 'gen-plan') runPlan(false);
  else if (action === 'adapt-plan') runPlan(true);
  else if (action === 'open-next') {
    state.planWeek = sh.week || 0;
    openNext(b.dataset.sport, Math.max(0, Number(b.dataset.day) - todayIndex()), 'plan');
  }
  else if (action === 'back-plan') { state.sheet = { type: 'plan', week: state.planWeek || 0 }; renderSheet(); }
  else if (action === 'plan-week') { state.sheet = { type: 'plan', week: Number(b.dataset.week) }; renderSheet(); }
  else if (action === 'count') {
    const acts = activities();
    const w = sh.week || 0;
    state.planCount[isoDay(currentMonday(w))] = Math.min(14, Math.max(1, planCount(acts, w) + Number(b.dataset.delta)));
    renderSheet();
  }
  else if (action === 'day' || action === 'time') {
    const o = nextOpts(sh.sport, activities());
    if (action === 'day') o.offset = Number(b.dataset.day);
    else o.time = b.dataset.time === '' ? null : Number(b.dataset.time);
    renderSheet();
  } else if (action === 'settings') {
    closeSheet();
    state.view = 'settings';
    state.detailId = null;
    render();
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && state.sheet) closeSheet();
});

// ---------- Vue Coach ----------

function renderCoach() {
  if (!Coach.getApiKey()) {
    $view.innerHTML = `
      <div class="empty">
        <div class="emoji">💬</div>
        <h3>Ton coach perso</h3>
        <p>Pose tes questions à Claude, qui connaît tes stats d'entraînement. Il faut une clé API Anthropic (payante à l'usage).</p>
        <button class="btn primary" data-goto="settings">Ajouter ma clé dans les réglages</button>
      </div>`;
    return;
  }
  const chat = Coach.loadChat();
  const msgs = chat?.messages || [];
  const bubbles = msgs.map(m => m.role === 'user'
    ? `<div class="msg user">${esc(Coach.messageText(m))}</div>`
    : `<div class="msg bot">${Coach.renderMarkdown(Coach.messageText(m))}</div>`).join('');

  const since = chat ? new Date(chat.createdAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : null;
  $view.innerHTML = `
    ${demoBanner()}
    ${msgs.length ? `
      <div class="chat-head">
        <span class="muted">Stats du ${since}</span>
        <button class="link" data-action="new-chat">Nouvelle conversation</button>
      </div>` : `
      <div class="card coach-intro">
        <strong>Salut ! Je suis ton coach.</strong>
        <p class="muted">Je connais tes séances depuis le 1<sup>er</sup> septembre : volumes, allures, charge. Demande-moi une analyse, un plan ou un conseil.</p>
        <div class="chips wrap">
          ${Coach.SUGGESTIONS.map(q => `<button data-ask="${esc(q)}">${esc(q)}</button>`).join('')}
        </div>
      </div>`}
    <div class="chat" id="chat">${bubbles}</div>
    <form class="composer" id="composer">
      <textarea id="coach-input" rows="1" placeholder="Écris ta question…" ${state.coachBusy ? 'disabled' : ''}></textarea>
      <button type="submit" class="send" aria-label="Envoyer" ${state.coachBusy ? 'disabled' : ''}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
      </button>
    </form>`;
  window.scrollTo(0, document.body.scrollHeight);
}

function coachContext(acts) {
  return Coach.buildContext(acts, {
    startDate: '1er septembre 2026',
    goal: loadPrefs().goal,
    swimRef: paceInfo.ref,
    swimLimit: paceInfo.limit,
  });
}

async function sendCoach(text) {
  text = text.trim();
  if (!text || state.coachBusy) return;
  const context = coachContext(activities());
  state.coachBusy = true;
  render();
  const chatEl = document.getElementById('chat');
  document.querySelector('.coach-intro')?.remove();
  chatEl.insertAdjacentHTML('beforeend', `<div class="msg user">${esc(text)}</div><div class="msg bot typing"><i></i><i></i><i></i></div>`);
  const bot = chatEl.lastElementChild;
  window.scrollTo(0, document.body.scrollHeight);
  try {
    await Coach.ask(text, context, partial => {
      bot.classList.remove('typing');
      bot.innerHTML = Coach.renderMarkdown(partial);
      window.scrollTo(0, document.body.scrollHeight);
    });
  } catch (e) {
    toast(e.message);
  } finally {
    state.coachBusy = false;
    if (state.view === 'coach') render();
  }
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
      <h2>Coach (Claude)</h2>
      <label class="field"><span>Clé API Anthropic</span><input id="anthropic-key" type="password" autocomplete="off" placeholder="sk-ant-…" value="${esc(Coach.getApiKey())}"></label>
      <label class="field"><span>Modèle</span>
        <select id="coach-model">
          ${Coach.MODELS.map(m => `<option value="${m.id}" ${Coach.getModel() === m.id ? 'selected' : ''}>${m.label} · ${m.cost}</option>`).join('')}
        </select>
      </label>
      <label class="field"><span>Ton objectif (pour le coach)</span><input id="goal" autocomplete="off" placeholder="Ex. : triathlon M en juin 2027" value="${esc(prefs.goal || '')}"></label>
      <button class="btn primary" data-action="save-coach">Enregistrer</button>
      <p class="muted">Crée une clé sur <code>console.anthropic.com</code> (crédit prépayé). Coûts estimés. Un changement de modèle s'applique à la prochaine conversation. La clé reste uniquement sur ce téléphone.</p>
    </div>

    <div class="card">
      <h2>Montre Garmin (Intervals.icu)</h2>
      <label class="field"><span>Clé API Intervals.icu</span><input id="icu-key" type="password" autocomplete="off" value="${esc(Icu.getKey())}"></label>
      <button class="btn primary" data-action="save-icu">Enregistrer</button>
      <button class="btn ghost" data-action="test-icu">Tester la connexion</button>
      <div class="switch-row" style="margin-top:14px">
        <div><strong>Pauses libres</strong><small>Pause non chronométrée entre l'échauffement, chaque exercice du corps de séance et le retour au calme : la montre attend un appui sur Lap.</small></div>
        <label class="switch"><input type="checkbox" id="lap-pauses" ${Icu.getPauses() ? 'checked' : ''}><i></i></label>
      </div>
      <div id="icu-test" class="muted" style="margin-top:8px"></div>
      <ol class="steps" style="margin-top:12px">
        <li>Crée un compte gratuit sur <code>intervals.icu</code>.</li>
        <li>Settings → <b>Garmin Connect</b> : connecte ton compte et active l'envoi des séances planifiées (« Upload planned workouts »).</li>
        <li>Settings → <b>Developer Settings</b> : crée ta clé API et colle-la ici.</li>
      </ol>
      <p class="muted">Les séances partent dans ton calendrier Intervals.icu, puis Garmin Connect, puis ta montre à la prochaine synchro. La clé reste sur ce téléphone.</p>
    </div>

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
  document.getElementById('title').textContent = state.view === 'list' && state.detailId ? 'Sortie' : TITLES[state.view];
  document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.view === state.view));

  const acts = activities();
  if (state.view === 'settings') renderSettings();
  else if (!acts.length) $view.innerHTML = emptyState();
  else if (state.view === 'week') renderWeek(acts);
  else if (state.view === 'progress') renderProgress(acts);
  else if (state.view === 'coach') renderCoach();
  else if (state.detailId) renderDetail(acts);
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
  state.detailId = null;
  render();
  window.scrollTo(0, 0);
});

document.getElementById('sync-btn').addEventListener('click', () => sync());

$view.addEventListener('click', e => {
  const t = e.target.closest('button');
  if (!t) {
    const doneItem = e.target.closest('[data-cal-act]');
    if (doneItem) {
      state.view = 'list';
      state.listScroll = 0;
      state.detailId = doneItem.dataset.calAct;
      render();
      return window.scrollTo(0, 0);
    }
    const planItem = e.target.closest('[data-cal-sport]');
    if (planItem) {
      const offset = Number(planItem.dataset.calDay) + 7 * state.weekOffset - todayIndex();
      return offset >= 0 && offset <= 13 - todayIndex()
        ? openNext(planItem.dataset.calSport, offset)
        : openSheet({ type: 'plan', week: 0 });
    }
    const card = e.target.closest('.sport-card[data-next]');
    if (card) return openNext(card.dataset.next);
    if (e.target.closest('[data-plan]')) return openSheet({ type: 'plan', week: 0 });
    const row = e.target.closest('.act[data-open]');
    if (row) {
      state.listScroll = window.scrollY;
      state.detailId = row.dataset.open;
      render();
      window.scrollTo(0, 0);
    }
    return;
  }
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
  else if (d.ask) sendCoach(d.ask);
  else if (d.action === 'ai-analyse') runAiAnalysis();
  else if (d.action === 'ai-discuss') {
    const a = activities().find(x => x.id === state.detailId);
    if (!a) return;
    state.view = 'coach';
    state.detailId = null;
    render();
    sendCoach(`J'aimerais parler de ma sortie ${SPORTS[a.sport].label.toLowerCase()} « ${a.name} » du ${fmtActivityDate(a.local).split(' · ')[0]}. Voici ton analyse :\n\n${Coach.cachedAnalysis(a.id)?.text || ''}\n\nQu'est-ce que tu me conseilles de travailler en priorité ?`);
  }
  else if (d.action === 'back') {
    state.detailId = null;
    render();
    window.scrollTo(0, state.listScroll || 0);
  }
  else if (d.action === 'reload-detail') {
    const a = activities().find(x => x.id === state.detailId);
    if (a) { loadStreams(a); render(); }
  }
  else if (d.action === 'new-chat') {
    if (state.coachBusy || !confirm('Commencer une nouvelle conversation avec des stats à jour ?')) return;
    Coach.resetChat();
    render();
  }
  else if (d.action === 'test-icu') {
    Icu.setKey(document.getElementById('icu-key').value);
    const out = document.getElementById('icu-test');
    out.textContent = 'Test en cours…';
    Icu.testConnection()
      .then(name => { out.innerHTML = `<span style="color:${cssVar('--good')}">✓ Connecté à Intervals.icu : ${esc(String(name))}</span>`; })
      .catch(e => { out.innerHTML = `<span style="color:${cssVar('--bad')}">✗ ${esc(e.message)}</span>`; });
  }
  else if (d.action === 'save-icu') {
    Icu.setKey(document.getElementById('icu-key').value);
    toast('Clé Intervals.icu enregistrée');
  }
  else if (d.action === 'save-coach') {
    Coach.setApiKey(document.getElementById('anthropic-key').value);
    Coach.setModel(document.getElementById('coach-model').value);
    savePrefs({ goal: document.getElementById('goal').value.trim() });
    toast('Réglages du coach enregistrés');
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

$view.addEventListener('submit', e => {
  if (e.target.id !== 'composer') return;
  e.preventDefault();
  sendCoach(document.getElementById('coach-input').value);
});

$view.addEventListener('input', e => {
  if (e.target.id !== 'coach-input') return;
  e.target.style.height = 'auto';
  e.target.style.height = Math.min(e.target.scrollHeight, 140) + 'px';
});

$view.addEventListener('change', e => {
  if (e.target.id === 'lap-pauses') {
    Icu.setPauses(e.target.checked);
    toast(e.target.checked ? 'Pauses libres activées' : 'Pauses libres désactivées');
    return;
  }
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
