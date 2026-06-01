/**
 * Race-detail seed for the Faff RaceView, sourced from the real web-v2
 * races table. Combines:
 *  - races-state row (name, date, distance, location, priority)
 *  - course_geometry JSONB (elevation profile, polyline)
 *  - profile.physiology (lthr + zones → drives projected pace/HR)
 *
 * AUTH (2026-05-30 P1 SSR fix): the per-user race lookup is keyed
 * off the `faff_session` cookie. When no session is present we return
 * null — RaceView treats null as "not found" and triggers notFound()
 * (a 404), which is the right surface for "you don't have a race
 * with that slug" + the right surface for "you aren't signed in".
 * Previously this silently loaded David's races, so any unauthenticated
 * visitor with a known slug would see his goal time / location / etc.
 *
 * Falls back to neutral CIM-style defaults for fields with no backend.
 */

import type { RaceDetailSeed } from './views/RaceView';
import { parseRaceTime, formatRaceTime } from '@/lib/training/vdot';
import { userIdFromCookies } from '@/lib/auth/session';

type CourseGeom = {
  trackPoints?: Array<{ lat: number; lon: number; ele: number | null }>;
  distance_mi?: number;
  elevation_gain_ft?: number;
  bbox?: { minLat: number; maxLat: number; minLon: number; maxLon: number };
};

function pace(goalSec: number, distMi: number): string {
  if (!goalSec || !distMi) return '·';
  const per = goalSec / distMi;
  return `${Math.floor(per / 60)}:${String(Math.round(per % 60)).padStart(2, '0')}`;
}

function cumAt(goalSec: number, distMi: number, atMi: number): string {
  if (!goalSec || !distMi) return '·';
  const t = goalSec * (atMi / distMi);
  return formatRaceTime(Math.round(t)) ?? '·';
}

/** 4-block negative-split pacing: first block 0.5%-1% slower (rolling in),
 *  middle blocks ~goal pace, last block fastest if downhill, even otherwise. */
function buildPacing(goalSec: number, distMi: number, netElevFt: number): RaceDetailSeed['pacing'] {
  if (!goalSec || !distMi) return [];
  const downhill = netElevFt < -100;
  const blocks = [
    { start: 0,            end: distMi * 0.25, factor: 1.012, color: '#14C08C', sub: 'controlled · ease in' },
    { start: distMi * 0.25, end: distMi * 0.50, factor: 1.0,   color: '#F3AD38', sub: 'settle into rhythm' },
    { start: distMi * 0.50, end: distMi * 0.80, factor: downhill ? 0.998 : 1.0, color: '#FF8847', sub: 'locked in · work the middle' },
    { start: distMi * 0.80, end: distMi,        factor: downhill ? 0.985 : 0.992, color: '#FC4D64', sub: 'empty the tank' },
  ];
  const out: RaceDetailSeed['pacing'] = [];
  let cum = 0;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const seg = b.end - b.start;
    const blockSec = goalSec * (seg / distMi) * b.factor;
    cum += blockSec;
    out.push({
      seg: `Miles ${formatMileRange(b.start, b.end, i === 0)}`,
      sub: b.sub,
      bar: 60 + i * 10,
      barColor: b.color,
      pace: pace(blockSec, seg),
      cum: formatRaceTime(Math.round(cum)) ?? '·',
    });
  }
  return out;
}
function formatMileRange(a: number, b: number, first: boolean): string {
  const round = (v: number) => Number.isInteger(v) ? v.toString() : v.toFixed(1).replace(/\.0$/, '');
  const lo = first ? '1' : round(a);
  return `${lo}–${round(b)}`;
}

function buildSplits(goalSec: number, distMi: number): RaceDetailSeed['splits'] {
  if (!goalSec || !distMi) return [];
  const ladder: Array<{ label: string; mi: number }> = [
    { label: '5K',  mi: 3.1069 },
    { label: '10K', mi: 6.2137 },
    { label: 'HALF', mi: 13.1094 },
    { label: '30K', mi: 18.641 },
    { label: '40K', mi: 24.855 },
  ];
  const out = ladder
    .filter(r => r.mi < distMi - 0.1)
    .map(r => ({ label: r.label, val: cumAt(goalSec, distMi, r.mi) }));
  out.push({ label: 'FINISH', val: formatRaceTime(Math.round(goalSec)) ?? '·' });
  return out;
}

/** Gels at ~70g/hr (40g per gel), one every ~35 min. */
function buildGels(goalSec: number, distMi: number): RaceDetailSeed['gels'] {
  if (!goalSec || !distMi) return [];
  const hours = goalSec / 3600;
  const totalGels = Math.max(1, Math.round(hours * 1.7)); // ~every 35 min
  const out: RaceDetailSeed['gels'] = [];
  for (let i = 1; i <= totalGels; i++) {
    const atMi = (i / (totalGels + 1)) * distMi;
    const isCaf = i === Math.max(1, totalGels - 1) || i === totalGels;
    out.push({
      mi: `MI ${atMi.toFixed(1)}${isCaf ? ' · caf' : ''}`,
      left: Math.round((atMi / distMi) * 100),
      caf: isCaf,
    });
  }
  return out;
}

function bumpHMS(t: string, addSec: number): string {
  const sec = parseRaceTime(t);
  if (!sec) return t;
  return formatRaceTime(sec + addSec) ?? t;
}

function notablesFromElevation(geom: CourseGeom | null, distMi: number): RaceDetailSeed['notables'] {
  if (!geom?.trackPoints?.length || distMi <= 0) {
    return [{ mi: '·', tx: 'Notable miles will surface once the course GPX is uploaded.' }];
  }
  // Walk the elevation series in thirds, label each third by net change.
  const eles = geom.trackPoints.map(p => p.ele).filter((v): v is number => v != null);
  if (eles.length < 6) {
    return [{ mi: '·', tx: 'Course profile loading.' }];
  }
  const splitMiles = [
    [0, distMi * 0.33],
    [distMi * 0.33, distMi * 0.66],
    [distMi * 0.66, distMi],
  ];
  const labelMile = (a: number, b: number) => {
    const round = (v: number) => Number.isInteger(v) ? v.toString() : v.toFixed(0);
    return `${a < 1 ? '1' : round(a)}–${round(b)}`;
  };
  const phase = (delta: number, gain: number) => {
    if (delta < -50) return 'Steady descent. Let gravity do the work, hold form.';
    if (delta > 50) return 'Climbing block. Stay relaxed, do not surge.';
    if (gain > 200) return 'Rolling hills. The bumps live here.';
    return 'Flat and fast. Where the race is won.';
  };
  return splitMiles.map(([a, b]) => {
    const iA = Math.floor((a / distMi) * eles.length);
    const iB = Math.min(eles.length - 1, Math.floor((b / distMi) * eles.length));
    const sub = eles.slice(iA, iB + 1);
    const delta = (sub.at(-1) ?? 0) - (sub[0] ?? 0);
    let gain = 0;
    for (let i = 1; i < sub.length; i++) {
      const d = sub[i] - sub[i - 1];
      if (d > 0) gain += d;
    }
    return { mi: labelMile(a, b), tx: `<b>${phase(delta, gain * 3.28).split('. ')[0]}.</b> ${phase(delta, gain * 3.28).split('. ').slice(1).join('. ')}` };
  });
}

function insightFor(name: string, distMi: number, netElevFt: number): string {
  const downhill = netElevFt < -200;
  const isMar = distMi >= 25;
  const isHalf = distMi >= 12 && distMi < 16;
  if (downhill && isMar)
    return `<b>${name}</b> is a fast course on paper, but net downhill races punish runners who hammer the early miles. <b>Bank nothing.</b> Hold goal pace, run the tangents, and use the final 10K to close.`;
  if (isMar)
    return `<b>${name}</b> rewards patience. <b>Even effort beats even pace.</b> Lock in by 10K, eat early, stay relaxed through the back half.`;
  if (isHalf)
    return `<b>${name}</b> · half marathon execution. Settle the first 5K so the final 5K is yours. <b>Bridge between threshold and tempo</b>; never red-line before mile 8.`;
  return `<b>${name}</b> · run controlled. The race opens up if you arrive at the final third with legs left.`;
}

function elevPathFromGeometry(geom: CourseGeom | null): string {
  const fallback = 'M0,58 L40,40 L80,70 L120,46 L160,78 L200,54 L240,86 L280,68 L320,96 L360,84 L400,104 L440,96 L480,112 L520,108 L560,120 L600,116 L640,128';
  if (!geom?.trackPoints?.length) return fallback;
  const pts = geom.trackPoints
    .map(p => p.ele)
    .filter((v): v is number => v != null);
  if (pts.length < 2) return fallback;
  const min = Math.min(...pts), max = Math.max(...pts);
  const span = Math.max(0.001, max - min);
  const step = Math.max(1, Math.floor(pts.length / 32));
  const out: string[] = [];
  for (let i = 0; i < pts.length; i += step) {
    const x = (i / (pts.length - 1)) * 640;
    const y = 130 - ((pts[i] - min) / span) * 90; // 40..130
    out.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return 'M' + out.join(' L');
}

/** 2026-05-30: real route shape from course trackPoints, projected into a
 *  640×158 SVG viewBox. Returns null when no GPX is on file — RaceView
 *  hides the map and shows a "Route unavailable" note instead of the old
 *  hardcoded zigzag. */
function routePathFromGeometry(geom: CourseGeom | null): {
  path: string;
  start: [number, number];
  end: [number, number];
} | null {
  if (!geom?.trackPoints?.length || geom.trackPoints.length < 2) return null;
  const latLng: Array<[number, number]> = geom.trackPoints.map((p) => [p.lat, p.lon]);
  // Inline the same Mercator-ish projection as lib/route/polyline so the
  // race detail can stay server-built without pulling in a browser-only
  // util. Identical math.
  let minLat = latLng[0][0], maxLat = latLng[0][0];
  let minLng = latLng[0][1], maxLng = latLng[0][1];
  for (const [la, ln] of latLng) {
    if (la < minLat) minLat = la; if (la > maxLat) maxLat = la;
    if (ln < minLng) minLng = ln; if (ln > maxLng) maxLng = ln;
  }
  const latSpan = maxLat - minLat || 1e-9;
  const lngSpan = maxLng - minLng || 1e-9;
  const midLat = (minLat + maxLat) / 2;
  const lngScale = Math.cos((midLat * Math.PI) / 180);
  const xSpan = lngSpan * lngScale || 1e-9;
  const viewW = 640, viewH = 158, pad = 14;
  const w = viewW - 2 * pad;
  const h = viewH - 2 * pad;
  const scale = Math.min(w / xSpan, h / latSpan);
  const drawW = xSpan * scale;
  const drawH = latSpan * scale;
  const offX = pad + (w - drawW) / 2;
  const offY = pad + (h - drawH) / 2;
  const project = ([la, ln]: [number, number]): [number, number] => [
    offX + (ln - minLng) * lngScale * scale,
    offY + (maxLat - la) * scale,
  ];
  const stride = Math.max(1, Math.floor(latLng.length / 400));
  const cmds: string[] = [];
  for (let i = 0; i < latLng.length; i += stride) {
    const [x, y] = project(latLng[i]);
    cmds.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return {
    path: cmds.join(' '),
    start: project(latLng[0]),
    end: project(latLng[latLng.length - 1]),
  };
}

export async function buildRaceDetail(slug: string): Promise<RaceDetailSeed | null> {
  try {
    // P1 SSR-leak fix (2026-05-30): resolve runner from cookie. Without
    // a session we return null → RaceView shows 404. This is the same
    // surface unauthenticated visitors got for slugs that don't match
    // their own races, so no information disclosure either way.
    const userId = await userIdFromCookies();
    if (!userId) return null;
    const [{ loadRacesState }, { pool }] = await Promise.all([
      import('@/lib/coach/races-state'),
      import('@/lib/db/pool'),
    ]);
    const [races, geoRow, courseLibRow] = await Promise.all([
      loadRacesState(userId),
      pool.query(
        `SELECT course_geometry, course_source, meta FROM races WHERE slug = $1 AND user_uuid = $2`,
        [slug, userId]
      ).catch(() => ({ rows: [] as Array<{ course_geometry: CourseGeom | null; course_source: string | null; meta: Record<string, unknown> | null }> })),
      // course_library row for the same slug — has provenance fields after
      // migration 127. When source='promoted' and contributor_count > 1,
      // RaceView surfaces a "Crowd-sourced by N runners" indicator.
      // 2026-05-31: also pull editorial annotations (start_label,
      // finish_label, notes) so RaceView can render CourseAnnotations
      // when source='editorial'. Closes coverage row 1185.
      pool.query(
        `SELECT source, contributor_count, start_label, finish_label, notes
           FROM course_library WHERE slug = $1`,
        [slug]
      ).catch(() => ({ rows: [] as Array<{ source: string | null; contributor_count: number | null; start_label: string | null; finish_label: string | null; notes: string | null }> })),
    ]);
    const row = geoRow.rows[0] ?? null;
    const geom = row?.course_geometry ?? null;
    const meta = row?.meta ?? {};
    const lib = courseLibRow.rows[0] ?? null;
    const courseSource = lib?.source ?? null;
    const contributorCount = Number(lib?.contributor_count ?? 0) || 0;
    const courseStartLabel = (lib as { start_label?: string | null } | null)?.start_label ?? null;
    const courseFinishLabel = (lib as { finish_label?: string | null } | null)?.finish_label ?? null;
    const courseNotes = (lib as { notes?: string | null } | null)?.notes ?? null;

    const race = [...races.aRaces, ...races.upcomingBs, ...races.upcomingCs, ...races.past].find(r => r?.slug === slug);
    if (!race) return null;

    const dist = race.distance_mi ?? (geom?.distance_mi ?? 26.2);
    const gainFt = Math.round(geom?.elevation_gain_ft ?? 0);
    const aGoal = race.goal || '·';
    const bGoal = aGoal !== '·' ? bumpHMS(aGoal, 420) : '·';
    const aGoalSec = parseRaceTime(aGoal) ?? 0;

    const startTime = (meta as { startTime?: string }).startTime || '·';
    const wave = (meta as { wave?: string }).wave || (aGoal !== '·' ? `Seed ${aGoal}` : '·');
    const bib = (meta as { bib?: string }).bib || '#pending';
    const netElevFt = geom?.elevation_gain_ft ? -Math.round(geom.elevation_gain_ft * 0.24) : 0;

    // 2026-05-30: post-race retro fields. Source of truth per CLAUDE.md is
    // races.actual_result (curated chip times beat raw Strava elapsed).
    // loadRacesState already does the resolution + Strava fallback labeling,
    // so race.finishTime is canonical here.
    const isPast = race.days < 0;
    const finishTime = race.finishTime ?? null;
    const pb = Boolean((meta as { pb?: boolean }).pb);

    return {
      slug: race.slug,
      name: race.name,
      date: race.date,
      startTime,
      course: race.location ?? '·',
      certification: race.priority === 'A' ? 'USATF certified' : '·',
      registered: (meta as { registered?: boolean }).registered ?? true,
      bib,
      wave,
      daysAway: race.days,
      isPast,
      finishTime,
      pb,
      distanceMi: dist,
      netElevFt,
      gainFt,
      goalPace: pace(aGoalSec, dist),
      aGoal,
      bGoal,
      pacing: buildPacing(aGoalSec, dist, netElevFt),
      splits: buildSplits(aGoalSec, dist),
      gels: buildGels(aGoalSec, dist),
      preRace:   '3 hrs out · 100g carbs + 24oz electrolyte',
      onCourse:  `${buildGels(aGoalSec, dist).length} × gel · ~70g/hr carbs`,
      hydration: 'Drink mix every 3–4 mi · extra electrolyte if warm',
      notables: notablesFromElevation(geom, dist),
      insight: insightFor(race.name, dist, netElevFt),
      start:   { time: startTime !== '·' ? `${startTime} · ${race.location ?? 'Start'}` : (race.location ?? '·'),
                 detail: startTime !== '·' ? `Be in corral by ${bumpStartByMin(startTime, -20)}` : '·' },
      shuttle: { value: '·', detail: 'Check race-site logistics page' },
      pickup:  { value: '·', detail: 'Reserve ahead via race site' },
      finish:  { value: race.location ?? '·', detail: '·' },
      elevPath: elevPathFromGeometry(geom),
      ...(() => {
        const r = routePathFromGeometry(geom);
        return {
          routePath: r?.path ?? null,
          routeStart: r?.start ?? null,
          routeEnd: r?.end ?? null,
        };
      })(),
      // 2026-05-31: course_library provenance from migration 127.
      // RaceView shows "Crowd-sourced by N runners" when promoted +
      // multi-contributor.
      courseSource,
      contributorCount,
      // 2026-05-31: editorial annotations from course_library (closes
      // coverage row 1185 · "Course editorial annotations"). Null on
      // crowd-sourced + stub courses; populated on the 4 editorial
      // rows (americas-finest-city, big-sur-marathon, cim,
      // sombrero-half).
      courseStartLabel,
      courseFinishLabel,
      courseNotes,
    };
  } catch {
    return null;
  }
}

function bumpStartByMin(t: string, mins: number): string {
  // Parse "7:00 AM" or "07:00" · coerce to minutes-of-day, add mins, format back.
  const m = t.trim().toUpperCase();
  const ampm = m.endsWith('AM') ? 'AM' : m.endsWith('PM') ? 'PM' : null;
  const body = ampm ? m.replace(/AM|PM/, '').trim() : m;
  const parts = body.split(':').map(x => parseInt(x, 10) || 0);
  let hour = parts[0] ?? 7;
  let min = parts[1] ?? 0;
  let total = hour * 60 + min + mins;
  if (total < 0) total = (24 * 60) + total;
  hour = Math.floor(total / 60) % 24;
  min = total % 60;
  if (ampm) {
    const isPM = hour >= 12;
    const h12 = hour % 12 === 0 ? 12 : hour % 12;
    return `${h12}:${String(min).padStart(2, '0')} ${isPM ? 'PM' : 'AM'}`;
  }
  return `${hour}:${String(min).padStart(2, '0')}`;
}
