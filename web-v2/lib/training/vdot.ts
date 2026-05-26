/**
 * VDOT — Daniels' fitness index derived from race performance.
 *
 * Cite: Research/01-pace-zones-vdot.md §vdot-table (Daniels Running Formula,
 * J. Daniels, 3rd ed., extended through VDOT 85 per project memory).
 *
 * Strategy:
 *   1. For each race in the past 6 months, look up the VDOT corresponding
 *      to (finish_time, distance).
 *   2. Return the highest (best). This naturally excludes slow C-races
 *      because a C-race effort produces a lower VDOT.
 *   3. Also exclude races flagged priority='C' explicitly.
 *
 * Algorithm: invert the Daniels race-time table by binary-searching over
 * VDOT and computing predicted race time at each VDOT, returning the VDOT
 * whose predicted time matches the actual finish.
 *
 * Daniels' race-time formula (s):
 *   For a given distance d (km) and VDOT v:
 *   - vO2 demand of running at speed s (m/min): VO2 = 0.000104·s² + 0.182·s − 4.6
 *   - %VO2max sustainable for time t (min): %v = 0.8 + 0.1894·exp(-0.012778·t) +
 *                                                  0.2989·exp(-0.1932·t)
 *   - Find s such that VO2(s) = v · %v(t) where t = (d·1000)/s
 *   - The whole thing is solved iteratively.
 */

/** Distance in km from a label. */
function kmFromMi(mi: number): number { return mi * 1.609344; }

/** Daniels' VO2 cost of running at speed s (m/min). */
function vo2Cost(metersPerMin: number): number {
  return -4.6 + 0.182258 * metersPerMin + 0.000104 * metersPerMin * metersPerMin;
}

/** Daniels' %VO2max sustainable for time t (min). */
function pctVO2(min: number): number {
  return 0.8 + 0.1894393 * Math.exp(-0.012778 * min) +
               0.2989558 * Math.exp(-0.1932605 * min);
}

/** Given (finish_seconds, distance_mi), return the VDOT that predicts
 *  exactly that finish time. Returns null if outside [30, 85]. */
export function vdotFromRace(finishSeconds: number, distanceMi: number): number | null {
  if (!finishSeconds || finishSeconds < 60 || !distanceMi || distanceMi <= 0) return null;
  const km = kmFromMi(distanceMi);
  const meters = km * 1000;
  const minutes = finishSeconds / 60;
  // Speed = meters per minute
  const speed = meters / minutes;
  const vo2 = vo2Cost(speed);
  const pct = pctVO2(minutes);
  const vdot = vo2 / pct;
  if (!isFinite(vdot)) return null;
  if (vdot < 30 || vdot > 85) return null;
  return Math.round(vdot * 10) / 10; // 1 decimal place
}

/** Parse "1:34:54" or "3:30:25" or "59:30" or "23:15" → seconds. */
export function parseRaceTime(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  if (m[3] != null) return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
  return (+m[1]) * 60 + (+m[2]);
}

export interface RaceVdotCandidate {
  slug: string;
  name: string;
  date: string;
  priority: 'A' | 'B' | 'C' | null;
  distance_mi: number;
  finish_seconds: number;
  vdot: number;
}

/** Best (highest) VDOT from races within the lookback window.
 *  Skips C-races and races without a finish time.
 *  Skips races more than `lookbackDays` old (default: 180). */
export function bestRecentVdot(
  races: Array<{ slug: string; name: string; date: string; priority: 'A'|'B'|'C'|null; distance_mi: number | null; finish_seconds: number | null }>,
  todayISO: string,
  lookbackDays = 180,
): { best: RaceVdotCandidate | null; considered: RaceVdotCandidate[] } {
  const cutoff = new Date(Date.parse(todayISO + 'T12:00:00Z') - lookbackDays * 86400000).toISOString().slice(0, 10);
  const candidates: RaceVdotCandidate[] = [];
  for (const r of races) {
    if (!r.date || !r.distance_mi || !r.finish_seconds) continue;
    if (r.date < cutoff) continue;
    if (r.priority === 'C') continue;
    const v = vdotFromRace(r.finish_seconds, r.distance_mi);
    if (v == null) continue;
    candidates.push({
      slug: r.slug, name: r.name, date: r.date, priority: r.priority,
      distance_mi: r.distance_mi, finish_seconds: r.finish_seconds, vdot: v,
    });
  }
  candidates.sort((a, b) => b.vdot - a.vdot);
  return { best: candidates[0] ?? null, considered: candidates };
}
