// Données fictives pour essayer l'appli sans compte Strava connecté.

import { currentMonday, addDays, isoDay } from './stats.js';

function rng(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

// [type, jour de la semaine (0 = lundi), heure, distance de base (m), vitesse de base (m/s), nom]
const PLAN = [
  ['Swim', 1, '12:15', 1300, 0.82, 'Natation le midi'],
  ['Run', 2, '18:45', 6000, 2.65, 'Footing'],
  ['Ride', 3, '12:30', 25000, 6.4, 'Sortie vélo le midi'],
  ['Swim', 4, '12:10', 1600, 0.84, 'Séance technique'],
  ['Ride', 5, '09:00', 40000, 6.6, 'Sortie longue'],
  ['Run', 6, '09:30', 9000, 2.6, 'Sortie longue course'],
];

// Découpe une séance de natation en séries ; parfois une série « buggée » (longueurs fantômes)
function demoLaps(distance, time, rand) {
  const n = 3 + Math.floor(rand() * 3);
  const laps = Array.from({ length: n }, () => [Math.round(distance / n / 50) * 50, Math.round(time / n)]);
  if (rand() < 0.3) laps[1][0] = Math.round(laps[1][0] * 1.3 / 50) * 50;
  return laps;
}

export function demoActivities(weeks = 20) {
  const rand = rng(42);
  const start = currentMonday(-(weeks - 1));
  const today = isoDay(new Date());
  const out = [];
  let id = 1;
  for (let w = 0; w < weeks; w++) {
    const progress = 1 + w * 0.012; // légère progression
    const volume = w % 4 === 3 ? 0.65 : 0.85 + rand() * 0.35; // semaine de récup toutes les 4 semaines
    for (const [type, day, hour, dist, speed, name] of PLAN) {
      if (rand() > 0.82) continue; // séance sautée
      const date = isoDay(addDays(start, 7 * w + day));
      if (date > today) continue;
      const distance = Math.round(dist * volume * (0.8 + rand() * 0.4));
      const average_speed = speed * progress * (0.94 + rand() * 0.1);
      const moving_time = Math.round(distance / average_speed);
      out.push({
        id: id++,
        name,
        sport_type: type,
        start_date_local: `${date}T${hour}:00Z`,
        start_date: `${date}T${hour}:00Z`,
        distance,
        moving_time,
        elapsed_time: Math.round(moving_time * (1.05 + rand() * 0.2)),
        total_elevation_gain: type === 'Swim' ? 0 : Math.round(distance / 1000 * (4 + rand() * 8)),
        average_speed,
        suffer_score: Math.round(moving_time / 60 * (0.8 + rand() * 0.8)),
        laps: type === 'Swim' ? demoLaps(distance, moving_time, rand) : undefined,
      });
    }
  }
  return out;
}

// Tronçons fictifs pour la page de détail en mode démo
export function demoSplits(act, unit) {
  const rand = rng(Number(act.id) * 7919);
  const n = Math.floor(act.distance / unit);
  const rest = act.distance - n * unit;
  const lengths = [...Array(n).fill(unit), ...(rest > unit * 0.3 ? [rest] : [])];
  const base = act.time / act.distance;
  const hr0 = act.sport === 'run' ? 148 : 132;
  return lengths.map((d, i) => {
    const fatigue = 1 + (i / lengths.length) * 0.04;
    return {
      distance: Math.round(d),
      time: Math.round(d * base * (0.95 + rand() * 0.08) * fatigue),
      hr: Math.round(hr0 + i * 1.2 + rand() * 6),
      gain: Math.round(rand() * act.elevation / Math.max(1, lengths.length) * 2),
    };
  });
}
