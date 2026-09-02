/**
 * lib/runs/_run_shape_lint.test.ts · structural lint for raw `runs.data` access.
 *
 * `runs.data` is an untyped jsonb blob with ~70 keys and no schema. Every key
 * is reachable only by string literal, and nothing checks the literal is real.
 * A typo, a key nothing ever wrote, and a measurement that is legitimately
 * absent are all the same `null` at the call site.
 *
 * Five bugs of exactly this class landed in one file in one afternoon — a read
 * of `data->'faff'` (a path that exists on zero rows), a join on
 * `start_date_local` (the key is `date`), a metres filter on a miles field, a
 * bigint compared to `text[]`, and an assumption that splits have one shape
 * when they have six. Each read as "no data for this runner" rather than as an
 * error. The full account is in the header of `lib/runs/run-shape.ts`.
 *
 * This file scans for the SHAPES that produce that class:
 *
 *   A · RAW KEY ACCESS. `data->>'…'` / `data->'…'` outside the accessor
 *       module. Every one of these is an unchecked string literal.
 *
 *   B · HAND-ROLLED CANONICAL FILTER. `data ? 'mergedIntoId'` written out by
 *       hand instead of using the one shared predicate. There is exactly one
 *       correct answer to "which run is the real one" and it already exists.
 *
 *   C · HAND-ROLLED PLAN-DAY SCOPE. `DISTINCT ON (pw.date_iso)` or a
 *       `plan_workouts`-over-`authored_iso` scope written outside the shared
 *       reader. An unscoped version of this counted 431 quality sessions in 42
 *       days; the obvious fix (scope to the active plan) is also wrong. See
 *       `lib/plan/owned-days.ts`.
 *
 * ── ON THE ALLOWLIST ────────────────────────────────────────────────────────
 *
 * There are ~70 pre-existing call sites. Migrating all of them at once is its
 * own risk, so the allowlists below are large and that is the intended state.
 * An entry costs one line and an honest reason.
 *
 * Both directions are enforced. Adding a file back to the allowlist to silence
 * a new violation is visible in review; REMOVING a file without migrating it
 * fails the staleness check, the same way the doctrine registry's `exempt`
 * map works. The list may shrink. It may not grow quietly.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const WEB = path.resolve(__dirname, '..', '..');
const ROOTS = ['lib', 'app'];

/** Files permitted to speak jsonb directly — the accessor layer itself. */
const SHAPE_MODULES = new Set([
  'lib/runs/run-shape.ts',
  // Defines CANONICAL_ROW_SQL, the shared merge-loser predicate that
  // run-shape re-exports. The definition has to live somewhere.
  'lib/runs/volume.ts',
  // The same idea for the distance quarantine: a tiny SQL-fragment builder
  // that exists precisely so `qualityFlag` is not spelled out at call sites.
  'lib/runs/distance-guard.ts',
  // The shared plan-day scope reader.
  'lib/plan/owned-days.ts',
]);

const rel = (p: string) => path.relative(WEB, p).split(path.sep).join('/');

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === '.next') continue;
        walk(p);
      } else if (
        /\.tsx?$/.test(e.name) &&
        !e.name.startsWith('._') &&
        // Tests are excluded on purpose. Two of them assert on the TEXT of a
        // query (`_adapt_invariants.test.ts` asserts a fragment is ABSENT from
        // adapt.ts; `distance-guard.test.ts` asserts the exact string the
        // builder emits). Linting those would be actively wrong.
        !/\.test\.tsx?$/.test(e.name) &&
        !/\.audit\.test\.tsx?$/.test(e.name)
      ) {
        out.push(p);
      }
    }
  };
  for (const r of ROOTS) walk(path.join(WEB, r));
  return out;
}

/**
 * Blank out comments and keep byte offsets, so line numbers stay honest.
 *
 * This matters more than it looks. A third of the apparent violations in this
 * codebase are inside comments describing a query that was REMOVED — e.g.
 * `app/api/cron/notifications/route.ts` documents a deleted read in an audit
 * note, and its live path delegates to `lib/runs/volume.ts`. A lint that fired
 * on those would spend its credibility on files that are already correct.
 */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  let inS: string | null = null; // ' " `
  while (i < n) {
    const c = src[i];
    const c2 = src.slice(i, i + 2);
    if (inS) {
      if (c === '\\') { out += src.slice(i, i + 2); i += 2; continue; }
      if (c === inS) inS = null;
      out += c; i++; continue;
    }
    if (c === "'" || c === '"' || c === '`') { inS = c; out += c; i++; continue; }
    if (c2 === '//') {
      while (i < n && src[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (c2 === '/*') {
      while (i < n && src.slice(i, i + 2) !== '*/') { out += src[i] === '\n' ? '\n' : ' '; i++; }
      out += '  '; i += 2;
      continue;
    }
    out += c; i++;
  }
  return out;
}

/** `data->'x'`, `data->>'x'`, `r.data->>'x'` — but never `metadata->>'x'`. */
const RAW_KEY = /(?<![A-Za-z0-9_])data\s*->>?\s*'([^']*)'/g;
/** The hand-rolled merge-loser predicate. */
const RAW_MERGED = /(?<![A-Za-z0-9_])data\s*\?\s*'mergedIntoId'/g;

interface Hit { file: string; line: number; text: string; key: string }

function scan(re: RegExp): Hit[] {
  const hits: Hit[] = [];
  for (const file of sourceFiles()) {
    const f = rel(file);
    if (SHAPE_MODULES.has(f)) continue;
    const src = stripComments(fs.readFileSync(file, 'utf8'));
    src.split('\n').forEach((line, i) => {
      for (const m of line.matchAll(re)) {
        hits.push({ file: f, line: i + 1, text: m[0].trim(), key: m[1] ?? '' });
      }
    });
  }
  return hits;
}

describe('RUN-SHAPE LINT · raw runs.data access', () => {
  /* ═════════════════════════════════════════════════════════════════════
   * A · raw `data->>'…'` key access
   *
   * key = file path → why it still reads raw. Every entry is a file that
   * predates `lib/runs/run-shape.ts`. The reason records what is actually in
   * it, so a future migration can be scoped rather than guessed at.
   * ═══════════════════════════════════════════════════════════════════ */
  const RAW_ACCESS_ALLOWED: Record<string, string> = {
    /* ── test substrate · builds rows rather than reading them ────────── */
    'lib/adaptation-harness/substrate.ts':
      'NOT A READER. It copies the runner\'s rows into a local scratch database and ' +
      'slides them forward by whole weeks so a real block lands on today — so it ' +
      'MANIPULATES the jsonb rather than interpreting it, and the accessors exist to ' +
      'answer "what does this run say", a question it never asks. It also has to name ' +
      'both `date` and `startLocal` explicitly and write them back, which is the one ' +
      'thing an accessor that resolves between them cannot express. Fenced to a ' +
      'loopback scratch DB named faff_adapt_harness and excluded from the default ' +
      'vitest glob, so a wrong key here cannot reach production data — it breaks the ' +
      'harness loudly on the next run instead. Migrate the read-shaped queries (the ' +
      'distanceMi/movingTimeS trio around :456-479) if the accessors ever grow a ' +
      'write-side form.',

    /* ── plan engine · held by another agent, or high blast radius ────── */
    'lib/plan/generate.ts':
      'HELD BY ANOTHER AGENT this session · not to be touched. Reads distanceMi, date, ' +
      'startLocal, type, workoutType, avgHr. Migrate once the hold lifts.',
    'lib/plan/adapt.ts':
      'The plan adapter · 3000+ lines and the single highest blast radius in the app. ' +
      'Reads the day/distance trio, plus (2026-08-30, QUALITY-EVIDENCE-1) workoutType and ' +
      'type in the completion gate — those two are handed straight to `runStimulusType`, ' +
      'the canonical resolver, rather than compared to a literal here, which is the thing ' +
      'the vocabulary split forbids. Worth migrating, but not in the same change as the ' +
      'module that would migrate it.',
    'lib/plan/drift-monitor.ts':
      'Widest key surface in the codebase (18 keys, most of them weather). Several of its ' +
      'literals — tempF_peak, dewpointF, startLat, start_latitude — do NOT appear on any ' +
      'row in the live census, so migrating it means deciding what each was meant to read. ' +
      'That is a correctness review, not a mechanical substitution.',
    'lib/plan/adaptive-ramp.ts':
      'Reads plan-side columns alongside run keys (hr_on_pace_delta_bpm, ' +
      'pace_target_s_per_mi are plan_workouts columns, not jsonb). Mixed query · migrate ' +
      'the run half only, carefully.',
    'lib/plan/recompute-paces.ts': 'Day expression only · straightforward, next batch.',
    'lib/plan/seal.ts': 'Day expression only · straightforward, next batch.',
    'lib/plan/seed-from-onboarding.ts': 'Day + distance · straightforward, next batch.',

    /* ── coach surfaces · read-heavy, display-path ────────────────────── */
    'lib/coach/health-state.ts':
      'Interpolates a key NAME into the query (`${m.key}`) from a metric table, so its ' +
      'access is not statically analysable and cannot be mechanically migrated.',
    'lib/coach/heat-acclimatization.ts':
      'Reads avgPaceSPerMi, which appears on zero rows in the live census (the real key ' +
      'is paceSPerMi). Migrating requires confirming whether that read has ever worked.',
    'lib/coach/pacing-discipline.ts': 'Same avgPaceSPerMi question as heat-acclimatization.',
    'lib/coach/recovery-phase.ts': 'Moving-seconds ladder + dynamics keys · next batch.',
    'lib/coach/recovery-brief.ts': 'Moving-seconds ladder over a CTE alias · next batch.',
    'lib/coach/training-state.ts': 'Moving-seconds ladder + splits · next batch.',
    'lib/coach/state-loader.ts': 'Day/distance/cadence · next batch.',
    'lib/coach/run-state.ts': 'Twelve keys across several queries · next batch.',
    'lib/coach/log-state.ts': 'Day/distance/name/source/workoutType · next batch.',
    'lib/coach/glance-state.ts': 'Day/weather/duration/cadence · next batch.',
    'lib/coach/cycle-performance.ts': 'Reads avgPaceMinPerMi (a display string) · next batch.',
    'lib/coach/quality-predictors.ts': 'Reads avgPaceMinPerMi (a display string) · next batch.',
    'lib/coach/training-form.ts': 'Day/distance/avgHr · next batch.',
    'lib/coach/readiness-brief.ts': 'Type/distance/day · next batch.',
    'lib/coach/races-state.ts': 'Distance/day · next batch.',
    'lib/coach/profile-state.ts': 'Day/source · next batch.',
    'lib/coach/runner-calibration.ts': 'Day/distance · next batch.',
    'lib/coach/easy-discipline.ts': 'Type/day · next batch.',
    'lib/coach/voice-band.ts': 'workoutType/distance/day · next batch.',
    'lib/coach/coach-log.ts': 'Distance/day · next batch.',
    'lib/coach/acknowledge.ts': 'Reads data->>\'id\' (the PROVIDER id) · next batch.',
    'lib/coach/calibration.ts': 'Reads data->>\'id\' (the PROVIDER id) · next batch.',

    /* ── ingest / sync · write-side, different risk profile ───────────── */
    // lib/strava/pullSync.ts · CLEARED 2026-08-21 (ingest audit). The entry
    // read: "reads distance_mi and startDate, neither of which is a key on any
    // row — almost certainly reading the INBOUND Strava payload. Needs reading
    // before it is touched." It was read. The raw access was findCanonicalRow's
    // match query, and `date` sat first in its COALESCE, so `::timestamptz`
    // resolved to MIDNIGHT and the ±10-min window could only ever match a run
    // that started at midnight. The matcher now asks lib/runs/identity.ts
    // isSameRun and reads its candidate day through runDaySql().
    'lib/strava/push.ts': 'Push path · id/activityId/day/mergedIntoId · next batch.',
    'lib/runs/post-write-hooks.ts': 'Elevation backfill · id/elevGainFt/routePolyline.',
    'lib/weather/openmeteo.ts':
      'Reads four different lat/lng spellings (startLatLng, startLat, start_lat, ' +
      'routeStartLat); only startLatLng exists in the census. Same "what was this meant ' +
      'to read" question as drift-monitor.',

    /* ── training / race readers ──────────────────────────────────────── */
    'lib/training/goal-projection.ts':
      'The projection engine · day/distance/duration/weather/splits across several large ' +
      'queries. High value to migrate, large enough to deserve its own change.',
    'lib/training/max-hr.ts': 'maxHr/date · next batch.',
    'lib/race/auto-result.ts': 'Distance/day · next batch.',
    'lib/race/retrospective.ts': 'Distance/day · next batch.',
    'lib/race/personal-records.ts': 'Distance only · next batch.',
    'lib/race/representativeness-inputs.ts': 'Day/distance · next batch.',
    'lib/shoe/auto-assign.ts': 'Day/gear · next batch.',
    'lib/notifications/streak-check.ts': 'Day only · next batch.',

    /* ── app routes ───────────────────────────────────────────────────── */
    'app/api/admin/audit-weather/route.ts': 'Admin diagnostic · day only.',
    'app/api/admin/backfill-splits/route.ts': 'Admin backfill · splits write path.',
    'app/api/admin/re-enrich-weather/route.ts': 'Admin backfill · day only.',
    'app/api/admin/tester-watch/route.ts': 'Admin diagnostic · day/distance/maxHr.',
    'app/api/cron/dedupe-runs/route.ts': 'Dedup cron · day only.',
    'app/api/ingest/workout/route.ts': 'Ingest write path · client_workout_id/qualityFlag.',
    // 2026-08-19 · relocated from app/api/plan/week/route.ts to
    // lib/plan/week-loader.ts (the v5 Today composer's week-strip loader
    // now shares this function instead of duplicating it) — same raw
    // access, same reason, new address. The `day` fragment now goes
    // through runDaySql(); only the provider `id` key remains raw here.
    'lib/plan/week-loader.ts': 'Id (provider id) · next batch.',
    'app/api/prescription/route.ts':
      'Reads startLat and startLng, which are not keys on any row (the real one is ' +
      'startLatLng). Same open question as openmeteo.',
    /* `app/api/runs/[id]/recap/route.ts` WAS HERE and is now clean (2026-09-02).
     * Its "id/activityId lookup" was the whole of its raw access, and it now
     * calls `runIdentityMatchSql` — which exists because four call sites were
     * each matching a different subset of the three id spellings, and two of
     * them disagreed in production. A stale exemption fails until deleted, so
     * this is the deletion rather than a comment beside a live entry. */
    'app/api/runs/[id]/route.ts':
      'Run detail PATCH · the shoe-assign fallbacks read day and distance directly. '
      + 'Its id/activityId lookups now go through `runIdentityMatchSql`; the day and '
      + 'distance reads in the two synthetic-id fallbacks are the remainder.',
    'app/api/strava/push-recent/route.ts': 'Push path · source/day.',
    'app/api/strava/webhook/route.ts': 'Webhook · day only.',
    'app/api/streak/route.ts': 'Day only · next batch.',
    'app/api/today/purpose/route.ts': 'Type/distance/day · next batch.',
    'app/api/today/shoe/route.ts': 'Day only · next batch.',
    'app/api/watch/workouts/complete/route.ts': 'Watch completion write path.',
    'app/dev/route-map-mockups/route.ts': 'Dev-only mockup route · not a product surface.',
  };

  it('no raw `data->>\'key\'` access outside the accessor module', () => {
    const bad = scan(RAW_KEY).filter((h) => !(h.file in RAW_ACCESS_ALLOWED));
    expect(
      bad.map((h) => `${h.file}:${h.line}  ${h.text}`),
      'Raw jsonb key access. Nothing checks these literals name a real key, which is how\n' +
        "`data->'faff'` (a path on zero rows) read as null for every runner instead of as an\n" +
        'error. Use the fragments and accessors in lib/runs/run-shape.ts, or add the file to\n' +
        'RAW_ACCESS_ALLOWED with an honest reason.\n  ',
    ).toEqual([]);
  });

  it('every raw-access allowlist entry is still needed · stale entries must be deleted', () => {
    const live = new Set(scan(RAW_KEY).map((h) => h.file));
    const stale = Object.keys(RAW_ACCESS_ALLOWED).filter((f) => !live.has(f));
    expect(
      stale,
      'These files no longer read raw jsonb — delete their RAW_ACCESS_ALLOWED entries so the\n' +
        'list keeps shrinking. An allowlist nobody prunes is a list nobody reads.\n  ' +
        stale.join('\n  '),
    ).toEqual([]);
  });

  /* ═════════════════════════════════════════════════════════════════════
   * B · hand-rolled canonical-run filtering
   * ═══════════════════════════════════════════════════════════════════ */
  const MERGED_FILTER_ALLOWED: Record<string, string> = {
    /* ── files that legitimately speak about the marker itself ─────────── */
    'lib/runs/flag-census.ts':
      'A diagnostic census OVER flag prevalence · reporting on the marker is its whole job.',

    /* ── plan engine ───────────────────────────────────────────────────── */
    'lib/plan/generate.ts': 'HELD BY ANOTHER AGENT this session · see RAW_ACCESS_ALLOWED.',
    'lib/plan/adapt.ts': 'Highest blast radius in the app · see RAW_ACCESS_ALLOWED.',
    'lib/plan/drift-monitor.ts': 'Needs a correctness review, not a substitution · see RAW_ACCESS_ALLOWED.',
    /* 2026-08-30 · `lib/plan/adaptive-ramp.ts` removed. Its two `runs` queries
     * were the dead ones — the quality read is now `loadKeySessionExecutions`
     * and the long read uses `runNotMergedSql` / `runDistanceMiSql` /
     * `runDaySql`. Nothing there hand-rolls the canonical filter any more. */
    'lib/plan/recompute-paces.ts': 'Next batch.',
    'lib/plan/seal.ts': 'Next batch.',
    'lib/plan/seed-from-onboarding.ts': 'Next batch.',

    /* ── coach surfaces ────────────────────────────────────────────────── */
    'lib/coach/state-loader.ts': 'Five occurrences across several queries · next batch.',
    'lib/coach/health-state.ts': 'Interpolates a key name · not statically analysable. See RAW_ACCESS_ALLOWED.',
    'lib/coach/coach-log.ts': 'Next batch.',
    'lib/coach/glance-state.ts': 'Next batch.',
    'lib/coach/recovery-phase.ts': 'Next batch.',
    'lib/coach/recovery-brief.ts': 'Next batch.',
    'lib/coach/readiness-brief.ts': 'Next batch.',
    'lib/coach/races-state.ts': 'Next batch.',
    'lib/coach/quality-predictors.ts': 'Next batch.',
    'lib/coach/profile-state.ts': 'Next batch.',
    'lib/coach/easy-discipline.ts': 'Next batch.',
    'lib/coach/cycle-performance.ts': 'Next batch.',
    'lib/coach/calibration.ts': 'Next batch.',
    'lib/coach/training-form.ts': 'Next batch.',
    'lib/coach/runner-calibration.ts': 'Next batch.',

    /* ── training / race / misc readers ────────────────────────────────── */
    'lib/training/goal-projection.ts': 'Six occurrences across large queries · deserves its own change.',
    'lib/training/max-hr.ts': 'Next batch.',
    'lib/race/auto-result.ts': 'Next batch.',
    'lib/race/retrospective.ts': 'Next batch.',
    'lib/race/representativeness-inputs.ts': 'Next batch.',
    'lib/weather/openmeteo.ts': 'Reads lat/lng spellings that do not exist · see RAW_ACCESS_ALLOWED.',

    /* ── app routes ────────────────────────────────────────────────────── */
    'app/api/admin/re-enrich-weather/route.ts': 'Admin backfill · next batch.',
    'app/api/admin/tester-watch/route.ts': 'Admin diagnostic · next batch.',
    'app/api/prescription/route.ts': 'Reads startLat/startLng, which do not exist · see RAW_ACCESS_ALLOWED.',
    'app/api/strava/push-recent/route.ts': 'Next batch.',
    'app/api/today/purpose/route.ts': 'Next batch.',
    'app/api/today/shoe/route.ts': 'Next batch.',
    'app/dev/route-map-mockups/route.ts': 'Dev-only mockup route · not a product surface.',
  };

  it('no hand-rolled `data ? \'mergedIntoId\'` canonical filter', () => {
    const bad = scan(RAW_MERGED).filter((h) => !(h.file in MERGED_FILTER_ALLOWED));
    expect(
      bad.map((h) => `${h.file}:${h.line}  ${h.text}`),
      'Hand-rolled merge-loser filtering. There is one correct answer to "which run is the\n' +
        'real one": getCanonicalRunIds (identity-clustered, catches UNMARKED duplicates) or,\n' +
        'where only the marked losers matter, CANONICAL_ROW_SQL / runNotMergedSql.\n  ',
    ).toEqual([]);
  });

  it('every merged-filter allowlist entry is still needed', () => {
    const live = new Set(scan(RAW_MERGED).map((h) => h.file));
    const stale = Object.keys(MERGED_FILTER_ALLOWED).filter((f) => !live.has(f));
    expect(
      stale,
      'These files no longer hand-roll the canonical filter — delete their entries.\n  ' +
        stale.join('\n  '),
    ).toEqual([]);
  });

  /* ═════════════════════════════════════════════════════════════════════
   * C · hand-rolled plan-day scope
   * ═══════════════════════════════════════════════════════════════════ */
  it('no hand-rolled `DISTINCT ON (pw.date_iso)` plan-day scope', () => {
    const hits: string[] = [];
    for (const file of sourceFiles()) {
      const f = rel(file);
      if (f === 'lib/plan/owned-days.ts') continue;
      const src = stripComments(fs.readFileSync(file, 'utf8'));
      src.split('\n').forEach((line, i) => {
        if (/DISTINCT\s+ON\s*\(\s*pw\.date_iso\s*\)/i.test(line)) {
          hits.push(`${f}:${i + 1}  ${line.trim()}`);
        }
      });
    }
    expect(
      hits,
      '"Which plan owned this day?" has one correct answer and two tempting wrong ones.\n' +
        'Unscoped reads every rebuild at once (431 quality sessions in 42 days); scoping to\n' +
        'the ACTIVE plan loses the whole executed block the morning after a goal race. Use\n' +
        'ownedDaysSql / loadOwnedDays from lib/plan/owned-days.ts.\n  ' +
        hits.join('\n  '),
    ).toEqual([]);
  });

  /* ═════════════════════════════════════════════════════════════════════
   * D · the scanner itself must work
   *
   * Every lint above passes trivially if the scanner finds nothing. These
   * assert it is actually looking at the tree.
   * ═══════════════════════════════════════════════════════════════════ */
  it('the scanner sees the codebase', () => {
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(200);
    expect(scan(RAW_KEY).length).toBeGreaterThan(50);
    expect(scan(RAW_MERGED).length).toBeGreaterThan(10);
  });

  it('comment stripping keeps line numbers and spares string literals', () => {
    const src = [
      "const a = 1; // data->>'inComment'",
      "/* data->>'inBlock' */",
      "const q = `select data->>'real' from runs`;",
    ].join('\n');
    const out = stripComments(src);
    expect(out.split('\n')).toHaveLength(3);
    expect(out).not.toContain('inComment');
    expect(out).not.toContain('inBlock');
    expect(out).toContain("data->>'real'");
  });

  it('the key pattern does not fire on `metadata->>`', () => {
    const hit = [...`select metadata->>'x' from t`.matchAll(RAW_KEY)];
    expect(hit).toEqual([]);
  });
});
