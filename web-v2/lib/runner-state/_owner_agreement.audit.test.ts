/**
 * lib/runner-state/_owner_agreement.audit.test.ts · THE CENSUS.
 *
 * `_owner_agreement.test.ts` answers "do the sites that answer one question
 * agree, on six synthetic runners, with no database". This file answers "and
 * what does each of them say TODAY, on the only real account this app has" —
 * which is the only form in which a divergence is a number rather than an
 * argument (Rule 13), and the only way the six `probe: 'DB_ONLY'` sites can be
 * measured at all.
 *
 * It is an `.audit.` file on purpose, the convention
 * `_threshold_owner_census.audit.test.ts` set: it needs `DATABASE_URL_RO`, it
 * skips without one, and CI never depends on a database. READ-ONLY is
 * ENFORCED rather than assumed — `DATABASE_URL` is overridden onto the
 * read-only role BEFORE `lib/db/pool`'s module-level `new Pool(...)` runs,
 * which is why every app import below is DYNAMIC. A static top-level import
 * would be hoisted ahead of the override.
 *
 * ── RULE 22 · WHAT THIS FILE CANNOT FAIL ON ────────────────────────────────
 *
 *   · IT CANNOT FAIL ON A DIVERGENCE. It is a RENDER, not a gate. Two owners
 *     eighteen days apart PRINT here and the file still passes, because a
 *     census that refused to report would report nothing. The gate that fails
 *     on a divergence is `_owner_agreement.test.ts`, and it runs in CI.
 *   · IT MEASURES ONE ACCOUNT. Every number below is the owner's. A second
 *     site that agrees with the canonical on this runner and diverges on a
 *     cold-start runner reads clean here — which is exactly why the synthetic
 *     matrix exists beside it rather than instead of it.
 *   · IT CANNOT CALL A CLOSURE. `densityForWeek` lives inside `composePlan`
 *     and `derivedTrainingDaysPerWeek` is module-private; neither can be
 *     invoked without driving the whole compose path against a live account.
 *     What is printed for those is RECONSTRUCTED from the same inputs, or
 *     read back off what the engine persisted, and every such row says so.
 *     A reconstruction is a claim, not a measurement.
 *   · IT CANNOT TELL WHETHER THE AGREED NUMBER IS RIGHT. Every site could
 *     agree on a wrong answer and this prints a clean table.
 *
 * Run with:
 *   npx vitest run lib/runner-state/_owner_agreement.audit.test.ts
 */
import { describe, it, expect } from 'vitest';

const RO = process.env.DATABASE_URL_RO;
const OWNER = '0645f40c-951d-4ccc-b86e-9979cd26c795';

/** Fixed so a re-run a week later is comparable. A stale anchor only narrows
 *  the lookback window; it never invalidates the read. */
const TODAY = '2026-09-05';

interface Row {
  quantity: string;
  siteId: string;
  value: number | null;
  unit: string;
  note: string;
}

const rows: Row[] = [];
const push = (r: Row): void => { rows.push(r); };

describe.skipIf(!RO)('OWNER AGREEMENT CENSUS · every live site, on the real account', () => {
  it('measures what each site says today', async () => {
    process.env.DATABASE_URL = RO;

    const { pool } = await import('@/lib/db/pool');

    // Rule 14 applied to the census itself: prove the population before
    // reading it. A census run as the read-write role would be a different
    // kind of file.
    const who = await pool.query<{ u: string }>('SELECT current_user AS u');
    expect(who.rows[0].u, 'the census must run read-only').toContain('readonly');

    /* ════ WEEKLY_VOLUME ═══════════════════════════════════════════════ */

    const nw = await import('@/lib/training/normal-window');
    const sustained = await nw.sustainedWeeklyMileage(OWNER, TODAY);
    push({
      quantity: 'WEEKLY_VOLUME',
      siteId: 'lib/training/normal-window.ts#sustainedWeeklyMileage',
      value: sustained.ok ? sustained.value.weeklyMi : null,
      unit: 'mi/wk',
      note: sustained.ok
        ? `OWNER (DB shell) · rank ${sustained.value.rank} of ${sustained.value.weeksObserved} representative weeks`
          + ` · mean would be ${sustained.value.meanWeeklyMi.toFixed(1)} · ${sustained.value.runDays} run days`
        : `REFUSED · ${sustained.refusal.code} · ${sustained.refusal.message}`,
    });
    push({
      quantity: 'WEEKLY_VOLUME',
      siteId: 'lib/training/normal-window.ts#sustainedFromWeeks',
      value: sustained.ok ? sustained.value.weeklyMi : null,
      unit: 'mi/wk',
      note: 'the pure core the shell above spends · byte-equal by construction',
    });

    // The SECOND answer, on the same runner: the same rank statistic over the
    // RAW series, which is what `rampBaseForBuild` builds and what the
    // composer actually ramps from.
    const { resolveRampBase } = await import('@/lib/plan/generate');
    let rawSeries: number[] = [];
    let rawWhy = '';
    try {
      const q = await pool.query<{ w: string; mi: string }>(
        `SELECT floor((($2::date - (data->>'date')::date)) / 7)::text AS w,
                SUM((data->>'distanceMi')::numeric)::text AS mi
           FROM runs
          WHERE user_uuid = $1::uuid
            AND NOT (data ? 'mergedIntoId')
            AND (data->>'date')::date >  $2::date - 112
            AND (data->>'date')::date <= $2::date
          GROUP BY 1 ORDER BY 1`,
        [OWNER, TODAY],
      );
      const byWeek = new Map<number, number>();
      for (const r of q.rows) byWeek.set(Number(r.w), Number(r.mi));
      rawSeries = Array.from({ length: 16 }, (_, i) => Math.round((byWeek.get(i) ?? 0) * 10) / 10);
      rawWhy = 'raw 112-day series, no Rule 8 filter';
    } catch (e) {
      rawWhy = `READ FAILED · ${(e as Error).message}`;
    }
    const mean4 = rawSeries.length ? rawSeries.slice(0, 4).reduce((a, b) => a + b, 0) / 4 : 0;
    const ramp = rawSeries.length
      ? resolveRampBase({ meanWeeklyMi: mean4, weeklySeries: rawSeries, allowedInterruptionWeeks: 3 })
      : null;
    push({
      quantity: 'WEEKLY_VOLUME',
      siteId: 'lib/plan/generate.ts#resolveRampBase',
      value: ramp && ramp.sustainedMi > 0 ? ramp.sustainedMi : null,
      unit: 'mi/wk',
      note: `SECOND · ${rawWhy}`
        + (ramp ? ` · baseMi ${ramp.baseMi.toFixed(1)} · peakMi ${ramp.peakMi.toFixed(1)}` : ''),
    });
    const { rankWeek } = await import('@/lib/adaptation/volume-evidence/belief');
    push({
      quantity: 'WEEKLY_VOLUME',
      siteId: 'lib/adaptation/volume-evidence/belief.ts#rankWeek',
      value: rawSeries.length ? rankWeek(rawSeries, nw.SUSTAINED_WEEK_RANK) : null,
      unit: 'mi/wk',
      note: 'SECOND · the volume-evidence lane\'s own rank-k, same raw population',
    });

    /* ════ RUNNING_FREQUENCY ═══════════════════════════════════════════ */

    // `derivedTrainingDaysPerWeek` is module-private, so its SQL is
    // reconstructed here rather than called. Labelled as a reconstruction.
    let derivedFreq: number | null = null;
    let freqWhy = '';
    try {
      const q = await pool.query<{ w: string; d: string }>(
        `SELECT floor((($2::date - (data->>'date')::date)) / 7)::text AS w,
                COUNT(DISTINCT (data->>'date'))::text AS d
           FROM runs
          WHERE user_uuid = $1::uuid
            AND NOT (data ? 'mergedIntoId')
            AND (data->>'date')::date >  $2::date - 112
            AND (data->>'date')::date <= $2::date
          GROUP BY 1`,
        [OWNER, TODAY],
      );
      const counts = q.rows.map((r) => Number(r.d)).sort((a, b) => b - a);
      derivedFreq = counts.length >= 3 ? Math.min(7, counts[2]) : null;
      freqWhy = counts.length >= 3
        ? `rank-3 of ${counts.length} weeks · series ${counts.slice(0, 6).join(',')}`
        : `REFUSED · only ${counts.length} weeks with any running`;
    } catch (e) {
      freqWhy = `READ FAILED · ${(e as Error).message}`;
    }
    push({
      quantity: 'RUNNING_FREQUENCY',
      siteId: 'lib/plan/generate.ts#derivedTrainingDaysPerWeek',
      value: derivedFreq,
      unit: 'days/wk',
      note: `OWNER · RECONSTRUCTED, not called (module-private) · ${freqWhy}`,
    });

    let statedFreq: number | null = null;
    let statedWhy = '';
    try {
      const q = await pool.query<{ f: string | null }>(
        'SELECT weekly_frequency::text AS f FROM profile WHERE user_uuid = $1::uuid',
        [OWNER],
      );
      if (q.rows.length === 0) statedWhy = 'ABSENT · no profile row';
      else if (q.rows[0].f == null) statedWhy = 'NULL · reads as "legacy, fill every slot"';
      else { statedFreq = Number(q.rows[0].f); statedWhy = 'stated on the profile'; }
    } catch (e) {
      statedWhy = `READ FAILED · ${(e as Error).message}`;
    }
    // CLOSED 2026-09-07 (RUNFREQ-OWNER-1) · all three now fall back to the
    // owner (derivedFreq) on a null stated preference, matching
    // `lib/plan/generate.ts`'s own `statedFreq ?? await
    // derivedTrainingDaysPerWeek(...)`. injury-builder additionally still
    // applies its own [1,7] validation and, below that, the file's
    // conservative MAX_ACTIVE_DAYS_PER_WEEK (5) only when BOTH stated and
    // derived come up empty.
    push({
      quantity: 'RUNNING_FREQUENCY',
      siteId: 'lib/plan/injury-builder.ts#weeklyFrequencyFallback',
      value: statedFreq != null && statedFreq >= 1 && statedFreq <= 7
        ? statedFreq : (derivedFreq ?? 5),
      unit: 'days/wk',
      note: `CARRIER · profile.weekly_frequency (${statedWhy}) falling back to `
        + `derivedTrainingDaysPerWeek, then to the file's own conservative 5 `
        + `· NOTE: buildInjuryPlan (the only export) unconditionally refuses, `
        + `so this site is unreachable in production today`,
    });
    push({
      quantity: 'RUNNING_FREQUENCY',
      siteId: 'lib/plan/adapt.ts#weeklyFrequencyCap',
      value: statedFreq ?? derivedFreq,
      unit: 'days/wk',
      note: `CARRIER · the raw column as a hard per-week run-count cap (${statedWhy})`
        + ' · falls back to derivedTrainingDaysPerWeek on null; no 0 -> 3 coercion',
    });
    push({
      quantity: 'RUNNING_FREQUENCY',
      siteId: 'lib/plan/mutate.ts#weeklyFrequencyContext',
      value: statedFreq ?? derivedFreq,
      unit: 'days/wk',
      note: `CARRIER · the same raw read into PlanValidationContext (${statedWhy})`
        + ' · falls back to derivedTrainingDaysPerWeek on null',
    });

    /* ════ QUALITY_FREQUENCY ═══════════════════════════════════════════ */

    // `densityForWeek` is a closure inside `composePlan`. What it decided is
    // read back off the rows it wrote — a persisted answer, not a call.
    let plannedQ: number | null = null;
    let plannedWhy = '';
    let aheadQ: number | null = null;
    let aheadWhy = '';
    try {
      // Rule 14 · the ACTIVE plan. A join on user_uuid alone reads every
      // archived version of the block, which is how one week once counted 59
      // quality sessions.
      const q = await pool.query<{ n: string; wk: string | null }>(
        `SELECT COUNT(*)::text AS n, MIN(w.date_iso)::text AS wk
           FROM plan_workouts w
           JOIN training_plans p ON p.id = w.plan_id
          WHERE p.user_uuid = $1::uuid AND p.archived_iso IS NULL
            AND w.is_quality = true
            AND w.date_iso >= $2::text
            AND w.date_iso <  to_char($2::date + 7, 'YYYY-MM-DD')`,
        [OWNER, TODAY],
      );
      aheadQ = Number(q.rows[0]?.n ?? 0);
      aheadWhy = `COUNT of is_quality rows in the seven days from ${q.rows[0]?.wk ?? TODAY}`;
      plannedQ = aheadQ;
      plannedWhy = 'read back off the rows the closure wrote';
    } catch (e) {
      plannedWhy = `READ FAILED · ${(e as Error).message}`;
      aheadWhy = plannedWhy;
    }
    push({
      quantity: 'QUALITY_FREQUENCY',
      siteId: 'lib/plan/generate.ts#densityForWeek',
      value: plannedQ,
      unit: 'sessions/wk',
      note: `OWNER · NOT CALLED (a closure inside composePlan) · ${plannedWhy}`,
    });
    push({
      quantity: 'QUALITY_FREQUENCY',
      siteId: 'lib/adaptation/load-adaptation-engine.ts#qualitySessionsWeekAhead',
      value: aheadQ,
      unit: 'sessions/wk',
      note: `SECOND · ${aheadWhy} · a PRESCRIBED count, not a habit`,
    });

    /* ════ RACE_TARGET ═════════════════════════════════════════════════ */

    let outlookTarget: number | null = null;
    let outlookWhy = '';
    let authoredTarget: number | null = null;
    let authoredWhy = '';
    try {
      const { resolveRaceOutlookBySlug } = await import('@/lib/race/race-outlook');
      // Rule 14 · the population is "races this runner has not yet run", and
      // this schema keeps the date inside `meta`, not in a column. The first
      // run of this file asked for `date_iso` and the read FAILED — which the
      // row below reported as a failure rather than as "no race", because a
      // failed read and an empty calendar are different facts (Rule 11).
      const nextRace = await pool.query<{ slug: string; d: string; goal: string | null }>(
        `SELECT slug, (meta->>'date') AS d, meta->>'goalDisplay' AS goal
           FROM races
          WHERE user_uuid = $1::uuid AND (meta->>'date') >= $2::text
          ORDER BY (meta->>'date') ASC LIMIT 1`,
        [OWNER, TODAY],
      );
      if (nextRace.rows.length === 0) outlookWhy = 'ABSENT · no upcoming race';
      else {
        const slug = nextRace.rows[0].slug;
        const o = await resolveRaceOutlookBySlug(OWNER, slug, TODAY);
        outlookTarget = o?.execution?.targetSec ?? null;
        outlookWhy = o
          ? `OWNER · ${slug} ${nextRace.rows[0].d} · stated goal ${nextRace.rows[0].goal ?? '—'}`
            + ` · execution target, which is the current projection and never the forecast`
          : `REFUSED · the outlook did not resolve for ${slug}`;
      }
    } catch (e) {
      outlookWhy = `READ FAILED · ${(e as Error).message}`;
    }
    push({
      quantity: 'RACE_TARGET',
      siteId: 'lib/race/race-outlook.ts#composeRaceOutlook',
      value: outlookTarget,
      unit: 's',
      note: outlookWhy,
    });
    try {
      const q = await pool.query<{ t: string | null; d: string | null }>(
        `SELECT authored_state->>'prescribed_race_pace_s_per_mi' AS t,
                to_char(authored_iso, 'YYYY-MM-DD') AS d
           FROM training_plans
          WHERE user_uuid = $1::uuid AND archived_iso IS NULL
          ORDER BY authored_iso DESC LIMIT 1`,
        [OWNER],
      );
      if (q.rows.length === 0) authoredWhy = 'ABSENT · no active plan';
      else if (q.rows[0].t == null) authoredWhy = 'ABSENT · the active plan stamps no prescribed race pace';
      else { authoredTarget = Number(q.rows[0].t); authoredWhy = `frozen at authoring ${q.rows[0].d}`; }
    } catch (e) {
      authoredWhy = `READ FAILED · ${(e as Error).message}`;
    }
    push({
      quantity: 'RACE_TARGET',
      siteId: 'lib/training/achievable-target.ts#achievableRaceTarget',
      value: authoredTarget,
      unit: 's/mi',
      note: `SECOND · the AUTHORING target, as persisted · ${authoredWhy}`
        + ' · a different basis from the outlook execution target, in a different unit',
    });

    /* ════ RECOVERY_SPACING · every live day-count, at this runner's own
     *     next race distance ══════════════════════════════════════════ */

    let raceMi = 26.2;
    try {
      const q = await pool.query<{ mi: string | null }>(
        `SELECT (meta->>'distanceMi') AS mi FROM races
          WHERE user_uuid = $1::uuid AND (meta->>'date') >= $2::text
          ORDER BY (meta->>'date') ASC LIMIT 1`,
        [OWNER, TODAY],
      );
      const v = q.rows[0]?.mi;
      if (v != null && Number.isFinite(Number(v))) raceMi = Number(v);
    } catch { /* keep the marathon default and say so below */ }

    const gt = await import('@/lib/plan/goal-tiers');
    const cs = await import('@/lib/plan/combined-stress');
    const ed = await import('@/lib/coach/easy-discipline');
    const rp = await import('@/lib/coach/recovery-phase');
    const cat = gt.distanceCategoryOf(raceMi);

    push({
      quantity: 'RECOVERY_SPACING',
      siteId: 'lib/plan/goal-tiers.ts#postRaceRecoveryWeeks',
      value: gt.postRaceRecoveryWeeks(cat, 'A') * 7,
      unit: 'days',
      note: `OWNER · ${cat} at A priority, whole weeks x 7`,
    });
    push({
      quantity: 'RECOVERY_SPACING',
      siteId: 'lib/plan/combined-stress.ts#postRaceNoQualityDays',
      value: (() => { try { return cs.postRaceNoQualityDays(raceMi, 'A'); } catch { return null; } })(),
      unit: 'days',
      note: 'CARRIER · the same week table read in days',
    });
    push({
      quantity: 'RECOVERY_SPACING',
      siteId: 'lib/plan/combined-stress.ts#noQualityDaysAfterRace',
      value: (() => { try { return cs.noQualityDaysAfterRace(raceMi, 'A'); } catch { return null; } })(),
      unit: 'days',
      note: 'SECOND · a day table with only hm/10k/5k rows · everything longer collapses onto the half',
    });
    push({
      quantity: 'RECOVERY_SPACING',
      siteId: 'lib/coach/easy-discipline.ts#raceWindowFor',
      value: ed.raceWindowFor(raceMi, true),
      unit: 'days',
      note: 'SECOND · the same doctrine column, upper bound, all four rows',
    });
    push({
      quantity: 'RECOVERY_SPACING',
      siteId: 'lib/coach/recovery-phase.ts#expectedDaysForAnchor:race',
      value: rp.expectedDaysForAnchor('race', raceMi),
      unit: 'days',
      note: 'SECOND · the floor of every band · THIS is what the phone renders',
    });

    const vd = await import('@/lib/plan/validate');
    const rs = await import('@/lib/plan/reschedule');
    const hard = { type: 'intervals', distanceMi: 9, isQuality: true, isLong: false };
    push({
      quantity: 'RECOVERY_SPACING',
      siteId: 'lib/plan/validate.ts#requiredSeparationDays',
      value: vd.requiredSeparationDays(hard as never).min,
      unit: 'days',
      note: 'OWNER (hard-session anchor) · the authoring gate, for one interval session',
    });
    push({
      quantity: 'RECOVERY_SPACING',
      siteId: 'lib/plan/reschedule.ts#requiredRecoveryDaysAfter',
      value: rs.requiredRecoveryDaysAfter(hard as never),
      unit: 'days',
      note: 'CARRIER · mirrors the gate rather than calling it',
    });
    push({
      quantity: 'RECOVERY_SPACING',
      siteId: 'lib/coach/recovery-phase.ts#expectedDaysForAnchor:session',
      value: rp.expectedDaysForAnchor('intervals', 9),
      unit: 'days',
      note: 'CLOSED 2026-09-07 (RECOVERY-OWNER-1) for this branch · now '
        + 'calls requiredSeparationDays directly. Still SECOND for the '
        + 'long-run branch this same siteId also covers — see '
        + 'quantity-owners.ts\'s note on this site.',
    });

    /* ════ THE PACE FAMILY · the canonical anchors, and the five
     *     production paths that do not take them ═══════════════════════ */

    const { resolvePrescribedPaceAnchors } = await import('@/lib/training/load-prescription-anchors');
    const read = await resolvePrescribedPaceAnchors(OWNER, TODAY);
    const a = read.ok ? read.anchors : null;
    push({
      quantity: 'INTERVAL_PACE',
      siteId: 'lib/training/prescription-resolver.ts#composePaceAnchors:I',
      value: a?.intervalSecPerMi ?? null,
      unit: 's/mi',
      note: a ? `OWNER · ${a.basis.highIntensity.sourceMode} · conf ${a.basis.highIntensity.confidence.toFixed(2)}`
        : `REFUSED · ${JSON.stringify(read)}`,
    });
    push({
      quantity: 'MARATHON_PACE_DOSE',
      siteId: 'lib/training/prescription-resolver.ts#composePaceAnchors:M',
      value: a?.marathonSecPerMi ?? null,
      unit: 's/mi',
      note: a ? `OWNER · ${a.basis.marathon.sourceMode} · exponent ${a.basis.marathon.enduranceExponent}`
        + ` · personally evidenced ${a.basis.marathon.personallyEvidenced}` : 'REFUSED',
    });

    if (a) {
      const { buildWorkoutSpec } = await import('@/lib/plan/spec-builder');
      const RX = '3 mi WU · 6×800m @ I pace · 90s jog · 2 mi CD';
      const anchored = buildWorkoutSpec(
        'intervals', 9, a.thresholdSecPerMi, 168, RX, 180, null,
        a.intervalSecPerMi, a.easyCeilingSecPerMi, false, null, a,
      );
      const anchorless = buildWorkoutSpec(
        'intervals', 9, a.thresholdSecPerMi, 168, RX, 180, null,
        null, null, false, null, null,
      );
      const pick = (spec: unknown, k: string): number | null => {
        const v = (spec as Record<string, unknown> | null)?.[k];
        return typeof v === 'number' ? v : null;
      };
      push({
        quantity: 'INTERVAL_PACE',
        siteId: 'lib/plan/spec-builder.ts#buildWorkoutSpec:anchored',
        value: pick(anchored.spec, 'rep_pace_s_per_mi'),
        unit: 's/mi',
        note: 'CARRIER · what generate/recompute/reanchor write · must equal the owner',
      });
      push({
        quantity: 'INTERVAL_PACE',
        siteId: 'lib/plan/spec-builder.ts#buildWorkoutSpec:anchorless',
        value: pick(anchorless.spec, 'rep_pace_s_per_mi'),
        unit: 's/mi',
        note: 'SECOND · what adapt / progression-pass / seed / restore / backfill write',
      });

      const LONG_RX = '18 mi with 6 mi @ MP finish';
      const longAnchored = buildWorkoutSpec(
        'long', 18, a.thresholdSecPerMi, 168, LONG_RX, 180, null,
        a.intervalSecPerMi, a.easyCeilingSecPerMi, false, null, a,
      );
      const longAnchorless = buildWorkoutSpec(
        'long', 18, a.thresholdSecPerMi, 168, LONG_RX, 180, null,
        null, null, false, null, null,
      );
      push({
        quantity: 'MARATHON_PACE_DOSE',
        siteId: 'lib/plan/spec-builder.ts#buildWorkoutSpec:mpAnchored',
        value: pick(longAnchored.spec, 'finish_pace_s_per_mi'),
        unit: 's/mi',
        note: 'CARRIER · the long run\'s marathon-pace finish, with anchors',
      });
      push({
        quantity: 'MARATHON_PACE_DOSE',
        siteId: 'lib/plan/spec-builder.ts#resolveMarathonPace',
        value: pick(longAnchorless.spec, 'finish_pace_s_per_mi'),
        unit: 's/mi',
        note: 'SECOND · the same finish through the flat T+18 offset, no anchors',
      });
    }

    /* ════ MARATHON_PACE_DOSE · the two ceilings ═══════════════════════ */

    const weeklyMi = sustained.ok ? sustained.value.weeklyMi : 0;
    const dosing = await import('@/lib/plan/dosing');
    push({
      quantity: 'MARATHON_PACE_DOSE',
      siteId: 'lib/plan/dosing.ts#MARATHON_PACE_WORKOUT_CAP',
      value: weeklyMi > 0
        ? Math.min(dosing.MARATHON_PACE_WORKOUT_CAP.absMi, weeklyMi * dosing.MARATHON_PACE_WORKOUT_CAP.pctOfWeekly)
        : null,
      unit: 'mi',
      note: `OWNER · min(18, ${weeklyMi.toFixed(1)} x 0.20) · both halves of the doctrine cell`,
    });
    push({
      quantity: 'MARATHON_PACE_DOSE',
      siteId: 'lib/plan/dosing.ts#slotDoseBudgetMi:M',
      value: weeklyMi > 0
        ? dosing.slotDoseBudgetMi({ weeklyMi, pace: 'M', context: 'training' })
        : null,
      unit: 'mi',
      note: 'SECOND · weeklyShareCap(M) is null so the weekly budget is Infinity'
        + ' · the percentage half never applies on this path',
    });

    /* ════ PRINT ═══════════════════════════════════════════════════════ */

    const out: string[] = [];
    out.push('');
    out.push('╔══════════════════════════════════════════════════════════════════════════════╗');
    out.push(`║ OWNER AGREEMENT CENSUS · owner account · ${TODAY}                          ║`);
    out.push('╚══════════════════════════════════════════════════════════════════════════════╝');
    let last = '';
    for (const r of rows) {
      if (r.quantity !== last) { out.push(''); out.push(`── ${r.quantity} ${'─'.repeat(Math.max(0, 60 - r.quantity.length))}`); last = r.quantity; }
      const v = r.value == null ? '—' : (Number.isInteger(r.value) ? String(r.value) : r.value.toFixed(2));
      out.push(`  ${v.padStart(8)} ${r.unit.padEnd(12)} ${r.siteId}`);
      out.push(`  ${' '.repeat(21)} ${r.note}`);
    }

    out.push('');
    out.push('── WIDEST PAIR PER QUANTITY ──────────────────────────────────');
    const byQ = new Map<string, number[]>();
    for (const r of rows) {
      if (r.value == null || !Number.isFinite(r.value)) continue;
      const key = `${r.quantity}|${r.unit}`;
      byQ.set(key, [...(byQ.get(key) ?? []), r.value]);
    }
    for (const [key, vals] of byQ) {
      if (vals.length < 2) continue;
      const spread = Math.max(...vals) - Math.min(...vals);
      const [q, u] = key.split('|');
      out.push(`  ${q.padEnd(24)} ${String(Math.round(spread * 100) / 100).padStart(8)} ${u}   values ${[...new Set(vals)].sort((x, y) => x - y).join(', ')}`);
    }
    out.push('');

    const fs = await import('node:fs');
    fs.writeFileSync(process.env.CENSUS_OUT ?? '/tmp/owner-agreement-census.txt', out.join('\n'));
    // eslint-disable-next-line no-console
    console.log(out.join('\n'));

    /* ── THE ONLY HARD ASSERTIONS ────────────────────────────────────── */

    // LIVENESS. A census that measured nothing must not report clean — the
    // failure `_authoring_shadow_compare.audit.test.ts` names in its own
    // header, where `describe.skipIf(!RO)` reported GREEN with no database.
    expect(rows.length, 'the census resolved nothing').toBeGreaterThanOrEqual(20);
    const resolved = rows.filter((r) => r.value != null).length;
    expect(resolved, 'every site refused · the census is measuring nothing').toBeGreaterThanOrEqual(15);

    // The one thing a census IS allowed to fail on: a CARRIER that altered
    // the number it exists to carry, on the real account. Everything else
    // prints.
    const anchoredI = rows.find((r) => r.siteId === 'lib/plan/spec-builder.ts#buildWorkoutSpec:anchored')?.value;
    const ownerI = rows.find((r) => r.siteId === 'lib/training/prescription-resolver.ts#composePaceAnchors:I')?.value;
    if (anchoredI != null && ownerI != null) {
      expect(anchoredI, 'the anchored spec builder altered the canonical interval pace').toBe(ownerI);
    }
    const carriedDays = rows.find((r) => r.siteId === 'lib/plan/combined-stress.ts#postRaceNoQualityDays')?.value;
    const ownerDays = rows.find((r) => r.siteId === 'lib/plan/goal-tiers.ts#postRaceRecoveryWeeks')?.value;
    if (carriedDays != null && ownerDays != null) {
      expect(carriedDays, 'postRaceNoQualityDays no longer carries the week table').toBe(ownerDays);
    }
  }, 180_000);
});
