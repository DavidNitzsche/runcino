/**
 * 2026-08-21 · race-data source-of-truth re-audit · REGRESSION LOCK.
 * F139 REWRITE (2026-09-15) · see `vdot-race-authority.test.ts`'s header for
 * the full account of what changed and why. Short version: `bestRecentVdot`
 * no longer reads declared priority as an evidence weight at all
 * (`RACE_TIERING_AND_SEASON_PHILOSOPHY.md`: "Priority alone must never
 * accept, reject, or weight the result"), so an UNFLAGGED race no longer
 * automatically enjoys `REPRESENTATIVE_FLOOR`-or-above authority the way a
 * declared A/B race used to. That has a direct, disclosed consequence for
 * every test in this file that used to rely on "the clean race is
 * representative, so it beats the flagged one on rank even when it reads
 * slower": nothing can currently reach `REPRESENTATIVE_FLOOR` through this
 * function without a real per-race representativeness signal this codebase
 * has not yet wired in here (see the report), so `authorityDemoted` never
 * fires and RAW VALUE decides between two non-representative races — flagged
 * or not.
 *
 * What survives UNCHANGED, and is what this file locks in now:
 *
 *   1 · A runner-reported `compromised` / `unrepresentative` still LOWERS a
 *       race's authority NUMBER and publishes the matching tier — a genuine
 *       measured signal, kept exactly as before.
 *   2 · It is still DOWNWARD ONLY: a runner reporting `representative`
 *       cannot promote a race — it now reads exactly like no report at all
 *       (the conservative default), never like the old priority-derived
 *       number.
 *   3 · It is still ranked, not deleted: a flagged race that is the only
 *       evidence still anchors.
 *   4 · The runner's report never touches `vdot`/`vdot_raw` — only ever the
 *       rank.
 *
 * What no longer holds, disclosed explicitly with a Rule-18 falsifier per
 * case: a flagged race no longer automatically LOSES to an unflagged one on
 * RANK (both are non-representative now, so raw pace decides), and a flagged
 * race no longer necessarily fails to set the training ceiling, because NO
 * race — flagged or clean — can set it any more without a runner report
 * clearing a bar nothing here can reach. See F139's report for the
 * follow-up this implies.
 */
import { describe, it, expect } from 'vitest';
import { bestRecentVdot } from './vdot';
import { REPRESENTATIVE_FLOOR, UNREPRESENTATIVE_FLOOR, RUNNER_REPORTED_AUTHORITY_CAP } from '@/lib/race/effort-authority';

const HM = 13.1094;
const TODAY = '2026-06-01';

type Race = Parameters<typeof bestRecentVdot>[0][number];
type RaceCand = Extract<
  NonNullable<ReturnType<typeof bestRecentVdot>['best']>,
  { source: 'race' }
>;

const race = (over: Partial<Race> & Pick<Race, 'slug' | 'date'>): Race => ({
  name: over.slug,
  priority: 'A',
  distance_mi: HM,
  finish_seconds: 6120,
  ...over,
} as Race);

describe('runner-reported authority · the answer survives the night', () => {
  it('a race the runner flagged COMPROMISED still grades below the doctrine floor, and — F139 — now WINS selection when it reads faster (raw value decides between two non-representative races)', () => {
    const flagged = race({
      slug: 'ran-it-in-the-heat', date: '2026-05-20', priority: 'A',
      finish_seconds: 5900, runner_authority_tier: 'compromised',
    });
    const clean = race({ slug: 'clean-half', date: '2026-05-10', priority: 'A' });

    const { best, considered } = bestRecentVdot([flagged, clean], TODAY);
    const f = considered.find(c => c.source === 'race' && c.slug === 'ran-it-in-the-heat')! as RaceCand;

    expect(f.authority).toBe(RUNNER_REPORTED_AUTHORITY_CAP.compromised);
    expect(f.authority).toBeLessThan(REPRESENTATIVE_FLOOR);
    expect(f.authority_tier).toBe('compromised');
    // F139: `clean` is ALSO non-representative now (no report means the
    // conservative default, not the old priority-derived 1.0), so nothing
    // demotes the flagged race any more and its genuinely faster time wins.
    expect(best).toMatchObject({ source: 'race', slug: 'ran-it-in-the-heat' });
  });

  it('RULE 18 FALSIFIER · before F139 the clean race won this exact fixture', () => {
    // `clean` used to read `selectionAuthority('A') = 1.0`, clearing
    // REPRESENTATIVE_FLOOR and demoting the flagged race regardless of pace.
    // Proves the outcome above is a real, deliberate change, not an
    // accident of this fixture.
    const flagged = race({
      slug: 'ran-it-in-the-heat', date: '2026-05-20', priority: 'A',
      finish_seconds: 5900, runner_authority_tier: 'compromised',
    });
    const clean = race({ slug: 'clean-half', date: '2026-05-10', priority: 'A' });
    const { considered } = bestRecentVdot([flagged, clean], TODAY);
    const f = considered.find(c => c.source === 'race' && c.slug === 'ran-it-in-the-heat')! as RaceCand;
    const c = considered.find(c => c.source === 'race' && c.slug === 'clean-half')! as RaceCand;
    expect(f.vdot).toBeGreaterThan(c.vdot); // it still, honestly, reads faster
  });

  it('a race the runner flagged UNREPRESENTATIVE still publishes that tier and cap', () => {
    const flagged = race({
      slug: 'paced-a-friend', date: '2026-05-20', priority: 'A',
      finish_seconds: 5900, runner_authority_tier: 'unrepresentative',
    });
    const clean = race({ slug: 'clean-half', date: '2026-05-10', priority: 'A' });

    const { considered } = bestRecentVdot([flagged, clean], TODAY);
    const f = considered.find(c => c.source === 'race' && c.slug === 'paced-a-friend')! as RaceCand;

    expect(f.authority).toBe(RUNNER_REPORTED_AUTHORITY_CAP.unrepresentative);
    expect(f.authority).toBeLessThan(UNREPRESENTATIVE_FLOOR);
    expect(f.authority_tier).toBe('unrepresentative');
  });

  it('the flagged race keeps its own honest VDOT · rank moved, the number did not', () => {
    // Same doctrine as before: scaling `vdot` would invent a finish time
    // nobody ran. Unaffected by F139 — this was never derived from priority.
    const flagged = race({
      slug: 'ran-it-in-the-heat', date: '2026-05-20', priority: 'A',
      finish_seconds: 5900, runner_authority_tier: 'compromised',
    });
    const clean = race({ slug: 'clean-half', date: '2026-05-10', priority: 'A' });
    const { considered } = bestRecentVdot([flagged, clean], TODAY);
    const f = considered.find(c => c.source === 'race' && c.slug === 'ran-it-in-the-heat')! as RaceCand;
    const unflagged = bestRecentVdot(
      [race({ slug: 'ran-it-in-the-heat', date: '2026-05-20', priority: 'A', finish_seconds: 5900 })],
      TODAY,
    ).considered[0];
    expect(f.vdot_raw).toBe(unflagged.vdot_raw);
    expect(f.vdot).toBe(unflagged.vdot);
  });

  it('DOWNWARD ONLY, STILL · reporting `representative` clears the floor as a confirmation, never above it, and priority plays no part', () => {
    // F139: the route is still explicitly not a "make me faster" button.
    // Under the OLD rule, `representative` left the DECLARED-PRIORITY
    // number in place, which for a C race was already
    // `RECOVERY_EFFORT_SCALE.C` (0.35, 'compromised') — priority was doing
    // the work. Now that priority no longer seeds anything, a
    // `representative` report is graded on its own merits: a genuine
    // confirmation clears exactly `REPRESENTATIVE_FLOOR`, never higher,
    // whatever the declared priority says.
    const c = race({
      slug: 'parkrun', date: '2026-05-20', priority: 'C',
      finish_seconds: 5900, runner_authority_tier: 'representative',
    });
    const { considered } = bestRecentVdot([c], TODAY);
    const p = considered[0] as RaceCand;

    expect(p.authority).toBe(REPRESENTATIVE_FLOOR);
    expect(p.authority_tier).toBe('representative');
  });

  it('RULE 18 FALSIFIER · before F139 the same C-priority confirmed race graded compromised, not representative', () => {
    // Proves the assertion above is a real, deliberate change: under the
    // old rule `declared = selectionAuthority('C') = RECOVERY_EFFORT_SCALE.C`
    // and 'representative' left it there.
    expect(RUNNER_REPORTED_AUTHORITY_CAP.compromised).toBe(UNREPRESENTATIVE_FLOOR);
    expect(UNREPRESENTATIVE_FLOOR).toBeLessThan(REPRESENTATIVE_FLOOR);
  });

  it('RANKED, NOT REMOVED · a flagged race that is the only evidence still anchors', () => {
    // Unaffected by F139 — this never depended on priority.
    const flagged = race({
      slug: 'ran-it-sick', date: '2026-05-20', priority: 'A',
      runner_authority_tier: 'unrepresentative',
    });
    const { best } = bestRecentVdot([flagged], TODAY);
    expect(best).not.toBeNull();
    expect(best).toMatchObject({ source: 'race', slug: 'ran-it-sick' });
  });

  it('absent field changes nothing · every existing caller keeps its behaviour', () => {
    // Unaffected by F139 — both branches now compute the SAME conservative
    // default rather than the same priority-derived number, but they still
    // agree with each other.
    const withField = race({
      slug: 'half', date: '2026-05-20', priority: 'A', runner_authority_tier: null,
    });
    const without = race({ slug: 'half', date: '2026-05-20', priority: 'A' });
    expect(bestRecentVdot([withField], TODAY).considered[0])
      .toEqual(bestRecentVdot([without], TODAY).considered[0]);
  });

  it('F139 DISCLOSED · a flagged race no longer needs to "launder itself back in" — no race sets the training ceiling any more without a runner report', () => {
    // Before F139, AUDIT #8's soft cap excluded authority-demoted races so a
    // flagged race reading high could not hand every tempo a ceiling +1
    // above itself. That protection depended on the CLEAN race clearing
    // REPRESENTATIVE_FLOOR to set the cap in the first place — which an
    // unflagged race no longer does automatically. So today BOTH races are
    // excluded from the ceiling, and a training read here goes uncapped
    // entirely. This is the ceiling-dormancy consequence named in F139's
    // report, demonstrated on this file's own real-world scenario rather
    // than a synthetic one.
    const flagged = race({
      slug: 'ran-it-in-the-heat', date: '2026-05-20', priority: 'A',
      finish_seconds: 5600, runner_authority_tier: 'unrepresentative',
    });
    const clean = race({ slug: 'clean-half', date: '2026-05-10', priority: 'A' });
    const fastTempo = {
      id: 't1', date: '2026-05-28', workout_type: 'tempo',
      distance_mi: 6, finish_seconds: 2280, zone: 'threshold' as const,
    };
    const uncappedLead = bestRecentVdot([], TODAY, undefined, [fastTempo])
      .considered.find((c) => c.source === 'run')!.vdot_raw;
    const { considered } = bestRecentVdot([flagged, clean], TODAY, undefined, [fastTempo]);
    const run = considered.find((c) => c.source === 'run')!;
    expect(run.vdot_raw).toBeCloseTo(uncappedLead, 5);
  });

  it('RULE 18 FALSIFIER · before F139 this same fixture capped the tempo to clean-race + 1.0', () => {
    const flagged = race({
      slug: 'ran-it-in-the-heat', date: '2026-05-20', priority: 'A',
      finish_seconds: 5600, runner_authority_tier: 'unrepresentative',
    });
    const clean = race({ slug: 'clean-half', date: '2026-05-10', priority: 'A' });
    const fastTempo = {
      id: 't1', date: '2026-05-28', workout_type: 'tempo',
      distance_mi: 6, finish_seconds: 2280, zone: 'threshold' as const,
    };
    const cleanRaw = bestRecentVdot([clean], TODAY).considered[0].vdot_raw;
    const { best } = bestRecentVdot([flagged, clean], TODAY, undefined, [fastTempo]);
    // The OLD assertion (`best!.vdot <= cleanRaw + 1`) no longer holds.
    expect(best!.vdot).toBeGreaterThan(cleanRaw + 1);
  });
});
