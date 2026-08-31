/**
 * lib/adaptation/_adaptation_engine.audit.test.ts · SHADOW MODE (§21, Rule 13).
 *
 * §21: "run in shadow mode → record what they would have returned → compare
 * against production behavior → inspect disagreements → decide which reflects
 * doctrine → promote." The first four steps are here. THE FIFTH IS NOT: nothing
 * in this repo calls `resolveAdaptationProposals` on a live path, and
 * `lib/plan/adapt.ts` still owns every mutation.
 *
 * So this file DECIDES NOTHING. It prints what the new ownership layer would
 * propose for the owner's real account today, beside what the shipped detectors
 * actually produce for the same runner and the same instant, and it asserts
 * only the properties that would be defects either way.
 *
 * ── HOW IT RUNS ─────────────────────────────────────────────────────────────
 *
 * Read-only, and ENFORCED rather than assumed: `process.env.DATABASE_URL` is
 * overridden onto the read-only role BEFORE `lib/db/pool`'s module-level
 * `new Pool(...)` is constructed, which means every app module must be imported
 * DYNAMICALLY inside the test body. A static top-level import would be hoisted
 * ahead of the override. Same convention as `_capacity_resolver.audit.test.ts`.
 *
 * The read-only role is also the FENCE around calling `detectAdaptations`: it
 * is a detector and should not write, but if a future edit made it write, the
 * role refuses rather than this file trusting a code path it does not own.
 *
 *   npx vitest run lib/adaptation/_adaptation_engine.audit.test.ts --disable-console-intercept
 *
 * ── THE QUESTION THIS FILE EXISTS TO ANSWER (CLAUDE.md Rule 21) ─────────────
 *
 * The engine's measured disposition on this account is ZERO upward adaptations
 * across the entire life of `coach_intents`, against five downgrades. So the
 * test that matters is not "does the new engine terminate". It is:
 *
 *   · Does it propose an upward change for this runner, ever, on real history?
 *   · If not, is that because his training genuinely never earned it — or
 *     because the bars are structurally unreachable?
 *
 * The second question is answered by REPORTING THE DISTANCE TO EACH BAR, not by
 * asserting a verdict. A lever that misses by one session is a different fact
 * from a lever that cannot be reached at all, and only the printout can tell
 * them apart.
 *
 * ── WHAT THIS PROVES, AND WHAT IT DOES NOT (Rule 22) ────────────────────────
 *
 *   · It proves the engine terminates on a real account with 270 runs and a
 *     live 14-week marathon block, and that its output is internally coherent.
 *   · IT DOES NOT SAY WHICH SIDE IS RIGHT where it and `adapt.ts` disagree.
 *   · IT READS ONE ACCOUNT. Nothing here generalises.
 */
import { describe, it, expect } from 'vitest';

const RO = process.env.DATABASE_URL_RO;
const OWNER = '0645f40c-951d-4ccc-b86e-9979cd26c795';

/** Anchored rather than `new Date()` so a re-run months later reports the same
 *  window. A stale anchor narrows a lookback; it never invalidates a read. */
const TODAY = '2026-08-31';

const pace = (s: number | null | undefined): string => {
  if (s == null || !Number.isFinite(s)) return '   -   ';
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return `${m}:${String(r).padStart(2, '0')}/mi`;
};
const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length));

describe.skipIf(!RO)('ADAPTATION ENGINE · shadow mode against the owner\'s live account', () => {
  it('proposes for the real account, and reports the distance to every bar', async () => {
    process.env.DATABASE_URL = RO;

    const { resolveAdaptationProposals } = await import('./load-adaptation-engine');
    const { contradictionsIn, PACE_PROGRESS_MIN_SESSIONS, VOLUME_PROGRESS_MIN_ABSORBED_WEEKS,
      VOLUME_ABSORBED_SHARE, sessionDemonstratesControl } = await import('./adaptation-engine');

    const { input, proposals, failures } = await resolveAdaptationProposals(OWNER, TODAY);

    /* ── 1 · WHAT COULD NOT BE READ ────────────────────────────────────────── */
    console.log('\n══ ADAPTATION ENGINE · SHADOW MODE ══════════════════════════════');
    console.log(`account ${OWNER} · today ${TODAY}`);
    if (failures.length > 0) {
      console.log('\nREAD FAILURES (Rule 11 · these are refusals, not empty evidence):');
      for (const f of failures) console.log(`  · ${f}`);
    } else {
      console.log('\nread failures: none');
    }

    expect(proposals).not.toBeNull();
    if (!input || !proposals?.readable) {
      console.log('\nENGINE REFUSED. Refusals:');
      for (const r of proposals?.refusals ?? []) console.log(`  · ${r.lever} ${r.code} — ${r.detail}`);
      // A refusal on a real account is a FINDING for a human, not a pass/fail.
      // The assertion is only that the refusal is honest about itself.
      expect(proposals?.refusals.length ?? 0).toBeGreaterThan(0);
      return;
    }

    /* ── 2 · THE INPUTS THE DECISION RESTED ON ─────────────────────────────── */
    const c = input.capacity;
    console.log('\n── INPUTS ───────────────────────────────────────────────────────');
    console.log(`capacity · threshold ${pace(c.threshold.paceSecPerMi)} `
      + `(${c.threshold.sourceMode}, confidence ${c.threshold.confidence.toFixed(2)})`);
    console.log(`           reasons ${c.threshold.reasons.join(', ')}`);
    console.log(`state    · ${input.state.decision}`
      + `${input.state.driver ? ` · driver ${input.state.driver.kind}: ${input.state.driver.detail}` : ''}`
      + ` · readable ${input.state.readable}`);
    console.log(`absorption · band ${input.absorption.band} · confidence ${input.absorption.confidence} `
      + `· decision ${input.absorption.decision} · veto ${input.absorption.veto ?? 'none'}`);
    console.log(`plan     · week ahead ${input.load.currentWeeklyMi ?? '-'} mi `
      + `· long ahead ${input.longRun.prescribedLongMi ?? '-'} mi `
      + `· tier ceiling ${input.load.tierWeeklyUpperMi ?? '-'} mi`);
    // PART 1 OF THE 2026-09-01 DECISION · phase-specific pricing, not a
    // blended average. Print every phase the loader found, each with its own
    // prescribed pace, so a human reading this log sees the SAME thing the
    // engine now decides against.
    console.log(`plan     · prescribed threshold, BY PHASE (${input.pace.phases.length} phase(s)):`);
    for (const ph of input.pace.phases) {
      console.log(`             ${pad(ph.phaseLabel ?? '(unphased)', 14)} `
        + `${pace(ph.prescribedSecPerMi)} · ${ph.rowCount} row(s) `
        + `· ${ph.firstDateISO} → ${ph.lastDateISO}`);
    }

    /* ── 2b · THE WINDOW · Rule 8's confidence-weighted lookback ───────────── */
    const lb = input.pace.lookback;
    console.log('\n── EVIDENCE WINDOW ──────────────────────────────────────────────');
    console.log(`base ${lb.baseWindowDays}d · used ${lb.windowDays}d `
      + `(${lb.windowDays > lb.baseWindowDays ? `EXTENDED by ${lb.windowDays - lb.baseWindowDays}d` : 'not extended'}) `
      + `· ${lb.representativeDays} representative days, ${lb.excludedDays} excluded as `
      + `taper/race/recovery · outer bound reached: ${lb.reachedOuterBound}`);
    console.log(`staleness factor · pace ${lb.stalenessFactor.toFixed(3)} `
      + `· duration ${input.longRun.lookback.stalenessFactor.toFixed(3)}`);
    const ht = input.load.historicalTolerance;
    console.log(`historical volume tolerance · ${ht.ok
      ? `${ht.sustainedWeeklyMi} mi/wk over ${ht.representativeDays} representative days`
      : `REFUSED (${ht.reason})`}`);

    /* ── 3 · THE DISTANCE TO EVERY BAR · the Rule 21 question ──────────────── */
    console.log('\n── DISTANCE TO EACH UPWARD BAR ──────────────────────────────────');

    const controlled = input.pace.sessions.filter(sessionDemonstratesControl);
    console.log(`PACE     · ${controlled.length}/${PACE_PROGRESS_MIN_SESSIONS} controlled sessions `
      + `(of ${input.pace.sessions.length} with quality evidence in the window)`);
    for (const s of input.pace.sessions) {
      console.log(`             ${s.dateISO} ${pad(s.capacity, 15)} `
        + `control=${pad(s.executionQuality, 14)} `
        + `collapse=${pad(String(s.lateRunPacingCollapse), 6)} `
        + `cost=${pad(String(s.internalCostMagnitude), 9)} `
        + `weight=${s.weight.toFixed(2)} ${sessionDemonstratesControl(s) ? '✓ counts' : '✗ does not count'}`);
    }
    for (const ph of input.pace.phases) {
      const gap = ph.prescribedSecPerMi - c.threshold.paceSecPerMi;
      console.log(`             ${pad(ph.phaseLabel ?? '(unphased)', 14)} capacity leads by `
        + `${gap.toFixed(1)} s/mi (needs 5+ and a direct source; source is ${c.threshold.sourceMode})`);
    }

    const scheduled = input.load.recentWeeks.filter((w) => w.scheduledMi != null && w.scheduledMi > 0);
    const absorbed = scheduled.filter((w) => w.completedMi >= (w.scheduledMi as number) * VOLUME_ABSORBED_SHARE);
    console.log(`\nVOLUME   · ${absorbed.length}/${VOLUME_PROGRESS_MIN_ABSORBED_WEEKS} weeks absorbed `
      + `at ${(VOLUME_ABSORBED_SHARE * 100).toFixed(0)}% of schedule`);
    for (const w of input.load.recentWeeks) {
      const share = w.scheduledMi ? (w.completedMi / w.scheduledMi * 100).toFixed(0) : '-';
      console.log(`             week of ${w.weekStartISO}: completed ${pad(String(w.completedMi), 6)} `
        + `scheduled ${pad(String(w.scheduledMi ?? 'none'), 6)} (${share}%)`);
    }

    console.log(`\nDURATION · ${input.longRun.recent.length} long run(s) in the window`);
    for (const l of input.longRun.recent) {
      console.log(`             ${l.dateISO} ${l.distanceMi.toFixed(1)} mi `
        + `durability=${pad(String(l.durabilityEvidence), 5)} `
        + `collapse=${pad(String(l.lateRunPacingCollapse), 6)} control=${l.executionQuality}`);
    }

    console.log(`\nDENSITY  · ${input.density.resolutions.length} progression resolution(s) `
      + `· gate state: ${input.density.gate}`);
    for (const r of input.density.resolutions) {
      console.log(`             ${r.dateISO} ${r.family} → ${r.action} `
        + `${r.shape.reps}x${r.shape.repMinutes}min/${r.shape.recoveryMinutes}min changed=${r.changed}`);
    }

    console.log(`\nSCHEDULE · ${input.schedule.sessionsOutOfPlace} session(s) out of place, `
      + `${input.schedule.clearSlotsAvailable} clear slot(s)`);

    /* ── 4 · WHAT THE ENGINE WOULD PROPOSE ─────────────────────────────────── */
    console.log('\n── PROPOSALS (ranked) ───────────────────────────────────────────');
    for (const p of proposals.proposals) {
      console.log(`  ${pad(p.decision, 12)} ${pad(p.target, 12)} ${pad(p.domain, 9)} `
        + `conf ${p.confidence.toFixed(2)}`);
      console.log(`      ${JSON.stringify(p.previous)} → ${JSON.stringify(p.proposed)}`);
      console.log(`      reasons: ${p.reasonCodes.join(', ')}`);
      console.log(`      "${p.explanation}"`);
      if (p.target === 'PACE') {
        console.log('      phase breakdown (Part 1 of the 2026-09-01 decision):');
        for (const b of p.phaseBreakdown) {
          console.log(`        ${pad(b.phaseLabel ?? '(unphased)', 14)} `
            + `${pace(b.previousSecPerMi)} → ${pace(b.proposedSecPerMi)} `
            + `(step ${b.stepSecPerMi.toFixed(1)}s, ${b.rowCount} row(s)) `
            + `${b.moved ? 'MOVED' : 'held'}`);
        }
      }
      for (const w of p.whyNot) console.log(`      why-not ${w.lever}: ${w.detail}`);
    }
    if (proposals.deferred.length > 0) {
      console.log('\n  DEFERRED (earned, but another lever is this cycle\'s primary stressor):');
      for (const d of proposals.deferred) {
        console.log(`    ${pad(d.decision, 10)} ${pad(d.target, 12)} `
          + `${JSON.stringify(d.previous)} → ${JSON.stringify(d.proposed)}`);
      }
    }
    if (proposals.refusals.length > 0) {
      console.log('\n  REFUSALS:');
      for (const r of proposals.refusals) console.log(`    ${r.lever} ${r.code} — ${r.detail}`);
    }

    /* ── 5 · WHAT THE SHIPPED DETECTORS SAY, FOR THE SAME RUNNER ───────────── */
    console.log('\n── THE SHIPPED ENGINE, SAME INSTANT (lib/plan/adapt.ts) ─────────');
    try {
      const { detectAdaptations } = await import('@/lib/plan/adapt');
      const live = await detectAdaptations(OWNER);
      console.log(`  triggers: ${live.triggers.length === 0 ? 'none' : ''}`);
      for (const t of live.triggers) {
        console.log(`    ${pad(t.kind, 24)} ${pad(t.severity, 9)} ${t.reason}`);
      }
      console.log(`  actions: ${live.actions.length === 0 ? 'none' : ''}`);
      for (const a of live.actions) {
        console.log(`    ${pad(a.kind, 18)} from ${pad(a.sourceTrigger ?? '-', 22)} ${a.why}`);
      }

      /* ── 6 · THE DISAGREEMENT, STATED PLAINLY ────────────────────────────── */
      console.log('\n── DISAGREEMENT ─────────────────────────────────────────────────');
      const newUpward = proposals.proposals.filter((p) => p.decision === 'PROGRESS').length
        + proposals.deferred.length;
      const liveUpward = live.actions.filter((a) => a.kind === 'mark_upgrade').length;
      console.log(`  upward · new engine ${newUpward} proposal(s) · shipped engine ${liveUpward} action(s)`);
      const newDown = proposals.proposals.filter((p) => p.decision === 'REDUCE').length;
      const liveDown = live.actions.filter((a) => a.kind === 'downgrade' || a.kind === 'shave').length;
      console.log(`  downward · new engine ${newDown} · shipped engine ${liveDown}`);
      console.log(`  the new engine also emits ${proposals.proposals.filter((p) => p.decision === 'HOLD').length} `
        + 'explicit HOLD(s); the shipped engine has no way to express one.');
    } catch (err) {
      console.log(`  could not run the shipped detectors read-only: ${err instanceof Error ? err.message : String(err)}`);
    }

    /* ── 7 · THE ONLY ASSERTIONS · properties that are defects either way ──── */
    expect(contradictionsIn(proposals)).toEqual([]);
    expect(proposals.proposals.filter((p) => p.decision === 'PROGRESS').length)
      .toBeLessThanOrEqual(1);
    for (const p of [...proposals.proposals, ...proposals.deferred]) {
      expect(p.reasonCodes.length).toBeGreaterThan(0);
      expect(p.explanation.length).toBeGreaterThan(0);
      expect(p.explanation).not.toMatch(/[—!]/);
    }
    // The engine must always say SOMETHING for a readable runner. Silence is the
    // failure mode this whole layer exists to remove.
    expect(proposals.proposals.length).toBeGreaterThan(0);

    console.log('\n═════════════════════════════════════════════════════════════════\n');
  }, 180_000);

  /**
   * THE RULE 21 TEST PROPER · is the bar a bar, or a wall?
   *
   * CLAUDE.md: "compute what the runner would have had to DO to trigger it,
   * then check whether any week they have actually run would have. If none
   * could, the bar is not a bar, it is a wall."
   *
   * Today's answer being zero is not by itself a finding — a runner can simply
   * not have earned anything today. What WOULD be a finding is a bar no week of
   * this runner's real season could ever have cleared. So this walks his actual
   * history, slides the engine's own windows across it, and reports how many
   * days each upward bar was clearable on.
   *
   * It reads real activities and the real plan. It asserts only LIVENESS — that
   * the probe actually looked at something — because the count itself is a
   * finding for a human, not a pass/fail.
   */
  it('walks the real season and reports how often each upward bar was clearable', async () => {
    process.env.DATABASE_URL = RO;

    const { classifyRecentActivities } = await import('@/lib/evidence/load-activity-evidence');
    const { sessionDemonstratesControl, PACE_PROGRESS_MIN_SESSIONS,
      VOLUME_PROGRESS_MIN_ABSORBED_WEEKS, VOLUME_ABSORBED_SHARE } = await import('./adaptation-engine');
    const { qualitySessionFrom, longRunFrom, ADAPTATION_EVIDENCE_WINDOW_DAYS } =
      await import('./load-adaptation-engine');
    const { mileageByDay } = await import('@/lib/runs/volume');
    const { pool } = await import('@/lib/db/pool');

    const SEASON_START = '2026-01-01';
    const classified = await classifyRecentActivities(OWNER, SEASON_START, TODAY);

    console.log('\n══ RULE 21 · IS THE BAR A BAR, OR A WALL? ═══════════════════════');
    console.log(`walking ${classified.length} classified activities, ${SEASON_START} → ${TODAY}`);
    // LIVENESS (Rule 18 guard 2): a probe that read nothing would report a
    // perfectly clean zero, which is the worst outcome available.
    expect(classified.length).toBeGreaterThan(20);

    const quality = classified
      .map(qualitySessionFrom)
      .filter((s): s is NonNullable<typeof s> => s != null);
    const controlled = quality.filter(sessionDemonstratesControl);
    console.log(`  quality-evidence activities: ${quality.length} `
      + `· of which CONTROLLED: ${controlled.length}`);

    /* ── PACE · was there ever a 28-day window with enough controlled work? ── */
    const days: string[] = [];
    for (let d = SEASON_START; d <= TODAY;
      d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) {
      days.push(d);
    }
    let paceClearableDays = 0;
    let bestPaceWindow = 0;
    for (const d of days) {
      const from = new Date(Date.parse(`${d}T00:00:00Z`) - ADAPTATION_EVIDENCE_WINDOW_DAYS * 86_400_000)
        .toISOString().slice(0, 10);
      const inWindow = controlled.filter((s) => s.dateISO > from && s.dateISO <= d).length;
      bestPaceWindow = Math.max(bestPaceWindow, inWindow);
      if (inWindow >= PACE_PROGRESS_MIN_SESSIONS) paceClearableDays += 1;
    }
    console.log(`\n  PACE · ${PACE_PROGRESS_MIN_SESSIONS} controlled sessions in `
      + `${ADAPTATION_EVIDENCE_WINDOW_DAYS} days`);
    console.log(`    clearable on ${paceClearableDays}/${days.length} days of the season `
      + `· best window held ${bestPaceWindow} controlled sessions`);
    console.log(`    VERDICT: ${paceClearableDays > 0
      ? 'A BAR. His own training has cleared it.'
      : 'A WALL on this history. Nothing he ran would ever have triggered it.'}`);

    /* ── DURATION · was a tolerated long run ever available? ──────────────── */
    const longs = classified
      .map((c) => longRunFrom(c, 10))
      .filter((l): l is NonNullable<typeof l> => l != null);
    const toleratedLongs = longs.filter(
      (l) => l.durabilityEvidence && l.lateRunPacingCollapse !== true && l.executionQuality !== 'variable',
    );
    console.log(`\n  DURATION · a long run (10+ mi) finishing under control`);
    console.log(`    ${longs.length} long run(s) in the season · ${toleratedLongs.length} tolerated`);
    console.log(`    VERDICT: ${toleratedLongs.length > 0
      ? 'A BAR. His own long runs have cleared it.'
      : 'A WALL on this history.'}`);

    /* ── VOLUME · were there ever consecutive absorbed weeks? ─────────────── */
    // RULE 14, AND I BROKE IT HERE FIRST. The initial version of this probe
    // joined `plan_workouts` on `user_uuid` alone, which reads every plan
    // version the owner has ever had — 47 of them — so `scheduled` was the sum
    // across all archived copies of the same week and NO week could ever come
    // in at 90% of it. The probe reported "0/16 weeks absorbed · A WALL", which
    // was a defect in the verification query, not in the engine. That is
    // precisely the failure CLAUDE.md warns about: "a verification query that
    // reuses the reader's filter reproduces the bug instead of revealing it."
    const planRows = (await pool.query<{ date_iso: string; distance_mi: string | number | null }>(
      `SELECT pw.date_iso, pw.distance_mi
         FROM plan_workouts pw
         JOIN training_plans tp ON tp.id = pw.plan_id
        WHERE tp.user_uuid = $1::uuid
          AND tp.archived_iso IS NULL
          AND pw.date_iso BETWEEN $2 AND $3`,
      [OWNER, SEASON_START, TODAY],
    )).rows;
    const scheduledByDay = new Map<string, number>();
    for (const r of planRows) {
      scheduledByDay.set(r.date_iso, (scheduledByDay.get(r.date_iso) ?? 0) + Number(r.distance_mi ?? 0));
    }
    const completedByDay = await mileageByDay(OWNER, SEASON_START, TODAY);

    let absorbedWeeks = 0;
    let scheduledWeeks = 0;
    let bestRun = 0;
    let currentRun = 0;
    for (let w = 0; w * 7 + 7 <= days.length; w += 1) {
      const slice = days.slice(w * 7, w * 7 + 7);
      let completed = 0;
      let scheduled = 0;
      let anyScheduled = false;
      for (const d of slice) {
        completed += completedByDay.get(d)?.mi ?? 0;
        const s = scheduledByDay.get(d);
        if (s != null) { scheduled += s; anyScheduled = true; }
      }
      if (!anyScheduled || scheduled <= 0) { currentRun = 0; continue; }
      scheduledWeeks += 1;
      if (completed >= scheduled * VOLUME_ABSORBED_SHARE) {
        absorbedWeeks += 1;
        currentRun += 1;
        bestRun = Math.max(bestRun, currentRun);
      } else {
        currentRun = 0;
      }
    }
    console.log(`\n  VOLUME · ${VOLUME_PROGRESS_MIN_ABSORBED_WEEKS} weeks at `
      + `${(VOLUME_ABSORBED_SHARE * 100).toFixed(0)}% of schedule`);
    console.log(`    ${absorbedWeeks}/${scheduledWeeks} scheduled weeks were absorbed `
      + `· longest consecutive run: ${bestRun}`);
    // THREE OUTCOMES, NOT TWO (Rule 11 applied to the probe itself). "The bar
    // was never cleared" and "there were never enough scheduled weeks for it to
    // be clearable" are opposite facts, and collapsing them into one verdict is
    // how a young plan gets misreported as a structural wall.
    const verdict = bestRun >= VOLUME_PROGRESS_MIN_ABSORBED_WEEKS
      ? 'A BAR. His own season has cleared it.'
      : scheduledWeeks < VOLUME_PROGRESS_MIN_ABSORBED_WEEKS
        ? `NOT YET ANSWERABLE. Only ${scheduledWeeks} completed week(s) have ever carried a `
          + `schedule at all (the active plan starts 2026-08-24), so the bar has not had the `
          + `chance to be cleared. Of those, ${absorbedWeeks} were absorbed — the rate is `
          + `${scheduledWeeks > 0 ? Math.round(absorbedWeeks / scheduledWeeks * 100) : 0}%.`
        : 'A WALL on this history. Scheduled weeks existed and none was absorbed.';
    console.log(`    VERDICT: ${verdict}`);

    console.log('\n═════════════════════════════════════════════════════════════════\n');
  }, 300_000);
});
