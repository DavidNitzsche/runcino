/**
 * 2026-08-21 · race-data source-of-truth re-audit · REGRESSION LOCK.
 *
 * "Did this race count?" — `POST /api/v5/race-authority` — writes the runner's
 * answer to `races.actual_result.authority_tier` with
 * `authority_source:'runner'`, then re-anchors the plan once via
 * `forceReanchorActivePlan`. Its own header calls the next-best fallback a
 * HARD CONSTRAINT.
 *
 * It held for exactly one request. NOTHING read the column back:
 * `loadVdotInputs` selected `actual_result` and ignored the field, and
 * `bestRecentVdot` graded authority from the declared A/B/C priority alone. So
 * the nightly `snapshot-projections` cron re-ran the same two functions over
 * the same unfiltered pool, the flagged race won selection again, and
 * `reanchorActivePlan` moved the paces back. The runner said "I ran that one
 * sick" and by morning the app had quietly overruled them.
 *
 * Three properties are locked here:
 *
 *   1 · A runner-reported `compromised` / `unrepresentative` LOWERS the race's
 *       selection authority, so any better-graded race outranks it — the same
 *       ranked-not-removed mechanism doctrine already uses for a C race.
 *   2 · It is DOWNWARD ONLY. A runner reporting `representative` on a race
 *       doctrine grades as a hard workout must not promote it; the route's own
 *       header forbids being a disguised "make me faster" button.
 *   3 · It is still ranked, not deleted. `effort-authority.ts` §"What
 *       selection deliberately does NOT charge" ruled on this for illness:
 *       zeroing at selection leaves a runner with no anchor at all, which is
 *       worse than an under-reading one. A flagged race that is the ONLY
 *       evidence still anchors.
 */
import { describe, it, expect } from 'vitest';
import { bestRecentVdot } from './vdot';
import { REPRESENTATIVE_FLOOR, UNREPRESENTATIVE_FLOOR } from '@/lib/race/effort-authority';

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
  it('a race the runner flagged COMPROMISED loses selection to a clean race', () => {
    // The flagged race reads FASTER (5900s vs 6120s). Magnitude alone takes
    // it, and did — for one request, until the cron re-ran.
    const flagged = race({
      slug: 'ran-it-in-the-heat', date: '2026-05-20', priority: 'A',
      finish_seconds: 5900, runner_authority_tier: 'compromised',
    });
    const clean = race({ slug: 'clean-half', date: '2026-05-10', priority: 'A' });

    const { best, considered } = bestRecentVdot([flagged, clean], TODAY);
    const f = considered.find(c => c.source === 'race' && c.slug === 'ran-it-in-the-heat')! as RaceCand;

    expect(f.vdot).toBeGreaterThan(best!.vdot); // it still reads faster
    expect(best).toMatchObject({ source: 'race', slug: 'clean-half' });
    expect(f.authority).toBeLessThan(REPRESENTATIVE_FLOOR);
    expect(f.authority_tier).toBe('compromised');
  });

  it('a race the runner flagged UNREPRESENTATIVE publishes that tier', () => {
    const flagged = race({
      slug: 'paced-a-friend', date: '2026-05-20', priority: 'A',
      finish_seconds: 5900, runner_authority_tier: 'unrepresentative',
    });
    const clean = race({ slug: 'clean-half', date: '2026-05-10', priority: 'A' });

    const { best, considered } = bestRecentVdot([flagged, clean], TODAY);
    const f = considered.find(c => c.source === 'race' && c.slug === 'paced-a-friend')! as RaceCand;

    expect(best).toMatchObject({ slug: 'clean-half' });
    expect(f.authority).toBeLessThan(UNREPRESENTATIVE_FLOOR);
    expect(f.authority_tier).toBe('unrepresentative');
  });

  it('the flagged race keeps its own honest VDOT · rank moved, the number did not', () => {
    // Same doctrine as the priority-derived demotion: scaling `vdot` would
    // invent a finish time nobody ran.
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

  it('DOWNWARD ONLY · reporting `representative` cannot promote a C race', () => {
    // The route is explicitly not a "make me faster" button. A C race the
    // runner calls representative stays at doctrine's C grading, and still
    // loses to a real A race.
    const c = race({
      slug: 'parkrun', date: '2026-05-20', priority: 'C',
      finish_seconds: 5900, runner_authority_tier: 'representative',
    });
    const a = race({ slug: 'goal-hm', date: '2026-05-10', priority: 'A' });

    const { best, considered } = bestRecentVdot([c, a], TODAY);
    const p = considered.find(x => x.source === 'race' && x.slug === 'parkrun')! as RaceCand;

    expect(p.authority).toBeLessThan(REPRESENTATIVE_FLOOR);
    expect(p.authority_tier).toBe('compromised');
    expect(best).toMatchObject({ slug: 'goal-hm' });
  });

  it('RANKED, NOT REMOVED · a flagged race that is the only evidence still anchors', () => {
    // effort-authority.ts already ruled on this for illness: "an honest slow
    // number prescribes work that is too easy, and no number at all falls
    // through to a mileage guess that floors at VDOT 30".
    const flagged = race({
      slug: 'ran-it-sick', date: '2026-05-20', priority: 'A',
      runner_authority_tier: 'unrepresentative',
    });
    const { best } = bestRecentVdot([flagged], TODAY);
    expect(best).not.toBeNull();
    expect(best).toMatchObject({ source: 'race', slug: 'ran-it-sick' });
  });

  it('absent field changes nothing · every existing caller keeps its behaviour', () => {
    const withField = race({
      slug: 'half', date: '2026-05-20', priority: 'A', runner_authority_tier: null,
    });
    const without = race({ slug: 'half', date: '2026-05-20', priority: 'A' });
    expect(bestRecentVdot([withField], TODAY).considered[0])
      .toEqual(bestRecentVdot([without], TODAY).considered[0]);
  });

  it('a flagged race cannot launder itself back in through the training ceiling', () => {
    // AUDIT #8's soft cap excludes authority-demoted races, so a flagged race
    // reading high must not hand every tempo a ceiling +1 above itself.
    const flagged = race({
      slug: 'ran-it-in-the-heat', date: '2026-05-20', priority: 'A',
      finish_seconds: 5600, runner_authority_tier: 'unrepresentative',
    });
    const clean = race({ slug: 'clean-half', date: '2026-05-10', priority: 'A' });
    const fastTempo = {
      id: 't1', date: '2026-05-28', workout_type: 'tempo',
      distance_mi: 6, finish_seconds: 2280, zone: 'threshold' as const,
    };
    const { best } = bestRecentVdot([flagged, clean], TODAY, undefined, [fastTempo]);
    // Whatever wins, it may not be an estimate licensed by the flagged race.
    const cleanRaw = bestRecentVdot([clean], TODAY).considered[0].vdot_raw;
    expect(best!.vdot).toBeLessThanOrEqual(cleanRaw + 1);
  });
});
