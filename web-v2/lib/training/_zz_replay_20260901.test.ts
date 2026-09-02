/**
 * REPLAY · the owner's real 2026-09-01 4×1 mi threshold session, through every
 * consumer that grades it. Rule 13's standard, applied to the engine half:
 * real data from production, not a fixture.
 *
 * NOT A GATE. It writes a report to the scratchpad and asserts only the
 * headline facts, so it is a harness rather than a check that has to hold in
 * CI. Run with a read-only DATABASE_URL.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const OWNER = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const RUN_ID = '-258355938987883';
const DATE = '2026-09-01';
const OUT = '/private/tmp/claude-501/-Volumes-WP-06-Claude-Code-Runcino/5f870f9b-924e-42f5-9e67-a1225046505a/scratchpad/p0/replay.md';

const lines: string[] = [];
const say = (s = ''): void => { lines.push(s); };

const hasDb = !!process.env.DATABASE_URL;

describe.runIf(hasDb)('REPLAY · 2026-09-01', () => {
  it('runs every consumer and writes the report', async () => {
    const { pool } = await import('@/lib/db/pool');

    say(`# 2026-09-01 · 4×1 mi @ T pace · 1 min jog — every consumer`);
    say();
    say(`Owner \`${OWNER}\`, canonical \`runs\` row \`${RUN_ID}\`.`);
    say();

    /* ── the stored row ────────────────────────────────────────────────── */
    const row = (await pool.query<{ data: any }>(
      `SELECT data FROM runs WHERE id = $1::bigint`, [RUN_ID],
    )).rows[0];
    expect(row, 'the production row must exist').toBeTruthy();
    const data = row!.data;
    const phases: any[] = Array.isArray(data.phases) ? data.phases : [];

    say('## 0 · What is stored (BEFORE — the watch build that recorded it)');
    say();
    say('| # | phase | dur | dist | target | actual | avgHr | inTol | outTol | stored verdict |');
    say('|---|---|---|---|---|---|---|---|---|---|');
    for (const p of phases) {
      say(`| ${p.index} | ${p.label} | ${p.actualDurationSec}s | ${p.actualDistanceMi} | `
        + `${p.targetPaceSPerMi ?? '—'} | ${p.actualPaceSPerMi ?? '—'} | ${p.avgHr ?? '—'} | `
        + `${p.timeInToleranceSec ?? '—'} | ${p.timeOutOfToleranceSec ?? '—'} | `
        + `**${p.verdict ?? '—'}** |`);
    }
    say();
    say(`Note: the row carries NO \`tolerancePaceSPerMi\` and NO \`paceShape\` — it`);
    say(`predates both fields — so every consumer below is exercising the`);
    say(`LEGACY-payload path, which is what every already-deployed watch sends.`);
    say();

    /* ── 1 · Activity Interpreter ──────────────────────────────────────── */
    const { classifyStoredActivity } = await import('@/lib/evidence/load-activity-evidence');
    const act = await classifyStoredActivity(OWNER, RUN_ID);
    say('## 1 · Activity Interpreter (`classifyStoredActivity`)');
    say();
    say('```json');
    say(JSON.stringify(act, null, 2).slice(0, 2400));
    say('```');
    say();

    /* ── 2 · run detail · mapWatchPhases ───────────────────────────────── */
    const { mapWatchPhases } = await import('@/lib/coach/run-state');
    const { deriveReadingScopes } = await import('@/lib/coach/reading-scope');
    const mappedNoClass = mapWatchPhases(phases);
    const mappedThreshold = mapWatchPhases(phases, 0, 'threshold');
    say('## 2 · Run Detail (`mapWatchPhases` → `phase_breakdown`)');
    say();
    say('| # | type | target | actual | tol (AFTER) | shape (AFTER) | status BEFORE | status AFTER | label AFTER | watch verdict (stored) |');
    say('|---|---|---|---|---|---|---|---|---|---|');
    for (let i = 0; i < mappedThreshold.length; i++) {
      const m = mappedThreshold[i]!;
      const n = mappedNoClass[i]!;
      // BEFORE: heatAdjustedStatus(target, actual) at a flat ±10, and
      // tolerance_pace_sec 8 on work / null elsewhere.
      const t = m.target_pace_sec;
      const a = Number(phases[i].actualPaceSPerMi) || null;
      const before = t != null && a != null && m.type !== 'recovery'
        ? (a < t - 10 ? 'fast' : a > t + 10 ? 'slow' : 'on')
        : null;
      say(`| ${m.index} | ${m.type} | ${m.target_pace_sec ?? '—'} | ${m.actual_pace ?? '—'} | `
        + `${m.tolerance_pace_sec ?? '—'} | ${m.pace_shape} | ${before ?? '—'} | `
        + `**${m.status ?? '—'}** | ${m.status_label ?? '—'} | ${m.verdict ?? '—'} |`);
      // The two paths must agree on the phases whose shape does not need a
      // session class (a warm-up, a cool-down and a recovery are what they are).
      if (m.type !== 'work') expect(n.pace_shape).toBe(m.pace_shape);
    }
    say();

    /* ── 3 · the new watch grader, replayed on the real phases ─────────── */
    const {
      gradePhase, gradeSession, paceShapeFor, phaseToleranceSec, phaseVerdictLabel,
    } = await import('./execution-semantics');
    say('## 3 · The new wrist grader, replayed on the nine real phases');
    say();
    say('| # | type | target | actual | shape | AFTER | reads as | BEFORE (stored) |');
    say('|---|---|---|---|---|---|---|---|');
    const gradable = phases.map((p) => ({
      phaseType: String(p.type) as 'warmup' | 'work' | 'recovery' | 'cooldown',
      targetSecPerMi: Number(p.targetPaceSPerMi) || null,
      avgSecPerMi: Number(p.actualPaceSPerMi) || null,
      completed: p.completed !== false,
    }));
    const verdicts: string[] = [];
    for (let i = 0; i < gradable.length; i++) {
      const g = gradable[i]!;
      const hasTarget = g.targetSecPerMi != null && g.targetSecPerMi > 0;
      const shape = paceShapeFor(g.phaseType, 'threshold', { hasTarget });
      const v = gradePhase(
        { ...g, toleranceSec: phaseToleranceSec(g.phaseType, 'threshold', { hasTarget }) },
        'threshold',
      );
      verdicts.push(v);
      say(`| ${i} | ${g.phaseType} | ${g.targetSecPerMi ?? '—'} | ${g.avgSecPerMi ?? '—'} | `
        + `${shape} | **${v}** | ${phaseVerdictLabel(v, shape) ?? '(nothing said)'} | `
        + `${phases[i].verdict ?? '—'} |`);
    }
    const session = gradeSession(gradable, 'threshold', {
      recoveries: phases.filter((p) => p.type === 'recovery')
        .map((p) => ({ prescribedSec: 60, actualSec: Number(p.actualDurationSec) || null })),
    });
    say();
    say('```json');
    say(JSON.stringify(session, null, 2));
    say('```');
    say();

    // THE HEADLINE. Nothing may call this session missed or drifted.
    const work = verdicts.filter((_, i) => phases[i].type === 'work');
    expect(work).not.toContain('slow');
    expect(work).not.toContain('incomplete');
    expect(session.verdict).toBe('executed');

    /* ── 4 · reconstruct + interpret via loadKeySessionExecutions ───────── */
    const { loadKeySessionExecutions } = await import('@/lib/execution/load');
    const sessions = await loadKeySessionExecutions(OWNER, DATE, '2026-09-02', null);
    const s = sessions.find((x) => x.dateISO === DATE) ?? sessions[0] ?? null;
    say('## 4 · Execution reconstruction + interpretation (`loadKeySessionExecutions`)');
    say();
    say('```json');
    say(JSON.stringify(s, null, 2).slice(0, 3000));
    say('```');
    say();

    /* ── 5 · deriveRecap ───────────────────────────────────────────────── */
    const { deriveRecap } = await import('@/lib/coach/run-recap');
    const splits = Array.isArray(data.splits)
      ? data.splits.map((sp: any, i: number) => ({
          mile: i + 1,
          paceSPerMi: Number(sp.paceSecPerMi ?? sp.paceSec ?? sp.pace_s_per_mi) || null,
          avgHr: Number(sp.avgHr ?? sp.hr) || null,
        }))
      : [];
    const workPace = Math.round(
      phases.filter((p) => p.type === 'work')
        .reduce((acc, p) => acc + Number(p.actualPaceSPerMi), 0)
      / Math.max(1, phases.filter((p) => p.type === 'work').length),
    );
    // The same four inputs the real routes assemble from `runs.data.phases`.
    const workPhases = phases.filter((p) => p.type === 'work');
    const repPaces = workPhases.map((p) => Number(p.actualPaceSPerMi)).filter((n) => n > 0);
    const workDistanceMi = workPhases.reduce((a, p) => a + (Number(p.actualDistanceMi) || 0), 0);
    const recapArgs = {
      type: 'threshold' as const, phase: 'BUILD' as const,
      plannedMi: 8.5, plannedPaceSPerMi: 430,
      plannedHrCap: 168, lthrBpm: 168,
      actualMi: 8.5, actualPaceSPerMi: 483,
      workPaceSPerMi: workPace,
      workDistanceMi,
      repCount: workPhases.length,
      repPaces,
      actualAvgHr: 154, actualMaxHr: 172,
      // RULE 16 · WHAT THIS RUN MAY SAY ABOUT ITS OWN HEART RATE, from the
      // one owner both real routes now call. 158 / 161 / 164 / 166 across the
      // four reps, duration-weighted, kinetics-floored.
      readings: deriveReadingScopes({
        phases: mapWatchPhases(phases),
        wholeHrBpm: 154,
      }),
      splits,
    };
    const recapAfter = deriveRecap(recapArgs as any);
    const recapNoLthr = deriveRecap({ ...recapArgs, lthrBpm: null } as any);
    say('## 5 · Recap (`deriveRecap`)');
    say();
    say(`Work-phase mean pace: **${workPace} s/mi** against a 430 target.`);
    say();
    say('**AFTER** (with the LTHR threaded, three arms):');
    say();
    say('> ' + recapAfter.verdict);
    for (const f of recapAfter.facts) say('> ' + f);
    say();
    say('**BEFORE** is the same call with no `lthrBpm` — which is what the old');
    say('code did structurally, since it fed `plannedHrCap` into the band and');
    say('had only two arms. Shown for contrast:');
    say();
    say('> ' + recapNoLthr.verdict);
    for (const f of recapNoLthr.facts) say('> ' + f);
    say();

    /* ── 6 · training influence ────────────────────────────────────────── */
    const { composeTrainingInfluence } = await import('@/lib/coach/training-influence');
    const infl = composeTrainingInfluence({
      type: 'threshold', spec: { kind: 'threshold' },
      plannedPaceSec: 430, donePaceSec: workPace,
      doneAvgHr: 154, sameTypeStreak: 1,
      wasAdapted: false, wasRestored: false,
      phaseLabel: 'BUILD', raceDistanceMi: 26.2, hrOnPaceDelta: null,
    });
    say('## 6 · Training influence (`composeTrainingInfluence`)');
    say();
    say('```json');
    say(JSON.stringify(infl, null, 2));
    say('```');
    say();

    /* ── 7 · the evidence / Targets test-point verdict ─────────────────── */
    const { judgeTestPointExecution } = await import('./goal-projection');
    const spec = (await pool.query<{ workout_spec: any }>(
      `SELECT pw.workout_spec FROM plan_workouts pw
         JOIN training_plans tp ON tp.id = pw.plan_id
        WHERE tp.user_uuid = $1::uuid AND tp.archived_iso IS NULL AND pw.date_iso = $2`,
      [OWNER, DATE],
    )).rows[0]?.workout_spec ?? null;
    const tp = judgeTestPointExecution({
      type: 'threshold', targetS: 430, watchWorkS: workPace, overallS: 483,
      rawSplits: data.splits ?? null, splitsUnreliable: false,
      spec, plannedDistanceMi: 8.5, actualDistanceMi: 8.5,
      vdot: null, heatSlowdownPct: 0,
    });
    say('## 7 · Evidence / Targets test point (`judgeTestPointExecution`)');
    say();
    say('```json');
    say(JSON.stringify(tp, null, 2));
    say('```');
    say();

    fs.writeFileSync(OUT, lines.join('\n') + '\n');
    // LIVENESS · a harness that wrote nothing would pass silently.
    expect(lines.length).toBeGreaterThan(40);
  }, 120_000);
});
