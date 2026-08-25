/**
 * lib/runs/energy.test.ts · the calorie column means ONE quantity.
 *
 * The fixtures are real prod rows, read over `faff_readonly` on 2026-08-24.
 * The ratios in them are not illustrative — they are what the runner's own
 * history holds, and they are the size of the defect this closes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import type { RunData } from '@/lib/runs/run-shape';
import { watchActiveEnergyKcal, estimateActiveEnergyKcal } from './energy';
import { runTotalEnergyKcal, runActiveEnergyKcal } from './coherence';

/* ── REAL ROWS ──────────────────────────────────────────────────────────── */

/** 2026-08-16 · 13.20 mi. The run the owner was looking at. */
const AUG16: RunData = { date: '2026-08-16', distanceMi: 13.20, calories: 2202, kcal: 1807 } as RunData;
/** 2026-06-15 · 6.01 mi. The widest gap in his history, 1.380x. */
const JUN15: RunData = { date: '2026-06-15', distanceMi: 6.01, calories: 999, kcal: 724 } as RunData;
/** 2026-07-12 · 12.60 mi. The narrowest, 1.210x. */
const JUL12: RunData = { date: '2026-07-12', distanceMi: 12.60, calories: 2093, kcal: 1730 } as RunData;
/** 2026-08-23 · 11.01 mi. Watch only — no Strava total ever arrived. */
const AUG23: RunData = { date: '2026-08-23', distanceMi: 11.01, kcal: 1417 } as RunData;
/** 2026-08-01 · 1.34 mi. The ONE canonical row app-wide with a total and no active reading. */
const AUG01: RunData = { date: '2026-08-01', distanceMi: 1.34, calories: 139, avgHr: 138 } as RunData;

describe('the calorie column is active energy, on every row', () => {
  it('a row carrying both reads ACTIVE, not Strava total', () => {
    // THE REGRESSION. Before 2026-08-24 run detail returned 2202 here and the
    // week card returned 2202 via COALESCE, both labelled kcal. The watch had
    // measured 1807 for the same effort and both surfaces ignored it.
    expect(watchActiveEnergyKcal(AUG16)).toBe(1807);
    expect(watchActiveEnergyKcal(JUN15)).toBe(724);
    expect(watchActiveEnergyKcal(JUL12)).toBe(1730);
  });

  it('and the gap it closes is the size the runner could see', () => {
    // The old COALESCE, verbatim: `data->>'calories' ?? data->>'kcal'`.
    const old = (d: RunData) => runTotalEnergyKcal(d) ?? runActiveEnergyKcal(d);
    expect(old(AUG16)! / watchActiveEnergyKcal(AUG16)!).toBeCloseTo(1.219, 3);
    expect(old(JUN15)! / watchActiveEnergyKcal(JUN15)!).toBeCloseTo(1.380, 3);
    expect(old(JUL12)! / watchActiveEnergyKcal(JUL12)!).toBeCloseTo(1.210, 3);
    // Neither of those two numbers is wrong. They answer different questions,
    // and only one of them is the question the column asks.
  });

  it('a watch-only row is unchanged · this was never the broken half', () => {
    expect(watchActiveEnergyKcal(AUG23)).toBe(1417);
  });

  it('a total-only row yields NO active figure · a refusal, not a conversion', () => {
    // The whole argument in one assertion. `Research/` supplies no resting- or
    // basal-metabolic rate, so there is no citable factor to divide 139 by,
    // and inventing the observed mean 1.314x would be curve-fitting this
    // runner's 25 rows and calling it physiology (CLAUDE.md Rule 7).
    //
    // The run is not left blank — the ladder falls through to HealthKit and
    // then to a MARKED estimate, both of which measure or model the right
    // quantity. What it must never do is print 139 under a label that means
    // active energy.
    expect(watchActiveEnergyKcal(AUG01)).toBeNull();
    expect(runTotalEnergyKcal(AUG01)).toBe(139);
  });

  it('the estimator is an active-energy formula and refuses without inputs', () => {
    // 2026-08-01 · 1.34 mi at avg HR 138, against his latest stored 85.2 kg.
    expect(estimateActiveEnergyKcal({ distanceMi: 1.34, weightKg: 85.2, avgHr: 138 })).toBe(123);
    // No distance, no estimate. No weight, no estimate. No guessing either.
    expect(estimateActiveEnergyKcal({ distanceMi: 0, weightKg: 85.2, avgHr: 138 })).toBeNull();
    expect(estimateActiveEnergyKcal({ distanceMi: 6, weightKg: null, avgHr: 140 })).toBeNull();
    // An implausible body mass is refused rather than priced. The week seed's
    // private copy of this formula had no such gate at all, which is how two
    // estimators for one column had already drifted apart before anyone was
    // reading them side by side.
    expect(estimateActiveEnergyKcal({ distanceMi: 6, weightKg: 210, avgHr: 140 })).toBeNull();
    expect(estimateActiveEnergyKcal({ distanceMi: 6, weightKg: 12, avgHr: 140 })).toBeNull();
    // Worth being exact about what the gate does NOT catch: a body mass
    // recorded in POUNDS for a runner this size lands near 188, inside the
    // band, and would be priced as kilograms. The gate rejects the absurd,
    // not the mislabelled, and claiming otherwise would be the same class of
    // overstatement this whole change is about.
    expect(estimateActiveEnergyKcal({ distanceMi: 6, weightKg: 188, avgHr: 140 })).not.toBeNull();
  });

  it('the HR multiplier is bounded, and a missing HR does not inflate a run', () => {
    const flat = estimateActiveEnergyKcal({ distanceMi: 10, weightKg: 80, avgHr: null })!;
    const easy = estimateActiveEnergyKcal({ distanceMi: 10, weightKg: 80, avgHr: 130 })!;
    const hard = estimateActiveEnergyKcal({ distanceMi: 10, weightKg: 80, avgHr: 170 })!;
    const absurd = estimateActiveEnergyKcal({ distanceMi: 10, weightKg: 80, avgHr: 260 })!;
    expect(easy).toBe(flat);                    // no HR is priced as HR 130
    expect(hard / flat).toBeCloseTo(1.20, 2);   // +20% at threshold
    expect(absurd).toBe(hard);                  // and never more, whatever arrives
  });

  it('the ladder cannot be handed a total, by construction', () => {
    // Not a behaviour test — a SHAPE test, and the strongest guard in the
    // change. `ActiveEnergyInput` has no field a Strava total could arrive
    // in, so the tier-1 defect cannot be reintroduced by a caller passing the
    // wrong argument. It can only come back by someone editing energy.ts,
    // where the argument for refusing it is written down.
    const src = fs.readFileSync(path.join(__dirname, 'energy.ts'), 'utf8');
    const iface = /export interface ActiveEnergyInput \{[\s\S]*?\n\}/.exec(src)?.[0] ?? '';
    expect(iface).not.toBe('');
    // The FIELD NAMES, not the prose. The doc comment inside says "Strava"
    // and "total" precisely because it is explaining their absence.
    const fields = [...iface.matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1]);
    expect(fields).toContain('watchActiveKcal');
    for (const f of fields) {
      expect(f, `${f} · a total may not enter the active-energy ladder`)
        .not.toMatch(/total|strava|calories/i);
    }
  });

  it('no HealthKit window tier · the table cannot answer that question', () => {
    /* Measured on prod 2026-08-24, and this is a finding rather than a tidy-up.
     *
     * `health_samples` carries UNIQUE (user_id, sample_type, sample_date), so
     * it holds ONE active_energy row per user per day — 123 rows, 123
     * distinct (user, day) pairs, never two for one day. The health ingest
     * route pre-aggregates the phone's 15-second buckets into that daily
     * total deliberately, and stamps `recorded_at` with the INGEST BATCH
     * TIME. Every one of David's 123 rows reads 2026-08-25 02:58 UTC.
     *
     * The tier that summed samples "inside the run's window" was therefore
     * asking when the phone last synced. It matched zero samples across all
     * 106 canonical rows that reached it. And if a background sync had ever
     * landed mid-run it would have summed whole DAILY TOTALS and returned
     * them as this run's cost with measured: true — a day's energy printed as
     * an hour's, and printed as measured.
     *
     * Keyed on the source file so re-adding the query has to argue with this
     * comment first. */
    const src = fs.readFileSync(path.join(__dirname, 'energy.ts'), 'utf8');
    expect(src).not.toMatch(/sample_type\s*=\s*'active_energy'/);
    expect(src).not.toMatch(/source:\s*'healthkit'/);
  });

  it('the total is still readable by name · it is data, not a mistake', () => {
    // Refusing to DISPLAY a total is not refusing to hold one. Strava's
    // number is a sound reading of a different quantity and `pullSync`
    // rightly keeps storing it under Strava's own name.
    expect(runTotalEnergyKcal(AUG16)).toBe(2202);
    expect(runActiveEnergyKcal(AUG16)).toBe(1807);
  });
});
