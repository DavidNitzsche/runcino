/**
 * lib/runs/derived-registry.ts · every place two stored values describe one
 * thing, and which one wins.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT A FAMILY IS
 *
 * Two or more stored keys bound by ARITHMETIC, so that any of them can be
 * computed from the others. Distance, time and pace are one family: fix two
 * and the third is determined. A display string and the number it formats are
 * a family of two. A splits array and the run's distance are a family, because
 * the splits have to add up to something.
 *
 * A family is dangerous exactly when its members can be written by DIFFERENT
 * sources — because then nothing forces them to agree, and every reader picks
 * one without knowing the other exists.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT THE WINNER RULE IS, AND WHY IT IS NOT "TRUST THE DEVICE"
 *
 * "The device that ran the session beats a third party's recomputation of it"
 * settled the pace case, and it is a good tiebreak. It is NOT the general
 * rule, and reaching for it first hides what actually goes wrong.
 *
 * In the 2026-08-23 incident neither source was wrong. Strava's row was
 * internally consistent; the watch's row was internally consistent; the merge
 * built a third row out of half of each. The failure was not a bad source, it
 * was a SPLIT PROVENANCE across one arithmetic family.
 *
 * So the general rule is:
 *
 *   1. A family is written and read AS A UNIT. A member may not enter a row
 *      from a source that did not also supply the rest of the family.
 *   2. Where members already disagree, prefer the subset that is internally
 *      coherent and was written by the highest-tier source.
 *   3. Where no coherent subset survives, REFUSE. Do not substitute a
 *      plausible sibling — that is how a wall clock gets printed as a moving
 *      one, and a modelled number must never look measured.
 *
 * Rule 1 is enforced at the WRITE (`familyGuardedFill` in `lib/runs/
 * canonical.ts`). Rules 2 and 3 are enforced at the READ (`reconcileRun` in
 * `lib/runs/coherence.ts`), which is what repairs the rows already stored.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ADDING A FAMILY
 *
 * Append an entry. `_coherence_gate.test.ts` does the rest: it resolves every
 * member against `run-shape.ts`, requires a read-time guard or an honest
 * exemption, and runs the entry's own positive and negative controls. A family
 * with no `control` cannot be added — a guard nobody has proved fails is not a
 * guard.
 *
 * If a family turns out to be SOUND, keep it here with `guard: 'none'` and say
 * why in `why`. The registry is the list of places two values describe one
 * thing, not the list of bugs; a sound family documented is a sound family
 * that stays sound.
 */

import type { RunData } from '@/lib/runs/run-shape';
import { reconcileRun, type RunCoherence } from '@/lib/runs/coherence';

/**
 * A control row: a real production shape, and what the guard must do with it.
 *
 * `shouldRefuse` names the refusal family that MUST fire — a POSITIVE control.
 * `null` makes it a NEGATIVE control: the entry's OWN id must NOT fire.
 *
 * Scoped to the entry's own id on purpose. A row can be sound in one family
 * and divergent in another, and the 2026-06-21 row is exactly that: its
 * moving time is honest (8.7% paused, so `clock.moving-disproved` must stay
 * quiet) while its pace STRING and pace NUMBER are 43 s/mi apart (so
 * `pace.display-vs-numeric` correctly fires on the same row). A negative
 * control demanding silence across every family would force one of those two
 * truths to be dropped.
 *
 * Both directions are required per guarded family. A guard that refuses
 * everything is as broken as one that refuses nothing, and only the negative
 * control catches it.
 */
export interface FamilyControl {
  label: string;
  row: RunData;
  shouldRefuse: string | null;
  /** An extra assertion on the reconciled view. Optional. */
  expect?: (c: RunCoherence) => boolean;
}

export interface DerivedFamily {
  /** Stable id. Matches the `family` string the guard puts in its refusals. */
  id: string;

  /**
   * The keys bound by the arithmetic. Every one must exist on `RunData` —
   * the gate checks, so a rename here fails the build rather than silently
   * unwatching the family.
   */
  members: readonly (keyof RunData)[];

  /** The arithmetic that binds them, in one sentence. */
  invariant: string;

  /**
   * Which member wins when they disagree, or `'refuse'` when no member may be
   * substituted for another, or `'none'` when the family is sound.
   */
  winner: keyof RunData | 'refuse' | 'none';

  /** Why that one wins. Honest, specific, and not "because it is newer". */
  why: string;

  /**
   * The exported symbol that enforces this at read time, or `'none'` for a
   * sound family that needs documenting rather than guarding.
   */
  guard: string;

  /** What production looked like when the entry was written. A snapshot. */
  measured: string;

  /**
   * A live violation this guard does NOT yet cover, with an honest reason.
   * Checked for staleness: fix the reader and the gate makes you delete it.
   */
  exempt?: Record<string, string>;

  /** Positive and negative controls. At least one of each. */
  controls: readonly FamilyControl[];
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE REGISTRY
 * ═══════════════════════════════════════════════════════════════════════ */

export const DERIVED_REGISTRY: readonly DerivedFamily[] = [
  /* ────────────────────────────────────────────────────────────────────── */
  {
    id: 'clock.moving-disproved',
    members: ['movingTimeS', 'movingSec', 'durationSec', 'elapsedTimeS', 'distanceMi'],
    invariant:
      'A stored moving time implies a paused share of the row\'s own elapsed ' +
      'clock. More than half the run "paused" is not a pause.',
    winner: 'refuse',
    why:
      'The elapsed clock survives and the moving clock does not, but the ' +
      'elapsed clock may NOT be handed back as moving time. They are ' +
      'different quantities. For the 2026-08-23 row the honest answer is ' +
      'that moving time is unknown: 2389s is disproved, and 5298s is the ' +
      'wall clock. A caller gets null and a reason, and says so.',
    guard: 'reconcileRun',
    measured:
      '2026-08-24 · 1 canonical row of 256 (2026-08-23, 54.9% implied paused). ' +
      'Zero collateral: no other row in the table trips it.',
    controls: [
      {
        label: 'the 2026-08-23 row, verbatim from production',
        row: {
          date: '2026-08-23', source: 'watch', distanceMi: 11.01,
          durationSec: 5298, movingTimeS: 2389, movingSec: 2389,
          elapsedTimeS: 2389, paceSPerMi: 217, avgPaceMinPerMi: '8:01',
        },
        shouldRefuse: 'clock.moving-disproved',
        // Moving time refused; pace falls to the elapsed clock at 8:01/mi.
        expect: (c) => c.movingSec === null
          && c.paceBasis === 'elapsed'
          && Math.round(c.paceSecPerMi ?? 0) === 481,
      },
      {
        label: '2026-06-21 · a genuine 9m21s of pauses on a 13.15 mi run',
        row: {
          date: '2026-06-21', source: 'watch', distanceMi: 13.15,
          durationSec: 6444, movingTimeS: 5883, elapsedTimeS: 5883,
          paceSPerMi: 447, avgPaceMinPerMi: '8:10',
        },
        // 8.7% paused. Believable, and must survive untouched.
        shouldRefuse: null,
        expect: (c) => c.movingSec === 5883 && c.paceBasis === 'moving',
      },
    ],
  },

  /* ────────────────────────────────────────────────────────────────────── */
  {
    id: 'clock.moving-impossible',
    members: ['movingTimeS', 'movingSec', 'durationSec', 'elapsedTimeS'],
    invariant: 'Moving time may never exceed the elapsed clock.',
    winner: 'refuse',
    why:
      'A run cannot move for longer than it lasted. There is no reading of ' +
      'the data under which this is a measurement, so no member may be ' +
      'promoted to stand in for the other.',
    guard: 'reconcileRun',
    measured:
      '2026-08-24 · 0 rows of 256 against the durationSec-first ladder. The ' +
      'family is SOUND today and guarded anyway: `movingSec` on the ' +
      '2026-05-22 row is 5730 against a movingTimeS of 4096, so the ' +
      'ingredients are already in the table and only the ladder order keeps ' +
      'them apart.',
    controls: [
      {
        label: 'moving longer than elapsed',
        row: { distanceMi: 6.0, durationSec: 3000, movingTimeS: 3600 },
        shouldRefuse: 'clock.moving-impossible',
        expect: (c) => c.movingSec === null && c.paceBasis === 'elapsed',
      },
      {
        label: 'an ordinary coherent row',
        row: { distanceMi: 6.0, durationSec: 3000, movingTimeS: 2950 },
        shouldRefuse: null,
        expect: (c) => c.movingSec === 2950,
      },
    ],
  },

  /* ────────────────────────────────────────────────────────────────────── */
  {
    id: 'pace.display-vs-numeric',
    members: ['avgPaceMinPerMi', 'paceSPerMi', 'durationSec', 'movingTimeS', 'distanceMi'],
    invariant:
      'A display string must equal the number stored beside it. Here it never ' +
      'does, because the two are not the same measurement.',
    winner: 'refuse',
    why:
      'On 115 of 115 production rows `avgPaceMinPerMi` is derived from ' +
      '`durationSec` and `paceSPerMi` from `movingTimeS`. They are the ' +
      'ELAPSED pace and the MOVING pace under two names that both read as ' +
      '"average pace", and they differ by up to 43 s/mi on sound rows. ' +
      'Neither wins, because neither is the other: the pace is recomputed ' +
      'from the reconciled clock and carries an explicit `paceBasis`. A ' +
      'string is also not arithmetic — nothing downstream can check it.',
    guard: 'reconcileRun',
    measured:
      '2026-08-24 · 115 rows carry the string, 41 carry both, 6 differ by ' +
      '>15 s/mi (worst 264 s/mi). Readers currently split: ' +
      'lib/coach/state-loader.ts and lib/coach/log-state.ts prefer the ' +
      'STRING; app/api/runs/[id]/recap/route.ts prefers the NUMBER. Same ' +
      'run, two paces, no label saying which.',
    exempt: {
      'lib/coach/cycle-performance.ts':
        'Parses the string in SQL for a cycle-level pace trend. Comparative ' +
        'within one query, so a consistent elapsed basis does not skew it. ' +
        'Already on the run-shape lint allowlist for the next batch.',
      'lib/coach/quality-predictors.ts':
        'Same SQL-side string parse, same comparative use. On the same lint ' +
        'allowlist.',
    },
    controls: [
      {
        label: 'the string is the elapsed pace, the number the moving pace',
        row: {
          distanceMi: 6.90, durationSec: 3326, movingTimeS: 3112,
          paceSPerMi: 451, avgPaceMinPerMi: '8:01',
        },
        shouldRefuse: 'pace.display-vs-numeric',
        expect: (c) => c.paceBasis === 'moving' && Math.round(c.paceSecPerMi ?? 0) === 451,
      },
      {
        label: 'string and number agree, as on an unpaused run',
        row: {
          distanceMi: 6.0, durationSec: 3000, movingTimeS: 3000,
          paceSPerMi: 500, avgPaceMinPerMi: '8:20',
        },
        shouldRefuse: null,
      },
    ],
  },

  /* ────────────────────────────────────────────────────────────────────── */
  {
    id: 'pace.stored-vs-clock',
    members: ['paceSPerMi', 'distanceMi', 'movingTimeS', 'durationSec', 'elapsedTimeS'],
    invariant: 'pace × distance = the clock it was divided by.',
    winner: 'refuse',
    why:
      'The stored pace is believed only while a surviving clock agrees with ' +
      'it. Once the clock guard has refused the moving time, the pace ' +
      'derived from that moving time has lost its input and is recomputed ' +
      'against whichever clock survived — never left standing on its own.',
    guard: 'reconcileRun',
    measured:
      '2026-08-24 · `paceSPerMi` agrees with `movingTimeS`/`distanceMi` on ' +
      'all 182 rows carrying both (worst 2.8 s/mi). The family is sound as ' +
      'stored; it breaks only when the clock beneath it is refused, which is ' +
      'exactly the 2026-08-23 row.',
    controls: [
      {
        label: 'pace orphaned by a refused clock',
        row: {
          distanceMi: 11.01, durationSec: 5298, movingTimeS: 2389, paceSPerMi: 217,
        },
        shouldRefuse: 'pace.stored-vs-clock',
        expect: (c) => Math.round(c.paceSecPerMi ?? 0) === 481,
      },
      {
        label: 'pace agreeing with its own moving clock',
        row: { distanceMi: 10.0, durationSec: 5100, movingTimeS: 5000, paceSPerMi: 500 },
        shouldRefuse: null,
      },
    ],
  },

  /* ────────────────────────────────────────────────────────────────────── */
  {
    id: 'speed.stored-vs-pace',
    members: ['avgSpeedMph', 'paceSPerMi', 'distanceMi', 'movingTimeS'],
    invariant:
      'speed = 3600 / pace. One quantity, two stored spellings, and the row ' +
      'carries no third fact that could tell them apart.',
    winner: 'refuse',
    why:
      '`avgSpeedMph` is a second stored spelling of the pace. It agrees with ' +
      'the pace everywhere today, which is luck rather than construction — ' +
      'the absorber that split the clock family across two sources would ' +
      'split this one the same way. Derived from the reconciled pace so the ' +
      'two cannot come apart.',
    guard: 'reconcileRun',
    measured:
      '2026-08-24 · 170 rows carry it; worst disagreement with the stored ' +
      'pace is 4.7 s/mi and with the moving clock 4.9 s/mi. SOUND today.',
    controls: [
      {
        label: 'a speed that disagrees with the row\'s own clock',
        row: { distanceMi: 10.0, durationSec: 5000, movingTimeS: 5000, avgSpeedMph: 16.6 },
        shouldRefuse: 'speed.stored-vs-pace',
        expect: (c) => Math.abs((c.speedMph ?? 0) - 7.2) < 0.1,
      },
      {
        label: 'a speed consistent with the clock',
        row: { distanceMi: 10.0, durationSec: 5000, movingTimeS: 5000, avgSpeedMph: 7.2 },
        shouldRefuse: null,
      },
    ],
  },

  /* ────────────────────────────────────────────────────────────────────── */
  {
    id: 'hr.zones-vs-avg',
    members: ['hrZonePcts', 'avgHr'],
    invariant:
      'Time-in-zone percentages sum to 100. A run with a measured average ' +
      'heart rate spent its time in some zone.',
    winner: 'refuse',
    why:
      'The distribution is derived from HR samples the row no longer carries, ' +
      'so there is nothing to recompute it from. Five zeros beside a measured ' +
      '138 bpm is a computation that produced nothing, rendered as a bar ' +
      'chart of nothing. "No zone data" is true; a flat zero distribution is ' +
      'not. The average HR is kept — it was measured independently.',
    guard: 'reconcileHrZones',
    measured:
      '2026-08-24 · 8 rows carry a zone object. 5 of them (all canonical, ' +
      'all apple_watch, 2026-05-19 to 2026-05-22) sum to 0 beside average ' +
      'heart rates of 135–145 bpm. 2 sum to 100, 1 to 99.',
    controls: [
      {
        label: 'all-zero zones beside a measured average HR',
        row: {
          avgHr: 138, maxHr: 157,
          hrZonePcts: { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 },
        },
        shouldRefuse: 'hr.zones-vs-avg',
        expect: (c) => c.hrZonePcts === null,
      },
      {
        label: 'a real distribution',
        row: {
          avgHr: 138,
          hrZonePcts: { z1: 10, z2: 60, z3: 20, z4: 8, z5: 2 },
        },
        shouldRefuse: null,
        expect: (c) => c.hrZonePcts !== null,
      },
    ],
  },

  /* ────────────────────────────────────────────────────────────────────── */
  {
    id: 'splits.total-vs-distance',
    members: ['splits', 'distanceMi'],
    invariant: 'The splits\' own distances sum to the run\'s distance.',
    winner: 'distanceMi',
    why:
      'The run-level distance is what weekly volume, plan adherence and every ' +
      'distance-keyed doctrine table are summed from, and it is the figure ' +
      'the recorder reported for the session. The split array is the derived ' +
      'decomposition of it. When they disagree the array is describing some ' +
      'other run — on 2026-08-01 five splits totalling 4.14 mi sit on a 1.34 ' +
      'mile row — so the array may not be presented as this run\'s ' +
      'decomposition. It does not follow that every split is garbage: ' +
      '`split-sanity.ts` already judges them one at a time, and this is the ' +
      'whole-array question that guard does not ask.',
    guard: 'reconcileSplitsTotal',
    measured:
      '2026-08-24 · 102 rows have splits carrying a readable distance. 39 ' +
      'differ from the run by more than 0.25 mi; worst 2.80 mi. A recurring ' +
      '+0.7 to +0.9 mi pattern on watch rows is the HealthKit sibling\'s ' +
      'distance absorbed into a row whose own distance came from GPS.',
    controls: [
      {
        label: '2026-08-01 · five splits totalling 4.14 mi on a 1.34 mile run',
        row: {
          distanceMi: 1.34,
          splits: [
            { mile: 1, distanceMi: 1, unreliable: true },
            { mile: 2, distanceMi: 1, unreliable: true },
            { mile: 3, distanceMi: 1, unreliable: true },
            { mile: 4, distanceMi: 1, unreliable: true },
            { mile: 5, distanceMi: 0.14285714285714285, unreliable: true },
          ],
        },
        shouldRefuse: 'splits.total-vs-distance',
        expect: (c) => c.splitsCoverRun === false,
      },
      {
        label: 'splits that decompose their run',
        row: {
          distanceMi: 3.1,
          splits: [
            { mile: 1, distanceMi: 1 },
            { mile: 2, distanceMi: 1 },
            { mile: 3, distanceMi: 1 },
            { mile: 4, distanceMi: 0.1 },
          ],
        },
        shouldRefuse: null,
        expect: (c) => c.splitsCoverRun === true,
      },
      {
        label: 'splits with pace but no distance · a shape limit, not a conflict',
        row: {
          distanceMi: 3.1,
          splits: [{ mile: 1, pace: '8:00' }, { mile: 2, pace: '7:55' }],
        },
        shouldRefuse: null,
        expect: (c) => c.splitsCoverRun === null,
      },
    ],
  },

  /* ────────────────────────────────────────────────────────────────────── */
  {
    id: 'energy.total-vs-active',
    members: ['calories', 'kcal'],
    invariant:
      'None. These are two different quantities and the arithmetic between ' +
      'them is a person\'s basal rate, which the row does not carry.',
    winner: 'none',
    why:
      'SOUND DATA, WRONG READ. `calories` is Strava/HealthKit TOTAL energy ' +
      '(basal included); `kcal` is the watch\'s ACTIVE energy from ' +
      'HKLiveWorkoutBuilder. On the 32 rows carrying both, `calories` is ' +
      '1.21x to 1.38x `kcal` — the basal share of an hour\'s running. All 32 ' +
      '"disagree" and all 32 are right. Nothing needs fixing in the data. ' +
      'What needs fixing is that two live readers COALESCE them, so one ' +
      'column is total energy on one row and active energy on the next and ' +
      'moves ~30% for no reason the runner can see. The accessors ' +
      '`runTotalEnergyKcal` and `runActiveEnergyKcal` exist so the choice has ' +
      'to be made by name.',
    guard: 'none',
    measured:
      '2026-08-24 · 65 rows carry `calories`, 67 carry `kcal`, 32 carry both. ' +
      'Ratio min 1.210, mean 1.314, max 1.380.',
    exempt: {
      'components/faff-app/seed.ts':
        'Line 723 · `COALESCE(c.data->>\'calories\', c.data->>\'kcal\') AS kcal` ' +
        'labels total energy as kcal. A display-only seed query; the fix is a ' +
        'read migration, not a guard, and it is queued rather than done here ' +
        'because the column feeds a chart whose axis label has to change with it.',
      'lib/coach/run-state.ts':
        'HALF CLOSED 2026-08-24. The unread-measurement half is FIXED: ' +
        '`data.kcal` is now tier 2 in resolveCalories(), above the HealthKit ' +
        'sum and the estimator, so the watch\'s own measurement is no longer ' +
        'discarded in favour of arithmetic — that was a modelled number ' +
        'looking measured on all 67 watch rows, off by -26% to +28%. ' +
        'STILL OPEN, and the reason this entry survives: the field is TOTAL ' +
        'energy at tier 1 and ACTIVE energy at tiers 2-4, so it can still ' +
        'move ~30% between two runs for a reason the runner cannot see. ' +
        'Closing that means dropping Strava\'s total from the ladder, which ' +
        'changes the calorie figure on every Strava-sourced run at once — a ' +
        'product decision, not a bug fix, and argued in place at the tier.',
    },
    controls: [
      {
        label: 'total and active energy are read by name, never coalesced',
        row: { calories: 2185, kcal: 1604 },
        shouldRefuse: null,
      },
    ],
  },
];

/* ══════════════════════════════════════════════════════════════════════════
 * RUNNING A CONTROL
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Reconcile a control row and report which refusal families fired.
 *
 * Shared by the gate test and the CI script so the two can never check
 * different things.
 */
export function refusalFamiliesFor(row: RunData): string[] {
  return reconcileRun(row).refusals.map((r) => r.family);
}
