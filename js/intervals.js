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
  if (st.note) parts.push(st.note.replace(/[0-9\n\r-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40));
  parts.push(st.duration_type === 'distance' && st.distance_m > 0 ? fmtDist(st.distance_m) : fmtTime(st.duration_s));
  if (st.kind === 'repos') {
    parts.push('intensity=rest');
  } else if (st.target_type === 'pace' && sport !== 'swim' && st.pace_min_s > 0) {
    const lo = Math.min(st.pace_min_s, st.pace_max_s || st.pace_min_s);
    const hi = Math.max(st.pace_min_s, st.pace_max_s || st.pace_min_s);
    parts.push(lo === hi ? `${fmtPace(lo)}/km Pace` : `${fmtPace(lo)}-${fmtPace(hi)}/km Pace`);
  } else if (st.target_type === 'hr_zone' && st.hr_zone >= 1) {
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
  } else if (st.target_type === 'hr_zone' && st.hr_zone >= 1) target = `zone FC ${st.hr_zone}`;
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
export async function testConnection() {
  const a = await call('/athlete/0');
  return [a.firstname, a.lastname].filter(Boolean).join(' ') || a.name || a.id || 'compte trouvé';
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
