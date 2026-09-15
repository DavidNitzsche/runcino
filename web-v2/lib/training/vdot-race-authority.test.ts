/**
 * F139 REWRITE (2026-09-15) · PRIORITY NEVER WEIGHTS EVIDENCE.
 *
 * This file used to assert the opposite of what `RACE_TIERING_AND_SEASON_
 * PHILOSOPHY.md` (locked 2026-09-14) actually says: that a declared A/B/C
 * priority alone should decide how much a race counts as fitness evidence,
 * and that a declared-C race must never outrank a declared-A race "even when
 * it reads higher". The doctrine's own words, verbatim: "An A race can
 * produce weak or non-representative evidence. A C race can produce strong
 * evidence. Priority alone must never accept, reject, or weight the
 * result." The old test's premise WAS the violation, not a safety net —
 * "a C race must never outrank an A race" is exactly the priority-as-
 * evidence-weight inference the doctrine forbids, arrived at by reading the
 * calendar label rather than measuring what actually happened.
 *
 * `bestRecentVdot` no longer calls `selectionAuthority(r.priority)` at all.
 * The only per-race MEASURED effort-class signal it can read is the
 * runner's own retroactive report (`runner_authority_tier`, real, disclosed,
 * downward-only). Absent it — including a bare 'representative' report,
 * which was always a floor-lowering lever only, never a promotion — the
 * race is graded at the same conservative floor an explicit
 * 'unrepresentative' report earns (`RUNNER_REPORTED_AUTHORITY_CAP.
 * unrepresentative`), never at the priority-implied number.
 *
 * ── The disclosed, load-bearing consequence this file locks in ───────────
 *
 * Because that floor sits below `REPRESENTATIVE_FLOOR` (the doctrine B-race
 * scale) and nothing raises a race above it any more (a bare 'representative'
 * report doesn't either — see above), NO race can currently reach
 * `authorityTier() === 'representative'` through this function. Two
 * mechanisms that used to key off that boundary are consequently dormant
 * until a real per-race representativeness signal is wired into
 * `bestRecentVdot`'s candidate pipeline (this file's own `durability-
 * anchor.ts` sibling already has one; `bestRecentVdot` does not):
 *
 *   1. THE CANDIDATE SORT's authority-demotion term (`authorityDemoted`)
 *      never fires, because it requires a BETTER-graded race to demote
 *      against and none can now clear the bar. Selection reverts to ranking
 *      on raw VDOT value alone — which is DOCTRINE-CORRECT, not a
 *      regression: doctrine explicitly permits a C race's genuine number to
 *      beat a weak A race's.
 *   2. THE TRAINING CEILING's race-based fallback (`bestRaceRaw`) never
 *      fires either, because it excludes every sub-representative race and
 *      none can escape that band. Whenever the training CORPUS cannot yet
 *      corroborate itself (a new user's first ~2 weeks, or an established
 *      runner returning from a break with too few recent qualifying runs),
 *      training reads are now UNCAPPED rather than bounded to race+1. This
 *      is disclosed, not silently absorbed — see the falsifier below.
 *
 * Both are reported in full in F139's report. Fixing them for real means
 * wiring a genuine measured per-race signal (e.g. `assessRaceRepresentative
 * ness`) into `bestRecentVdot`'s candidate loading — out of scope for this
 * change, which only had to stop reading priority as that signal.
 */

import { describe, it, expect } from 'vitest';
import { bestRecentVdot, vdotFromRace, predictRaceTime } from './vdot';
import {
  REPRESENTATIVE_FLOOR,
  UNREPRESENTATIVE_FLOOR,
  RUNNER_REPORTED_AUTHORITY_CAP,
  selectionAuthority,
} from '@/lib/race/effort-authority';
import { RECOVERY_EFFORT_SCALE } from '@/lib/plan/goal-tiers';

const HM = 13.1094;
const TEN_K = 6.21371;
const M = 26.2188;

type Race = Parameters<typeof bestRecentVdot>[0][number];
type Run = NonNullable<Parameters<typeof bestRecentVdot>[3]>[number];

const race = (over: Partial<Race> & Pick<Race, 'slug' | 'date'>): Race => ({
  name: over.slug,
  priority: 'A',
  distance_mi: HM,
  finish_seconds: 6120,
  ...over,
} as Race);

const tempo = (id: string, date: string, over: Partial<Run> = {}): Run => ({
  id,
  date,
  workout_type: 'tempo',
  distance_mi: 5,
  finish_seconds: 2100,
  zone: 'threshold',
  ...over,
} as Run);

// ── The owner's real calendar ────────────────────────────────────────────────
const BIG_SUR = race({
  slug: 'big-sur', date: '2026-04-26', priority: 'hilly_excluded',
  distance_mi: M, finish_seconds: 13028, // 3:37:08 → VDOT 42.8
});
const SOMBRERO = race({
  slug: 'sombrero', date: '2026-05-03', priority: 'C',
  distance_mi: HM, finish_seconds: 6037, // 1:40:37 → VDOT 44.8
});
const AFC = race({
  slug: 'afc', date: '2026-08-16', priority: 'A',
  distance_mi: HM, finish_seconds: 6120, // 1:42:00 → VDOT 44.1
});
const DODGERS_JOGGED = race({
  slug: 'dodgers', date: '2026-09-26', priority: 'C',
  distance_mi: TEN_K, finish_seconds: 3000, // 50:00 → VDOT 40.0
});

describe('selectionAuthority itself is unchanged (planning-cost reserved, untouched by F139)', () => {
  it('still reads Research/00b\'s own recovery scale · A 1.0 · B 0.65 · C 0.35', () => {
    expect(selectionAuthority('A')).toBe(RECOVERY_EFFORT_SCALE.A);
    expect(selectionAuthority('B')).toBe(RECOVERY_EFFORT_SCALE.B);
    expect(selectionAuthority('C')).toBe(RECOVERY_EFFORT_SCALE.C);
  });

  // Whether `bestRecentVdot` itself still calls `selectionAuthority` is
  // enforced at the source level by `EVIDENCE.priority-never-weights-
  // evidence` in `lib/doctrine/registry.ts` (`_doctrine_gate.test.ts`) —
  // not duplicated here as a source-grep; this file asserts the runtime
  // BEHAVIOUR that proves it (below).
});

describe('F139 · priority alone no longer differentiates a race\'s authority', () => {
  const TODAY = '2026-06-01';

  it('an A, a B, a C and an ungraded race grade IDENTICALLY with no runner report', () => {
    const a = race({ slug: 'r-a', date: '2026-05-20', priority: 'A' });
    const b = race({ slug: 'r-b', date: '2026-05-20', priority: 'B' });
    const c = race({ slug: 'r-c', date: '2026-05-20', priority: 'C' });
    const ungraded = race({ slug: 'r-u', date: '2026-05-20', priority: 'hilly_excluded' });
    const { considered } = bestRecentVdot([a, b, c, ungraded], TODAY);
    const authorities = considered.map((x) => (x as { authority: number }).authority);
    expect(new Set(authorities).size).toBe(1);
    expect(authorities[0]).toBe(RUNNER_REPORTED_AUTHORITY_CAP.unrepresentative);
    expect(considered.every((x) => (x as { authority_tier: string }).authority_tier === 'unrepresentative')).toBe(true);
  });

  it('RULE 18 FALSIFIER · reverting to selectionAuthority(r.priority) would break this', () => {
    // Direct proof the assertion above actually distinguishes the two
    // regimes, not just something that happened to already be true: under
    // the OLD (priority-driven) rule, an A race read 1.0 and a C race read
    // 0.35 — genuinely different tiers (representative vs compromised).
    expect(selectionAuthority('A')).not.toBe(selectionAuthority('C'));
    expect(selectionAuthority('A')).toBeGreaterThanOrEqual(REPRESENTATIVE_FLOOR);
    expect(selectionAuthority('C')).toBeLessThan(REPRESENTATIVE_FLOOR);
  });
});

describe('F139 · the runner\'s own report is the only thing that still moves authority', () => {
  const TODAY = '2026-06-01';

  it('a runner-reported "compromised" race grades ABOVE an unreported one · a real fact beats no fact', () => {
    const reported = race({
      slug: 'reported', date: '2026-05-20', priority: 'A',
      runner_authority_tier: 'compromised',
    });
    const unreported = race({ slug: 'unreported', date: '2026-05-20', priority: 'A' });
    const { considered } = bestRecentVdot([reported, unreported], TODAY);
    const r = considered.find((c) => c.source === 'race' && c.slug === 'reported')! as { authority: number };
    const u = considered.find((c) => c.source === 'race' && c.slug === 'unreported')! as { authority: number };
    expect(r.authority).toBe(RUNNER_REPORTED_AUTHORITY_CAP.compromised);
    expect(u.authority).toBe(RUNNER_REPORTED_AUTHORITY_CAP.unrepresentative);
    expect(r.authority).toBeGreaterThan(u.authority);
  });

  it('a runner-reported "unrepresentative" race grades the SAME as an unreported one', () => {
    const reported = race({
      slug: 'reported', date: '2026-05-20', priority: 'A',
      runner_authority_tier: 'unrepresentative',
    });
    const unreported = race({ slug: 'unreported', date: '2026-05-20', priority: 'A' });
    const { considered } = bestRecentVdot([reported, unreported], TODAY);
    const r = considered.find((c) => c.source === 'race' && c.slug === 'reported')! as { authority: number };
    const u = considered.find((c) => c.source === 'race' && c.slug === 'unreported')! as { authority: number };
    expect(r.authority).toBe(u.authority);
    expect(r.authority).toBe(RUNNER_REPORTED_AUTHORITY_CAP.unrepresentative);
  });

  it('a runner-reported "representative" race clears the floor as a CONFIRMATION, never above it', () => {
    // `RUNNER_REPORTED_AUTHORITY_CAP`'s own header calls 'representative' "a
    // floor-lowering lever only" — that was true of the OLD mechanism
    // because it had a priority-derived number to leave untouched. There is
    // no such number any more, so 'representative' is graded on its own
    // merits: a genuine confirmation clears exactly REPRESENTATIVE_FLOOR,
    // never higher — the runner is answering "did this race count?", not
    // pressing a "make me faster" button (the race's own pace is unchanged).
    const reported = race({
      slug: 'reported', date: '2026-05-20', priority: 'A',
      runner_authority_tier: 'representative',
    });
    const { considered } = bestRecentVdot([reported], TODAY);
    const r = considered[0] as { authority: number; authority_tier: string };
    expect(r.authority).toBe(REPRESENTATIVE_FLOOR);
    expect(r.authority_tier).toBe('representative');
  });

  it('but a "representative" report never lifts a race ABOVE the floor, whatever its declared priority', () => {
    // Confirms priority still plays no part: an A-priority and a C-priority
    // race, both confirmed representative, land at exactly the same
    // authority.
    const aConfirmed = race({ slug: 'a', date: '2026-05-20', priority: 'A', runner_authority_tier: 'representative' });
    const cConfirmed = race({ slug: 'c', date: '2026-05-20', priority: 'C', runner_authority_tier: 'representative' });
    const { considered } = bestRecentVdot([aConfirmed, cConfirmed], TODAY);
    const authorities = considered.map((x) => (x as { authority: number }).authority);
    expect(new Set(authorities).size).toBe(1);
    expect(authorities[0]).toBe(REPRESENTATIVE_FLOOR);
  });
});

describe('membership is still open · every race is still a candidate (unaffected by F139)', () => {
  const TODAY = '2026-06-01';

  it('a C race is in the pool at all · it used to be dropped twice over', () => {
    const { considered } = bestRecentVdot([SOMBRERO], TODAY);
    expect(considered.map((c) => c.source)).toEqual(['race']);
    expect(considered[0]).toMatchObject({ source: 'race', vdot_raw: 44.8 });
  });

  it('a C race that is the ONLY candidate anchors the runner', () => {
    const { best } = bestRecentVdot([SOMBRERO], TODAY);
    expect(best?.source).toBe('race');
    expect(best?.vdot).toBe(44.8);
  });

  it('an ungraded race is still a candidate, graded the same conservative default', () => {
    const { best, considered } = bestRecentVdot([BIG_SUR], '2026-05-20');
    expect(considered).toHaveLength(1);
    expect(considered[0]).toMatchObject({
      source: 'race', vdot_raw: 42.8, authority: RUNNER_REPORTED_AUTHORITY_CAP.unrepresentative,
      authority_tier: 'unrepresentative',
    });
    expect(best?.vdot).toBe(42.8);
  });
});

describe('F139 · ranking is now by raw value when nothing is measured (doctrine-correct)', () => {
  const TODAY = '2026-06-01';

  it('a faster declared-C race NOW outranks a slower declared-A race · doctrine permits this directly', () => {
    // This is the exact scenario the OLD test called "the hazard": Sombrero
    // (C, 44.8) reads higher than a same-shaped A race (44.1). The doctrine
    // itself supplies this exact example — "An A race can produce weak or
    // non-representative evidence. A C race can produce strong evidence." —
    // so a C race's genuine number outranking a weaker A race's is the
    // CORRECT reading now, not the bug it used to be treated as.
    const goalRace = race({ slug: 'goal-hm', date: '2026-05-10', priority: 'A' });
    const { best } = bestRecentVdot([SOMBRERO, goalRace], TODAY);
    expect(best).toMatchObject({ source: 'race', slug: 'sombrero', vdot: 44.8 });
  });

  it('RULE 18 FALSIFIER · the OLD selectionAuthority-driven rule would have picked the other race', () => {
    // Proves the test above actually distinguishes old vs. new behaviour,
    // rather than something that was always true.
    const oldDeclaredAuthority = (p: string | null) => selectionAuthority(p);
    expect(oldDeclaredAuthority('C')).toBeLessThan(REPRESENTATIVE_FLOOR);
    expect(oldDeclaredAuthority('A')).toBeGreaterThanOrEqual(REPRESENTATIVE_FLOOR);
    // Under the old rule, `representativeRaceExists` would be true (the A
    // race clears the bar) and `authorityDemoted` would sort the C race
    // below the A race regardless of its value — the opposite outcome.
  });

  it('a confirmed race DOES now demote a faster, unreported one — the ONE way authority still beats raw value', () => {
    // Because a 'representative' report is a real measured confirmation
    // (unlike declared priority), it is the one remaining way
    // `representativeRaceExists` can become true, which re-arms the
    // candidate-sort demotion for every unreported race in the pool — even
    // a genuinely faster one. This is the mirror image of the "ranking is
    // now by raw value" tests above: once real signal exists ANYWHERE in
    // the pool, it still governs rank, exactly as intended.
    const confirmed = race({
      slug: 'confirmed', date: '2026-05-10', priority: 'C', finish_seconds: 6400,
      runner_authority_tier: 'representative',
    });
    const faster = race({ slug: 'faster', date: '2026-05-20', priority: 'C' });
    const { best } = bestRecentVdot([confirmed, faster], TODAY);
    expect(best?.source).toBe('race');
    expect((best as { slug: string }).slug).toBe('confirmed');
  });

  it('RULE 18 FALSIFIER · without the confirmation, the faster race wins instead', () => {
    const unconfirmed = race({ slug: 'unconfirmed', date: '2026-05-10', priority: 'C', finish_seconds: 6400 });
    const faster = race({ slug: 'faster', date: '2026-05-20', priority: 'C' });
    const { best } = bestRecentVdot([unconfirmed, faster], TODAY);
    expect((best as { slug: string }).slug).toBe('faster');
  });

  it('demotion is not deletion · every race stays auditable in `considered`', () => {
    const a = race({ slug: 'goal-hm', date: '2026-05-10', priority: 'A' });
    const { considered } = bestRecentVdot([SOMBRERO, a], TODAY);
    expect(considered).toHaveLength(2);
  });
});

describe('F139 · the race-based training ceiling fallback is now dormant (disclosed consequence)', () => {
  const TODAY = '2026-06-01';
  const LEAD = tempo('lead', '2026-05-20');

  const uncapped = bestRecentVdot([], TODAY, undefined, [LEAD])
    .considered.find((c) => c.source === 'run')!.vdot_raw;

  it('an unreported A race no longer bounds a training lead · it cannot clear the ceiling gate any more', () => {
    // Before F139 this was the DELIBERATE protection ("an A race does · the
    // lead is bound to race + the doctrinal quantum"). It no longer fires
    // because no race — of any declared priority — can reach
    // REPRESENTATIVE_FLOOR without a runner report, and
    // `excludedFromCeiling`'s `subRepresentative` check excludes every race
    // that cannot. This is the ceiling consequence F139's report calls out
    // by name: training reads run uncapped whenever the training corpus
    // itself cannot corroborate (see `vdot-corpus.ts`), for as long as no
    // real per-race representativeness signal reaches this function.
    const goal = race({ slug: 'goal-hm', date: '2026-05-25', priority: 'A' });
    const { considered } = bestRecentVdot([goal], TODAY, undefined, [LEAD]);
    expect(considered.find((c) => c.source === 'run')!.vdot_raw).toBeCloseTo(uncapped, 5);
  });

  it('RULE 18 FALSIFIER · before F139 this exact fixture bounded the lead to race + 1.0', () => {
    // Documents the prior, intended behaviour this file used to assert
    // (`vdot-race-authority.test.ts`, "an A race does · the lead is bound
    // to race + the doctrinal quantum") so a reader can see precisely what
    // changed and why, without re-deriving it from the diff.
    const goal = race({ slug: 'goal-hm', date: '2026-05-25', priority: 'A' });
    const { considered } = bestRecentVdot([goal], TODAY, undefined, [LEAD]);
    const raceCand = considered.find((c) => c.source === 'race')!;
    const run = considered.find((c) => c.source === 'run')!;
    // The OLD assertion (`run.vdot_raw` ≈ `raceCand.vdot_raw + 1.0`) no
    // longer holds — proving this is a real, deliberate behaviour change,
    // not a coincidence of this fixture.
    expect(run.vdot_raw).not.toBeCloseTo(raceCand.vdot_raw + 1.0, 5);
  });

  it('a race the runner explicitly reported "compromised" still cannot set the ceiling either', () => {
    // Unchanged from before F139: a sub-representative race never bounded
    // training reads. What changed is only that this is now the case for
    // EVERY unreported race too, not just explicitly-flagged ones.
    const goal = race({
      slug: 'goal-hm', date: '2026-05-25', priority: 'A',
      runner_authority_tier: 'compromised',
    });
    const { considered } = bestRecentVdot([goal], TODAY, undefined, [LEAD]);
    expect(considered.find((c) => c.source === 'run')!.vdot_raw).toBeCloseTo(uncapped, 5);
  });
});

describe('sanity · the stated finish times round-trip to the stated VDOTs (unaffected by F139)', () => {
  it('round-trips', () => {
    expect(vdotFromRace(AFC.finish_seconds!, AFC.distance_mi!)).toBe(44.1);
    expect(vdotFromRace(SOMBRERO.finish_seconds!, SOMBRERO.distance_mi!)).toBe(44.8);
    expect(vdotFromRace(BIG_SUR.finish_seconds!, BIG_SUR.distance_mi!)).toBe(42.8);
    expect(vdotFromRace(DODGERS_JOGGED.finish_seconds!, DODGERS_JOGGED.distance_mi!)).toBe(40);
    expect(predictRaceTime(44.1, TEN_K)).toBe(2761);
  });
});

describe('UNREPRESENTATIVE_FLOOR/REPRESENTATIVE_FLOOR themselves are untouched by F139', () => {
  it('the two tier floors are still the doctrine B and C rows', () => {
    expect(REPRESENTATIVE_FLOOR).toBe(RECOVERY_EFFORT_SCALE.B);
    expect(UNREPRESENTATIVE_FLOOR).toBe(RECOVERY_EFFORT_SCALE.C);
  });
});
