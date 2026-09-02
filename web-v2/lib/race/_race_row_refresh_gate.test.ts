/**
 * _race_row_refresh_gate.test.ts · RACE-ROW-STALENESS · a race row is never
 * permanently exempt from the brain.
 *
 * THE DEFECT: `recompute-paces.ts` listed `race` in RECOMPUTE_EXEMPT_TYPES and
 * nothing else ever repriced a race row, so the owner's CIM row froze at
 * 7:16/mi (authored) while every marathon-pace rehearsal in the same block
 * moved to 7:55/mi with the evidence. Sealed rows are never touched; every
 * future race row follows `RaceOutlook.execution` through the dedicated path.
 *
 * What this gate cannot fail on (Rule 22): a refresh that runs and writes the
 * wrong number (the contract test owns the number), and a caller that is
 * wired but never scheduled (Rule 23; the cron ledger owns that).
 *
 * Falsified 2026-09-01 (docs/reports/p0-coaching-loop-completion-handback-
 * 2026-09-01/falsification/): removing the refresh call from recompute-paces
 * fails test 1; restoring `hr_cap_bpm: lthr` on the race branch fails test 3;
 * dropping the `- 'hr_cap_bpm'` merge fails test 4.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { raceExecutionSpecFields } from './race-row-refresh';
import { composeRaceOutlook } from './race-outlook';
import { fixtureReads, fixtureRace } from './_race_outlook_fixture';

const ROOT = path.resolve(__dirname, '..', '..');
const code = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

describe('RACE-ROW-STALENESS · every path that reprices a plan reprices its race rows', () => {
  it('1 · recompute-paces calls the dedicated race-row path inside its transaction', () => {
    const s = code('lib/plan/recompute-paces.ts');
    expect(s).toMatch(/refreshRaceRowsForPlan\(planId,\s*\{\s*client:\s*tx/);
  });
  it('2 · the daily snapshot cron and authoring persist call it too', () => {
    expect(code('app/api/cron/snapshot-projections/route.ts')).toMatch(/refreshRaceRowsForPlan\(/);
    expect(code('lib/plan/generate.ts')).toMatch(/refreshRaceRowsForPlan\(planId,\s*\{\s*client,\s*todayISO/);
  });
  it('3 · the authoring-time race branch writes no HR cap for the wrist to alarm on', () => {
    const s = code('lib/plan/spec-builder.ts');
    const raceBranch = s.slice(s.indexOf("case 'race': {"), s.indexOf("case 'shakeout':"));
    expect(raceBranch).toMatch(/hr_cap_bpm:\s*null/);
    expect(raceBranch).not.toMatch(/hr_cap_bpm:\s*lthr/);
  });
  it('4 · the refresh merges field-level and DROPS hr_cap_bpm (Rule 6)', () => {
    const s = code('lib/race/race-row-refresh.ts');
    expect(s).toMatch(/workout_spec = \(COALESCE\(workout_spec, '\{\}'::jsonb\) - 'hr_cap_bpm'\) \|\| \$3::jsonb/);
    expect(s).toMatch(/AND \$\{runNotMergedSql\('r'\)\}/); // sealed = a canonical run exists that day
    // and a sealed or past row is skipped before anything is resolved for it
    expect(s).toMatch(/if \(row\.sealed \|\| row\.date_iso < today\)/);
  });
  it('5 · the fields the refresh writes are the brain\'s, by name', async () => {
    const o = await composeRaceOutlook(fixtureRace(), '2026-09-01', fixtureReads());
    const f = raceExecutionSpecFields(o) as Record<string, unknown>;
    expect(f).not.toHaveProperty('hr_cap_bpm');
    expect(f.pace_target_s_per_mi_lo).toBe(o.execution.paceSecPerMi! - 5);
    expect(f.pace_target_s_per_mi_hi).toBe(o.execution.paceSecPerMi! + 5);
    const x = f.race_execution as Record<string, unknown>;
    expect(x.target_sec).toBe(o.execution.targetSec);
    expect(x.expected_race_day_sec).toBe(o.expectedRaceDay.expectedSec);
    expect(x.stated_goal_sec).toBe(o.statedGoal.sec);
    expect(x.training_pace_s_per_mi).toBe(o.trainingPrescription.paceSecPerMi);
    const hr = f.race_hr as Record<string, unknown>;
    expect(hr.informational_only).toBe(true);
    expect(hr.expected_range_bpm).toEqual(o.execution.hr!.expectedRangeBpm);
  });
});

describe('2026-09-02 · staleness is reported and a material change is recorded, never slipped in', () => {
  it('the outlook says how old its newest evidence is, and does not refuse because of it', async () => {
    const o = await composeRaceOutlook(fixtureRace(), '2026-09-01', fixtureReads());
    expect(o.staleness.staleAfterDays).toBeGreaterThan(0);
    expect(o.staleness).toHaveProperty('stale');
    // Stale or not, a target is still produced — a stale belief and no belief
    // are different facts (Rule 11).
    expect(o.execution.targetSec).not.toBeNull();
  });
  it('a target that moves past the meaningful threshold carries its previous value and says so', async () => {
    const o = await composeRaceOutlook(fixtureRace(), '2026-09-01', fixtureReads());
    const target = o.execution.targetSec!;
    const moved = raceExecutionSpecFields(o, { target_sec: target + 400 }).race_execution as Record<string, unknown>;
    expect(moved.material_change).toBe(true);
    expect(moved.previous_target_sec).toBe(target + 400);
    const noise = raceExecutionSpecFields(o, { target_sec: target + 5 }).race_execution as Record<string, unknown>;
    expect(noise.material_change).toBe(false);
    const first = raceExecutionSpecFields(o, null).race_execution as Record<string, unknown>;
    expect(first.material_change).toBe(false);
    expect(first.previous_target_sec).toBeNull();
  });
  it('the threshold is the SAME one the projection-changed notification uses (one runner, one number)', () => {
    const src = code('lib/race/race-row-refresh.ts');
    expect(src).toMatch(/MEANINGFUL_MOVE_SEC/);
    expect(src).not.toMatch(/material_change[\s\S]{0,120}>=\s*\d+\s*[;,)]/);
  });
});
