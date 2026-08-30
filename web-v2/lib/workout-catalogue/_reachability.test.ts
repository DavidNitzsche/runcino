/**
 * REACH-1 (2026-08-29) · CAN THE COMPOSER EVER BE HANDED THIS SESSION?
 *
 * Every other gate in this directory asks whether an entry's NUMBERS match the
 * doc. None asked whether the entry can be prescribed at all, and that is the
 * question three separate defects hid behind:
 *
 *   · §11.1's Canova block carried only a `double`, which `renderPrescription`
 *     has no arm for, so the selector declined it on every pass since it was
 *     written. §11.1 read as covered the whole time.
 *   · §8.6's hill fartlek and §9.4's Lydiard fartlek are base-phase entries
 *     that §15's own base row names ("occasional fartlek/light hills"), and
 *     `SLOT_FAMILIES_IN_PHASE` already admitted their families to the base
 *     speed slot — but a `continuous` structure had no rendering outside the
 *     tempo slot, so they were admitted and then refused.
 *   · §8.5's Lydiard circuit dosed to zero work in BOTH currencies, because
 *     the effort-cued `sequence` branch of `fits()` returned zeros.
 *
 * None of those was found by a test. They were found by sweeping the selector
 * and diffing against the catalogue, which is what this does.
 *
 * The allowlist below is the honest half: some entries are authored by the
 * composer directly and never travel through the selector at all. Each one has
 * to say WHERE it is authored, so "unreachable" and "reached by another road"
 * stay distinguishable — that distinction is exactly what was missing.
 */
import { describe, it, expect } from 'vitest';
import { selectSlotWorkout, selectLongRunVariant, newCatalogueHistory, recordCatalogueChoice } from '@/lib/plan/catalogue-rx';
import { WORKOUT_CATALOGUE } from './catalogue';
import { ALL_DISTANCES, TIERS } from './types';

/** Slugs the SELECTOR is not expected to yield, and the road they take instead. */
const AUTHORED_ELSEWHERE: Record<string, string> = {
  'recovery-run': 'composer authors recovery days directly; never a quality slot',
  'easy-run': 'composer authors easy days directly',
  'medium-long-run': 'composer authors the MLR directly · the medium_long slot is never passed to the selector',
  'base-long-run': "composer's plain 'LONG' day, authored when the week carries no intensity long",
  'dress-rehearsal-long-run': '§4.6 is placed by days-to-race in authorDressRehearsal; LONG_ROTATION_EXCLUDED keeps it out of the rotation on purpose',
  'canova-special-block': 'carries only a `double` · plan_workouts holds one session per date, so a two-a-day 6-8h apart cannot be scheduled. §11.1 is carried by canova-modified-block, its own Variations row',
  'pre-fatigue-mp-work': "structure (b) is authored as the race-specific long run's MP finish (MP.pre-fatigue-is-the-fast-finish-long); its two `double` structures are unschedulable for the same reason",
};

/** KNOWN UNREACHABLE · a real gap, recorded rather than hidden. Delete the
 *  entry when it is fixed; the test fails if one becomes reachable, so this
 *  cannot rot into a list of things that quietly started working.
 *
 * REACH-4 (2026-08-30) · `lydiard-hill-circuit` and `continuous-mile-cutdowns`
 * CLOSED. Both were reopened from the 2026-08-29 revert and fixed as two
 * separate defects rather than one:
 *
 *   · The circuit's block was never the grammar (REACH-2's leg-name steps
 *     already described it) or the composer's own accounting (`fits()`'s
 *     effort-cued `sequence` branch already prices it at zero at-pace miles).
 *     It was `dosing.ts:dosePaceOf` re-deriving a dose from the STORED
 *     `type`/`subLabel` with no way to see the entry's `effortOnly` flag —
 *     every `ZONED_TYPES` day fell through to `declaredDosePace`, and every
 *     other quality type defaulted to `I` off the bare day `type`. Fixed by
 *     DOSE-EFFORT-1: `dosePaceOf` now reads the same "hill" / "by effort"
 *     marker `buildWorkoutSpec`'s `by_effort` gate already reads, and returns
 *     null before either fallback fires. The circuit's own render is now a
 *     bespoke effort-cued branch in `catalogue-rx.ts` using each step's `leg`
 *     name, not `renderSequenceSegments` (which still correctly declines any
 *     sequence with an E-zoned step — the circuit no longer routes through it
 *     at all). The same audit found two MORE live instances of the identical
 *     dosePaceOf hole — every other `effortOnly` rep entry (hill sprints,
 *     short/medium/long hill repeats, downhill repeats) and §9.4's Lydiard
 *     fartlek — small enough on each to sit under the corpus sweep gate
 *     unnoticed; DOSE-EFFORT-1 closes all of them the same way.
 *   · The continuous mile cutdown was a wiring gap, not a dosing one:
 *     `capFamilyOf` already prices it `threshold` (HM is its tighter zone) and
 *     `dosePaceOf`'s tempo case already defaults to T with no "@ MP" token to
 *     misread — `renderContinuousPhrase`'s blanket "refuses any entry naming
 *     MP" guard was refusing a session `capFamilyOf` was pricing correctly the
 *     whole time. Narrowed to check `capFamilyOf(entry) == null` (REACH-4) —
 *     refuses only a genuinely M-priced entry, not a T-priced one that merely
 *     names MP as its starting zone — and `SLOT_FAMILIES.tempo` now admits
 *     `cutdown`, the only door with a continuous-block renderer at all.
 *
 * `_dosing_sweep_gate.test.ts`, `_maint_invariants.test.ts` and
 * `_sweep_allusers.test.ts` all stay green after both fixes — see their own
 * run notes in the fixing commit for the archetype-level verification.
 */
const KNOWN_BLOCKED: Record<string, string> = {};


function reachableSlugs(): Set<string> {
  const reached = new Set<string>();
  for (const distance of ALL_DISTANCES) {
    for (const tier of TIERS) {
      for (const phase of ['BASE', 'QUALITY', 'RACE-SPECIFIC', 'TAPER']) {
        for (const weeklyMi of [15, 30, 45, 60, 80, 100, 120]) {
          for (const inHillBlock of [true, false, null]) {
            for (const slot of ['speed', 'threshold', 'intervals', 'tempo'] as const) {
              // ONE history, walked forward. A fresh history each call makes
              // LRU return the same winner forever and everything behind it
              // look unreachable — the first version of this sweep did that
              // and reported nine false positives.
              const history = newCatalogueHistory();
              for (let weekIdx = 0; weekIdx < 24; weekIdx++) {
                const r = selectSlotWorkout({
                  history, enginePhase: phase, distance, tier, weekIdx, weeklyMi, slot,
                  dayOffset: 2, placedThisWeek: [], inTaperWindow: phase === 'TAPER',
                  tPaceSec: 435, iPaceSec: 400, mpPaceSec: 465, usedThisWeek: new Set(),
                  targetAtPaceMinutes: null, inHillBlock,
                } as never) as { ok: boolean; entry?: { slug: string } };
                if (!r.ok || !r.entry) break;
                reached.add(r.entry.slug);
                recordCatalogueChoice(history, r.entry.slug, weekIdx);
              }
            }
            const lh = newCatalogueHistory();
            for (let weekIdx = 0; weekIdx < 24; weekIdx++) {
              const l = selectLongRunVariant({
                history: lh, enginePhase: phase, distance, tier, weekIdx, weeklyMi,
                dayOffset: 0, inTaperWindow: false, tPaceSec: 435, iPaceSec: 400,
                mpPaceSec: 465, inHillBlock,
              } as never);
              if (!l) break;
              reached.add(l.entry.slug);
              recordCatalogueChoice(lh, l.entry.slug, weekIdx);
            }
          }
        }
      }
    }
  }
  return reached;
}

describe('CATALOGUE REACHABILITY · every entry is prescribable, or says why not', () => {
  const reached = reachableSlugs();

  it('no entry is silently unreachable', () => {
    const orphans = WORKOUT_CATALOGUE
      .filter((e) => !reached.has(e.slug))
      .filter((e) => !(e.slug in AUTHORED_ELSEWHERE) && !(e.slug in KNOWN_BLOCKED))
      .map((e) => `${e.slug} (${e.section}, family=${e.family}, phases=${e.phases.join('/')})`);
    expect(
      orphans,
      'These entries exist in the catalogue and no (slot × phase × distance × tier × volume)\n'
      + 'the composer uses can ever yield them. An entry nothing can select is doctrine the\n'
      + 'runner never sees. Either wire it, or add it to AUTHORED_ELSEWHERE / KNOWN_BLOCKED\n'
      + 'with the reason:\n  ' + orphans.join('\n  '),
    ).toEqual([]);
  });

  it('the known-blocked list has not rotted · a fixed entry must be removed from it', () => {
    const fixed = Object.keys(KNOWN_BLOCKED).filter((s) => reached.has(s));
    expect(
      fixed,
      'These are now reachable, so their KNOWN_BLOCKED entries are lying. Delete them.',
    ).toEqual([]);
  });

  it('the authored-elsewhere list is not a dumping ground · every slug is real', () => {
    for (const slug of [...Object.keys(AUTHORED_ELSEWHERE), ...Object.keys(KNOWN_BLOCKED)]) {
      expect(
        WORKOUT_CATALOGUE.some((e) => e.slug === slug),
        `${slug} is exempted but is not in the catalogue`,
      ).toBe(true);
    }
  });

  it('most of the catalogue is genuinely reachable', () => {
    // A floor, so a change that quietly strands a dozen entries fails even if
    // someone remembers to grow the exemption lists.
    expect(reached.size).toBeGreaterThanOrEqual(54);
  });
});
