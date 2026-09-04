/**
 * lib/adaptation/canonical/work-hr-ceiling.ts · THE ONE OWNER of "what HR
 * ceiling bounds THIS session's work".
 *
 * ── HRCEILING-1 (2026-09-04) · THE DEFECT ──────────────────────────────────
 *
 * Measured on the owner's real history, through the adaptation replay. Every
 * threshold session in June and July was graded against an HR ceiling of
 * **149**, and his LTHR is **168**:
 *
 *   2026-06-11 tempo   DIFFERENT · mean work HR 162 against ceiling 149
 *   2026-06-18 tempo   DIFFERENT · mean work HR 163 against ceiling 149
 *   2026-06-23 tempo   DIFFERENT · mean work HR 160 against ceiling 149
 *   2026-06-25 tempo   DIFFERENT · mean work HR 155 against ceiling 149
 *   2026-07-07 tempo   PARTIAL   · mean work HR 167 against ceiling 149
 *   2026-07-09 tempo   PARTIAL   · mean work HR 163 against ceiling 149
 *   2026-07-14 tempo   PARTIAL   · mean work HR 156 against ceiling 149
 *   2026-07-21 tempo   PARTIAL   · mean work HR 159 against ceiling 149
 *
 * 149 is an EASY-DAY aerobic cap. Threshold work is run at or just under LTHR,
 * so 155-167 against an LTHR of 168 is the session doing exactly what it was
 * for. The engine read every one of them as "completed at clearly excessive
 * effort", which is `gradeStimulus`'s DIFFERENT branch
 * (`paceCannotRescueExcessiveEffort`), and DIFFERENT and PARTIAL are both
 * outside `GRADES_THAT_COUNT_AS_EVIDENCE`.
 *
 * The consequence is the whole reason the Adaptation Engine has never proposed
 * an increase: `C4_HR_COMPATIBLE` is the limiting condition on 12 of the 17
 * non-counting grades in the season, and the threshold lever's own report reads
 * "No qualifying threshold session in the last 28 days" on 39 of 40 decision
 * points. A prescription-authoring defect was being spent as a verdict about
 * the runner's capacity.
 *
 * ── WHY THIS IS NOT A THRESHOLD BEING WEAKENED ─────────────────────────────
 *
 * This changes nothing about how hard a session must be to count. It stops one
 * quantity being compared against a different quantity (Rule 16): an easy-day
 * aerobic ceiling is not a bound on threshold work, and never was.
 *
 * The rule is not invented here either — ZONEBAND-1 (2026-09-03) already
 * settled it on the display side, in `lib/training/spec-card.ts`'s own words:
 * "a quality HR target belongs to threshold/interval work, never to an easy or
 * long block", and the fix made the authoring path emit NO generic HR cap for
 * quality types. Verified against the live plan on 2026-09-04:
 *
 *   easy 151 (n=47) · long 151 (n=11) · shakeout 151 (n=3)
 *   intervals null  · tempo null      · threshold null · race null
 *
 * So a `hr_cap_bpm` sitting on a quality row is, by construction, a
 * pre-ZONEBAND-1 artefact of the generic aerobic path. ZONEBAND-1 fixed what
 * the runner READS; it did not reach what the engine GRADES. This does.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT DO ─────────────────────────────────────
 *
 * It does not invent a replacement ceiling. Rule 11: the honest answer to "what
 * bounded this threshold session's HR" is that nothing valid did, so C4 reports
 * UNREADABLE and the grade is decided on the channels that ARE readable —
 * exactly what already happens for every session authored since ZONEBAND-1,
 * whose rows carry no cap at all. A session that genuinely fell apart still
 * fails C1/C2/C3/C5, none of which this touches.
 *
 * It also does not touch EASY or LONG_RUN sessions. There the aerobic cap IS
 * the right quantity and C4 keeps binding on it, which is the guard that
 * catches an easy day run too hard.
 */
import type { GradedSession } from './input';
import { absent, measured, type Measured } from './input';

/** The intensity domains for which a generic aerobic cap is the wrong bound. */
const QUALITY_DOMAINS: ReadonlySet<GradedSession['tests']> =
  new Set<GradedSession['tests']>(['THRESHOLD', 'HIGH_INTENSITY', 'MARATHON_EFFORT']);

/**
 * The HR ceiling to grade this session's WORK against.
 *
 * `storedCapBpm` is `workout_spec.hr_cap_bpm` as authored. Returns it for the
 * aerobic domains, where it means what it says, and refuses it by name for the
 * quality domains, where its presence is a pre-ZONEBAND-1 mis-stamp.
 */
export function workHrCeilingFor(
  tests: GradedSession['tests'],
  storedCapBpm: number | null | undefined,
): Measured<number> {
  if (storedCapBpm == null || !Number.isFinite(storedCapBpm) || storedCapBpm <= 0) {
    return absent<number>('no HR ceiling on this prescription');
  }
  if (QUALITY_DOMAINS.has(tests)) {
    return absent<number>(
      `the prescription carried a generic aerobic HR cap of ${Math.round(storedCapBpm)} bpm, `
      + 'which is not a bound on threshold or interval work (ZONEBAND-1); this session\'s work '
      + 'HR is therefore ungraded rather than judged against the wrong ceiling',
    );
  }
  return measured(storedCapBpm);
}
