/**
 * VOCAB-CATALOGUE-1 · the catalogue is WIRED, and stays wired.
 *
 * `lib/workout-catalogue/` shipped complete and unread: 59 of
 * `Research/04-workout-vocabulary.md`'s named workouts as cited data, §15's
 * placement table and §16's combinations-to-avoid as a selection algorithm, and
 * no importer anywhere in `lib/plan/`. The composer meanwhile looked a session
 * up in a fixed table of one string per (family, distance), which is why every
 * hills slot in every week of every plan read the same fifteen words.
 *
 * `lib/plan/catalogue-rx.ts` is the door and this file is its gate. Three
 * claims, in the order they would break:
 *
 *   1 · EVERY RENDERED PRESCRIPTION ROUND-TRIPS. The string is what
 *       `buildWorkoutSpec` builds the session from, so a shape the parser reads
 *       differently from the way it was written IS the sub_label/spec drift
 *       this codebase has already paid for twice. Asserted over the whole
 *       catalogue rather than over the entries a plan happens to draw.
 *   2 · THE COMPOSER ACTUALLY CONSULTS IT. A plan carries sessions that only
 *       the catalogue can produce, and no week runs the same one twice.
 *   3 · THE REFUSAL PATH IS REACHABLE AND SAFE. Nothing degenerate is authored
 *       on a small week, and the plan still validates.
 *
 * Run: ./node_modules/.bin/vitest run lib/plan/_catalogue_wiring.test.ts
 */
import { describe, it, expect } from 'vitest';
import { buildSimPlan } from './sim-inputs';
import { WORKOUT_CATALOGUE } from '@/lib/workout-catalogue/catalogue';
import { selectWorkout, type Slot } from '@/lib/workout-catalogue/select';
import { ALL_DISTANCES, DOCTRINE_PHASES, TIERS, type PaceZone } from '@/lib/workout-catalogue/types';
import { anchorsFor, renderPrescription, renderContinuousPhrase } from './catalogue-rx';
import { parsePrescription, parseSegments, parseTimeReps, parseTempoLeadMi } from './prescription-parser';
import { buildWorkoutSpec } from './spec-builder';

const base = {
  startDateISO: '2026-07-06', raceDateISO: '2027-03-01', lastRaceFinishedDaysAgo: 0,
  lastRaceDistance: null, raceHistory: [], longRunDay: 'sun', restDay: 'sat', availableDays: [],
} as any;

/** The anchor set the composer can honestly supply · see `anchorsFor`. */
const ANCHORS = anchorsFor({ tPaceSec: 435, iPaceSec: 400 });

function qualityShapes(cfg: Record<string, unknown>): string[] {
  const r = buildSimPlan(cfg as never);
  if (!r.ok) throw new Error(`sim build failed: ${JSON.stringify(r)}`);
  const out = new Set<string>();
  for (const w of r.composed.weeks) {
    for (const d of w.days) if (d.isQuality && d.subLabel && d.type !== 'race') out.add(d.subLabel);
  }
  return [...out];
}

describe('VOCAB-CATALOGUE-1 · every rendered prescription round-trips', () => {
  it('walks the whole catalogue and reads back what it wrote', () => {
    const slots: Slot[] = ['threshold', 'intervals', 'tempo'];
    let rendered = 0;
    const drift: string[] = [];

    for (const distance of ALL_DISTANCES) {
      for (const phase of DOCTRINE_PHASES) {
        for (const tier of TIERS) {
          for (const slot of slots) {
            // A wide week so affordability rarely binds — this test is about the
            // RENDERING, not about what a small runner can pay for.
            const res = selectWorkout({
              phase, distance, tier, weekIndex: 0, weeklyMi: 90, slot, anchors: ANCHORS,
            });
            if (!res.ok) continue;
            const s = slot === 'tempo'
              ? renderContinuousPhrase(res.entry, res.dose)
              : renderPrescription(res.entry, res.dose);
            if (s == null) continue;
            rendered++;

            if (slot === 'tempo') {
              // A phrase, never a sized string: `layoutWeek` writes the miles in
              // front of it and `parseTempoLeadMi` reads them back.
              if (parseTempoLeadMi(s) != null) drift.push(`${res.entry.slug}: tempo phrase leads with a size — "${s}"`);
              if (/@\s*MP\b/i.test(s)) drift.push(`${res.entry.slug}: tempo phrase declares MP, which dosePaceOf would charge to the marathon budget — "${s}"`);
              if (parseTempoLeadMi(`5mi ${s}`) !== 5) drift.push(`${res.entry.slug}: composed tempo label does not read back — "5mi ${s}"`);
              continue;
            }

            // GRAMMAR-SEQ · an UNEQUAL-STEP session's label has no single
            // leading rep count to compare against `dose.reps` — §9.2's Mona
            // fartlek is "2×90s + 4×60s + 4×30s + 4×15s", where the leading
            // two is the first segment and the dose's fourteen is every step.
            // The round-trip claim still applies, in the grammar the label is
            // actually written in: the segments must read back, and they must
            // sum to the dose. Reading `2` off the front and calling it drift
            // was the test's model of a shape the engine renders correctly —
            // caught when a rotation change first made §9.2 the index-0 pick
            // on this slot, having never been reachable there before.
            if (res.dose.structure.kind === 'sequence') {
              const segs = parseSegments(s);
              if (!segs) {
                drift.push(`${res.entry.slug}: unequal-step label does not parse as segments — "${s}"`);
              } else if (segs.length !== res.dose.reps) {
                drift.push(`${res.entry.slug}: label carries ${segs.length} steps, the dose is ${res.dose.reps} — "${s}"`);
              }
              continue;
            }

            const dist = parsePrescription(s);
            const timed = dist ? null : parseTimeReps(s);
            if (!dist && !timed) {
              drift.push(`${res.entry.slug}: "${s}" parses as neither a distance nor a time rep set`);
              continue;
            }
            const reps = dist ? dist.reps : timed!.reps;
            if (reps !== res.dose.reps) {
              drift.push(`${res.entry.slug}: label says ${reps} reps, the dose is ${res.dose.reps} — "${s}"`);
            }
            if (reps < 2) {
              drift.push(`${res.entry.slug}: a one-rep set is not a rep set — "${s}"`);
            }
            // The spec a watch would run must agree with the label. The day is
            // sized the way `composeQualityDay` sizes it — work plus jog floats
            // plus doctrine's warm-up and cool-down — because spec-builder
            // re-clamps the rep count to whatever budget it is handed, and a
            // budget this test invented would measure that clamp instead of the
            // rendering.
            const repMi = dist ? dist.repDistanceMi : timed!.durationS / 435;
            const restS = (dist ? dist.restS : timed!.restS) ?? 90;
            const budget = reps * repMi + Math.max(0, reps - 1) * (restS / 540) + 5;
            const { spec } = buildWorkoutSpec(
              slot === 'intervals' ? 'intervals' : 'threshold', budget, 435, 160, s,
            );
            const sp = spec as Record<string, unknown>;
            if (sp.rep_count !== reps) {
              drift.push(`${res.entry.slug}: spec builds ${String(sp.rep_count)} reps under a ${reps}-rep label — "${s}"`);
            }
          }
        }
      }
    }

    expect(rendered, 'the selector rendered nothing at all — the wiring is dead').toBeGreaterThan(30);
    expect(drift.slice(0, 10).join('\n')).toBe('');
  });

  it('renders no session doctrine does not state', () => {
    // Every rep count and rep length in a rendered string has to come out of the
    // entry's own bands. The catalogue quotes the doc row each band was read
    // from, so this is the line between "transcribed" and "invented".
    for (const entry of WORKOUT_CATALOGUE) {
      for (const structure of entry.structures) {
        if (structure.kind !== 'reps') continue;
        const s = renderPrescription(entry, {
          structure, reps: structure.reps.max, atPaceMinutes: 0, atPaceMi: 0,
          recoverySec: structure.recoverySec?.min ?? 0,
        });
        if (s == null) continue;
        const m = s.match(/^(\d+)×/);
        expect(m, `${entry.slug}: "${s}" does not open with a rep count`).not.toBeNull();
        const reps = Number(m![1]);
        expect(reps, `${entry.slug}: ${reps} reps is outside doctrine's ${structure.reps.min}-${structure.reps.max}`)
          .toBeLessThanOrEqual(structure.reps.max);
        expect(reps).toBeGreaterThanOrEqual(structure.reps.min);
      }
    }
  });
});

describe('VOCAB-CATALOGUE-1 · the composer consults it', () => {
  const MARATHON = {
    ...base, goalMode: 'goal', distance: 'marathon', experienceLevel: 'advanced',
    weeklyMileageBucket: 55, weeklyFrequency: 6, planWeeks: 18, goalTimeSec: 11400,
    longestRunBucket: '10+', bestRecentVdotOverride: 48,
  };

  it('draws more than one hill session, which the old fixed table could not', () => {
    // The engine emitted `6×90s hills @ 5K-10K effort · 2:30 jog down` for every
    // hills slot, at every distance, in every week. §8 writes five hill
    // sessions; the plan now rotates through them.
    const hills = qualityShapes(MARATHON).filter((s) => /hill/i.test(s));
    expect(new Set(hills).size, `only one hill shape: ${hills}`).toBeGreaterThanOrEqual(2);
  });

  it('carries §11.2 Canova repeats with the zone walk the doc states', () => {
    // "Pace | Start slightly slower than MP; descend across reps to slightly
    // faster than T". The arrow is rendered from the entry's own `zones`.
    //
    // ZONE-R-1 (2026-08-19) · asserted on the RENDERING rather than on this
    // plan's draw. The threshold slot's candidate pool went from five entries
    // to eight when MP and ST became anchorable, and a least-recently-used
    // rotation over eight with two catalogue-won slots in the phase does not
    // land on any particular one — so pinning the claim to a plan measured
    // whichever way the tie-break fell rather than whether the engine can say
    // the thing. This asks the question directly, on the entry itself, and it
    // is the stronger form: it holds for every plan that draws §11.2 rather
    // than for one that happens to.
    const entry = WORKOUT_CATALOGUE.find((e) => e.slug === 'canova-2k-repeats');
    expect(entry, '§11.2 is no longer in the catalogue').toBeTruthy();
    const structure = entry!.structures.find((s) => s.kind === 'reps');
    expect(structure, '§11.2 no longer carries a rep structure').toBeTruthy();
    const rendered = renderPrescription(entry!, {
      structure: structure!, reps: 4, atPaceMinutes: 0, atPaceMi: 0, recoverySec: 120,
    });
    expect(rendered, `§11.2 renders as "${rendered}"`).toMatch(/×2km · MP → T/);

    // And the marathon build still carries marathon-pace work, whichever of the
    // phase's MP entries the rotation lands on.
    const shapes = qualityShapes(MARATHON);
    expect(shapes.some((s) => /\bMP\b/.test(s)), `no marathon-pace work at all: ${shapes}`).toBe(true);
  });

  it('never places the same session twice in one week', () => {
    const r = buildSimPlan(MARATHON as never);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const w of r.composed.weeks) {
      const q = w.days.filter((d) => d.isQuality && d.type !== 'race').map((d) => d.subLabel);
      expect(new Set(q).size, `${w.phase} repeats a session: ${q.join(' | ')}`).toBe(q.length);
    }
  });

  it('regenerates byte-identically · the selection is a pure function of state', () => {
    // No `Math.random`, no clock. The rotation is least-recently-used over a
    // history the composer threads week to week, so two runs must agree exactly.
    const a = buildSimPlan(MARATHON as never);
    const b = buildSimPlan(MARATHON as never);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(JSON.stringify(a.composed.weeks)).toBe(JSON.stringify(b.composed.weeks));
  });
});

describe('VOCAB-CATALOGUE-1 · the refusal path', () => {
  it('declines every paced session on a week that cannot afford one', () => {
    // 15 mi/wk · Daniels' 10% leaves 1.5 threshold miles and §5.2's shortest
    // continuous tempo is twenty minutes. The honest answer is no paced quality
    // session, and the selector gives it.
    const res = selectWorkout({
      phase: 'specific_support', distance: 'hm', tier: 'intermediate',
      weekIndex: 0, weeklyMi: 15, slot: 'tempo', anchors: ANCHORS,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('no-quality-fits');
  });

  it('keeps effort-cued work at the volume where paced work is refused', () => {
    // §8.1's pace column is "5K–10K effort", never a number, so a hill session
    // spends no at-pace share and survives the week that refuses a tempo.
    const res = selectWorkout({
      phase: 'hill_strength', distance: 'hm', tier: 'intermediate',
      weekIndex: 0, weeklyMi: 15, slot: 'intervals', anchors: ANCHORS,
    });
    expect(res.ok, `nothing survived a 15 mi/wk week`).toBe(true);
    if (!res.ok) return;
    expect(res.entry.effortOnly).toBe(true);
    expect(renderPrescription(res.entry, res.dose)).toMatch(/hills|by effort/);
  });

  it('a runner with no pace anchors is declined, not paced by inference', () => {
    const res = selectWorkout({
      phase: 'specific_support', distance: 'm', tier: 'intermediate',
      weekIndex: 0, weeklyMi: 55, slot: 'threshold', anchors: {} as Partial<Record<PaceZone, number>>,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('no-anchor');
  });

  it('a low-volume plan still composes and still validates', () => {
    // The refusal must not leave a hole. Every archetype below is a week the
    // selector declines paced work on; the composer falls back to the generic
    // prescription, which the dosing caps bound just as tightly.
    for (const distance of ['5k', 'half', 'marathon'] as const) {
      const shapes = qualityShapes({
        ...base, goalMode: 'goal', distance, experienceLevel: 'intermediate',
        weeklyMileageBucket: 15, weeklyFrequency: 4, planWeeks: 12,
        goalTimeSec: distance === '5k' ? 1500 : distance === 'half' ? 7200 : 15000,
        longestRunBucket: '6-10',
      });
      expect(shapes.length, `${distance} at 15 mi/wk composed no quality at all`).toBeGreaterThan(0);
    }
  });
});
