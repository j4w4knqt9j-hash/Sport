// Envoi des séances sur Intervals.icu, qui les transmet à Garmin Connect puis à la montre.
// La clé API Intervals.icu reste sur l'appareil (localStorage).

const API = 'https://intervals.icu/api/v1';
const KEY = 'trisuivi.intervalsKey';
const PAUSE_KEY = 'trisuivi.lapPauses';

// Pause non chronométrée entre les blocs (la montre attend un appui sur Lap) : activée par défaut
export function getPauses() {
  try { return localStorage.getItem(PAUSE_KEY) !== 'off'; } catch { return true; }
}

export function setPauses(on) {
  localStorage.setItem(PAUSE_KEY, on ? 'on' : 'off');
}

export const ICU_TYPE = { run: 'Run', ride: 'Ride', swim: 'Swim' };

// Allure seuil en course (secondes par km) : Garmin ne reçoit les cibles d'allure que
// sous forme de pourcentage de cette allure, telle qu'enregistrée dans Intervals.icu
const THRESHOLD_KEY = 'trisuivi.runThreshold';

export function getThreshold() {
  try { return Number(localStorage.getItem(THRESHOLD_KEY)) || null; } catch { return null; }
}

export function setThreshold(sec) {
  if (sec > 0) localStorage.setItem(THRESHOLD_KEY, String(Math.round(sec)));
  else localStorage.removeItem(THRESHOLD_KEY);
}

// « 4:45 » → 285 s
export function parsePace(text) {
  const m = String(text).trim().match(/^(\d{1,2})[:'h.,](\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function fmtPaceText(sec) {
  return sec ? `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}` : '';
}

export function getKey() {
  try { return localStorage.getItem(KEY) || ''; } catch { return ''; }
}

export function setKey(key) {
  localStorage.setItem(KEY, key.trim());
}

// ---------- Texte de séance au format Intervals.icu ----------

function fmtTime(sec) {
  sec = Math.max(1, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return `${h ? h + 'h' : ''}${m ? m + 'm' : ''}${s ? s + 's' : ''}`;
}

function fmtDist(m) {
  // « m » veut dire minutes pour Intervals.icu : les mètres s'écrivent « mtr »
  return m >= 1000 && m % 100 === 0 ? `${m / 1000}km` : `${Math.round(m)}mtr`;
}

function fmtPace(sec) {
  sec = Math.round(sec);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

function stepLine(st, sport) {
  const parts = ['-'];
  // texte affiché sur la montre
  // (sans chiffres ni tirets, qu'Intervals.icu prendrait pour une durée ou une nouvelle étape)
  // (ni chiffres, tirets ou mots qu'Intervals.icu prendrait pour une durée, une unité ou une cible)
  if (st.note) {
    parts.push(st.note
      .replace(/[0-9\n\r\-%=/:]+/g, ' ')
      .replace(/\b(km|mtr|m|s|h|min|mi|x|z|pace|hr|lthr|rpm|w|ftp|ramp|freeride|intensity)\b/gi, ' ')
      .replace(/\s+/g, ' ').trim().slice(0, 40));
  }
  parts.push(st.duration_type === 'distance' && st.distance_m > 0 ? fmtDist(st.distance_m) : fmtTime(st.duration_s));
  if (st.kind === 'repos') {
    parts.push('intensity=rest');
  } else if (st.target_type === 'pace' && sport !== 'swim' && st.pace_min_s > 0) {
    const lo = Math.min(st.pace_min_s, st.pace_max_s || st.pace_min_s);
    const hi = Math.max(st.pace_min_s, st.pace_max_s || st.pace_min_s);
    const t = getThreshold();
    if (t) {
      // % de l'allure seuil (en vitesse) : une allure plus lente donne un pourcentage plus bas
      const a = Math.round(t / hi * 100), b = Math.round(t / lo * 100);
      parts.push(a === b ? `${a}% Pace` : `${a}-${b}% Pace`);
    } else {
      parts.push(lo === hi ? `${fmtPace(lo)}/km Pace` : `${fmtPace(lo)}/km-${fmtPace(hi)}/km Pace`);
    }
  } else if (st.target_type === 'hr_zone' && st.hr_zone >= 1 && sport !== 'run') {
    // course : pas de zone FC, une séance ne doit mélanger allure et FC (Garmin)
    parts.push(`Z${Math.min(5, st.hr_zone)} HR`);
  }
  return parts.filter(Boolean).join(' ');
}

// Pause ouverte avant l'étape j du bloc i : entre deux exercices différents d'un bloc
// non répété du corps de séance (pas dans l'échauffement ni le retour au calme)
export function exercisePause(w, i, j) {
  const b = w.blocks[i];
  if (j === 0 || b.repeat > 1 || i === 0 || i === w.blocks.length - 1) return false;
  return b.steps[j].kind === 'effort' && b.steps[j - 1].kind === 'effort';
}

// Étape ouverte : la durée ne sert qu'au calcul de la durée prévue, la montre attend un appui sur Lap
const OPEN_STEP = '- Press lap 1m intensity=rest';

// Convertit la séance structurée par Claude en texte de séance Intervals.icu
export function workoutText(w, sport, pauses = getPauses()) {
  const out = [];
  w.blocks.forEach((b, i) => {
    if (pauses && i > 0) out.push('Pause', OPEN_STEP, '');
    const label = (b.label || '').replace(/\d+\s*x/gi, '').trim() || 'Bloc';
    out.push(b.repeat > 1 ? `${label} ${b.repeat}x` : label);
    b.steps.forEach((st, j) => {
      if (pauses && exercisePause(w, i, j)) out.push(OPEN_STEP);
      out.push(stepLine(st, sport));
    });
    out.push('');
  });
  return out.join('\n').trim();
}

// Résumé lisible d'une étape, pour l'aperçu dans l'appli
export function stepLabel(st, sport) {
  const dur = st.duration_type === 'distance' && st.distance_m > 0
    ? (st.distance_m >= 1000 ? `${(st.distance_m / 1000).toString().replace('.', ',')} km` : `${st.distance_m} m`)
    : fmtTime(st.duration_s).replace(/(\d)([hms])/g, '$1 $2 ').replace(/ m /g, ' min ').trim().replace(/ m$/, ' min');
  let target = '';
  if (st.kind === 'repos') target = 'repos';
  else if (st.target_type === 'pace' && st.pace_min_s > 0 && sport !== 'swim') {
    const unit = '/km';
    const lo = Math.min(st.pace_min_s, st.pace_max_s || st.pace_min_s), hi = Math.max(st.pace_min_s, st.pace_max_s || st.pace_min_s);
    target = lo === hi ? `${fmtPace(lo)} ${unit}` : `${fmtPace(lo)}–${fmtPace(hi)} ${unit}`;
  } else if (st.target_type === 'hr_zone' && st.hr_zone >= 1 && sport !== 'run') target = `zone FC ${st.hr_zone}`;
  return [st.note, dur, target].filter(Boolean).join(' · ');
}

// ---------- API ----------

export class BrowserBlockedError extends Error {}

function authHeader() {
  return 'Basic ' + btoa(`API_KEY:${getKey()}`);
}

async function call(path, options = {}) {
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      ...options,
      headers: { Authorization: authHeader(), 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
  } catch {
    // le navigateur a bloqué l'appel (accès depuis une page web refusé) ou pas de réseau
    throw new BrowserBlockedError('Le navigateur a bloqué l\'appel à Intervals.icu (ou pas de connexion).');
  }
  const body = await res.text();
  if (res.status === 401 || res.status === 403) throw new Error(`Clé Intervals.icu refusée (${res.status}). Vérifie-la dans les Réglages.`);
  if (!res.ok) throw new Error(`Erreur Intervals.icu ${res.status} : ${body.slice(0, 200) || 'pas de détail'}`);
  try { return JSON.parse(body); } catch { return body; }
}

// Vérifie la clé : renvoie le nom de l'athlète
// Allure seuil course lue dans les réglages Intervals.icu (vitesse en m/s)
function runThresholdFrom(athlete) {
  const settings = athlete.sportSettings || athlete.sport_settings || [];
  const run = settings.find(x => (x.types || []).includes('Run'));
  const v = run && Number(run.threshold_pace);
  return v > 0 ? 1000 / v : null;
}

// Vérifie la clé et récupère l'allure seuil course si elle est réglée dans Intervals.icu
export async function testConnection() {
  const a = await call('/athlete/0');
  const t = runThresholdFrom(a);
  if (t) setThreshold(t);
  return {
    name: [a.firstname, a.lastname].filter(Boolean).join(' ') || a.name || a.id || 'compte trouvé',
    threshold: t,
  };
}

// Avant d'envoyer une séance de course : il faut l'allure seuil
export async function ensureThreshold() {
  if (getThreshold()) return getThreshold();
  try { await testConnection(); } catch { /* l'erreur d'envoi suivra si besoin */ }
  return getThreshold();
}

// Crée ou remplace (même external_id) des séances planifiées dans le calendrier
export async function pushEvents(events) {
  const saved = await call('/athlete/0/events/bulk?upsert=true', { method: 'POST', body: JSON.stringify(events) });
  if (!Array.isArray(saved) || saved.length < events.length) {
    throw new Error(`Intervals.icu a répondu sans enregistrer les séances : ${JSON.stringify(saved).slice(0, 200)}`);
  }
  return saved;
}

export function makeEvent({ date, sport, name, text, minutes, externalId }) {
  return {
    category: 'WORKOUT',
    start_date_local: `${date}T00:00:00`,
    type: ICU_TYPE[sport],
    name: name.slice(0, 80),
    description: text,
    ...(minutes ? { moving_time: Math.round(minutes * 60) } : {}),
    external_id: externalId,
  };
}

// ---------- Séances envoyées (mémorisées sur l'appareil) ----------

const SENT = 'trisuivi.sent';

export function externalId(date, sport) {
  return `trisuivi-${date}-${sport}`;
}

export function getSent(id) {
  try { return (JSON.parse(localStorage.getItem(SENT)) || {})[id] || null; } catch { return null; }
}

export function markSent(id, data) {
  let all;
  try { all = JSON.parse(localStorage.getItem(SENT)) || {}; } catch { all = {}; }
  all[id] = { ...data, at: Date.now() };
  try { localStorage.setItem(SENT, JSON.stringify(all)); } catch { /* stockage plein */ }
}
