/**
 * lib/audit/_swallowed_failure_fixes.test.ts · one regression per fix from the
 * 2026-08-24 swallowed-failure sweep.
 *
 * Every case here FAILS against the code as it shipped and passes after. Where
 * the defect is in SQL text, the assertion is on the SQL text — because that is
 * where the defect was, and because a unit test with a mocked pool proves
 * nothing about a query Postgres refuses to parse. The parse-level truth was
 * established separately, by PREPARE-ing all 1,037 extracted statements against
 * production; these lock the results in so they cannot silently regress.
 *
 * Two shapes recur and are worth naming, because they will recur again:
 *
 *   A · ONE PLACEHOLDER, TWO COLUMN TYPES. `VALUES ($1, $1, …)` into a
 *       `(text, uuid)` pair, or `COALESCE(a::text, b) = $1` where both columns
 *       are uuid. Postgres deduces one type per parameter and then refuses.
 *       Five sites, every one caught into a plausible value.
 *   B · A TEXT DAY KEY MEETING A date. `date_iso` on `plan_workouts` AND on
 *       `day_actions`. `lib/runs/_plan_date_join_lint.test.ts` is the standing
 *       guard; it now knows `BETWEEN` too.
 *
 * date_iso-lint: quotes the broken shape on purpose
 *   — the assertions below name the exact SQL that shipped, so they have to
 *     write it out. That lint's opt-out marker is above; see its comment.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseIntentValue, intentValueField } from '@/lib/coach/intent-value';
import { classifyFallback } from './swallow-scan';

const ROOT = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
/** Comments stripped and whitespace flattened, so a multi-line query is one line. */
const sql = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1 ')
    .replace(/\s+/g, ' ');

/* ══════════════════════════════════════════════════════════════════════════
 * A · one placeholder, two column types
 * ═══════════════════════════════════════════════════════════════════════ */

describe('a parameter may not be asked to be two types at once', () => {
  it('revokeAllSessionsForUser no longer mixes text and uuid in one COALESCE', () => {
    const s = sql('lib/auth/session.ts');
    // As shipped: `COALESCE(user_uuid::text, user_id) = $1`, and both columns
    // are `uuid` → "COALESCE types text and uuid cannot be matched", thrown on
    // every call, caught into `0` by both call sites. Password changes never
    // ended another session and the route reported `other_sessions_ended: 0`.
    expect(s).not.toContain('COALESCE(user_uuid::text, user_id) = $1');
    expect(s).toContain('COALESCE(user_uuid, user_id) = $1::uuid');
  });

  it('set-password reports a null session count rather than a fabricated zero', () => {
    const s = read('app/api/auth/set-password/route.ts');
    expect(s).not.toContain('revokeAllSessionsForUser(auth, {\n    exceptToken: tokenFromRequest(req),\n  }).catch(() => 0)');
    expect(s).toContain('revoked = null');
  });

  it('isDaySealed fails closed when the resolver cannot read', () => {
    // SEALING-IDENTITY-1 (2026-09-04) replaced the raw date-EXISTS SQL this
    // test used to pin ($1 typed both uuid and text on either side of the
    // sum) with delegation to the canonical day-resolver — there is no SQL
    // left in this function to type wrong. The safety property this test
    // protects — a guard that cannot see must seal, not unseal — is
    // preserved by the resolver-failure branch below; the shape changed,
    // the promise did not.
    const s = read('lib/plan/seal.ts');
    expect(s).toContain('resolveDayExecutions(userUuid, dateIso).catch');
    expect(s).toContain('if (day === null) return true;');
  });

  /* DELETED 2026-09-02 · `coach_proposals inserts cast the shared parameter
   * per column`. All four of its assertions named the `illness_adjust` and
   * `injury_adjust` INSERTs in `lib/plan/adapt.ts`, and those INSERTs are
   * gone: illness, injury and a reported niggle no longer influence a training
   * decision, so `detectSickEpisodeActive` / `detectInjuryActive` and their
   * `actionsForTrigger` limbs are deleted. There is no cast left to pin.
   *
   * The parameter-typing FINDING is not lost — the `post_run_rpe` test
   * immediately below is the same shape on live INSERTs, and `isDaySealed`
   * above covers the query half. Only the two dead statements left. */

  it('post_run_rpe inserts cast the shared parameter per column', () => {
    // `post_run_rpe.user_id` is text and `.user_uuid` is uuid.
    for (const f of ['lib/runs/canonical.ts', 'lib/strava/pullSync.ts']) {
      const s = sql(f);
      expect(s, f).not.toContain('INSERT INTO post_run_rpe (user_id, user_uuid, activity_id, rpe, notes, logged_at) VALUES ($1, $1,');
      expect(s, f).toContain('VALUES ($1::text, $1::uuid,');
    }
  });

  it('the coach_intents readers stop casting one side of a uuid pair', () => {
    for (const f of ['lib/plan/adaptive-ramp.ts', 'app/api/race/route.ts', 'app/api/v5/races/route.ts']) {
      expect(sql(f), f).not.toContain('COALESCE(user_uuid::text, user_id) = $1');
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * B · a TEXT day key meeting a date
 * ═══════════════════════════════════════════════════════════════════════ */

describe('day_actions.date_iso is text, like plan_workouts.date_iso', () => {
  it('week-loader casts both sides of its BETWEEN', () => {
    const s = sql('lib/plan/week-loader.ts');
    expect(s).not.toContain("AND date_iso BETWEEN $2::date AND $3::date");
    expect(s).toContain('AND date_iso::date BETWEEN $2::date AND $3::date');
  });

  it('the week result can say the skip state is unknown', () => {
    // `skipped` is a bare boolean on the wire and has to stay one, so the
    // distinction lives beside it rather than inside it.
    expect(read('lib/plan/week-loader.ts')).toContain('skipStateUnknown');
  });

  it('peakWeekMi types its interval parameter', () => {
    const s = sql('lib/coach/runner-calibration.ts');
    // `$3::date - $2` left $2 untyped → "operator does not exist: date >= integer".
    // volume_ceiling_mi was null for every runner; the real value is 39.81 mi
    // for the primary runner as of 2026-08-24.
    expect(s).not.toContain("(data->>'date')::date >= $3::date - $2 GROUP BY");
    expect(s).toContain('$3::date - $2::int');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * C · columns and tables that do not exist
 * ═══════════════════════════════════════════════════════════════════════ */

describe('a reader may not name a column or a table that is not there', () => {
  it('readiness_snapshots is read by snapshot_date, not sample_date', () => {
    for (const f of ['lib/coach/health-state.ts', 'lib/coach/voice-band.ts']) {
      const s = sql(f);
      const bad = /readiness_snapshots[^;]{0,400}?\bsample_date\b/.test(s);
      expect(bad, `${f} still reads readiness_snapshots.sample_date`).toBe(false);
    }
  });

  it('the injury check reads runner_injuries, the table that exists', () => {
    const s = sql('app/api/v5/races/route.ts');
    expect(s).not.toContain('FROM injuries');
    expect(s).toContain('FROM runner_injuries');
  });

  it('dose-guard reads the long-run day off users, not the retired user_settings table', () => {
    const s = sql('lib/plan/dose-guard.ts');
    expect(s).not.toContain('LEFT JOIN user_settings');
    expect(s).toContain('LEFT JOIN users u ON u.id = tp.user_uuid');
  });

  it('the plan simulator joins plan_weeks instead of subtracting a text date', () => {
    const s = sql('lib/plan/simulator.ts');
    expect(s).not.toContain('FLOOR((pw.date_iso - tp.start_date) / 7)');
    expect(s).toContain('JOIN plan_weeks w ON w.id = pw.week_id');
  });

  it('plan/diff selects a column training_plans actually has', () => {
    const s = sql('app/api/plan/diff/route.ts');
    expect(s).not.toContain('p.label');
    expect(s).toContain('p.mode');
  });

  it('a failed read still refuses rather than answering "none"', () => {
    // `personal_goals` and `coach_reads_cache` were named by the code and
    // existed in no database and no migration, so every read failed and every
    // failure rendered as an honest-looking nothing. Migrations 152 and 153
    // (2026-08-24) created them.
    //
    // THESE ASSERTIONS OUTLIVE THAT. The refusal branches are not scaffolding
    // for a missing table — a table existing has never made a read incapable
    // of failing, and the day one of these reads fails again is the day the
    // distinction earns its keep. Deleting them because "the table is there
    // now" would restore the exact bug the migrations were written to end.
    expect(read('app/api/goals/route.ts')).toContain("outage('api/goals'");
    expect(read('app/api/goals/[id]/route.ts')).toContain("outage('api/goals/[id]'");
    expect(read('lib/coach-calendar/store.ts')).toContain('Calendar storage is unavailable');
  });

  it('the three tables the code writes to are declared by a migration', () => {
    // The whole failure class was a statement naming a relation that no file
    // in db/migrations creates. This is the cheap standing guard against a
    // fourth one: the table's own DDL has to exist in the repo.
    const ddl = readdirSync(join(ROOT, 'db/migrations'))
      .filter((f) => f.endsWith('.sql'))
      .map((f) => readFileSync(join(ROOT, 'db/migrations', f), 'utf8'))
      .join('\n');
    for (const t of ['personal_goals', 'coach_reads_cache', 'sick_recovery']) {
      expect(ddl, t).toContain(`CREATE TABLE IF NOT EXISTS ${t}`);
    }
  });

  it('a runner who reports recovery gets their episode cleared even without sick_recovery', () => {
    // Migration 117 declares sick_episodes AND sick_recovery; only the first
    // landed. The trend INSERT ran BEFORE the cleared_at UPDATE, so it took the
    // whole handler down and the runner stayed marked sick with the plan paused.
    // Migration 154 replays 117's statements, so the row lands now — but the
    // ordering guard is what makes the state change unreachable by a failure in
    // the log write, and that is true whatever the schema does next.
    for (const f of ['app/api/sick/recovery/route.ts', 'app/api/notifications/ack/route.ts']) {
      const s = read(f);
      expect(s, f).toContain('INSERT INTO sick_recovery');
      // Wrapped, so the failure cannot reach the state change below it.
      expect(s, f).toMatch(/attempt\(\s*\n?\s*'[^']*',\s*\n?\s*pool\.query\(\s*\n?\s*`INSERT INTO sick_recovery/);
      // And the UPDATE comes after it, never inside the same throw path.
      expect(s.indexOf('INSERT INTO sick_recovery'), f)
        .toBeLessThan(s.indexOf('UPDATE sick_episodes SET cleared_at'));
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * D · coach_intents.value is TEXT, not jsonb
 * ═══════════════════════════════════════════════════════════════════════ */

describe('coach_intents.value is a text column holding JSON', () => {
  it('no reader uses the jsonb operator on it', () => {
    for (const f of ['lib/notifications/session-moved.ts', 'lib/training/goal-projection.ts']) {
      expect(sql(f), f).not.toMatch(/\bci\.value\s*->>/);
    }
  });

  it('parses a JSON row and shrugs at a non-JSON one', () => {
    // 169 of 269 rows in prod are bare sentences from older writers. A blanket
    // `value::jsonb` would trade `text ->> unknown` for `invalid input syntax
    // for type json` on the majority of the table.
    expect(intentValueField('{"why":"Long run missed."}', 'why')).toBe('Long run missed.');
    expect(intentValueField('plan bumped', 'why')).toBeNull();
    expect(intentValueField(null, 'why')).toBeNull();
    expect(intentValueField('{not json', 'why')).toBeNull();
    expect(parseIntentValue('[1,2]')).toBeNull();
    expect(parseIntentValue('{"a":1}')).toEqual({ a: 1 });
    // `->>` would render a non-string; no caller here wants "[object Object]".
    expect(intentValueField('{"why":{"a":1}}', 'why')).toBeNull();
  });

  it('the plan-adapter drift signal excludes one trigger, not the whole signal', () => {
    const s = read('lib/training/goal-projection.ts');
    expect(s).toContain("intentValueField(row.value, 'source_trigger') === 'volume_overshoot'");
    expect(s).toContain('if (rows === null) return null;');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * E · guards must fail CLOSED
 * ═══════════════════════════════════════════════════════════════════════ */

describe('a guard that cannot see assumes the worst', () => {
  it('the de-dupe guards no longer answer "go ahead" on a failed read', () => {
    // `rowCount: 0` means "not already done" — the one answer that turns a
    // de-dupe check into a duplicate-action generator.
    for (const f of ['app/api/cron/plan-drift/route.ts', 'lib/plan/open-block.ts']) {
      const s = read(f);
      expect(s, f).not.toContain('.catch(() => ({ rowCount: 0 }))).rowCount');
      expect(s, f).toContain('return { rowCount: 1 }');
    }
  });

  it('the push de-dup gate suppresses rather than resends', () => {
    expect(read('lib/notifications/dispatch.ts')).toMatch(/logReadFailure\('notifications\/dispatch · recentlySent', e\);\s*\n\s*return true;/);
  });

  it('the race-morning suppressor stays quiet when it cannot check', () => {
    expect(read('app/api/today/skip/route.ts')).toMatch(/logReadFailure\('today\/skip · dayHoldsRace', e\);\s*\n\s*return true;/);
  });

  it('plan generation refuses rather than authoring off fabricated history', () => {
    const s = read('lib/plan/generate.ts');
    // recentPeakLongMi returning 0 made composePlan treat a marathoner as a
    // cold start and re-seed the volume curve from their onboarding form.
    //
    // 2026-08-30 · Rule 8 split this read in two, and the signature moved with
    // it: the LITERAL 28-day max is the spike-guard anchor (doctrine writes its
    // own prior-30-day window into that citation), while the REPRESENTATIVE max
    // — taper and post-race recovery excluded — is the habit floor. The refusal
    // this test exists to protect is now asserted at BOTH points rather than
    // one, which is stricter than the signature it replaces. Pinning the
    // intent, not the old text.
    expect(s).toContain('Promise<RecentLongRead | null>');
    expect(s).toMatch(/representativeMi:\s*number \| null/);
    expect(s).toContain("reason: 'could not read your recent runs · the plan you have stands'");
    // detectMidBlock returning false drops a mid-build runner back to BASE.
    expect(s).toContain('async function detectMidBlock(userId: string): Promise<boolean | null>');
    // Two validator inputs whose null means "skip this check".
    expect(s).toContain("reason: 'could not read your training history · the plan you have stands'");
  });

  it('the streak pill does not read zero on a dropped connection', () => {
    for (const f of ['app/api/streak/route.ts', 'lib/notifications/streak-check.ts']) {
      const s = read(f);
      expect(s, f).toContain('Promise<number | null>');
      expect(s, f).not.toMatch(/} catch \{\s*\n\s*return 0;/);
    }
  });

  it('Today never prints "Week N of 0"', () => {
    const s = read('app/api/v5/today/route.ts');
    expect(s).not.toContain(".catch(() => ({ rows: [{ n: '0' }] }))).rows[0];\n        return w ?");
    expect(s).toContain('if (!total || Number(total.n) <= 0) return null;');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * F · the helper itself
 * ═══════════════════════════════════════════════════════════════════════ */

describe('lib/db/read.ts', () => {
  it('distinguishes the three states a read can be in', async () => {
    const { attempt, rowsOrNull, rowOrNull, isQueryDefect } = await import('@/lib/db/read');

    const ok = await attempt('t', Promise.resolve({ rows: [{ a: 1 }] }));
    expect(ok).toEqual({ ok: true, value: { rows: [{ a: 1 }] } });

    const bad = await attempt('t', Promise.reject(new Error('boom')));
    expect(bad.ok).toBe(false);

    // Empty vs failed — the whole point.
    expect(await rowsOrNull('t', Promise.resolve({ rows: [] }))).toEqual([]);
    expect(await rowsOrNull('t', Promise.reject(new Error('x')))).toBeNull();

    // Three states, because there are three.
    expect(await rowOrNull('t', Promise.resolve({ rows: [{ a: 1 }] }))).toEqual({ a: 1 });
    expect(await rowOrNull('t', Promise.resolve({ rows: [] }))).toBeUndefined();
    expect(await rowOrNull('t', Promise.reject(new Error('x')))).toBeNull();
  });

  it('names the SQLSTATEs that always mean the query is wrong', async () => {
    const { isQueryDefect } = await import('@/lib/db/read');
    // The four that produced this incident, plus their siblings.
    for (const code of ['42883', '42703', '42P01', '42804', '42P08']) {
      expect(isQueryDefect(Object.assign(new Error('x'), { code })), code).toBe(true);
    }
    // A dropped connection is a fact about the network, not a bug in the SQL.
    expect(isQueryDefect(Object.assign(new Error('x'), { code: '57P01' }))).toBe(false);
    expect(isQueryDefect(new Error('x'))).toBe(false);
  });

  it('is the shape the scanner recognises as safe', () => {
    // The helper must not itself trip the gate it exists to satisfy.
    expect(classifyFallback('null')).toBe('emptied');
    expect(read('lib/db/read.ts')).toContain('logReadFailure');
  });
});
