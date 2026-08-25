/**
 * lib/conservation/surfaces.ts · reading a run the way each screen reads it.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE RULE THIS FILE OBEYS
 *
 * Where the app has a pure seam, this file CALLS IT. Where it does not, this
 * file says so out loud and the shape's finding carries the caveat, rather
 * than a transcription of the surface's logic quietly standing in for it.
 *
 * That distinction is the whole difference between a harness and a second
 * implementation. A harness that re-writes the code under test proves only
 * that the author wrote the same bug twice — and it would have passed on
 * 2026-08-23, because the transcription would have read `data.paceSPerMi`
 * exactly as the surface did.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT IS REAL HERE AND WHAT IS NOT
 *
 *   poster      REAL. `composeV5Today` is pure and exported; this builds its
 *               context and reads the three stats it returns.
 *   recap       REAL. `deriveRecap` is pure and exported.
 *   run detail  PARTIAL. `loadRunDetail` is one ~500-line function that
 *               interleaves five queries with its formatting, and its
 *               formatters are module-private. Reached through the shared
 *               `runFacts` seam it now reads from; the FORMATTING step is
 *               not covered. See `UNCOVERED` below.
 *   log         PARTIAL, for the same reason as run detail.
 *
 * The numbers on all four come from `lib/runs/run-facts.ts`, which is the
 * point: one reader, so a fix lands everywhere at once and a surface cannot
 * quietly grow its own precedence ladder again. Before that seam existed
 * there were three, in three files, disagreeing.
 */
import { composeV5Today, type V5TodayContext } from '@/lib/faff/v5-today';
import { deriveRecap } from '@/lib/coach/run-recap';
import { runFacts } from '@/lib/runs/run-facts';
import type { RunData } from '@/lib/runs/run-shape';
import type { SurfaceReading } from './laws';
import type { RunShape } from './shapes';
import { pickElevationGain } from '@/lib/runs/elevation';
import { watchActiveEnergyKcal } from '@/lib/runs/energy';

/**
 * Hops this harness cannot execute, stated once so no report can imply they
 * were checked. Printed by the test on every run.
 */
export const UNCOVERED: string[] = [
  'The four ingest ROUTES (`/api/watch/workouts/complete`, `/api/ingest/workout`, `/api/run/manual`, `/api/strava/webhook`). Each builds its `runs.data` inline inside an exported `POST` and exports no mapper, so the payload→row hop is entered at the row, not at the wire.',
  '`enhanceCanonicalFromAbsorbed` — the field-copy loop that stamped Strava\'s moving time onto the watch\'s row. Welded to five queries. The merged shape carries the OBSERVED production result instead.',
  '`loadRunDetail` and `loadLogState` formatting. Their `fmtDuration` / `fmtPace` are module-private; the numbers reaching them are covered, the strings leaving them are not.',
  'The iPhone and the Watch. `native-v2` decodes this wire in Swift and re-formats it; nothing here runs Swift.',
  'Anything that needs a database or a device. No hop below touches either.',
];

/** Round-trip a value through JSON, the way every wire boundary does. */
function wire<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE POSTER · `composeV5Today`, for real.
 * ═══════════════════════════════════════════════════════════════════════ */

function posterCtx(shape: RunShape, data: RunData): V5TodayContext {
  // The route prefers the elapsed clock for the poster's Time stat. The
  // preference is the surface's; the guard against an impossible clock is
  // `runFacts`'s.
  const facts = runFacts(data, { basis: 'elapsed' });
  return {
    todayISO: '2026-08-23',
    raceMode: true,
    todayPlan: shape.planned
      ? { type: shape.planned.type, subLabel: null, distanceMi: shape.planned.distanceMi, originalType: null, originalSubLabel: null }
      : null,
    weekLine: 'Week 6 of 16',
    phaseLine: 'Base',
    weekStripDays: [],
    prescription: null,
    weatherKicker: null,
    paceBandStat: null,
    hrCapStat: null,
    effortStat: null,
    why: null,
    whereYouAre: [],
    beforeYouGo: [],
    paceNote: null,
    raceDay: false,
    recentRun: {
      runId: shape.id,
      distanceMi: facts.distanceMi ?? 0,
      durationSec: facts.timeSec,
      paceSPerMi: facts.paceSecPerMi,
      avgHr: (data.avgHr as number | null) ?? null,
      indoor: data.indoor === true || data.source === 'treadmill',
      speedMph: null,
      inclinePct: null,
      askedPaceSPerMi: shape.planned?.paceSPerMi ?? null,
      // ASKED DISTANCE is wired from the shape's own prescription rather than
      // nulled, because it is a number this harness can CONSERVE: the poster's
      // asked-vs-ran table prints it beside the distance actually run, and the
      // `prescribed 5, ran 11` shape exists here precisely so the pair can be
      // checked. A null here would have added the row to the wire and left it
      // untested on every shape that has a plan.
      askedMi: shape.planned?.distanceMi ?? null,
      askedHrCap: null,
      askedHrIsHardCap: false,
      effortAsked: null,
      effortLogged: null,
      verdict: null,
      // The four recap strings. Null / empty is the honest shape for a
      // harness that does not run the recap engine on this path — the poster
      // must not invent prose, and `deriveRecap` is driven directly on its
      // own hop below, where its output IS checked.
      facts: [],
      win: null,
      conditionsNote: null,
      coachTip: null,
      zoneShares: shape.zones ? [shape.zones.z1, shape.zones.z2, shape.zones.z3, shape.zones.z4, shape.zones.z5] : null,
      zoneTarget: null,
      zoneTargets: null,
      elevationSamples: null,
      /* THE CLIMB AND WHETHER IT IS A MEASUREMENT.
       *
       * `elevGainMeasured: true` was hardcoded here, which is a harness
       * telling itself what it is supposed to be checking. Rule one — a
       * modelled number must never look measured — cannot be tested by a
       * fixture that declares every number measured, and `pickElevationGain`
       * is what the route itself asks. Asked here too, so a `gps_derived`
       * shape arrives at the law marked modelled, the way it would on the
       * phone. */
      elevGainFt: absoluteFigures(data).elevGainFt ?? null,
      elevGainMeasured: absoluteFigures(data).elevGainMeasured ?? false,
      // Not conserved by any law here — the harness grades numbers, and a
      // polyline is a picture. Null so the map's refusal branch is what this
      // fixture exercises; the map itself is covered by the Swift sweep.
      hrMax: 158, cadenceAvg: 172, tempF: 61, workoutType: 'easy', hrAvgWork: null, cadenceAvgWork: null, paceWork: null,
    routeSplits: [],
      routePhases: [],
      hrZones: [],
      paceBand: null,
      routePolyline: null,
      weekDoneMi: facts.distanceMi ?? 0,
      weekPlannedMi: null,
      shoeOptions: [{ id: 's1', name: 'Vomero Premium', mi: 62.7 }, { id: 's2', name: 'Vaporfly 3', mi: 88 }],
      shoeWorn: null,
      niggleFlagged: null,
    },
    weekOff: null,
    offSeason: null,
    injury: null,
    sick: null,
    convergence: null,
  } as V5TodayContext;
}

/** Parse a stat the composer printed back into a number, the way an eye does. */
function readMi(text: string | null): number | null {
  if (!text) return null;
  const m = /^([\d.]+)\s*mi$/.exec(text.trim());
  return m ? Number(m[1]) : null;
}
function readClock(text: string | null): number | null {
  if (!text) return null;
  const parts = text.trim().split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}
function readPace(text: string | null): number | null {
  if (!text) return null;
  const m = /^(\d+):(\d{2})\/mi$/.exec(text.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * The poster, as the runner sees it.
 *
 * Deliberately read back OUT of the composer's own formatted strings rather
 * than out of the numbers that went in. The screen is the strings. A pipeline
 * that carries a correct number all the way to a formatter that drops it is
 * still a pipeline that shows the runner the wrong thing.
 */
export function readPoster(shape: RunShape, data: RunData): SurfaceReading {
  const out = wire(composeV5Today(posterCtx(shape, data)));
  const stat = (label: string) => out.panel.stats.find((s) => s.label === label)?.value.text ?? null;
  const d = stat('Distance'), t = stat('Time'), p = stat('Pace');
  return {
    surface: 'poster',
    distanceMi: readMi(d),
    timeSec: readClock(t),
    paceSecPerMi: readPace(p),
    printed: { distance: d, time: t, pace: p },
    // Read back off what the composer RETURNED, not off the context that went
    // in, for the same reason the three stats above are: a pipeline that
    // carries a correct climb to a panel that drops it still shows the runner
    // the wrong thing.
    elevGainFt: out.elevGainFt ?? null,
    elevGainMeasured: out.elevGainMeasured ?? null,
    avgHrBpm: absoluteFigures(data).avgHrBpm ?? null,
    maxHrBpm: absoluteFigures(data).maxHrBpm ?? null,
    cadenceSpm: absoluteFigures(data).cadenceSpm ?? null,
    tempF: absoluteFigures(data).tempF ?? null,
    caloriesKcal: absoluteFigures(data).caloriesKcal ?? null,
    splitDistancesMi: absoluteFigures(data).splitDistancesMi ?? null,
    splitHrs: absoluteFigures(data).splitHrs ?? null,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE RECAP · `deriveRecap`, for real.
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * The recap sentence, and the figures inside it.
 *
 * The recap prints a pace in prose rather than in a stat row — "Easy 11.0 mi
 * at 3:37/mi" — so its reading is scraped back out of the sentence it wrote.
 * That is the only honest way to check it: the sentence IS the surface.
 */
export function readRecap(shape: RunShape, data: RunData): SurfaceReading & { sentence: string } {
  const facts = runFacts(data, { basis: 'elapsed' });
  const payload = deriveRecap({
    type: (shape.planned?.type ?? 'easy') as never,
    phase: null,
    plannedMi: shape.planned?.distanceMi ?? (facts.distanceMi ?? 0),
    plannedPaceSPerMi: shape.planned?.paceSPerMi ?? null,
    actualMi: facts.distanceMi ?? 0,
    actualPaceSPerMi: facts.paceSecPerMi,
    actualDurationSec: facts.timeSec,
    actualAvgHr: (data.avgHr as number | null) ?? null,
    actualMaxHr: (data.maxHr as number | null) ?? null,
  } as never);
  const sentence = [payload.verdict, ...payload.facts].filter(Boolean).join(' ');

  // The pace the sentence actually states, if it states one. `\d:\d\d/mi`
  // matches the recap's own `paceLabel` output.
  const mentioned = /(\d+):(\d{2})\/mi/.exec(sentence);
  const distMatch = /([\d.]+)\s*mi\b/.exec(sentence);
  return {
    surface: 'recap',
    distanceMi: distMatch ? Number(distMatch[1]) : facts.distanceMi,
    timeSec: facts.timeSec,
    paceSecPerMi: mentioned ? Number(mentioned[1]) * 60 + Number(mentioned[2]) : facts.paceSecPerMi,
    printed: { pace: mentioned ? mentioned[0] : null },
    sentence,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * RUN DETAIL AND THE LOG · the numbers, through the seam both now read.
 *
 * Both prefer the MOVING clock, and both did so through their own private
 * COALESCE ladder until `runFacts` replaced them:
 *
 *     log-state.ts     movingTimeS → movingSec → durationSec
 *     run-state.ts     movingTimeS → duration_sec → elapsedTimeS
 *     v5 today route   durationSec → movingTimeS → elapsedTimeS
 *
 * Three orders, three files, and the middle one names a key that exists on
 * zero rows. The same run gave a different Time on the Log than on Today.
 * ═══════════════════════════════════════════════════════════════════════ */

export function readRunDetail(_shape: RunShape, data: RunData): SurfaceReading {
  const facts = runFacts(data, { basis: 'moving' });
  return {
    surface: 'run detail',
    distanceMi: facts.distanceMi,
    timeSec: facts.timeSec,
    paceSecPerMi: facts.paceSecPerMi,
    ...absoluteFigures(data),
  };
}

export function readLog(_shape: RunShape, data: RunData): SurfaceReading {
  const facts = runFacts(data, { basis: 'moving' });
  return {
    surface: 'log',
    distanceMi: facts.distanceMi,
    timeSec: facts.timeSec,
    paceSecPerMi: facts.paceSecPerMi,
    // The log draws no calories column and no temperature. Absence is a
    // layout decision, not a divergence, and `absoluteFiguresAgree` skips a
    // figure a surface does not print rather than treating it as a zero.
    ...(({ caloriesKcal: _c, tempF: _t, ...rest }) => rest)(absoluteFigures(data)),
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE ABSOLUTE FIGURES · one resolution, read by every surface.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THESE ARE NOT TRANSCRIBED PER SURFACE
 *
 * The clock readings above are deliberately taken through each surface's own
 * basis preference, because the surfaces genuinely differ there. These do not
 * differ, and as of 2026-08-24 every one of the four calls the same resolver
 * for them. So the harness calls it once too.
 *
 * That makes `absoluteFiguresAgree` LOOK trivially satisfiable, and it is
 * worth being explicit that this file knows it: the law here proves the
 * SHAPE — that every surface is reading one resolution and that the
 * resolution is internally sound — and it cannot prove the WIRING. Nothing
 * inside a harness can. If run detail quietly grows its own elevation
 * heuristic again, this file will still be calling the shared one and will
 * still report clean.
 *
 * That direction is covered, and has to be, by `_reader_lint.test.ts`, which
 * scans the surfaces themselves for a private ladder. The two checks are a
 * pair: the lint proves the surfaces call the reader, this proves the reader
 * is right. Neither is sufficient alone, and the 2026-08-24 morning — a
 * correct guard with zero call sites and a green suite — is what happens when
 * only the second exists.
 * ═══════════════════════════════════════════════════════════════════════ */

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Elevation, heart rate, cadence, temperature and calories, resolved once. */
export function absoluteFigures(data: RunData): Partial<SurfaceReading> {
  const elev = pickElevationGain([
    { ft: num(data.elevGainFt), source: (data.elevGainSource as string | null) ?? null, ingest: (data.source as string | null) ?? null },
  ]);
  const splits = Array.isArray(data.splits) ? (data.splits as Array<Record<string, unknown>>) : null;
  return {
    avgHrBpm: num(data.avgHr),
    maxHrBpm: num(data.maxHr),
    cadenceSpm: num(data.avgCadence),
    tempF: num(data.tempF),
    elevGainFt: elev?.ft ?? null,
    elevGainMeasured: elev?.measured ?? null,
    // ACTIVE energy, through the shared accessor rather than a local read.
    // Strava's `calories` is a DIFFERENT quantity (total, basal included) and
    // is deliberately not coalesced in — see `energy.total-vs-active` in the
    // derived registry for the 1.21x-1.38x gap that coalescing hid.
    //
    // Only tier 1 is reachable from a harness: tiers 2 and 3 need the
    // database. That is the honest limit of what this file can prove, and it
    // is the tier that matters here — the question a harness can answer is
    // whether two surfaces read the same KEY, not whether the fallback works.
    caloriesKcal: watchActiveEnergyKcal(data),
    splitDistancesMi: splits
      ? splits.map((s) => num(s.distanceMi ?? s.distance_mi) ?? 1)
      : null,
    splitHrs: splits ? splits.map((s) => num(s.hr)) : null,
  };
}

/** Every surface, for one row. */
export function readAllSurfaces(shape: RunShape, data: RunData): SurfaceReading[] {
  return [readPoster(shape, data), readRecap(shape, data), readRunDetail(shape, data), readLog(shape, data)];
}
