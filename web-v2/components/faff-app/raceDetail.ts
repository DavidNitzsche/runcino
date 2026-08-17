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
import { parseRaceTime } from '@/lib/training/vdot';
import { userIdFromCookies } from '@/lib/auth/session';
import type { CourseGeometryInput } from '@/lib/race/pacing';
import { buildRaceRetro } from '@/lib/race/retrospective';
import { loadEffectiveRaceTarget } from '@/lib/race/effective-race-target';
import { composeRaceDetailPacing, certificationFromMeta, registeredFromMeta } from '@/lib/race/race-detail-pacing';

type CourseGeom = {
  trackPoints?: Array<{ lat: number; lon: number; ele: number | null }>;
  distance_mi?: number;
  elevation_gain_ft?: number;
  bbox?: { minLat: number; maxLat: number; minLon: number; maxLon: number };
};

/** Pacing/fueling math lives in lib/race/race-detail-pacing.ts (pure,
 *  tested) — this file resolves the data and hands it over. 2026-08-17:
 *  every pacing-derived field paces off the EFFECTIVE race target
 *  (lib/race/effective-race-target.ts), matching the watch payload and
 *  the execution plan. */

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
  // 2026-08-17 · this section used to print the SAME SENTENCE under all
  // three mile ranges. Two reasons, both fixed here:
  //  1. `delta` came out of the GPX in METRES but was compared against
  //     ±50 as if it were feet, while `gain` in the same expression was
  //     converted (×3.28). A 40 m (130 ft) drop therefore read as "flat".
  //     Everything below is in feet, converted once, at the source.
  //  2. Even when the thirds genuinely are alike, three identical rows is
  //     worse than one honest one — it looks like the app has nothing to
  //     say and is padding. Identical thirds now collapse into a single
  //     row spanning the distance.
  // Each row also carries its own measured net change, so two thirds that
  // share a headline still differ in the detail a runner can act on.
  const M_TO_FT = 3.28084;
  const phase = (deltaFt: number, gainFt: number): { head: string; body: string } => {
    if (deltaFt < -160) return { head: 'Steady descent', body: 'Let gravity do the work, hold form.' };
    if (deltaFt > 160) return { head: 'Climbing block', body: 'Stay relaxed, do not surge.' };
    if (gainFt > 200) return { head: 'Rolling', body: 'The bumps live here.' };
    return { head: 'Flat and fast', body: 'Where the race is won.' };
  };
  const netLabel = (deltaFt: number) => {
    const r = Math.round(deltaFt);
    if (Math.abs(r) < 20) return 'net flat';
    return `${r > 0 ? '+' : '−'}${Math.abs(r)} ft net`;
  };

  const thirds = splitMiles.map(([a, b]) => {
    const iA = Math.floor((a / distMi) * eles.length);
    const iB = Math.min(eles.length - 1, Math.floor((b / distMi) * eles.length));
    const sub = eles.slice(iA, iB + 1);
    const deltaFt = ((sub.at(-1) ?? 0) - (sub[0] ?? 0)) * M_TO_FT;
    let gainM = 0;
    for (let i = 1; i < sub.length; i++) {
      const d = sub[i] - sub[i - 1];
      if (d > 0) gainM += d;
    }
    const gainFt = gainM * M_TO_FT;
    return { a, b, deltaFt, gainFt, ...phase(deltaFt, gainFt) };
  });

  // All three thirds read the same → one row for the whole course.
  const allAlike = thirds.every(t => t.head === thirds[0].head);
  if (allAlike) {
    const totalDelta = thirds.reduce((s, t) => s + t.deltaFt, 0);
    const totalGain = thirds.reduce((s, t) => s + t.gainFt, 0);
    return [{
      mi: labelMile(0, distMi),
      tx: `<b>${thirds[0].head} throughout.</b> ${thirds[0].body} ${netLabel(totalDelta)} over the full distance, ${Math.round(totalGain)} ft of total climbing.`,
    }];
  }

  return thirds.map(t => ({
    mi: labelMile(t.a, t.b),
    tx: `<b>${t.head}.</b> ${t.body} ${netLabel(t.deltaFt)}.`,
  }));
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

/** #40 · start/finish elevation in feet from the trackpoints (first/last ele
 *  with a real value), ×3.28084 m→ft. Mirrors the net-elevation read at
 *  raceDetail.ts:302-309 and seed.ts:2345-2349. null when no usable trackpoint
 *  elevations — the caption then drops the ft line instead of lying "360→20". */
function elevEndpointsFt(geom: CourseGeom | null): { startFt: number | null; finishFt: number | null } {
  const tp = geom?.trackPoints;
  if (!Array.isArray(tp) || tp.length < 2) return { startFt: null, finishFt: null };
  const withEle = tp.filter((p): p is typeof p & { ele: number } => p?.ele != null);
  if (withEle.length < 2) return { startFt: null, finishFt: null };
  return {
    startFt: Math.round(withEle[0].ele * 3.28084),
    finishFt: Math.round(withEle[withEle.length - 1].ele * 3.28084),
  };
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
      // 2026-08-17 · retro: also pull actual_result (per-mile miles[],
      // provisional flag) + plan (course phases with authored labels and
      // target paces) — both feed the post-race retrospective build.
      pool.query(
        `SELECT course_geometry, course_source, meta, actual_result, plan FROM races WHERE slug = $1 AND user_uuid = $2`,
        [slug, userId]
      ).catch(() => ({ rows: [] as Array<{ course_geometry: CourseGeom | null; course_source: string | null; meta: Record<string, unknown> | null; actual_result: Record<string, unknown> | null; plan: Record<string, unknown> | null }> })),
      // course_library row for the same slug — has provenance fields after
      // migration 127. When source='promoted' and contributor_count > 1,
      // RaceView surfaces a "Crowd-sourced by N runners" indicator.
      // 2026-05-31: also pull editorial annotations (start_label,
      // finish_label, notes) so RaceView can render CourseAnnotations
      // when source='editorial'. Closes coverage row 1185.
      // 2026-06-09 · race-killer F3 — also pull geometry_json: the authored
      // phase profile feeds course-aware goal splits (lib/race/pacing.ts).
      pool.query(
        `SELECT source, contributor_count, start_label, finish_label, notes, geometry_json, net_elevation_ft
           FROM course_library WHERE slug = $1`,
        [slug]
      ).catch(() => ({ rows: [] as Array<{ source: string | null; contributor_count: number | null; start_label: string | null; finish_label: string | null; notes: string | null; geometry_json: unknown; net_elevation_ft: number | null }> })),
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
    const aGoalSec = parseRaceTime(aGoal) ?? 0;

    // 2026-08-17 · the ONE race-target resolver (same as the watch payload
    // + execution plan): goal when within 5% of the latest projection
    // snapshot for this distance, else the projection with the goal demoted
    // to stretch. No snapshot → goal fallback.
    const effective = aGoalSec > 0
      ? await loadEffectiveRaceTarget(userId, aGoalSec, dist).catch(() => null)
      : null;

    const startTime = (meta as { startTime?: string }).startTime || '·';
    const wave = (meta as { wave?: string }).wave || (aGoal !== '·' ? `Seed ${aGoal}` : '·');
    const bib = (meta as { bib?: string }).bib || '#pending';
    // Net elevation · curated course_library.net_elevation_ft wins (editorially
    // verified — e.g. Big Sur is +260 ft net UPHILL), else measure from the
    // geometry trackpoints (first vs last ele), mirroring seed.ts:2345-2349.
    // NEVER the old -0.24 * gross heuristic: gross gain is always positive, so
    // it fabricated a net downhill for every course and fed inverted pacing +
    // "bank nothing" coach copy off a guessed profile.
    const curatedNet = (lib as { net_elevation_ft?: number | null } | null)?.net_elevation_ft;
    let netElevFt = 0;
    if (curatedNet != null) {
      netElevFt = Number(curatedNet);
    } else {
      const tp = Array.isArray((geom as { trackPoints?: unknown })?.trackPoints)
        ? (geom as { trackPoints: Array<{ ele?: number }> }).trackPoints
        : null;
      if (tp && tp.length >= 2) {
        const firstEle = Number(tp[0]?.ele ?? 0);
        const lastEle = Number(tp[tp.length - 1]?.ele ?? 0);
        netElevFt = Math.round((lastEle - firstEle) * 3.28084);
      }
    }

    // 2026-05-30: post-race retro fields. Source of truth per CLAUDE.md is
    // races.actual_result (curated chip times beat raw Strava elapsed).
    // loadRacesState already does the resolution + Strava fallback labeling,
    // so race.finishTime is canonical here.
    const isPast = race.days < 0;
    const finishTime = race.finishTime ?? null;
    const pb = Boolean((meta as { pb?: boolean }).pb);
    const elevEnds = elevEndpointsFt(geom);  // #40 · caption start/finish ft

    // Next A race after this one (used by the retro + the WHAT'S NEXT block).
    const nextARow = isPast
      ? races.aRaces.filter(r => r.date > race.date).sort((a, b) => a.date.localeCompare(b.date))[0] ?? null
      : null;

    // 2026-08-17 · post-race retrospective payload · actual_result miles,
    // plan-phase targets vs actuals, VDOT + projection before/after, and
    // the next-A-race read. Additive: null on upcoming races or any failure.
    let retro = null;
    if (isPast) {
      try {
        retro = await buildRaceRetro({
          userId,
          race,
          nextA: nextARow,
          actualResult: (row as { actual_result?: Record<string, unknown> | null } | null)?.actual_result ?? null,
          plan: (row as { plan?: Record<string, unknown> | null } | null)?.plan ?? null,
          libGeometry: (lib as { geometry_json?: unknown } | null)?.geometry_json as CourseGeometryInput | null,
          todayISO: races.today,
        });
      } catch { retro = null; }
    }

    // Every pacing-derived field off the effective target (pure module,
    // tested in lib/race/_race_detail_pacing.test.ts). Also reads back the
    // runner-edited B goal (meta.goalSafeDisplay) instead of goal + 7:00.
    const pf = composeRaceDetailPacing({
      goalDisplay: race.goal ?? null,
      effective,
      goalSafeDisplay: (meta as { goalSafeDisplay?: string }).goalSafeDisplay ?? null,
      distanceMi: dist,
      netElevFt,
      geometry: (lib as { geometry_json?: unknown } | null)?.geometry_json as CourseGeometryInput | null,
    });

    return {
      slug: race.slug,
      name: race.name,
      date: race.date,
      startTime,
      course: race.location ?? '·',
      // 2026-08-17 · honesty: no more hardcoded "USATF certified" on every
      // A race. Render nothing when we don't actually know.
      certification: certificationFromMeta(meta),
      // 2026-06-02 · A/B/C priority is editable on the race detail page.
      // Default to 'A' for legacy rows whose priority was never set —
      // matches POST /api/race's default. Type-narrow because race.priority
      // is a free string upstream.
      priority: ((race.priority === 'B' || race.priority === 'C') ? race.priority : 'A') as 'A' | 'B' | 'C',
      // 2026-08-17 · honesty: no default-true. The chip renders only when
      // the runner actually recorded a registration.
      registered: registeredFromMeta(meta),
      bib,
      wave,
      daysAway: race.days,
      isPast,
      finishTime,
      // 2026-08-17 · provisional-finish provenance straight off the
      // races-state row (primary; retro is the fallback in RaceView) so a
      // provisional finish stays labeled even when buildRaceRetro threw.
      finishProvisional: race.finishProvisional ?? false,
      finishProvisionalLabel: race.finishProvisionalLabel ?? null,
      pb,
      distanceMi: dist,
      netElevFt,
      gainFt,
      goalPace: pf.goalPace,
      aGoal,
      bGoal: pf.bGoal,
      effectiveGoal: pf.effectiveGoal,
      effectiveSource: pf.effectiveSource,
      stretchGoal: pf.stretchGoal,
      pacing: pf.pacing,
      splits: pf.splits,
      gels: pf.gels,
      preRace:   '3 hrs out · 100g carbs + 24oz electrolyte',
      onCourse:  `${pf.gels.length} × gel · ~70g/hr carbs`,
      hydration: 'Drink mix every 3–4 mi · extra electrolyte if warm',
      notables: notablesFromElevation(geom, dist),
      insight: insightFor(race.name, dist, netElevFt),
      start:   { time: startTime !== '·' ? `${startTime} · ${race.location ?? 'Start'}` : (race.location ?? '·'),
                 detail: startTime !== '·' ? `Be in corral by ${bumpStartByMin(startTime, -20)}` : '·' },
      shuttle: { value: '·', detail: 'Check race-site logistics page' },
      pickup:  { value: '·', detail: 'Reserve ahead via race site' },
      finish:  { value: race.location ?? '·', detail: '·' },
      elevPath: elevPathFromGeometry(geom),
      elevStartFt: elevEnds.startFt,
      elevFinishFt: elevEnds.finishFt,
      ...(() => {
        const r = routePathFromGeometry(geom);
        return {
          routePath: r?.path ?? null,
          routeStart: r?.start ?? null,
          routeEnd: r?.end ?? null,
        };
      })(),
      // 2026-06-02: raw lat/lng for the Leaflet RouteMap (terrain tiles).
      // Thinned to ≤500 points so a marathon trackpoint dump doesn't bloat
      // the seed payload; the visual route doesn't need every GPX vertex.
      routeLatLng: (() => {
        const pts = geom?.trackPoints;
        if (!pts || pts.length < 2) return null;
        const stride = Math.max(1, Math.floor(pts.length / 500));
        const out: Array<[number, number]> = [];
        for (let i = 0; i < pts.length; i += stride) out.push([pts[i].lat, pts[i].lon]);
        // ensure the final endpoint is always included so the route closes
        const last = pts[pts.length - 1];
        if (out[out.length - 1]?.[0] !== last.lat || out[out.length - 1]?.[1] !== last.lon) {
          out.push([last.lat, last.lon]);
        }
        return out;
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
      // 2026-08-17 · official race site (races-state meta.officialUrl /
      // meta.website). Replaces the three inert link rows: the site link is
      // now a real <a> when on file, and the dead GPX / weather-history
      // rows are gone.
      website: race.website ?? null,
      // Retrospective fields — persisted to races.meta.
      avgHrBpm: (meta as { avgHrBpm?: unknown }).avgHrBpm != null ? Number((meta as { avgHrBpm?: unknown }).avgHrBpm) : null,
      retroFelt: (meta as { retroFelt?: string }).retroFelt ?? null,
      retroExecution: (meta as { retroExecution?: string }).retroExecution ?? null,
      retroNotes: (meta as { retroNotes?: string }).retroNotes ?? null,
      // Post-race handoff — next A race after this one + B races between.
      ...(() => {
        const nextA = nextARow;
        if (!isPast || !nextA) return { nextARace: null, bridgeRaces: [] };
        const nextARace = { slug: nextA.slug, name: nextA.name, date: nextA.date, distanceMi: nextA.distance_mi ?? null };
        const bRaces = [...races.upcomingBs, ...races.upcomingCs]
          .filter(r => r.date > race.date && r.date < nextA.date)
          .map(r => ({
            name: r.name, date: r.date,
            daysBeforeNextA: Math.round((Date.parse(nextA.date + 'T12:00:00Z') - Date.parse(r.date + 'T12:00:00Z')) / 86_400_000),
          }))
          .sort((a, b) => a.daysBeforeNextA - b.daysBeforeNextA);
        return { nextARace, bridgeRaces: bRaces };
      })(),
      retro,
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
