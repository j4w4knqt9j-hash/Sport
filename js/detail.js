// Détail d'une sortie : découpage en tronçons (km, 5 km ou séries) et analyse chiffrée, sans IA.

import { paceValue, fmtPaceValue, fmtDuration, fmtDistance, SPORTS } from './stats.js';

const CACHE = 'trisuivi.detail.';
// Longueur d'un tronçon selon le sport
export const SPLIT = { run: 1000, ride: 5000 };

export function cachedDetail(id) {
  try { return JSON.parse(localStorage.getItem(CACHE + id)); } catch { return null; }
}

export function saveDetail(id, detail) {
  try { localStorage.setItem(CACHE + id, JSON.stringify(detail)); } catch { /* stockage plein : on recalculera */ }
}

// Découpe les flux Strava (time, distance, moving, heartrate, altitude) en tronçons de `unit` mètres
export function splitsFromStreams(s, unit) {
  const time = s.time?.data, dist = s.distance?.data;
  if (!time?.length || !dist?.length) return [];
  const moving = s.moving?.data, hr = s.heartrate?.data, alt = s.altitude?.data;
  const splits = [];
  let cur = { distance: 0, time: 0, hrSum: 0, hrTime: 0, gain: 0 };
  let boundary = unit;
  for (let i = 1; i < time.length; i++) {
    const dt = time[i] - time[i - 1];
    const dd = Math.max(0, dist[i] - dist[i - 1]);
    if (!moving || moving[i]) {
      cur.time += dt;
      if (hr?.[i]) { cur.hrSum += hr[i] * dt; cur.hrTime += dt; }
    }
    cur.distance += dd;
    if (alt && alt[i] > alt[i - 1]) cur.gain += alt[i] - alt[i - 1];
    if (dist[i] >= boundary) {
      splits.push(cur);
      cur = { distance: 0, time: 0, hrSum: 0, hrTime: 0, gain: 0 };
      boundary += unit;
    }
  }
  if (cur.distance > unit * 0.3) splits.push(cur);
  return splits.map(x => ({
    distance: Math.round(x.distance),
    time: Math.round(x.time),
    hr: x.hrTime ? Math.round(x.hrSum / x.hrTime) : null,
    gain: Math.round(x.gain),
  }));
}

// Tronçons d'une sortie : séries de la montre en natation, flux Strava sinon
export function splitsOf(act, detail) {
  if (act.sport === 'swim') {
    return (act.laps || [])
      .filter(([d, t]) => d > 0 && t > 0)
      .map(([d, t]) => ({ distance: d, time: t, hr: null, gain: 0 }));
  }
  return detail?.splits || [];
}

// ---------- Analyse ----------

const mean = arr => arr.reduce((s, x) => s + x, 0) / arr.length;

function pctText(p) {
  return `${p > 0 ? '+' : ''}${Math.round(p * 100)} %`;
}

// Écart d'allure lisible : « 12 s/km plus rapide », « 1,2 km/h plus lent »
function paceGap(v, ref, sport) {
  const diff = v - ref;
  const faster = sport === 'ride' ? diff > 0 : diff < 0;
  const abs = Math.abs(diff);
  const txt = sport === 'ride'
    ? `${abs.toFixed(1).replace('.', ',')} km/h`
    : `${Math.round(abs)} s${sport === 'run' ? '/km' : '/100 m'}`;
  return { faster, txt, tiny: sport === 'ride' ? abs < 0.3 : abs < 3 };
}

// Retourne une liste de constats { tone: 'good' | 'bad' | 'info', title, text }
export function analyse(act, acts, splits, { swimLimit = 0 } = {}) {
  const out = [];
  const sport = act.sport;
  const others = acts.filter(a => a.sport === sport && a.id !== act.id);
  const label = SPORTS[sport].label.toLowerCase();
  const v = act.pace ? paceValue(act.pace.distance / act.pace.time, sport) : null;

  // Allure par rapport à la moyenne
  const paced = others.filter(a => a.pace);
  if (v && paced.length >= 2) {
    const ref = paceValue(paced.reduce((s, a) => s + a.pace.distance, 0) / paced.reduce((s, a) => s + a.pace.time, 0), sport);
    const g = paceGap(v, ref, sport);
    const all = [...paced.map(a => paceValue(a.pace.distance / a.pace.time, sport)), v]
      .sort((a, b) => sport === 'ride' ? b - a : a - b);
    const rank = all.indexOf(v) + 1;
    out.push({
      tone: g.tiny ? 'info' : g.faster ? 'good' : 'bad',
      title: g.tiny ? 'Allure dans ta moyenne' : `${g.txt} ${g.faster ? 'plus rapide' : 'plus lent'} que ta moyenne`,
      text: `Moyenne ${label} : ${fmtPaceValue(ref, sport)}. ${rank === 1 ? 'C\'est ta meilleure allure' : `${rank}e meilleure allure`} sur ${all.length} sorties.`,
    });
  }

  // Distance et durée
  if (others.length >= 2) {
    const longer = others.filter(a => a.distance > act.distance).length;
    const avgDist = mean(others.map(a => a.distance));
    const ratio = act.distance / avgDist - 1;
    out.push({
      tone: longer === 0 ? 'good' : 'info',
      title: longer === 0 ? `Ta plus longue sortie ${label}` : `Distance ${pctText(ratio)} vs ta moyenne`,
      text: `Distance moyenne : ${fmtDistance(avgDist, sport)} · ${others.length + 1} sorties ${label} au total.`,
    });
  }

  // Comparaison avec la dernière sortie comparable (distance à ±25 %)
  const similar = others
    .filter(a => a.local < act.local && a.pace && Math.abs(a.distance / act.distance - 1) <= 0.25)
    .sort((a, b) => b.local.localeCompare(a.local))[0];
  if (v && similar) {
    const g = paceGap(v, paceValue(similar.pace.distance / similar.pace.time, sport), sport);
    let hrTxt = '';
    if (act.hr && similar.hr) {
      const d = Math.round(act.hr - similar.hr);
      hrTxt = ` FC moyenne ${d >= 0 ? '+' : ''}${d} bpm.`;
    }
    out.push({
      tone: g.tiny ? 'info' : g.faster ? 'good' : 'bad',
      title: g.tiny ? 'Même allure que ta dernière sortie similaire' : `${g.txt} ${g.faster ? 'plus rapide' : 'plus lent'} que ta dernière sortie similaire`,
      text: `« ${similar.name} » (${fmtDistance(similar.distance, sport)}, ${similar.local.slice(8, 10)}/${similar.local.slice(5, 7)}).${hrTxt}`,
    });
  }

  // Intensité : effort relatif par heure
  const withEffort = others.filter(a => a.effort && a.time);
  if (act.effort && withEffort.length >= 2) {
    const perH = act.effort / (act.time / 3600);
    const ref = mean(withEffort.map(a => a.effort / (a.time / 3600)));
    const r = perH / ref - 1;
    out.push({
      tone: Math.abs(r) < 0.15 ? 'info' : r > 0 ? 'bad' : 'good',
      title: Math.abs(r) < 0.15 ? 'Intensité habituelle' : r > 0 ? 'Séance plus intense que d\'habitude' : 'Séance plus facile que d\'habitude',
      text: `Effort relatif ${Math.round(perH)}/h contre ${Math.round(ref)}/h en moyenne (${pctText(r)}).`,
    });
  }

  // Analyse des tronçons
  // en natation, on ignore les séries buggées (plus rapides que la limite du filtre)
  const full = splits.filter(s => s.distance > 0 && s.time > 0 && !(sport === 'swim' && swimLimit && s.time / s.distance * 100 < swimLimit));
  const unitWord = sport === 'swim' ? 'séries' : sport === 'run' ? 'km' : 'tronçons de 5 km';
  if (full.length >= 3) {
    const paces = full.map(s => s.time / s.distance);
    const avg = mean(paces);
    const cv = Math.sqrt(mean(paces.map(p => (p - avg) ** 2))) / avg;
    out.push({
      tone: cv < 0.04 ? 'good' : cv < 0.08 ? 'info' : 'bad',
      title: cv < 0.04 ? 'Allure très régulière' : cv < 0.08 ? 'Allure assez régulière' : 'Allure irrégulière',
      text: `Écart moyen de ${Math.round(cv * 100)} % entre tes ${unitWord}.${sport !== 'swim' && cv >= 0.08 ? ' Le dénivelé ou les arrêts peuvent l\'expliquer.' : ''}`,
    });

    // Première moitié / seconde moitié
    const half = Math.floor(full.length / 2);
    const sum = (arr, f) => arr.reduce((s, x) => s + x[f], 0);
    const h1 = full.slice(0, half), h2 = full.slice(full.length - half);
    const s1 = sum(h1, 'distance') / sum(h1, 'time'), s2 = sum(h2, 'distance') / sum(h2, 'time');
    const r = s2 / s1 - 1;
    if (Math.abs(r) >= 0.02) {
      out.push({
        tone: r > 0 ? 'good' : 'bad',
        title: r > 0 ? 'Fin plus rapide que le début (split négatif)' : 'Baisse de rythme en seconde partie',
        text: `${fmtPaceValue(paceValue(s1, sport), sport)} sur la 1re moitié, ${fmtPaceValue(paceValue(s2, sport), sport)} sur la 2de.`,
      });
    } else {
      out.push({ tone: 'good', title: 'Rythme tenu jusqu\'au bout', text: 'Même allure sur les deux moitiés de la sortie.' });
    }

    // Dérive cardiaque : FC par unité de vitesse, 2de moitié vs 1re
    const hr1 = h1.filter(s => s.hr), hr2 = h2.filter(s => s.hr);
    if (hr1.length && hr2.length) {
      const f1 = mean(hr1.map(s => s.hr)) / s1, f2 = mean(hr2.map(s => s.hr)) / s2;
      const drift = f2 / f1 - 1;
      out.push({
        tone: drift < 0.05 ? 'good' : drift < 0.1 ? 'info' : 'bad',
        title: drift < 0.05 ? 'Peu de dérive cardiaque' : drift < 0.1 ? 'Dérive cardiaque modérée' : 'Forte dérive cardiaque',
        text: `À allure égale, ta FC a varié de ${pctText(drift)} entre les deux moitiés.${drift >= 0.05 ? ' Signe de fatigue, de chaleur ou de manque d\'hydratation.' : ' Bonne endurance sur cette durée.'}`,
      });
    }
  }

  // Pauses
  const pause = act.elapsed - act.time;
  if (act.elapsed && pause > 60) {
    const share = pause / act.elapsed;
    out.push({
      tone: 'info',
      title: `${fmtDuration(pause)} de pause`,
      text: `${Math.round(share * 100)} % du temps total (${fmtDuration(act.elapsed)}).${sport === 'swim' ? ' Récupération entre les séries.' : ''}`,
    });
  }
  return out;
}
