/**
 * lib/race/personal-records.ts · THE personal-records composer.
 *
 * 2026-07-06 · phone+watch audit P1-7 · the iPhone Activity 'Personal
 * records' card was derived purely from training-run averages (client-side
 * over /api/log) and never consulted races.actual_result — exactly the bug
 * class the 2026-05-19 race-data source-of-truth lock was written against
 * (Strava/training data displayed as an authoritative record; see the
 * "Empty Personal Records card" row in the CLAUDE.md bug table).
 *
 * The four checklist answers, concretely:
 *   1. Displays race results?      Yes — distance PRs.
 *   2. races.actual_result first?  Yes — actual_result.finishS is rung 1;
 *      meta.finishTime (the curated retro entry the race editor writes) is
 *      rung 2. Both are runner-curated → authoritative, provisional:false.
 *   3. Training fallback labeled?  Yes — a bucket with no curated race
 *      result falls back to the fastest whole training run near that
 *      distance, ALWAYS provisional:true + source:'training_run' +
 *      the canonical 'Training effort · race to lock in' caption.
 *   4. Skips Strava best-effort segments? Yes — we never read
 *      canonicalLabel; training candidates are whole runs matched on
 *      data.distanceMi with a per-bucket window, so a 5K split inside a
 *      long run can never masquerade as a 5K record.
 *
 * Pure compose (composePersonalRecords) is separated from the DB loader
 * (loadPersonalRecords) so the record ladder is unit-testable without pg.
 */
import { pool } from '@/lib/db/pool';
import { parseRaceTime } from '@/lib/training/vdot';
import { distanceMiFromLabel } from '@/lib/race/distance';
import { PROVISIONAL_FINISH_LABEL } from '@/lib/coach/races-state';
import { CANONICAL_ROW_SQL } from '@/lib/runs/volume';

// ── Buckets ──────────────────────────────────────────────────────────────────

export interface RecordBucket {
  key: '5k' | '10k' | 'half' | 'marathon';
  label: string;
  /** Canonical distance (codebase 3.1/6.2/13.1/26.2 convention). */
  mi: number;
  /** Whole-run distance window for the PROVISIONAL training fallback.
   *  Lower bound = the goal-relative floor lesson (b10dab25: a flat floor
   *  rejected 5K runners' 3.0-mi efforts); upper bound is tight enough
   *  that a run with a warm-up recorded into the file doesn't claim a
   *  shorter distance's record. */
  runMinMi: number;
  runMaxMi: number;
}

export const RECORD_BUCKETS: RecordBucket[] = [
  { key: '5k',       label: '5K',            mi: 3.1,  runMinMi: 3.0,  runMaxMi: 3.5 },
  { key: '10k',      label: '10K',           mi: 6.2,  runMinMi: 6.0,  runMaxMi: 6.8 },
  { key: 'half',     label: 'Half Marathon', mi: 13.1, runMinMi: 12.9, runMaxMi: 14.0 },
  { key: 'marathon', label: 'Marathon',      mi: 26.2, runMinMi: 25.9, runMaxMi: 28.0 },
];

// A race row claims a bucket when its distance is within ±6% of the
// bucket's canonical distance — the same ±5%ish band the projection-
// snapshot queries use, widened a hair for label-derived values.
const RACE_BUCKET_TOLERANCE = 0.06;

// ── Shapes ───────────────────────────────────────────────────────────────────

/** Minimal races projection the composer needs (mirrors the SELECT below).
 *  Type aliases, not interfaces — pg's query<R extends QueryResultRow>
 *  constraint needs the implicit index signature only aliases get. */
export type RaceRecordInput = {
  slug: string;
  meta: Record<string, unknown> | null;
  actual_result: Record<string, unknown> | null;
};

/** Minimal runs projection (data jsonb) the composer needs. */
export type RunRecordInput = {
  id: string;
  data: Record<string, unknown>;
};

export interface PersonalRecordEntry {
  key: RecordBucket['key'];
  label: string;
  timeS: number;
  timeDisplay: string;
  /** min/mi over the record's actual distance, "M:SS". */
  paceDisplay: string | null;
  dateISO: string | null;
  /** Race name (curated) or run name (provisional fallback). */
  name: string | null;
  /** Race slug when the record is race-sourced; null for training runs. */
  slug: string | null;
  /** Actual distance behind the entry (run distance for training bests). */
  distanceMi: number | null;
  /** 'race_result' → races.actual_result.finishS (canonical chip time)
   *  'race_meta'   → races.meta.finishTime (curated retro entry)
   *  'training_run'→ whole training run near the distance (PROVISIONAL) */
  source: 'race_result' | 'race_meta' | 'training_run';
  /** Rule 3: true whenever the entry is NOT a curated race result. */
  provisional: boolean;
  /** Render-ready caption when provisional ('Training effort · race to
   *  lock in'); null on authoritative entries. */
  provisionalLabel: string | null;
}

export interface TrainingBests {
  longestRun: {
    distanceMi: number;
    dateISO: string | null;
    name: string | null;
    source: 'training_run';
  } | null;
  biggestWeek: {
    miles: number;
    weekStartISO: string;
    source: 'training_run';
  } | null;
}

export interface PersonalRecords {
  records: PersonalRecordEntry[];
  training: TrainingBests;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtDuration(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.round(secs % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtPace(sPerMi: number): string | null {
  if (!Number.isFinite(sPerMi) || sPerMi <= 0) return null;
  const m = Math.floor(sPerMi / 60);
  return `${m}:${String(Math.round(sPerMi % 60)).padStart(2, '0')}`;
}

function bucketForRaceMi(mi: number | null): RecordBucket | null {
  if (mi == null || !(mi > 0)) return null;
  for (const b of RECORD_BUCKETS) {
    if (Math.abs(mi - b.mi) <= b.mi * RACE_BUCKET_TOLERANCE) return b;
  }
  return null;
}

// ── Pure composer ────────────────────────────────────────────────────────────

export function composePersonalRecords(
  races: RaceRecordInput[],
  runs: RunRecordInput[],
): PersonalRecords {
  const records: PersonalRecordEntry[] = [];

  for (const bucket of RECORD_BUCKETS) {
    // 1 · Curated race results for this bucket. Per-race ladder:
    //     actual_result.finishS FIRST (canonical chip time), then
    //     meta.finishTime (curated retro entry). Never the Strava match —
    //     races-state's run_match auto-fill is a display convenience, not
    //     a record (Rule 3).
    let best: PersonalRecordEntry | null = null;
    for (const race of races) {
      const m = (race.meta ?? {}) as Record<string, any>;
      const raceMi = m.distanceMi ? Number(m.distanceMi) : distanceMiFromLabel(m.distanceLabel ?? null);
      if (bucketForRaceMi(raceMi)?.key !== bucket.key) continue;

      const ar = (race.actual_result ?? {}) as Record<string, any>;
      let timeS: number | null = null;
      let source: 'race_result' | 'race_meta' | null = null;
      if (ar.finishS != null && Number(ar.finishS) > 0) {
        timeS = Math.round(Number(ar.finishS));
        source = 'race_result';
      } else {
        const parsed = parseRaceTime(typeof m.finishTime === 'string' ? m.finishTime : null);
        if (parsed != null && parsed > 0) { timeS = parsed; source = 'race_meta'; }
      }
      if (timeS == null || source == null) continue;

      if (!best || timeS < best.timeS) {
        best = {
          key: bucket.key,
          label: bucket.label,
          timeS,
          timeDisplay: fmtDuration(timeS),
          paceDisplay: raceMi ? fmtPace(timeS / raceMi) : null,
          dateISO: typeof m.date === 'string' ? m.date : null,
          name: typeof m.name === 'string' ? m.name : race.slug,
          slug: race.slug,
          distanceMi: raceMi ?? bucket.mi,
          source,
          provisional: false,
          provisionalLabel: null,
        };
      }
    }

    // 2 · No curated result → fastest whole training run near the distance,
    //     clearly flagged provisional. Whole-run time (moving-time COALESCE
    //     ladder, same as races-state #2), whole-run distance — never a
    //     best-effort segment (checklist #4).
    if (!best) {
      for (const run of runs) {
        const d = run.data ?? {};
        const mi = Number(d.distanceMi);
        if (!(mi >= bucket.runMinMi && mi <= bucket.runMaxMi)) continue;
        const timeS = Number(d.movingTimeS) || Number(d.movingSec) || Number(d.elapsedTimeS) || 0;
        if (!(timeS > 0)) continue;
        if (!best || timeS / mi < best.timeS / (best.distanceMi ?? bucket.mi)) {
          best = {
            key: bucket.key,
            label: bucket.label,
            timeS: Math.round(timeS),
            timeDisplay: fmtDuration(timeS),
            paceDisplay: fmtPace(timeS / mi),
            dateISO: (typeof d.date === 'string' && d.date)
              ? d.date
              : (typeof d.startLocal === 'string' ? d.startLocal.slice(0, 10) : null),
            name: typeof d.name === 'string' ? d.name : null,
            slug: null,
            distanceMi: Math.round(mi * 100) / 100,
            source: 'training_run',
            provisional: true,
            provisionalLabel: PROVISIONAL_FINISH_LABEL,
          };
        }
      }
    }

    if (best) records.push(best);
  }

  // 3 · Training bests — factual training stats, kept OUTSIDE `records` so
  //     no surface can headline them under a "Personal records" banner
  //     without the training_run source riding along.
  let longest: TrainingBests['longestRun'] = null;
  const weekMi = new Map<string, number>();
  for (const run of runs) {
    const d = run.data ?? {};
    const mi = Number(d.distanceMi);
    if (!(mi > 0)) continue;
    const dateISO = (typeof d.date === 'string' && d.date)
      ? d.date
      : (typeof d.startLocal === 'string' ? d.startLocal.slice(0, 10) : null);
    if (!longest || mi > longest.distanceMi) {
      longest = {
        distanceMi: Math.round(mi * 100) / 100,
        dateISO,
        name: typeof d.name === 'string' ? d.name : null,
        source: 'training_run',
      };
    }
    if (dateISO) {
      // ISO-week bucket (Monday start) purely for the biggest-week stat.
      const t = Date.parse(dateISO + 'T12:00:00Z');
      if (Number.isFinite(t)) {
        const dt = new Date(t);
        const dow = (dt.getUTCDay() + 6) % 7;
        dt.setUTCDate(dt.getUTCDate() - dow);
        const key = dt.toISOString().slice(0, 10);
        weekMi.set(key, (weekMi.get(key) ?? 0) + mi);
      }
    }
  }
  let biggestWeek: TrainingBests['biggestWeek'] = null;
  for (const [weekStartISO, miles] of weekMi) {
    if (!biggestWeek || miles > biggestWeek.miles) {
      biggestWeek = { miles: Math.round(miles * 10) / 10, weekStartISO, source: 'training_run' };
    }
  }

  return { records, training: { longestRun: longest, biggestWeek } };
}

// ── DB loader ────────────────────────────────────────────────────────────────

/**
 * Load + compose the runner's personal records.
 *
 * Races: every row the runner owns (curated results live on any priority).
 * Runs: canonical rows only (CANONICAL_ROW_SQL — merged losers excluded so
 * an HK/Strava dupe can't double as two candidates), ≥ 3.0 mi (nothing
 * shorter can claim a bucket or the longest-run stat meaningfully changes).
 */
export async function loadPersonalRecords(userId: string): Promise<PersonalRecords> {
  const [raceRows, runRows] = await Promise.all([
    pool.query<RaceRecordInput>(
      `SELECT slug, meta, actual_result FROM races WHERE user_uuid = $1`,
      [userId],
    ).then((r) => r.rows).catch(() => [] as RaceRecordInput[]),
    pool.query<RunRecordInput>(
      `SELECT id::text AS id, data FROM runs
        WHERE user_uuid = $1
          AND ${CANONICAL_ROW_SQL}
          AND (data->>'distanceMi')::numeric >= 3.0`,
      [userId],
    ).then((r) => r.rows).catch(() => [] as RunRecordInput[]),
  ]);
  return composePersonalRecords(raceRows, runRows);
}
