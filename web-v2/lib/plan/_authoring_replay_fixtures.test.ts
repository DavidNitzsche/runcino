/**
 * AUTHORING-REPLAY GATE (2026-09-01) · authoring and recomputation are ONE
 * brain, proved on the runner shapes the DB-backed proof cannot reach.
 *
 * ── THE PROPERTY ────────────────────────────────────────────────────────────
 *
 * With UNCHANGED EVIDENCE, an immediate recomputation must produce zero
 * material change. `scripts/p0-proof/authoring-recompute-parity.ts` proves
 * that against the owner's live plan (77 rows, 0 changed at the plan's own
 * stamped anchors). It can only ever prove it for accounts that exist.
 *
 * This is the same property for the four shapes the golden-runner set names
 * and production does not have: a COLD START with nothing logged, a SPARSE
 * history, a RETURNING runner off a layoff, and an AGGRESSIVE GOAL against a
 * modest base.
 *
 * ── WHY THE HOP IS NOT TRIVIALLY IDENTITY ───────────────────────────────────
 *
 * It would be, if authoring stored what it composed. It does not — the write
 * is LOSSY on purpose, and `persistedDayShape`'s own header says so:
 *
 *   · `distance_mi` becomes the SPEC's summed total, not the composed day's
 *     distance (a 4-mile threshold core is stored as its 8-mile whole);
 *   · `sub_label` is RE-DERIVED from the spec, so the composer's own string
 *     is replaced by `subLabelFromSpec`.
 *
 * A recompute then re-prices from those STORED values. So the replay below is
 * a real round trip: compose → persist-shape → re-price off the persisted row,
 * at the SAME anchors. Any disagreement between what the composer wrote and
 * what the stored row re-derives shows up here as a moved pace, band, HR cap
 * or kind — which is exactly the LABELTRUTH drift class this codebase has paid
 * for twice, caught before it needs an account to appear on.
 *
 * ── RULE 22 · WHAT THIS GATE CANNOT FAIL ON ─────────────────────────────────
 *
 *   · It holds the ANCHORS FIXED by construction, which is the point (the
 *     question is "does the same brain answer the same way", not "did the
 *     evidence move"). It therefore says nothing about whether the anchors
 *     themselves are right — that is the capacity resolvers' own suites.
 *   · It replays the PRICING hop only. Structure (which day, what distance,
 *     which phase) is not repriced by a recompute by construction, so a
 *     structural defect passes here and belongs to `_sweep_allusers`.
 *   · It cannot catch a WIRING defect in `loadGeneratorInputs`: these runners
 *     are composed through `buildSimPlan`, so a real authoring that stopped
 *     calling `resolvePrescribedPaceAnchors` would still pass.
 *   · The four shapes are FOUR. Breadth is the corpus's job.
 */
import { describe, it, expect } from 'vitest';
import { buildSimPlan } from './sim-inputs';
import { persistedDayShape } from './generate';
import { buildWorkoutSpec } from './spec-builder';
import { subLabelFromSpec } from '@/lib/training/expand-spec';

/**
 * `formatMi` renders a stored sub_label to a TENTH of a mile, so a recompute
 * off that label can only ever recover the session to that precision. One
 * tenth is therefore the bound the first recompute may quantise within;
 * anything larger is the session being re-sized, which is drift, not rounding.
 *
 * MEASURED, not assumed. Set to 0.05 first — half a step — and the gate
 * reported one real finding on the returning-runner fixture:
 *
 *   2026-10-05 threshold "6x1km @ ST pace · 60s jog"  cooldown_mi 1.8 -> 1.9
 *
 * That label states its reps and NOT its warm-up or cool-down, so the
 * recompute re-derives them from the stored total, and the two land one full
 * rendering step apart. It is idempotent (pass two does not move it again), so
 * it settles rather than accumulating — a quantisation, which is what this
 * bound exists to permit. Kept at one step rather than widened past it: the
 * injected falsifier (a label overstating its at-pace block by a mile) is ten
 * steps out and still fails.
 */
const LABEL_PRECISION_MI = 0.1;
import { HISTORY_SHAPES, renderHistory } from './history-shapes';

const LTHR = 168;
const MAX_HR = 183;

interface Shape {
  name: string;
  /** What a coach should be able to say about this runner in one line. */
  expect: string;
  input: Record<string, unknown>;
}

/** A rendered history for one of the corpus's own shapes. */
function history(id: string, sustainedMi: number, freq: number) {
  const spec = HISTORY_SHAPES.find((s) => s.id === id);
  if (!spec) throw new Error(`history shape "${id}" is gone · the replay fixtures name it`);
  return renderHistory(spec, sustainedMi, freq);
}

const SHAPES: Shape[] = [
  {
    name: 'cold start · nothing logged, no PR',
    expect: 'priced off a population prior, and it still round-trips',
    input: {
      goalMode: 'race', distance: 'half', experienceLevel: 'beginner',
      weeklyFrequency: 3, weeklyMileageBucket: 0, longestRunBucket: '0-3',
      longRunDay: 'sun', restDay: 'fri',
      // INSIDE the half's own build window (`BUILD_WINDOW_WEEKS.hm` = 12).
      // Dated further out the engine correctly answers MAINTENANCE — a
      // holding block, not a build — and the replay would be measuring the
      // wrong composer.
      startDateISO: '2026-08-31', raceDateISO: '2026-11-08',
      goalTimeSec: null, planWeeks: 0,
      lastRaceFinishedDaysAgo: 0, lastRaceDistance: null,
      raceHistory: [], availableDays: [],
    },
  },
  {
    name: 'sparse history · a few weeks, thin and irregular',
    expect: 'a real but thin base; the block opens conservatively',
    input: (() => {
      const h = history('fromNothing', 18, 3);
      return {
        goalMode: 'race', distance: '10k', experienceLevel: 'beginner',
        weeklyFrequency: 3, weeklyMileageBucket: 10, longestRunBucket: '3-6',
        longRunDay: 'sun', restDay: 'fri',
        startDateISO: '2026-08-31', raceDateISO: '2026-11-15',
        goalTimeSec: null, planWeeks: 0,
        lastRaceFinishedDaysAgo: 0, lastRaceDistance: null,
        raceHistory: [], availableDays: [],
        dailyMiMostRecentFirst: h.dailyMiMostRecentFirst,
        recentQualityPerWeek: h.recentQualityPerWeek,
        recentQualityDistanceMi: h.recentQualityDistanceMi,
        isMidBlock: false,
      };
    })(),
  },
  {
    name: 'returning runner · off a short layoff, base half rebuilt',
    expect: 'the restoration ladder runs and the prices still round-trip',
    input: (() => {
      const h = history('shortLayoff', 40, 5);
      return {
        goalMode: 'race', distance: 'marathon', experienceLevel: 'intermediate',
        weeklyFrequency: 5, weeklyMileageBucket: 35, longestRunBucket: '10+',
        longRunDay: 'sun', restDay: 'fri',
        startDateISO: '2026-08-31', raceDateISO: '2026-12-06',
        goalTimeSec: 13500, planWeeks: 0,
        lastRaceFinishedDaysAgo: 0, lastRaceDistance: null,
        raceHistory: [{ distance: 'half', timeSec: 6300, whenRaced: '<6mo' }],
        availableDays: [],
        dailyMiMostRecentFirst: h.dailyMiMostRecentFirst,
        recentQualityPerWeek: h.recentQualityPerWeek,
        recentQualityDistanceMi: h.recentQualityDistanceMi,
        isMidBlock: false,
      };
    })(),
  },
  {
    name: 'aggressive goal · sub-3 marathon off a modest base',
    expect: 'the goal moves the RACE row and nothing else; training still round-trips',
    input: (() => {
      const h = history('steady', 32, 5);
      return {
        goalMode: 'race', distance: 'marathon', experienceLevel: 'intermediate',
        weeklyFrequency: 5, weeklyMileageBucket: 30, longestRunBucket: '10+',
        longRunDay: 'sun', restDay: 'fri',
        startDateISO: '2026-08-31', raceDateISO: '2026-12-06',
        goalTimeSec: 10800, planWeeks: 0,
        lastRaceFinishedDaysAgo: 0, lastRaceDistance: null,
        raceHistory: [{ distance: 'half', timeSec: 6600, whenRaced: '<6mo' }],
        availableDays: [],
        dailyMiMostRecentFirst: h.dailyMiMostRecentFirst,
        recentQualityPerWeek: h.recentQualityPerWeek,
        recentQualityDistanceMi: h.recentQualityDistanceMi,
        isMidBlock: false,
      };
    })(),
  },
];

interface Moved {
  date: string; type: string; label: string | null; field: string;
  authored: unknown; replayed: unknown;
}

/** Compose, take the authoring hop, then re-price off the PERSISTED row at the
 *  same anchors — the exact shape `recomputePacesForPlan` re-prices in. */
function replay(input: Record<string, unknown>): { rows: number; moved: Moved[]; note: string } {
  const built = buildSimPlan(input as unknown as Parameters<typeof buildSimPlan>[0]);
  if (!built.ok) return { rows: 0, moved: [], note: `compose refused: ${(built as { reason: string }).reason}` };
  const anchors = built.composed.paceAnchors ?? null;
  const goalPaceSec = built.derived.goalPaceSec ?? null;
  const moved: Moved[] = [];
  let rows = 0;

  for (const w of built.composed.weeks) {
    const weekT = w.tPaceSec ?? built.composed.tPaceSec ?? null;
    for (const d of w.days) {
      if (d.type === 'rest' || d.distanceMi <= 0) continue;
      // Race rows are owned by the race-row refresh, not by the generic
      // recompute loop, and the live proof excludes them for the same reason.
      if (d.type === 'race' || d.type === 'race_week_tuneup') continue;
      rows++;

      const authored = persistedDayShape(d, weekT, {
        lthr: LTHR, maxHr: MAX_HR, goalPaceSec,
        easyAnchorTSec: anchors?.easyCeilingSecPerMi ?? null,
        anchors,
      });

      // THE RECOMPUTE HOP · off the STORED row (its re-derived sub_label and
      // its spec-summed distance), at the SAME anchors, exactly as
      // `recomputePacesForPlan` calls it.
      const replayed = buildWorkoutSpec(
        authored.type, authored.distanceMi,
        anchors?.thresholdSecPerMi ?? weekT ?? 0,
        LTHR, authored.subLabel, MAX_HR, goalPaceSec,
        anchors?.intervalSecPerMi ?? null,
        anchors?.thresholdSecPerMi ?? null,
        false, null, anchors,
      );

      // THE THIRD PASS · a recompute off the row the SECOND pass would store.
      // This is what makes the gate meaningful; see the note below.
      const restored = subLabelFromSpec(replayed.spec as Parameters<typeof subLabelFromSpec>[0]) ?? authored.subLabel;
      const replayedTwice = buildWorkoutSpec(
        authored.type, authored.distanceMi,
        anchors?.thresholdSecPerMi ?? weekT ?? 0,
        LTHR, restored, MAX_HR, goalPaceSec,
        anchors?.intervalSecPerMi ?? null,
        anchors?.thresholdSecPerMi ?? null,
        false, null, anchors,
      );

      const a = (authored.workoutSpec ?? {}) as Record<string, unknown>;
      const b = (replayed.spec ?? {}) as Record<string, unknown>;
      const c = (replayedTwice.spec ?? {}) as Record<string, unknown>;
      const date = `${w.startISO}+${d.dow}`;

      /* ── WHAT IS ASSERTED, AND WHY IT IS NOT BYTE-EQUALITY ─────────────────
       *
       * PRICE fields must be identical on the first recompute. That is the
       * property the live proof reports (77 rows, 0 changed) and it is what a
       * runner actually reads off the row.
       *
       * STRUCTURE cannot be asserted byte-equal, and finding that out is what
       * this gate was for. `sub_label` is rendered through `formatMi`, which
       * is 0.1-mile precise, so a rep the composer sized at 0.746 mi is stored
       * as "0.75 mi" and re-parsed as 0.75. That is a QUANTISATION to the
       * stored row's own precision, not a drift: it happens once and then
       * stops.
       *
       * So the structural assertion is IDEMPOTENCE — the second recompute is a
       * no-op — plus a bound on how far the first pass may quantise. A real
       * drift does not converge: with the tempo label overstating its block by
       * a mile, pass two adds another mile and pass three another, and this
       * fails on the first step. Both falsifiers named in the header fail
       * against this formulation; neither failed against plain byte-equality
       * on the price fields alone. */
      for (const f of ['pace_target_s_per_mi_lo', 'pace_target_s_per_mi_hi', 'hr_cap_bpm', 'kind'] as const) {
        if (JSON.stringify(a[f] ?? null) !== JSON.stringify(b[f] ?? null)) {
          moved.push({ date, type: d.type, label: authored.subLabel, field: f, authored: a[f] ?? null, replayed: b[f] ?? null });
        }
      }
      if ((authored.paceTargetSPerMi ?? null) !== (replayed.paceTargetSPerMi ?? null)) {
        moved.push({
          date, type: d.type, label: authored.subLabel, field: 'pace_target_s_per_mi',
          authored: authored.paceTargetSPerMi ?? null, replayed: replayed.paceTargetSPerMi ?? null,
        });
      }
      const STRUCTURAL = [
        'rep_count', 'rep_distance_mi', 'rep_rest_s',
        'tempo_distance_mi', 'warmup_mi', 'cooldown_mi', 'work_mi',
      ] as const;
      for (const f of STRUCTURAL) {
        // IDEMPOTENCE · pass two must not move what pass one settled.
        if (JSON.stringify(b[f] ?? null) !== JSON.stringify(c[f] ?? null)) {
          moved.push({ date, type: d.type, label: authored.subLabel, field: `${f} (not idempotent)`, authored: b[f] ?? null, replayed: c[f] ?? null });
        }
        // BOUNDED · and pass one may only quantise to the label's own
        // precision, never re-size the session.
        const av = a[f]; const bv = b[f];
        if (typeof av === 'number' && typeof bv === 'number' && Math.abs(av - bv) > LABEL_PRECISION_MI + 1e-9) {
          moved.push({ date, type: d.type, label: authored.subLabel, field: `${f} (beyond label precision)`, authored: av, replayed: bv });
        }
      }
    }
  }
  return { rows, moved, note: '' };
}

describe('authoring → recompute replay · unchanged evidence moves nothing', () => {
  for (const shape of SHAPES) {
    it(`${shape.name} · ${shape.expect}`, () => {
      const { rows, moved, note } = replay(shape.input);
      // LIVENESS (Rule 18 point 2). A shape whose compose refused, or that
      // produced no priceable rows, must FAIL rather than report clean — a
      // replay over zero rows is the "scanner that opened nothing" shape.
      expect(rows, `no priceable rows for "${shape.name}"${note ? ` · ${note}` : ''} · the replay is checking nothing`)
        .toBeGreaterThan(10);
      expect(
        moved,
        `Recomputing "${shape.name}" immediately, at the SAME anchors, moved ${moved.length} field(s).\n`
        + 'Authoring and recomputation must be one brain: with unchanged evidence the second pass\n'
        + 'is a no-op. A move here means the composer wrote something the stored row re-derives\n'
        + 'differently (the LABELTRUTH drift class).\n  '
        + moved.map((m) => `${m.date} ${m.type} "${m.label}" ${m.field}: ${JSON.stringify(m.authored)} → ${JSON.stringify(m.replayed)}`).join('\n  '),
      ).toEqual([]);
    });
  }

  it('the four shapes are genuinely different runners, not one fixture four times', () => {
    const fingerprints = SHAPES.map((s) => {
      const built = buildSimPlan(s.input as unknown as Parameters<typeof buildSimPlan>[0]);
      if (!built.ok) return `refused:${s.name}`;
      const peak = Math.max(0, ...built.composed.weeks.map((w) => w.weeklyMi ?? 0));
      return `${built.composed.totalWeeks}w peak${peak} T${built.composed.paceAnchors?.thresholdSecPerMi ?? 'none'}`;
    });
    // Rule 22: a corpus of four identical runners proves one thing four times.
    expect(new Set(fingerprints).size, `the fixtures collapsed onto each other: ${fingerprints.join(' | ')}`)
      .toBe(SHAPES.length);
  });
});
