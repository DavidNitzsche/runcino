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
 * It is a RATCHET over the whole archetype matrix, not a zero.
 *
 * LADDER-TARGET-2 (2026-09-02) took it from 2,581 to 497 by giving the segment
 * grammar the vocabulary it was missing. The paragraph that used to stand here
 * said the engine "cannot currently express a per-rep pace ramp" — it can now,
 * and the two shapes that remain are structural rather than a missing
 * vocabulary. They are named beside the baseline constant below, with what
 * closing each one would take, so the next pass starts from evidence.
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
import {
  entryDeclaresProgression, descentRungs, perRepPaceStepSPerMi, renderPrescription,
} from './catalogue-rx';
import { parseSegments } from './prescription-parser';
import { WORKOUT_CATALOGUE } from '@/lib/workout-catalogue/catalogue';
import { tPaceFromVdot, iPaceFromVdot, vdotFromTpace } from '@/lib/training/vdot';
import { distanceCategoryOf } from './goal-tiers';

/**
 * THE RATCHET · measured 2026-09-02 over the whole archetype matrix. It may
 * shrink; it may never grow. When it reaches zero, delete the ratchet, assert
 * zero, and delete the paragraph in the header that explains why it is not one.
 */
const FLAT_LADDER_BASELINE = 497;

/**
 * ── LADDER-TARGET-2 (2026-09-02) · 2,581 → 497, and what the 497 ARE ────────
 *
 * The REPS branch is closed. `renderDescentReps` in `catalogue-rx.ts` now
 * renders a descent as an explicit sequence in the segment grammar — one rung
 * per rep, each with its own zone — so `segmentSpec` prices every rung
 * separately into `SpecStep.pace_s_per_mi`. §12.2's mile cutdowns, §12.3's 1K
 * cutdowns and §11.2's Canova repeats all ship stepped now. The grammar gained
 * one additive token, `@ ZONE+N` (`Research/04` §12.2's own "MP+10"), which
 * resolves to a number before the spec so no new key reaches the wire.
 *
 * WHAT IS LEFT, and both are structural rather than a missing vocabulary:
 *
 *   §12.5 continuous mile cutdowns · the TEMPO slot's shape is `"<N>mi
 *     <phrase>"` and `parseTempoLeadMi` reads that leading number back out.
 *     A per-mile ladder cannot be written in that shape, so closing it means
 *     changing what the tempo slot emits — a `layoutWeek` change, not a
 *     catalogue one. The same session is also the open §12.5 dose/zone finding
 *     (it ships 4 mi at T against a documented 5-7 mi at MP+15 → HM).
 *
 *   §13.1 descending ladder, collapsed to ONE rung · `sizeFromPrescription`
 *     cuts an unaffordable sequence down, and can cut it to a single step
 *     ("1×1600m @ 10K"). `renderPrescription` refuses to AUTHOR a one-rep set;
 *     the affordability cut has no such rule. Recorded as its own finding.
 *
 * Both are named so the next pass starts from the evidence rather than from a
 * number. The ratchet may shrink; it may never grow.
 */

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
    const bySection = new Map<string, number>();
    const steppedBySection = new Map<string, number>();

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
          if (!isFlatScalar(spec)) {
            steppedBySection.set(entry.section, (steppedBySection.get(entry.section) ?? 0) + 1);
          }
          if (isFlatScalar(spec)) {
            flat++;
            bySection.set(entry.section, (bySection.get(entry.section) ?? 0) + 1);
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
    for (const [sec, n] of [...bySection].sort((a, b) => b[1] - a[1])) {
      console.log(`      flat  ${sec.padEnd(7)} ${String(n).padStart(5)}`);
    }
    for (const [sec, n] of [...steppedBySection].sort((a, b) => b[1] - a[1])) {
      console.log(`      step  ${sec.padEnd(7)} ${String(n).padStart(5)}`);
    }
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

/* ═══════════════════════════ LADDER-TARGET-2 · the rungs, and the token ════
 *
 * The fix half of LADDER-TARGET-1. Everything here asserts the SHAPE the
 * runner receives, not the absence of the old defect (Rule 13: "the bad string
 * is gone" is satisfied by garbage).
 *
 * WHAT THIS CANNOT FAIL ON (Rule 22):
 *
 *   · Whether the middle rungs are the RIGHT paces for this runner. The zones
 *     are doctrine's; the numbers behind them come from the one zone resolver
 *     and are that resolver's to defend.
 *   · The §12.5 continuous cutdown and the collapsed §13.1 ladder — the 497
 *     the census still counts. Both are structural and named beside the
 *     ratchet, and nothing here would notice them getting worse.
 *   · The watch. `steps[]` and `expandSpecToPhases` are pre-existing and
 *     unchanged; the offset resolves to a number before the spec, so there is
 *     no new key for a wire test to check. That is the compatibility argument,
 *     and this file cannot prove it — `check-wire-keys.sh` and the fact that
 *     no key was added are what carry it.
 *   · TWO ADJACENT RUNGS RESOLVING TO THE SAME NUMBER. `resolveZoneAnchors`
 *     prices HM at the threshold anchor (`out.HM = tPaceSec`), which
 *     `Research/01` §"Pace zone shorthand" licenses in as many words — T is
 *     "≈HM pace for sub-elite" — so an MP → HM → T → 10K → 5K ladder ships its
 *     HM and T rungs at one pace. The monotone check below therefore passes on
 *     equality, and reordering HM and T inside `DESCENT_LADDER` would not trip
 *     it; the explicit rung assertion is what catches that. Whether HM should
 *     have its own anchor is the pace resolver's question, not this file's.
 *     The first-to-last assertion below is what stops a ladder resolving
 *     entirely flat.
 */
describe('LADDER-TARGET-2 · a cutdown ships its rungs', () => {
  it('the grammar reads a doctrine offset, and only on the plus side', () => {
    const segs = parseSegments('1km @ MP+10 · 60s jog + 1km @ MP · 60s jog + 1km @ 5K');
    expect(segs, 'the offset token did not parse').toBeTruthy();
    expect(segs!.map((s) => [s.zone, s.zoneOffsetSPerMi])).toEqual([
      ['MP', 10], ['MP', 0], ['5K', 0],
    ]);
    // A minus is the BAND separator in a zone clause and must stay one, or
    // "T-10K" becomes "T minus ten kilometres".
    const band = parseSegments('1mi @ T-10K · 60s jog + 1mi @ 5K');
    expect(band, 'a zone band stopped parsing').toBeTruthy();
    expect(band!.map((s) => s.zoneOffsetSPerMi)).toEqual([0, 0]);
    // An offset with nothing to offset from is junk, not a zone.
    expect(parseSegments('1mi @ +10 · 60s jog + 1mi @ 5K')).toBeNull();
  });

  it('the offset reaches the SPEC as a number, and the label agrees with it', () => {
    const { spec } = buildWorkoutSpec(
      'threshold', 9, 430, null,
      '1mi @ MP+10 · 60s jog + 1mi @ MP · 60s jog + 1mi @ T',
      null, 420, null, 430,
    );
    const s = spec as {
      steps?: Array<{ pace_s_per_mi: number | null; zone: string | null }>;
      rep_count?: number; rep_pace_s_per_mi?: number | null;
    };
    expect(s.steps, 'the session did not build as steps').toBeTruthy();
    expect(s.steps!.length).toBe(3);
    const [a, b] = s.steps!;
    expect(a.zone).toBe('MP+10');
    expect(b.zone).toBe('MP');
    // Rule 16 · the label carries the offset the pace carries.
    expect(a.pace_s_per_mi! - b.pace_s_per_mi!).toBe(10);
    // ADDITIVE · a consumer that has never heard of `steps` still finds a
    // well-formed rep session with the right count and a usable pace. That is
    // today's behaviour for such a consumer, and no worse.
    expect(s.rep_count).toBe(3);
    expect(s.rep_pace_s_per_mi).toBeGreaterThan(0);
  });

  it("the rungs are doctrine's own, read out of the entry at run time", () => {
    const mile = WORKOUT_CATALOGUE.find((e) => e.slug === 'mile-cutdowns')!;
    // §12.2's Pace example is "6 reps: MP+10, MP, MP-10, HM, T, 10K" — an
    // opener above MP, then the zone walk. The engine's six-rep answer is that
    // shape with the descent carried all the way to the entry's own last zone,
    // which is what its Structure row asks for ("Final rep at 5K pace or
    // faster"). Falsified by changing DESCENT_LADDER's order: the walk between
    // MP and 5K stops being MP-HM-T-10K-5K and this fails.
    expect(descentRungs(mile, 6)).toEqual(['MP+10', 'MP', 'HM', 'T', '10K', '5K']);
    expect(descentRungs(mile, 5)).toEqual(['MP', 'HM', 'T', '10K', '5K']);
    // Fewer reps than rungs keeps BOTH endpoints — "start at MP, finish at 5K"
    // is the sentence, and dropping either end says something else.
    const three = descentRungs(mile, 3)!;
    expect(three[0]).toBe('MP');
    expect(three[three.length - 1]).toBe('5K');

    // The per-rep step is the entry's own cited number, converted where the
    // doc states it per kilometre.
    expect(perRepPaceStepSPerMi(mile)).toBe(10);                       // "5–15 s/mi"
    const oneK = WORKOUT_CATALOGUE.find((e) => e.slug === '1k-cutdowns')!;
    expect(perRepPaceStepSPerMi(oneK)).toBe(5);                        // "5 s/mi"
    const canova = WORKOUT_CATALOGUE.find((e) => e.slug === 'canova-2k-repeats')!;
    expect(perRepPaceStepSPerMi(canova)).toBe(6);                      // "2.5–5 s/km"
  });

  it('DECLINES rather than guessing, on every entry that is not a walk', () => {
    // An entry whose cited rows do not state a descent is not turned into one.
    // §5.4's long tempo declares HM and T as the BAND its block sits in, and
    // the first cut of this work rendered it as a two-rung ladder. Caught by
    // `_catalogue_wiring`'s doctrine check, not by review.
    for (const e of WORKOUT_CATALOGUE) {
      if (entryDeclaresProgression(e)) continue;
      expect(descentRungs(e, 4), `${e.slug} was rendered as a descent it does not cite`).toBeNull();
    }
    // An ASCENT is not a descent. §13.3's pyramid declares 5K then 10K.
    const pyramid = WORKOUT_CATALOGUE.find((e) => e.slug === 'up-and-down-pyramid')!;
    expect(descentRungs(pyramid, 4)).toBeNull();
    // A one-rep "set" is not a ladder.
    const oneK = WORKOUT_CATALOGUE.find((e) => e.slug === '1k-cutdowns')!;
    expect(descentRungs(oneK, 1)).toBeNull();
  });

  it('every ladder session the corpus places round-trips label to spec to label', () => {
    // Rule 13's assertion-of-shape: the string the runner reads and the spec
    // the watch runs are the same object twice. A ladder that parsed into
    // steps and then re-derived a generic label would be the SAME defect in a
    // new place.
    const checked: string[] = [];
    for (const e of WORKOUT_CATALOGUE.filter(entryDeclaresProgression)) {
      for (const st of e.structures) {
        if (st.kind !== 'reps') continue;
        for (let reps = st.reps.min; reps <= st.reps.max; reps++) {
          const label = renderPrescription(e, {
            structure: st, reps, atPaceMinutes: 0, atPaceMi: 0,
            recoverySec: st.recoverySec?.min ?? 60,
          });
          if (!label || !label.includes(' + ')) continue;
          const segs = parseSegments(label);
          expect(segs, `${e.slug} rendered "${label}" and the grammar cannot read it back`).toBeTruthy();
          expect(segs!.length, `${e.slug}: "${label}" expands to ${segs!.length} rungs, not ${reps}`).toBe(reps);
          // Monotone: every rung is at or faster than the one before it. Zones
          // are named, so this is checked on the resolved paces.
          const { spec } = buildWorkoutSpec('threshold', reps * 2 + 6, 430, null, label, null, 420, null, 430);
          const steps = (spec as { steps?: Array<{ pace_s_per_mi: number | null }> }).steps ?? [];
          expect(steps.length, `${e.slug}: "${label}" built ${steps.length} steps`).toBe(reps);
          for (let i = 1; i < steps.length; i++) {
            expect(
              steps[i].pace_s_per_mi!,
              `${e.slug}: "${label}" rung ${i + 1} is slower than rung ${i} — a cutdown must descend`,
            ).toBeLessThanOrEqual(steps[i - 1].pace_s_per_mi!);
          }
          // Monotone alone is satisfied by a ladder that resolves entirely
          // flat, which is the defect this whole file exists for. The set must
          // actually get faster end to end.
          expect(
            steps[0].pace_s_per_mi! - steps[steps.length - 1].pace_s_per_mi!,
            `${e.slug}: "${label}" resolves to ONE pace across all ${reps} rungs`,
          ).toBeGreaterThan(0);
          checked.push(`${e.slug}/${reps}`);
        }
      }
    }
    // Rule 18 liveness: this must actually have checked something.
    expect(checked.length, 'no ladder rendered as a sequence — the fix is not wired').toBeGreaterThan(8);
  });
});
