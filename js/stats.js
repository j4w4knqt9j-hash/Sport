// Calculs : normalisation des activités Strava, volumes hebdo, allures, records.

export const SPORTS = {
  swim: { label: 'Natation', icon: '🏊', color: '#14b8a6' },
  ride: { label: 'Vélo', icon: '🚴', color: '#3b82f6' },
  run: { label: 'Course', icon: '🏃', color: '#fc4c02' },
};
export const SPORT_KEYS = ['swim', 'ride', 'run'];

const TYPE_MAP = {
  Run: 'run', TrailRun: 'run', VirtualRun: 'run',
  Ride: 'ride', VirtualRide: 'ride', GravelRide: 'ride', MountainBikeRide: 'ride',
  Swim: 'swim',
};

// Distance minimale pour qu'une sortie compte dans les courbes d'allure
const MIN_DIST = { run: 1000, ride: 3000, swim: 200 };

// ---------- Dates (on travaille en heure locale de l'activité, sans fuseau) ----------

function parseDay(str) {
  const [y, m, d] = str.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function isoDay(dt) {
  return dt.toISOString().slice(0, 10);
}

export function mondayOf(dt) {
  const r = new Date(dt);
  r.setUTCDate(r.getUTCDate() - ((r.getUTCDay() + 6) % 7));
  return r;
}

export function addDays(dt, n) {
  const r = new Date(dt);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

export function currentMonday(offsetWeeks = 0) {
  const now = new Date();
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  return addDays(mondayOf(today), 7 * offsetWeeks);
}

// ---------- Normalisation ----------

export function normalize(a) {
  const sport = TYPE_MAP[a.sport_type] || TYPE_MAP[a.type];
  if (!sport) return null;
  const local = a.start_date_local.replace('Z', '');
  return {
    id: String(a.id),
    name: a.name,
    sport,
    local,
    epoch: Math.floor(new Date(a.start_date).getTime() / 1000),
    week: isoDay(mondayOf(parseDay(local))),
    distance: a.distance || 0,
    time: a.moving_time || 0,
    elapsed: a.elapsed_time || 0,
    elevation: a.total_elevation_gain || 0,
    speed: a.average_speed || 0,
    hr: a.average_heartrate || null,
    maxHr: a.max_heartrate || null,
    effort: a.suffer_score ?? null,
    ...(a.laps ? { laps: a.laps } : {}),
  };
}

// ---------- Filtre des allures aberrantes ----------

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Allure de référence en natation (s/100 m) : médiane de toutes les séries nagées,
// ou des séances entières si on n'a pas encore le détail des séries.
export function swimReference(acts) {
  const swims = acts.filter(a => a.sport === 'swim');
  const laps = swims.flatMap(a => (a.laps || []).filter(([d, t]) => d > 0 && t > 0).map(([d, t]) => t / d * 100));
  if (laps.length >= 3) return median(laps);
  return median(swims.filter(a => a.distance > 0 && a.time > 0).map(a => a.time / a.distance * 100));
}

// Ajoute à chaque activité `pace` = { distance, time } servant aux stats d'allure (null si écartée)
// et `paceNote` qui explique ce qui a été écarté.
// Natation : une série plus rapide que la référence de plus de `tolerance` est considérée
// comme un bug de la montre (longueurs fantômes) et sortie du calcul.
export function annotatePace(acts, { excluded = new Set(), tolerance = 0.12 } = {}) {
  const ref = swimReference(acts);
  const limit = ref ? ref * (1 - tolerance) : 0;
  for (const a of acts) {
    a.pace = null;
    a.paceNote = null;
    if (excluded.has(a.id)) { a.paceNote = 'Exclue manuellement'; continue; }
    if (!a.distance || !a.time) continue;
    if (a.sport !== 'swim' || !ref) { a.pace = { distance: a.distance, time: a.time }; continue; }

    const laps = (a.laps || []).filter(([d, t]) => d > 0 && t > 0);
    if (laps.length) {
      const ok = laps.filter(([d, t]) => t / d * 100 >= limit);
      const removed = laps.length - ok.length;
      if (ok.length) {
        a.pace = {
          distance: ok.reduce((x, [d]) => x + d, 0),
          time: ok.reduce((x, [, t]) => x + t, 0),
        };
      }
      if (removed) a.paceNote = ok.length ? `${removed} série${removed > 1 ? 's' : ''} écartée${removed > 1 ? 's' : ''} (bug montre)` : 'Allure écartée (bug montre)';
    } else if (a.time / a.distance * 100 < limit) {
      a.paceNote = 'Allure écartée (bug montre)';
    } else {
      a.pace = { distance: a.distance, time: a.time };
    }
  }
  return { ref, limit };
}

// Vitesse moyenne (m/s) d'un sport sur les `weeks` semaines finissant à `monday`, allures filtrées
export function averageSpeed(acts, sport, monday, weeks = 8) {
  const from = isoDay(addDays(monday, -7 * (weeks - 1)));
  const to = isoDay(addDays(monday, 6));
  let list = acts.filter(a => a.sport === sport && a.pace && a.week >= from && a.week <= to);
  if (!list.length) list = acts.filter(a => a.sport === sport && a.pace);
  const d = list.reduce((x, a) => x + a.pace.distance, 0);
  const t = list.reduce((x, a) => x + a.pace.time, 0);
  return t ? d / t : null;
}

// ---------- Agrégats ----------

function emptyTotals() {
  return { time: 0, distance: 0, count: 0, effort: 0, elevation: 0, paceDistance: 0, paceTime: 0 };
}

export function weekTotals(acts, mondayKey) {
  const res = { all: emptyTotals() };
  SPORT_KEYS.forEach(s => (res[s] = emptyTotals()));
  for (const a of acts) {
    if (a.week !== mondayKey) continue;
    for (const t of [res[a.sport], res.all]) {
      t.time += a.time;
      t.distance += a.distance;
      t.count += 1;
      t.effort += a.effort || 0;
      t.elevation += a.elevation;
      if (a.pace) { t.paceDistance += a.pace.distance; t.paceTime += a.pace.time; }
    }
  }
  return res;
}

// Les n semaines qui finissent à `endMonday` (inclus), de la plus ancienne à la plus récente
export function weeklySeries(acts, endMonday, n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const monday = addDays(endMonday, -7 * i);
    out.push({ monday, totals: weekTotals(acts, isoDay(monday)) });
  }
  return out;
}

// Moyenne des 4 semaines précédant `monday`
export function previousAverage(acts, monday, weeks = 4) {
  const series = weeklySeries(acts, addDays(monday, -7), weeks);
  const avg = { all: emptyTotals() };
  SPORT_KEYS.forEach(s => (avg[s] = emptyTotals()));
  for (const w of series) {
    for (const k of ['all', ...SPORT_KEYS]) {
      for (const f of Object.keys(avg[k])) avg[k][f] += w.totals[k][f] / weeks;
    }
  }
  return avg;
}

// Ratio charge aiguë / chronique à partir de l'« effort relatif » Strava
export function loadRatio(acts, monday) {
  const cur = weekTotals(acts, isoDay(monday)).all.effort;
  const prev = previousAverage(acts, monday).all.effort;
  if (!prev || !acts.some(a => a.effort != null)) return null;
  const ratio = cur / prev;
  let level, text;
  if (ratio < 0.8) { level = 'low'; text = 'Semaine légère, bonne pour récupérer'; }
  else if (ratio <= 1.3) { level = 'good'; text = 'Charge dans ta zone habituelle'; }
  else if (ratio <= 1.5) { level = 'warn'; text = 'Charge en hausse, reste vigilant'; }
  else { level = 'bad'; text = 'Hausse brutale, risque de blessure'; }
  return { ratio, cur, prev, level, text };
}

// ---------- Allures ----------

// Valeur numérique de l'allure, dans l'unité de la discipline
// course : s/km, natation : s/100 m, vélo : km/h
export function paceValue(speed, sport) {
  if (!speed) return null;
  if (sport === 'run') return 1000 / speed;
  if (sport === 'swim') return 100 / speed;
  return speed * 3.6;
}

export function paceSeries(acts, sport) {
  const pts = acts
    .filter(a => a.sport === sport && a.pace && a.distance >= MIN_DIST[sport])
    .sort((a, b) => a.local.localeCompare(b.local))
    .map(a => ({ act: a, value: paceValue(a.pace.distance / a.pace.time, sport) }));
  // moyenne glissante sur 5 sorties
  pts.forEach((p, i) => {
    const win = pts.slice(Math.max(0, i - 4), i + 1);
    p.avg = win.reduce((s, x) => s + x.value, 0) / win.length;
  });
  return pts;
}

export function records(acts, sport) {
  const list = acts.filter(a => a.sport === sport);
  const year = String(new Date().getFullYear());
  const thisYear = list.filter(a => a.local.startsWith(year));
  const paced = list.filter(a => a.pace && a.distance >= MIN_DIST[sport]);
  const better = sport === 'ride' ? (a, b) => b - a : (a, b) => a - b;
  const best = paced
    .map(a => ({ a, v: paceValue(a.pace.distance / a.pace.time, sport) }))
    .sort((x, y) => better(x.v, y.v))[0];
  const longest = [...list].sort((a, b) => b.distance - a.distance)[0];
  const sum = (arr, f) => arr.reduce((s, a) => s + a[f], 0);
  return {
    best,
    longest,
    yearDistance: sum(thisYear, 'distance'),
    yearTime: sum(thisYear, 'time'),
    yearCount: thisYear.length,
  };
}

// ---------- Formatage ----------

const nf1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

export function fmtDuration(sec) {
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h === 0) return `${m} min`;
  return `${h}h${String(m).padStart(2, '0')}`;
}

export function fmtDistance(m, sport) {
  if (sport === 'swim' && m < 10000) return `${nf0.format(m)} m`;
  return `${nf1.format(m / 1000)} km`;
}

function mmss(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, '0')}`;
}

export function fmtPaceValue(v, sport) {
  if (v == null || !isFinite(v)) return '–';
  if (sport === 'run') return `${mmss(v)} /km`;
  if (sport === 'swim') return `${mmss(v)} /100 m`;
  return `${nf1.format(v)} km/h`;
}

export function fmtPace(distance, time, sport) {
  if (!distance || !time) return '–';
  return fmtPaceValue(paceValue(distance / time, sport), sport);
}

export function fmtShortPace(v, sport) {
  return sport === 'ride' ? nf1.format(v) : mmss(v);
}

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const DAYS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];

export function fmtDayMonth(dt) {
  return `${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]}`;
}

export function fmtActivityDate(local) {
  const d = parseDay(local);
  return `${DAYS[d.getUTCDay()]} ${fmtDayMonth(d)} · ${local.slice(11, 16).replace(':', 'h')}`;
}

export function fmtWeekRange(monday) {
  return `${fmtDayMonth(monday)} – ${fmtDayMonth(addDays(monday, 6))}`;
}

export function fmtNumber(n) {
  return nf1.format(n);
}
