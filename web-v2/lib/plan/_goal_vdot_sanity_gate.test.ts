/**
 * _goal_vdot_sanity_gate.test.ts · GOAL-SANITY-NAME-1 (2026-09-02)
 *
 * THE RULE THIS ENFORCES. A boolean may not carry a name that promises more
 * than its predicate delivers, and it may not become a second answer to a
 * question the Constitution has already assigned an owner.
 *
 * THE INCIDENT. `authored_state.goal_realism.flag` read `false` on the owner's
 * live CIM block while Goal Feasibility's canonical owner
 * (`lib/race/race-outlook.ts` §7, Constitution §L) read `unlikely_currently`
 * against a 19:42 gap, at the same instant, for the same runner. Both were
 * arithmetically correct against their own inputs. The name was the defect:
 * "goal realism = false" reads as "the goal is realistic", and the predicate
 * only ever asked whether the typed goal sat inside a fixed 15% VDOT band
 * around demonstrated threshold capacity. His ruling: rename it.
 *
 * WHAT THIS GATE CANNOT FAIL ON (Rule 22 · declare the blind spots):
 *
 *   · It cannot tell whether 1.15 is the RIGHT band. It only holds that the
 *     band is wider than the largest block gain the engine models, which is
 *     what makes "inside the band" un-readable as "reachable". A band of 1.02
 *     would pass every assertion here.
 *   · It cannot see a RENDERED surface. It scans source for the old
 *     identifiers and for goal mutation; a native screen that decodes
 *     `beyondSanityBand` and prints "your goal is realistic" would pass. Rule
 *     13 verification is the only thing that catches that, and there is no
 *     consumer today (guard 4 holds that there is none).
 *   · It cannot detect a NEW third owner of feasibility invented under a name
 *     it does not know. `docs/BRAIN_CONSTITUTION.md` §L review is what catches
 *     that; two producers besides the canonical owner are already recorded in
 *     `docs/reports/complete-coaching-brain-handback-2026-09-02/`.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { assessGoalVdotSanity, GOAL_VDOT_SANITY_BAND, goalVdotSanityFromLegacyRecord } from './goal-vdot-sanity';
import { predictRaceTime, vdotFromRace } from '../training/vdot';
import { MAX_BLOCK_GAIN_VDOT } from '../training/vdot-gain-rate';

const ROOT = path.resolve(__dirname, '../..');
const SCAN_DIRS = ['lib', 'app', 'components', 'scripts'];

/**
 * Files permitted to mention the retired identifiers, each with an argued
 * reason. RATCHET · it may shrink, never grow, and an entry whose target no
 * longer mentions them fails until deleted (guard 1b).
 */
const LEGACY_NAME_ALLOWLIST: Record<string, string> = {
  'lib/plan/goal-vdot-sanity.ts':
    'the resolver that replaced it · its header explains the rename and it reads the legacy shape forward',
  'lib/plan/_goal_vdot_sanity_gate.test.ts':
    'this gate · it must name what it forbids',
  'lib/plan/generate.ts':
    'authoring · the comment recording why the key was renamed, beside the new write',
  'lib/plan/_coldstart_doctrine.test.ts':
    'the cold-start incident narrative quotes the value as it was recorded in 2026-08',
  'app/api/coach/read/route.ts':
    'reads authored_state->goal_realism as the BACK-COMPAT fallback for plans authored before 2026-09-02 · '
    + 'delete this entry once no unarchived training_plans row carries the old key',
};

function walk(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.next' || e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(full);
  }
  return out;
}

const FILES = SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d)));

describe('GOAL-SANITY-NAME-1 · the sanity screen is named for its predicate', () => {
  it('LIVENESS · the scanner actually read files', () => {
    // Rule 18 · a gate that reports clean because it looked at nothing is the
    // worst available outcome, because it also reports confidence.
    expect(FILES.length).toBeGreaterThan(500);
  });

  it('guard 1 · no source outside the argued allowlist mentions goal_realism / goalRealism', () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      const rel = path.relative(ROOT, f);
      if (LEGACY_NAME_ALLOWLIST[rel]) continue;
      const src = fs.readFileSync(f, 'utf8');
      if (/goal_realism|goalRealism/.test(src)) offenders.push(rel);
    }
    expect(offenders, `retired identifier still present in:\n  ${offenders.join('\n  ')}`).toEqual([]);
  });

  it('guard 1b · every allowlist entry is still needed (ratchet)', () => {
    const stale: string[] = [];
    for (const rel of Object.keys(LEGACY_NAME_ALLOWLIST)) {
      const full = path.join(ROOT, rel);
      if (!fs.existsSync(full)) { stale.push(`${rel} (file gone)`); continue; }
      if (!/goal_realism|goalRealism/.test(fs.readFileSync(full, 'utf8'))) stale.push(`${rel} (now clean)`);
    }
    expect(stale, `delete these allowlist entries:\n  ${stale.join('\n  ')}`).toEqual([]);
  });

  it('guard 2 · the persisted struct carries no field named for a verdict it cannot reach', () => {
    const s = assessGoalVdotSanity({
      goalSec: 10800, raceDistanceMi: 26.2188, currentVdot: 47.8, anchorSource: 'measured_vdot',
    });
    for (const banned of ['flag', 'realistic', 'realism', 'feasible', 'feasibility', 'achievable']) {
      expect(Object.prototype.hasOwnProperty.call(s, banned), `field "${banned}" is back`).toBe(false);
    }
    expect(Object.prototype.hasOwnProperty.call(s, 'beyondSanityBand')).toBe(true);
  });

  it('guard 3 · the band is WIDER than the largest gain the engine models, so "inside" cannot mean "reachable"', () => {
    // THE LOAD-BEARING ASSERTION. Both sides are read out of the engine at run
    // time (Rule 18 · never hardcode both sides). If the band ever tolerated
    // LESS ambition than a full build can deliver, "inside the band" would
    // start to carry a reachability meaning and the name would need revisiting.
    const anchor = 47.8; // the owner's canonical threshold capacity, 2026-09-02
    const toleratedGain = anchor * GOAL_VDOT_SANITY_BAND - anchor;
    expect(toleratedGain).toBeGreaterThan(MAX_BLOCK_GAIN_VDOT);

    // And the concrete consequence, in the unit the runner reads: at the band
    // edge, the goal is this far from what current fitness predicts.
    const goalVdot = vdotFromRace(10800, 26.2188)!;
    const edgeAnchor = goalVdot / GOAL_VDOT_SANITY_BAND;
    const goalSec = 10800;
    const edgePredictedSec = predictRaceTime(edgeAnchor, 26.2188)!;
    const toleratedGapSec = edgePredictedSec - goalSec;
    // Over twenty minutes of marathon. A boolean that tolerates that much and
    // is named "realism" is the defect this gate exists for.
    expect(toleratedGapSec).toBeGreaterThan(20 * 60);
  });

  it('guard 4 · nothing writes a goal from the sanity screen', () => {
    // The standing app-wide rule: the coach projects, it never renegotiates a
    // stated goal. Any file that both reads the screen and writes a goal field
    // is a candidate violation and must be read by a human.
    const readsScreen = /goal_vdot_sanity|goalVdotSanity|beyondSanityBand|assessGoalVdotSanity/;
    const writesGoal = /UPDATE\s+races[\s\S]{0,400}goal_sec|goal_sec\s*=\s*\$|setGoalSec|PATCH[\s\S]{0,80}goal/i;
    const offenders: string[] = [];
    let goalWriters = 0;
    let screenReaders = 0;
    for (const f of FILES) {
      const rel = path.relative(ROOT, f);
      if (rel === 'lib/plan/_goal_vdot_sanity_gate.test.ts') continue; // this file quotes both patterns
      const src = fs.readFileSync(f, 'utf8');
      const reads = readsScreen.test(src);
      const writes = writesGoal.test(src);
      if (writes) goalWriters++;
      if (reads) screenReaders++;
      if (reads && writes) offenders.push(rel);
    }
    // Rule 18 · both halves of the conjunction must be able to match, or the
    // guard is vacuously true and reports confidence about nothing.
    expect(goalWriters, 'the goal-write pattern matches nothing · guard 4 is vacuous').toBeGreaterThan(0);
    expect(screenReaders, 'the sanity-screen pattern matches nothing · guard 4 is vacuous').toBeGreaterThan(0);
    expect(offenders, `these read the sanity screen AND write a goal:\n  ${offenders.join('\n  ')}`).toEqual([]);
  });

  it('guard 5 · Rule 11 · goalVdot and anchorVdot are always present, null only when genuinely absent', () => {
    const provisional = assessGoalVdotSanity({
      goalSec: 10800, raceDistanceMi: 26.2188, currentVdot: null, anchorSource: 'provisional_mileage',
    });
    expect(provisional.assessable).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(provisional, 'goalVdot')).toBe(true);
    expect(provisional.goalVdot).toBe(53.5);          // computed, and RECORDED
    expect(provisional.anchorVdot).toBeNull();        // genuinely absent

    // The predecessor dropped goalVdot on the not-beyond branch while having
    // computed it. That is the exact collapse Rule 11 forbids.
    const inside = assessGoalVdotSanity({
      goalSec: 10800, raceDistanceMi: 26.2188, currentVdot: 47.8, anchorSource: 'measured_vdot',
    });
    expect(inside.beyondSanityBand).toBe(false);
    expect(inside.goalVdot).toBe(53.5);
    expect(inside.anchorVdot).toBe(47.8);
  });

  it('guard 6 · the predicate is the band, and the arithmetic is monotone across it', () => {
    const at = (v: number) => assessGoalVdotSanity({
      goalSec: 10800, raceDistanceMi: 26.2188, currentVdot: v, anchorSource: 'measured_vdot',
    });
    // The owner's own values, both sides of the transition, read out here so a
    // future change to the band or the table shows up as a failure.
    expect(at(44.1).beyondSanityBand).toBe(true);
    expect(at(47.8).beyondSanityBand).toBe(false);
    // Rule 9 · the published continuous quantity moves monotonically and
    // changes sign exactly where the boolean does.
    let prev = Infinity;
    for (let v = 40; v <= 55; v += 0.1) {
      const s = at(Math.round(v * 10) / 10);
      expect(s.bandExcessVdot).not.toBeNull();
      expect(s.bandExcessVdot!).toBeLessThanOrEqual(prev + 1e-9);
      expect(s.beyondSanityBand).toBe(s.bandExcessVdot! > 0);
      prev = s.bandExcessVdot!;
    }
  });

  it('guard 7 · off-the-top goals stay flagged (GOAL-3 direction awareness survives)', () => {
    // A 1:30 marathon is off the top of the Daniels table, so goalVdot is null.
    // Reading that as "inside the band" would invert the screen for exactly the
    // inputs it exists to catch.
    const absurd = assessGoalVdotSanity({
      goalSec: 5400, raceDistanceMi: 26.2188, currentVdot: 47.8, anchorSource: 'measured_vdot',
    });
    expect(absurd.goalVdot).toBeNull();
    expect(absurd.beyondSanityBand).toBe(true);

    // Off the BOTTOM (a deliberately slow goal) is not beyond anything.
    const easy = assessGoalVdotSanity({
      goalSec: 6 * 3600, raceDistanceMi: 26.2188, currentVdot: 47.8, anchorSource: 'measured_vdot',
    });
    expect(easy.beyondSanityBand).toBe(false);
  });

  it('guard 8 · the legacy record reads forward without inventing a verdict', () => {
    // The owner's live row, verbatim, as authored 2026-08-31.
    const legacy = goalVdotSanityFromLegacyRecord({
      flag: true, basis: 'measured_vdot', goalVdot: 53.5, assessable: true, estimatedCurrentVdot: 44.1,
    })!;
    expect(legacy.beyondSanityBand).toBe(true);
    expect(legacy.anchorVdot).toBe(44.1);
    expect(legacy.goalVdot).toBe(53.5);

    // A not-assessable legacy row must never read as a negative verdict.
    const cold = goalVdotSanityFromLegacyRecord({ flag: false, assessable: false, basis: 'provisional_mileage' })!;
    expect(cold.assessable).toBe(false);
    expect(cold.anchorVdot).toBeNull();

    // A record with no `assessable` key at all is "cannot say", not a default.
    expect(goalVdotSanityFromLegacyRecord({ flag: false })).toBeNull();
    expect(goalVdotSanityFromLegacyRecord(null)).toBeNull();
  });
});
