/**
 * lib/plan/_ladder_targets.test.ts · LADDER-TARGET-1 (2026-09-02).
 *
 * A WORKOUT WHOSE OWN DOCTRINE SAYS "EACH REP FASTER" MUST NOT REACH THE RUNNER
 * AS ONE FLAT NUMBER.
 *
 * ── The defect, on the owner's live block ───────────────────────────────────
 *
 * Reproduced against production 2026-09-02 (`_probe_cim_sessions`, plan
 * pln_9a57561debb776e5). Two sessions, three ways of disagreeing each:
 *
 *   2026-09-22   Research/04 §12.5 · Continuous mile cutdowns
 *     notes      "Each mile ~10–15 s/mi faster than prior. Start controlled.
 *                 Each rep a little faster. The last one is the point."
 *     sub_label  "2.5 mi WU · 4 mi @ T · 2.5 mi CD"        ← ONE zone
 *     spec       tempo_pace_s_per_mi: 430                   ← ONE number
 *     doctrine   "Start MP+15, drop to slightly faster than HM by final mile"
 *                and a 5-7 mi block; the session shipped 4 mi, flat, at T.
 *
 *   2026-10-05   Research/04 §12.3 · 1K cutdowns
 *     notes      "Start controlled. Each rep a little faster."
 *     sub_label  "5×1 km @ I · 1 min jog"                   ← ONE zone
 *     spec       rep_pace_s_per_mi: 400                     ← ONE number
 *     doctrine   "Start at MP, finish at 5K" · "Each rep 5 s/mi faster"
 *
 * The brief §3.2.E: "A workout with a progression structure needs a structured
 * target array. If the system cannot represent and grade the ladder, select a
 * workout it can honestly prescribe." §8 makes it an invariant: fail when "a
 * progression/ladder workout has only one flat scalar target" and when "workout
 * label, structured phases, and grading contract disagree".
 *
 * ── Where it comes from ─────────────────────────────────────────────────────
 *
 * NOT from the catalogue. `zoneClause` already renders these entries' labels as
 * a walk — `5×1km · MP → 5K · 60s jog` — off the entry's own ordered `zones`
 * and its cited "Each rep 5 s/mi faster" row. The ladder is destroyed
 * downstream: `buildWorkoutSpec` prices an intervals-slot rep set at the slot's
 * single anchor (I), and `subLabelFromSpec` then re-derives the label FROM that
 * spec, so "MP → 5K" becomes "@ I" and the runner never sees the session
 * doctrine wrote. One quantity, three answers (Rule 16).
 *
 * ── WHAT THIS GATE IS, AND IS NOT ───────────────────────────────────────────
 *
 * It is a RATCHET over the whole archetype matrix, not a zero, and that is a
 * deliberate statement rather than a convenience: the engine cannot currently
 * express a per-rep pace ramp. `SpecStep` carries a zone and a pace per step
 * and `segmentSpec` builds them, so the machinery exists — but `parseStep`'s
 * grammar can only name a ZONE, and a two-zone entry like §12.3 has no zone
 * vocabulary for its three middle reps. Closing this needs either per-step
 * paces in the segment grammar or the brief's other option (decline the shape
 * and let the rotation pick a session the engine can prescribe honestly). Both
 * are engine changes with a watch-contract edge, and neither is guessed at
 * here. The number is written down so it cannot quietly grow.
 *
 * ── WHAT THIS GATE CANNOT FAIL ON (Rule 22) ─────────────────────────────────
 *
 *   · A ladder whose ENTRY does not cite a descent. The predicate is the
 *     catalogue's own `entryDeclaresProgression`, shared with the renderer, so
 *     a session that ramps in practice but says nothing in its cited rows is
 *     invisible here — as is any ladder the catalogue does not carry at all.
 *   · Whether the flat pace is the RIGHT flat pace. It asks only whether one
 *     number is standing in for a ramp.
 *   · The long run's race-pace finish, the race row, and the taper's MP block.
 *     None is a rep ladder.
 *   · A ONE-REP ladder. The census surfaced a worse shape than the two live
 *     rows above: `1×1mi · MP → HM → T → 10K → 5K · 60s jog` — a single mile
 *     carrying a five-zone descent, on 5k/intermediate/f3 archetypes, after
 *     `sizeFromPrescription` cut the set to one rep. `renderPrescription`
 *     refuses to AUTHOR a one-rep set for exactly this reason ("a one-rep set
 *     is not a rep set"); the affordability cut has no such rule. Counted here
 *     as flat, and recorded in the handback as its own finding.
 *   · §12.5's WRONG ZONE and UNDERSIZED BLOCK. The doc says MP+15 → faster than
 *     HM over 5-7 miles and the engine shipped 4 miles flat at T; this gate
 *     sees the flatness and says nothing about either the zone or the dose.
 *     Both are recorded in the handback as open findings.
 */
import { describe, it, expect } from 'vitest';
import { buildSimPlan } from './sim-inputs';
import { matrix, arcStr, simInputsForArc, type Arc } from './sim-matrix';
import { buildWorkoutSpec, capSpecToDistance, conservativeVdotFromMileage } from './spec-builder';
import { entryDeclaresProgression } from './catalogue-rx';
import { WORKOUT_CATALOGUE } from '@/lib/workout-catalogue/catalogue';
import { tPaceFromVdot, iPaceFromVdot, vdotFromTpace } from '@/lib/training/vdot';
import { distanceCategoryOf } from './goal-tiers';

/**
 * THE RATCHET · measured 2026-09-02 over the whole archetype matrix. It may
 * shrink; it may never grow. When it reaches zero, delete the ratchet, assert
 * zero, and delete the paragraph in the header that explains why it is not one.
 */
const FLAT_LADDER_BASELINE = 2581;

/** Entries whose own cited rows say the session descends across its reps. */
const LADDER_SLUGS = new Set(
  WORKOUT_CATALOGUE.filter(entryDeclaresProgression).map((e) => e.slug),
);

/** True when a built spec expresses the session as ONE pace and no steps. */
function isFlatScalar(spec: unknown): boolean {
  if (!spec || typeof spec !== 'object') return false;
  const s = spec as Record<string, unknown>;
  const steps = Array.isArray(s.steps) ? s.steps : null;
  // A stepped spec is the honest shape; whether the steps actually differ is a
  // second question this does not ask.
  if (steps && steps.length > 1) return false;
  const kind = String(s.kind ?? '');
  if (kind === 'tempo') return Number(s.tempo_pace_s_per_mi ?? 0) > 0;
  if (kind === 'threshold' || kind === 'intervals') return Number(s.rep_pace_s_per_mi ?? 0) > 0;
  return false;
}

describe('LADDER-TARGET-1 · a cutdown is not one number', () => {
  it('the corpus census of flat-target ladders does not grow', () => {
    let composed = 0;
    let laddersPlaced = 0;
    let flat = 0;
    const examples: string[] = [];

    // Rule 18 liveness, stated up front: the predicate must actually select
    // something, or the whole census is a count of zero dressed as clean.
    expect(
      LADDER_SLUGS.size,
      'no catalogue entry declares a descent — the shared predicate stopped matching',
    ).toBeGreaterThan(2);

    for (const a of matrix()) {
      const built = buildSimPlan(simInputsForArc(a) as never);
      if (!built.ok) continue;
      composed++;
      const cat = distanceCategoryOf(built.raceDistanceMi);
      const easyAnchorT = tPaceFromVdot(
        built.derived.bestRecentVdot ?? conservativeVdotFromMileage(built.derived.recentWeeklyMi),
      ) ?? 480;
      for (const w of built.composed.weeks as unknown as {
        startISO: string; tPaceSec: number | null;
        days: {
          type: string; distanceMi: number; subLabel: string | null;
          isQuality?: boolean; isLong?: boolean; catalogueRationale?: string;
        }[];
      }[]) {
        const weekT = w.tPaceSec ?? built.derived.tPaceSec;
        if (weekT == null) continue;
        for (const d of w.days) {
          if (!d.isQuality || d.isLong || d.type === 'race') continue;
          // The catalogue entry behind the day. `catalogueRationale` opens with
          // the entry's own name — the only place the identity survives compose.
          const rationale = String(d.catalogueRationale ?? '');
          const entry = WORKOUT_CATALOGUE.find(
            (e) => LADDER_SLUGS.has(e.slug) && rationale.startsWith(e.name + ' ('),
          );
          if (!entry) continue;
          laddersPlaced++;
          const iPaceSec = ['5k', '10k', 'hm'].includes(cat)
            ? iPaceFromVdot(vdotFromTpace(weekT)) : null;
          const spec = capSpecToDistance(
            buildWorkoutSpec(d.type, d.distanceMi, weekT, null, d.subLabel ?? '', null,
              built.derived.goalPaceSec, iPaceSec, easyAnchorT).spec,
            d.distanceMi,
          );
          if (isFlatScalar(spec)) {
            flat++;
            if (examples.length < 6) {
              examples.push(`${arcStr(a as Arc)} ${w.startISO} ${entry.name} (${entry.section}) `
                + `zones ${entry.zones.join('→')} · shipped "${d.subLabel}"`);
            }
          }
        }
      }
    }

    console.log(`\n=== LADDER-TARGET-1 · ${composed} plans composed ===`);
    console.log(`  catalogue entries declaring a descent: ${LADDER_SLUGS.size} `
      + `(${[...LADDER_SLUGS].join(', ')})`);
    console.log(`  ladder sessions placed:                ${laddersPlaced}`);
    console.log(`  shipped as ONE flat scalar:            ${flat} (ratchet ${FLAT_LADDER_BASELINE})`);
    for (const e of examples) console.log(`    ${e}`);

    // Rule 18 liveness.
    expect(composed, 'the corpus composed no plans').toBeGreaterThan(1000);
    expect(
      laddersPlaced,
      'the corpus placed no ladder session at all — this census cannot see the defect',
    ).toBeGreaterThan(100);

    // THE RATCHET, both directions.
    expect(flat, 'more ladder sessions ship a flat target than the ratchet allows')
      .toBeLessThanOrEqual(FLAT_LADDER_BASELINE);
    expect(
      FLAT_LADDER_BASELINE - flat,
      `the ratchet is stale by ${FLAT_LADDER_BASELINE - flat} sessions — lower it`,
    ).toBeLessThan(200);
  }, 180_000);

  /**
   * The catalogue's own label is NOT the problem, and this pins that so the fix
   * lands downstream where the defect is. Falsify by making `zoneClause` render
   * only the first zone: the arrow disappears and this fails.
   */
  it('the catalogue renders a descent as a walk, not as one zone', () => {
    const ladders = WORKOUT_CATALOGUE.filter(entryDeclaresProgression);
    expect(ladders.length, 'no ladder entries').toBeGreaterThan(2);
    for (const e of ladders) {
      expect(
        e.zones.length,
        `${e.slug} (${e.section}) cites a descent but declares ${e.zones.length} zone(s)`,
      ).toBeGreaterThanOrEqual(2);
    }
  });
});
