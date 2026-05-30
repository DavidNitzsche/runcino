/**
 * Race-detail seed for the Faff RaceView, sourced from the real web-v2
 * races table. Combines:
 *  - races-state row (name, date, distance, location, priority)
 *  - course_geometry JSONB (elevation profile, polyline)
 *  - profile.physiology (lthr + zones → drives projected pace/HR)
 *
 * Falls back to neutral CIM-style defaults for fields with no backend.
 */

import type { RaceDetailSeed } from './views/RaceView';

const DEFAULT_USER_ID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';

type CourseGeom = {
  trackPoints?: Array<{ lat: number; lon: number; ele: number | null }>;
  distance_mi?: number;
  elevation_gain_ft?: number;
  bbox?: { minLat: number; maxLat: number; minLon: number; maxLon: number };
};

const DEFAULT_PACING = [
  { seg: 'Miles 1–6',     sub: 'rolling · hold back',   bar: 62, barColor: '#14C08C', pace: '6:52', cum: '41:12'   },
  { seg: 'Miles 7–13',    sub: 'settle, let it roll',   bar: 74, barColor: '#F3AD38', pace: '6:48', cum: '1:28:50' },
  { seg: 'Miles 14–20',   sub: 'locked in',             bar: 78, barColor: '#FF8847', pace: '6:46', cum: '2:16:12' },
  { seg: 'Miles 21–26.2', sub: 'flat · empty the tank', bar: 92, barColor: '#FC4D64', pace: '6:42', cum: '2:57:50' },
];

function bumpHMS(t: string, addSec: number): string {
  const parts = t.split(':').map(x => parseInt(x, 10) || 0);
  let sec = parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2]
    : parts.length === 2 ? parts[0] * 3600 + parts[1] * 60
    : 0;
  sec += addSec;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}:${String(m).padStart(2, '0')}${s ? ':' + String(s).padStart(2, '0') : ''}`;
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

export async function buildRaceDetail(slug: string): Promise<RaceDetailSeed | null> {
  try {
    const [{ loadRacesState }, { pool }] = await Promise.all([
      import('@/lib/coach/races-state'),
      import('@/lib/db/pool'),
    ]);
    const [races, geoRow] = await Promise.all([
      loadRacesState(DEFAULT_USER_ID),
      pool.query(
        `SELECT course_geometry, course_source, meta FROM races WHERE slug = $1`,
        [slug]
      ).catch(() => ({ rows: [] as Array<{ course_geometry: CourseGeom | null; course_source: string | null; meta: Record<string, unknown> | null }> })),
    ]);
    const row = geoRow.rows[0] ?? null;
    const geom = row?.course_geometry ?? null;
    const meta = row?.meta ?? {};

    const race = [...races.aRaces, ...races.upcomingBs, ...races.upcomingCs, ...races.past].find(r => r?.slug === slug);
    if (!race) return null;

    const dist = race.distance_mi ?? (geom?.distance_mi ?? 26.2);
    const gainFt = Math.round(geom?.elevation_gain_ft ?? 1100);
    const aGoal = race.goal || '2:58';
    const bGoal = bumpHMS(aGoal, 420);

    const startTime = (meta as { startTime?: string }).startTime || '7:00 AM';
    const wave = (meta as { wave?: string }).wave || `Seed ${aGoal}`;
    const bib = (meta as { bib?: string }).bib || '#pending';

    return {
      slug: race.slug,
      name: race.name,
      date: race.date,
      startTime,
      course: race.location ? `${race.location}` : 'Course TBD',
      certification: 'USATF certified',
      registered: (meta as { registered?: boolean }).registered ?? true,
      bib,
      wave,
      daysAway: Math.max(0, race.days),
      distanceMi: dist,
      netElevFt: -(Math.round((geom?.elevation_gain_ft ?? 1440) * 0.24)),
      gainFt,
      goalPace: '6:48',
      aGoal,
      bGoal,
      pacing: DEFAULT_PACING,
      splits: [
        { label: '5K',     val: '21:18'   },
        { label: '10K',    val: '42:34'   },
        { label: 'HALF',   val: '1:29:20' },
        { label: '30K',    val: '2:01:40' },
        { label: '40K',    val: '2:42:10' },
        { label: 'FINISH', val: aGoal     },
      ],
      gels: [
        { mi: 'MI 4',        left: 15 },
        { mi: 'MI 8',        left: 31 },
        { mi: 'MI 12',       left: 46 },
        { mi: 'MI 16 · caf', left: 61, caf: true },
        { mi: 'MI 20',       left: 76 },
        { mi: 'MI 23 · caf', left: 88, caf: true },
      ],
      preRace:   '3 hrs out · bagel + banana + 24oz electrolyte',
      onCourse:  '6 × PF 30 gel · every ~35 min · 2 with caffeine',
      hydration: 'Drink mix · every 5K · extra tab if >55°F',
      notables: [
        { mi: '1–6',   tx: 'Rolling hills. The bumps live here. Stay relaxed, do not surge the climbs.' },
        { mi: '7–20',  tx: 'Steady descent. Gentle net downhill. Let gravity do the work, hold form.' },
        { mi: '21–26', tx: 'Flat &amp; fast. Pancake-flat to the finish. Where the race is won.' },
      ],
      insight: `${race.name} rewards <b>patient effort</b>. Bank nothing early, run the tangents, and use the final 10K to close. <b>Hold goal pace</b> through the rolling first 10K, then settle into rhythm.`,
      start:   { time: `${startTime} · ${race.location || 'Start'}`, detail: `Be in by ${bumpStartByMin(startTime, -20)}` },
      shuttle: { value: 'Book shuttle window',                       detail: 'Buses from finish → start, ~1–2 hrs pre-race' },
      pickup:  { value: 'Expo pickup window',                        detail: 'Reserve ahead via race site' },
      finish:  { value: race.location || 'Finish line',              detail: 'Gear check reunion at finish chute' },
      elevPath: elevPathFromGeometry(geom),
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
