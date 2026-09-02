/**
 * RACE SPECS · the finished race specification, from the production path.
 *
 * WHY THIS FILE EXISTS. The first spec preview built race rows by calling
 * `buildWorkoutSpec` with SEVEN of its twelve arguments. Without
 * `prescribedRacePaceSec` the race branch falls back to the stated goal pace,
 * so the 10K, the half and the marathon all read 6:52/mi — an artifact of the
 * harness. A number that came out of an incomplete call has no business in a
 * document the runner reads.
 *
 * SO NOTHING HERE RECONSTRUCTS AN ARGUMENT LIST. Every step below is a call to
 * the same exported production function the authoring transaction calls, in
 * the same order, with the values that transaction assembles:
 *
 *   1. `composeForUser`              — what `generatePlan` stages.
 *   2. `resolveAuthoringRaceSeed`    — what `persistComposedPlan` resolves
 *                                      BEFORE it opens the transaction.
 *   3. `persistedDayShape`           — what `persistPlan` binds into the
 *                                      `plan_workouts` INSERT. It calls
 *                                      `specForComposedDay`, which makes the
 *                                      full TWELVE-argument `buildWorkoutSpec`
 *                                      call. Its own header says it was
 *                                      extracted so an audit would stop
 *                                      reconstructing that call by hand.
 *   4. `refreshRaceRowsForPlan`      — what authoring runs post-persist, inside
 *                                      the same transaction, and what owns
 *                                      race pacing.
 *
 * WHAT IS NOT EXERCISED, STATED RATHER THAN GLOSSED. `persistPlan` itself and
 * `mutatePlan` are not driven, because they cannot be driven without writing:
 * `mutatePlan` with `touches: 'authorship'` COMMITS by design and has no
 * dry-run branch, and the connected role has no INSERT privilege to roll back
 * in the first place. Step 4 is driven through a Queryable that forwards every
 * read to the read-only pool and CAPTURES every write instead of issuing it,
 * so the UPDATE parameters are recorded verbatim and no statement that could
 * modify anything is ever sent.
 *
 * Read-only by role AND by construction. Run:
 *   npx vitest run --config scripts/p0-proof/vitest.harness.config.ts
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { PoolClient } from 'pg';

const U = process.env.PROBE_UUID || '0645f40c-951d-4ccc-b86e-9979cd26c795';
const OUT = process.env.RACE_SPECS_OUT
  || path.resolve(__dirname, '../../../docs/reports/complete-coaching-brain-handback-2026-09-02/rebuild-preview/race-specs-evidence.json');

/** The four races this proof is about, in date order. */
const RACE_DATES = ['2026-09-13', '2026-09-26', '2026-11-08', '2026-12-06'];

// ── the fence, before anything can open a connection ─────────────────────────
// `vitest.setup.ts` loads `.env.local` and never overrides an already-set
// variable, so DATABASE_URL is the PRODUCTION READ-WRITE url by the time this
// module is evaluated. Repoint it at the read-only role here, and use only
// dynamic imports below so nothing has already constructed a pool against the
// value being replaced.
{
  const envPath = path.resolve(__dirname, '../../.env.local');
  const raw = fs.readFileSync(envPath, 'utf8');
  const ro = raw.split('\n')
    .map((l) => l.match(/^\s*DATABASE_URL_RO\s*=\s*(.*)$/))
    .find(Boolean)?.[1]?.trim().replace(/^["']|["']$/g, '');
  if (!ro) throw new Error('DATABASE_URL_RO missing from web-v2/.env.local · refusing to run against a writable url');
  process.env.DATABASE_URL = ro;
}

type QueryLog = { kind: 'read' | 'CAPTURED_WRITE'; text: string; values: unknown[] };

/**
 * A `Queryable` that reads production and cannot write it.
 *
 * Anything that is not a SELECT is recorded with its bound parameters and a
 * zero-row result is returned in its place — the statement is never sent. That
 * is belt; the braces are the role, which holds no UPDATE or INSERT on any
 * table this touches and is asserted before the first call.
 *
 * `serveRaceRows`, when supplied, answers the ONE statement that reads the
 * plan's race rows with the rows a freshly-persisted rebuild would have put
 * there. That is the transaction's own view immediately after `persistPlan`,
 * which is where `refreshRaceRowsForPlan` runs during authoring.
 */
function interceptor(
  pool: { query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null }> },
  log: QueryLog[],
  serveRaceRows?: unknown[] | null,
): Pick<PoolClient, 'query'> {
  const q = async (text: string, values: unknown[] = []) => {
    if (!/^\s*select/i.test(text)) {
      log.push({ kind: 'CAPTURED_WRITE', text: text.trim(), values });
      return { rows: [], rowCount: 0 } as never;
    }
    log.push({ kind: 'read', text: text.trim().slice(0, 120), values });
    if (serveRaceRows && /FROM plan_workouts pw/i.test(text)) {
      return { rows: serveRaceRows, rowCount: serveRaceRows.length } as never;
    }
    return (await pool.query(text, values)) as never;
  };
  return { query: q as never } as Pick<PoolClient, 'query'>;
}

describe('race specifications from the production authoring path', () => {
  it('produces the finished specification for every race in the block', async () => {
    const { pool } = await import('@/lib/db/pool');

    // 1 · THE FENCE, PROVEN. A role that cannot write is the only claim worth
    //     making; a comment saying "read-only" is not one (Rule 20).
    const priv = (await pool.query<{
      cu: string; upd_pw: boolean; ins_pw: boolean; ins_tp: boolean; upd_tp: boolean; upd_races: boolean;
    }>(`SELECT current_user AS cu,
          has_table_privilege(current_user,'plan_workouts','UPDATE')  AS upd_pw,
          has_table_privilege(current_user,'plan_workouts','INSERT')  AS ins_pw,
          has_table_privilege(current_user,'training_plans','INSERT') AS ins_tp,
          has_table_privilege(current_user,'training_plans','UPDATE') AS upd_tp,
          has_table_privilege(current_user,'races','UPDATE')          AS upd_races`)).rows[0];
    expect(priv.upd_pw).toBe(false);
    expect(priv.ins_pw).toBe(false);
    expect(priv.ins_tp).toBe(false);
    expect(priv.upd_tp).toBe(false);
    expect(priv.upd_races).toBe(false);

    const gen = await import('@/lib/plan/generate');
    const rrr = await import('@/lib/race/race-row-refresh');
    const outlookMod = await import('@/lib/race/race-outlook');
    const { runnerToday } = await import('@/lib/runtime/runner-tz');
    const todayISO = await runnerToday(U);

    const livePlan = (await pool.query<{ id: string; race_id: string | null }>(
      `SELECT id, race_id FROM training_plans
        WHERE user_uuid = $1::uuid AND archived_iso IS NULL
        ORDER BY authored_iso DESC LIMIT 1`, [U])).rows[0];

    // 2 · COMPOSE — the same call `generatePlan` stages before it persists.
    const composed = await gen.composeForUser({ userId: U, raceSlug: livePlan.race_id ?? 'cim' });
    if (!composed.ok) throw new Error(`COMPOSE REFUSED · ${composed.reason}`);
    const staged = composed.result;
    const cr = staged.composed as unknown as {
      weeks: Array<{ startISO: string; days: Array<Record<string, unknown>>; tPaceSec?: number | null }>;
      paceAnchors?: { easyCeilingSecPerMi: number } | null;
      authoredState: Record<string, unknown>;
    };
    const compose = staged.compose as unknown as Record<string, unknown>;

    // 3 · THE AUTHORING SEED — `persistComposedPlan`'s own call, verbatim.
    const seed = await rrr.resolveAuthoringRaceSeed(U, livePlan.race_id ?? 'cim', todayISO);

    // 4 · THE ARGUMENTS `persistPlan` IS GIVEN. Assembled from the same
    //     expressions `persistComposedPlan` uses, not from guesses.
    const belowTableAnchor = (compose.belowTableAnchor ?? null) as { anchor: { paceSPerMi: number } } | null;
    const persistArgs = {
      lthr: (compose.lthr ?? null) as number | null,
      maxHr: (compose.maxHr ?? null) as number | null,
      goalPaceSec: ((compose.goalPaceSec ?? null) as number | null)
        ?? (belowTableAnchor ? Math.round(belowTableAnchor.anchor.paceSPerMi) : null),
      easyAnchorTSec: (staged.composed as { paceAnchors?: { easyCeilingSecPerMi: number } | null }).paceAnchors?.easyCeilingSecPerMi ?? null,
      anchors: (staged.composed as { paceAnchors?: unknown }).paceAnchors ?? null,
      prescribedRacePaceSec: seed.ok ? seed.paceSecPerMi : null,
      belowTableAnchor,
    } as Parameters<typeof gen.persistedDayShape>[2];

    // 5 · EVERY COMPOSED DAY BECOMES ITS STORED ROW, through the writer's own
    //     function. Twelve arguments, because `specForComposedDay` builds them.
    const rebuiltRows: Array<Record<string, unknown>> = [];
    for (const w of cr.weeks ?? []) {
      const startMs = Date.parse(w.startISO + 'T12:00:00Z');
      const startDow = new Date(startMs).getUTCDay();
      const weekT = (w.tPaceSec ?? (compose.tPaceSec as number | null)) ?? null;
      for (const d of w.days ?? []) {
        const off = ((Number(d.dow) - startDow) % 7 + 7) % 7;
        const iso = new Date(startMs + off * 86400000).toISOString().slice(0, 10);
        const shape = gen.persistedDayShape(d as never, weekT, persistArgs);
        rebuiltRows.push({
          date_iso: iso, dow: d.dow, type: shape.type, distance_mi: shape.distanceMi,
          pace_target_s_per_mi: shape.paceTargetSPerMi, workout_spec: shape.workoutSpec,
          is_quality: shape.isQuality, is_long: shape.isLong, notes: shape.notes,
          sub_label: shape.subLabel, sealed: shape.sealed,
        });
      }
    }
    rebuiltRows.sort((a, b) => String(a.date_iso).localeCompare(String(b.date_iso)));

    // 6 · THE POST-PERSIST REFRESH, RUN TWICE.
    //     A · against the LIVE plan's rows, untouched — the production path
    //         exactly as the daily cron and authoring run it.
    //     B · against the rebuild's rows, which is the state the transaction
    //         itself would see one statement after the INSERT.
    const logLive: QueryLog[] = [];
    const live = await rrr.refreshRaceRowsForPlan(livePlan.id, {
      client: interceptor(pool as never, logLive),
      todayISO, source: 'authoring',
    });

    const raceRowsForRefresh = rebuiltRows
      .filter((r) => r.type === 'race' || r.type === 'race_week_tuneup')
      .map((r, i) => ({
        id: `rebuild_${String(i).padStart(2, '0')}_${r.date_iso}`,
        date_iso: r.date_iso, type: r.type,
        pace_target_s_per_mi: r.pace_target_s_per_mi,
        distance_mi: r.distance_mi,
        workout_spec: r.workout_spec,
        sealed: false,
      }));
    const logRebuild: QueryLog[] = [];
    const rebuilt = await rrr.refreshRaceRowsForPlan(livePlan.id, {
      client: interceptor(pool as never, logRebuild, raceRowsForRefresh),
      todayISO, source: 'authoring',
    });

    // 7 · THE FINISHED ROW. The refresh's own SQL is
    //     `(COALESCE(workout_spec,'{}') - 'hr_cap_bpm') || $3::jsonb`.
    const capturedFor = (log: QueryLog[], rowId: string): Record<string, unknown> | null => {
      for (const e of log) {
        if (e.kind !== 'CAPTURED_WRITE') continue;
        if (!/UPDATE plan_workouts/i.test(e.text)) continue;
        if (e.values[0] !== rowId) continue;
        return { pace_target_s_per_mi: e.values[1], fields: JSON.parse(String(e.values[2])) };
      }
      return null;
    };
    const merge = (spec: Record<string, unknown> | null, fields: Record<string, unknown> | null) => {
      const base = { ...(spec ?? {}) } as Record<string, unknown>;
      delete base.hr_cap_bpm;
      return { ...base, ...(fields ?? {}) };
    };

    const finished: Record<string, unknown>[] = [];
    for (const r of raceRowsForRefresh) {
      const w = capturedFor(logRebuild, r.id);
      finished.push({
        date_iso: r.date_iso, type: r.type, distance_mi: r.distance_mi,
        authored_pace_target_s_per_mi: r.pace_target_s_per_mi,
        refresh_action: rebuilt?.rows.find((x) => x.id === r.id)?.action ?? 'not-reached',
        refresh_reason: rebuilt?.rows.find((x) => x.id === r.id)?.reason ?? null,
        refreshed_pace_target_s_per_mi: (w?.pace_target_s_per_mi as number | null) ?? r.pace_target_s_per_mi,
        finished_spec: merge(r.workout_spec as Record<string, unknown> | null, (w?.fields ?? null) as Record<string, unknown> | null),
      });
    }

    // 8 · THE OUTLOOK IN FULL, per race, from its canonical owner. Everything
    //     the row's `race_execution` summarises, plus what it does not carry.
    const outlooks: Record<string, unknown> = {};
    const races = (await pool.query<{ slug: string; date: string; priority: string | null }>(
      `SELECT slug, LEFT(meta->>'date',10) AS date, meta->>'priority' AS priority
         FROM races WHERE user_uuid = $1::uuid AND LEFT(meta->>'date',10) = ANY($2::text[])`,
      [U, RACE_DATES])).rows;
    for (const row of races) {
      const race = await outlookMod.loadRaceForOutlook(U, row.slug, todayISO);
      if (!race) { outlooks[row.slug] = { refused: 'NO_RACE' }; continue; }
      outlooks[row.slug] = await outlookMod.resolveRaceOutlook(U, race, todayISO);
    }

    // 9 · THE SURFACE'S OWN RESOLUTION (Rule 13). The pace plan the runner
    //     reads is not on the plan row: `GET /api/race/[slug]/execution-plan`
    //     composes it. Its gate and its inputs are evaluated here exactly as
    //     the handler evaluates them, and its composer is called with the
    //     handler's own argument list. Only Next's request/auth wrapper is
    //     not exercised — it decides nothing about the numbers.
    const { parseRaceTime } = await import('@/lib/training/vdot');
    const { distanceMiFromLabel } = await import('@/lib/race/distance');
    const { composeRaceExecutionPlan } = await import('@/lib/race/execution-plan');
    const { resolveRaceFuel } = await import('@/lib/race/fuel-resolve');
    const { loadEffectiveRaceTarget } = await import('@/lib/race/effective-race-target');
    const { loadEffectiveMaxHr } = await import('@/lib/training/max-hr');

    const executionPlans: Record<string, unknown> = {};
    for (const row of races) {
      const meta = (await pool.query<{ meta: Record<string, unknown> | null }>(
        `SELECT meta FROM races WHERE slug = $1 AND user_uuid = $2 LIMIT 1`, [row.slug, U])).rows[0]?.meta;
      if (!meta) { executionPlans[row.slug] = { route_status: 404, reason: 'race not found' }; continue; }
      const goalSec = parseRaceTime(meta.goalDisplay as string) ?? parseRaceTime(meta.goalTime as string);
      const distanceMi = Number(meta.distanceMi) || distanceMiFromLabel(meta.distanceLabel as string | null) || null;
      if (!goalSec || !distanceMi) {
        executionPlans[row.slug] = {
          route_status: 404,
          reason: 'no goal time set · execution plan needs a goal',
          goal_display: meta.goalDisplay ?? null,
        };
        continue;
      }
      const bGoalSec = parseRaceTime(meta.goalSafeDisplay as string) ?? parseRaceTime(meta.bGoalDisplay as string);
      const startTimeLocal = (meta.startTime as string) ?? null;
      const profileRow = (await pool.query<{ lthr: number | null }>(
        `SELECT lthr FROM profile WHERE user_uuid = $1 LIMIT 1`, [U])).rows[0] ?? null;
      const maxHrEff = await loadEffectiveMaxHr(U).catch(() => null);
      const fuelDefaults = (await pool.query<{ fuel_brand: string | null; fuel_gel_carbs_g: number | null; fuel_target_g_per_hr: number | null }>(
        `SELECT fuel_brand, fuel_gel_carbs_g, fuel_target_g_per_hr FROM users WHERE id = $1 LIMIT 1`, [U])).rows[0] ?? null;
      const { fuel, fuelIsDefault } = resolveRaceFuel(meta, fuelDefaults);
      const effective = await loadEffectiveRaceTarget(U, goalSec, distanceMi, { slug: row.slug });
      const range = effective.outlook?.expectedRaceDay.likelyRangeSec ?? null;
      const ci = range ? { loSec: range[0], hiSec: range[1] } : null;
      const vdot = effective.outlook?.capacity.thresholdVdot ?? null;
      const bGoalEffective = bGoalSec != null && bGoalSec > effective.targetSec ? bGoalSec : null;
      const plan = composeRaceExecutionPlan({
        goalSec: effective.targetSec, distanceMi, bGoalSec: bGoalEffective,
        lthr: profileRow?.lthr ?? null, maxHr: maxHrEff?.bpm ?? null,
        vdot, ci, startTimeLocal, fuel, fuelIsDefault,
      });
      executionPlans[row.slug] = {
        route_status: 200,
        effective_target: { target_sec: effective.targetSec, source: effective.source, goal_sec: effective.goalSec, projection_sec: effective.projectionSec },
        plan,
      };
    }

    // 9b · THE PHONE'S OWN "Pace plan" SECTION. `GET /api/v5/race/[slug]`
    //      builds it from `buildRacePacing` against the OUTLOOK TARGET, and
    //      the course geometry it reads. A different owner from the
    //      execution-plan route above, gated on a different fact — which is
    //      why both are resolved here rather than one standing for the other.
    const { buildRacePacing } = await import('@/lib/race/pacing');
    const pacePlans: Record<string, unknown> = {};
    for (const row of races) {
      const geoRow = (await pool.query<{ course_geometry: unknown }>(
        `SELECT course_geometry FROM races WHERE slug = $1 AND user_uuid = $2`, [row.slug, U])).rows[0] ?? null;
      const libRow = (await pool.query<{ geometry_json: unknown }>(
        `SELECT geometry_json FROM course_library WHERE slug = $1`, [row.slug])).rows[0] ?? null;
      const o = outlooks[row.slug] as { execution?: { targetSec: number | null }; race?: { distanceMi: number } } | undefined;
      const targetSec = o?.execution?.targetSec ?? null;
      const distanceMi = o?.race?.distanceMi ?? 0;
      if (!targetSec || !(distanceMi > 0)) { pacePlans[row.slug] = { pace_plan_rows: [], reason: 'no outlook target' }; continue; }
      try {
        const pacing = buildRacePacing({
          goalSec: targetSec, distanceMi,
          geometry: (libRow?.geometry_json ?? geoRow?.course_geometry ?? null) as never,
        });
        pacePlans[row.slug] = {
          target_sec: targetSec,
          has_geometry: !!(libRow?.geometry_json ?? geoRow?.course_geometry),
          phases: pacing.phases ?? [],
        };
      } catch (e) {
        pacePlans[row.slug] = { error: (e as Error).message };
      }
    }

    // 9c · THE COACH-SET GOAL the race detail actually renders. A SECOND
    //      producer of an A/B/C set: `loadCoachGoalForRace`, not
    //      `outlook.coachSet`. Resolved here so the report states what the
    //      screen draws rather than what the outlook holds.
    const { loadCoachGoalForRace } = await import('@/lib/race/coach-goal-load');
    const coachGoals: Record<string, unknown> = {};
    for (const row of races) {
      const meta = (await pool.query<{ meta: Record<string, unknown> | null; terrain: string | null; goal_framing: string | null; distance_mi: number | null }>(
        `SELECT meta, meta->>'terrain' AS terrain, meta->>'goalFraming' AS goal_framing,
                (meta->>'distanceMi')::float AS distance_mi
           FROM races WHERE slug = $1 AND user_uuid = $2 LIMIT 1`, [row.slug, U])).rows[0];
      const lib = (await pool.query<{ elevation_gain_ft: number | string | null }>(
        `SELECT elevation_gain_ft FROM course_library WHERE slug = $1`, [row.slug])).rows[0] ?? null;
      const statedGoalSec = parseRaceTime(meta?.meta?.goalDisplay as string) ?? null;
      const daysAway = Math.round((Date.parse(row.date + 'T12:00:00Z') - Date.parse(todayISO + 'T12:00:00Z')) / 86400000);
      coachGoals[row.slug] = await loadCoachGoalForRace(U, {
        slug: row.slug, name: (meta?.meta?.name as string) ?? row.slug,
        priority: row.priority ?? null,
        statedGoalSec: statedGoalSec != null && statedGoalSec > 0 ? statedGoalSec : null,
        distanceMi: meta?.distance_mi ?? null,
        metaTerrain: meta?.terrain ?? null,
        elevationGainFt: lib?.elevation_gain_ft != null ? Number(lib.elevation_gain_ft) : null,
        goalFraming: meta?.goal_framing ?? null,
        daysAway,
      }).catch((e) => ({ error: (e as Error).message }));
    }

    // 10 · CONTEXT: the days around each race in the rebuild, and the
    //      composer's own record of the placement decisions it made.
    const context = rebuiltRows.filter((r) => {
      const iso = String(r.date_iso);
      return RACE_DATES.some((d) => Math.abs(Date.parse(iso) - Date.parse(d)) <= 8 * 86400000);
    });
    const weekly = (cr.weeks ?? []).map((w, i) => {
      const mi = (w.days ?? []).reduce((s, d) => s + Number(d.distanceMi ?? 0), 0);
      const long = Math.max(0, ...(w.days ?? []).filter((d) => d.type === 'long').map((d) => Number(d.distanceMi ?? 0)));
      return { idx: i, startISO: w.startISO, mi: Math.round(mi * 10) / 10, long, phase: (w as { phase?: string }).phase ?? null, isRaceWeek: (w as { isRaceWeek?: boolean }).isRaceWeek ?? false };
    });

    const payload = {
      generated_at: new Date().toISOString(),
      todayISO,
      db_role: priv,
      live_plan_id: livePlan.id,
      compose: {
        tPaceSec: compose.tPaceSec, lthr: compose.lthr, maxHr: compose.maxHr,
        goalPaceSec: compose.goalPaceSec, goalSec: compose.goalSec,
        level: compose.level, raceDistanceMi: compose.raceDistanceMi,
        paceAnchors: (staged.composed as { paceAnchors?: unknown }).paceAnchors ?? null,
      },
      authoring_race_seed: seed,
      placement_compromises: cr.authoredState?.placement_compromises ?? null,
      prescribed_race_pace_provenance: cr.authoredState?.prescribed_race_pace ?? null,
      coaching_thesis: cr.authoredState?.coaching_thesis ?? cr.authoredState?.thesis ?? null,
      rebuild_race_rows_as_authored: raceRowsForRefresh,
      refresh_against_live_plan: { result: live, captured_writes: logLive.filter((e) => e.kind === 'CAPTURED_WRITE') },
      refresh_against_rebuild_rows: { result: rebuilt, captured_writes: logRebuild.filter((e) => e.kind === 'CAPTURED_WRITE') },
      finished_race_rows: finished,
      outlooks,
      execution_plans: executionPlans,
      phone_pace_plans: pacePlans,
      coach_goals: coachGoals,
      context_days: context,
      weekly,
      races_meta: (await pool.query(
        `SELECT slug, LEFT(meta->>'date',10) AS date, meta->>'priority' AS priority,
                meta->>'goalDisplay' AS goal_display, meta->>'goalSafeDisplay' AS goal_safe,
                meta->>'plannedRole' AS planned_role, meta->>'distanceMi' AS distance_mi,
                meta->>'name' AS name, meta->>'startTime' AS start_time
           FROM races WHERE user_uuid = $1::uuid AND LEFT(meta->>'date',10) = ANY($2::text[])
          ORDER BY 2`, [U, RACE_DATES])).rows,
    };

    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(payload, null, 2));

    // 10 · THE PROOF THAT NOTHING WAS WRITTEN. Every non-SELECT the production
    //      path attempted is in the log, and every one of them was captured
    //      rather than issued.
    const attempted = [...logLive, ...logRebuild].filter((e) => e.kind === 'CAPTURED_WRITE');
    console.log(`\n[race-specs] role=${priv.cu} · writes attempted by the production path: ${attempted.length} · writes issued: 0`);
    for (const e of attempted) console.log(`  CAPTURED  ${e.text.split('\n')[0].slice(0, 90)}  id=${String(e.values[0]).slice(0, 40)}`);
    console.log(`[race-specs] evidence written to ${OUT}`);

    // LIVENESS (Rule 18 guard 2). A probe whose whole claim is "the production
    // path attempted writes and none were issued" is worthless if the path
    // stopped attempting any. Fail on zero rather than reporting clean.
    expect(attempted.length).toBeGreaterThan(0);
    expect(rebuiltRows.length).toBeGreaterThan(90);

    // RACEPACE-1, ASSERTED WHERE IT IS ACTUALLY WIRED.
    //
    // The refreshed pace cannot see this defect: `refreshRaceRowsForPlan`
    // reprices every race row from the outlook regardless of what authoring
    // wrote, so a seven-argument authoring call still ends at 443. The place
    // the missing argument shows is the AUTHORED row, before the refresh.
    //
    // FALSIFIED 2026-09-02: dropping `prescribedRacePaceSec` from
    // `persistArgs` returns the CIM row to 412 s/mi — the 3:00 goal pace,
    // which is the exact artifact the previous preview reported — and both
    // lines below fail.
    const cimAuthored = raceRowsForRefresh.find((r) => r.date_iso === '2026-12-06');
    expect(seed.ok).toBe(true);
    expect(cimAuthored?.pace_target_s_per_mi).toBe(seed.ok ? seed.paceSecPerMi : null);
    expect(cimAuthored?.pace_target_s_per_mi).not.toBe(persistArgs.goalPaceSec);

    // Four races, four distances. If any two finished race rows come out at
    // the same pace, something upstream is answering with one number again.
    const racePaces = finished.filter((f) => f.type === 'race').map((f) => f.refreshed_pace_target_s_per_mi);
    expect(new Set(racePaces).size).toBeGreaterThan(1);
    expect(finished.filter((f) => f.type === 'race').length).toBe(4);

    // WHAT THIS HARNESS CANNOT FAIL ON (Rule 22). It cannot fail because a
    // number is wrong — it has no answer key, and every value it prints comes
    // from the engine it is auditing. It cannot fail on anything `persistPlan`
    // does between `persistedDayShape` and the INSERT, because that statement
    // is never reached. It cannot fail on a rendering defect: it traces
    // resolvers, not pixels. What it CAN fail on is an incomplete call into
    // the spec builder, a race row priced off the wrong owner, a write leaking
    // out of a read-only probe, and a production path that has gone silent.
  });
});
