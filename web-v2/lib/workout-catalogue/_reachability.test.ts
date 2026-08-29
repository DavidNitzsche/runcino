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
 *  cannot rot into a list of things that quietly started working. */
const KNOWN_BLOCKED: Record<string, string> = {
  'lydiard-hill-circuit':
    'Blocked by DOSE ACCOUNTING, and measured 2026-08-29. Dosing was fixed (REACH-1 gave the '
    + 'effort-cued sequence branch its minutes) and the steps now carry the doc\'s own leg names, '
    + 'so the grammar CAN describe the circuit. Rendering it is still wrong one layer down: a '
    + 'label of distance segments is dose-visible, and dosePaceOf charges an intervals-slot day '
    + "at I, so the circuit's ~1.9 mi of bounding, jogging and striding gets billed against "
    + 'Daniels\' 8% interval cap even though effortOnly means it spends no at-pace miles. '
    + 'Enabling it produced 2208 enforced breaches and 4416 firm failures against zero before. '
    + 'The real fix is to make an effort-cued session dose-invisible end to end, not to render it.',
  'continuous-mile-cutdowns':
    'Blocked by dose accounting, also measured 2026-08-29. The tempo slot is the only one with a '
    + 'continuous renderer and renderContinuousPhrase refuses MP-zoned entries; both were relaxed '
    + 'on the ruling that this charges to the THRESHOLD budget — which capFamilyOf already returns '
    + 'for it, and which dosePaceOf already gives a tempo label carrying no @ MP token. The '
    + 'reasoning held and the corpus did not. Reverted alongside the circuit; the two were '
    + 'measured together, so the split between them is not yet separated.',
};


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
