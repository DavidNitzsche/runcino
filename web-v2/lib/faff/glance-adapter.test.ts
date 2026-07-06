import { describe, it, expect } from 'vitest';
import { getPersonaGlanceState } from './personas';
import { resolveDayState, buildPoster, buildSibling } from './glance-adapter';
import type { GlanceState, GlanceWeekDay } from '@/lib/coach/glance-state';
import type { WorkoutSpec } from '@/lib/faff/types';

/**
 * E5 · the done-state must reflect how the run ACTUALLY went, not blanket
 * "NAILED IT". `alex` is the persona that ran today (drives done_nailed); we
 * override `todayExecution` (the verdict glance-state derives from the frozen
 * phases) to exercise each branch. Short stays done_nailed at the STATE level
 * (no new DayState / no iPhone enum change) but flips the verb / stat / prose.
 */
describe('E5 · done-state reflects how the run went', () => {
  const doneGlance = (exec: GlanceState['todayExecution']): GlanceState =>
    ({ ...getPersonaGlanceState('alex'), todayExecution: exec });

  it('nailed → done_nailed · NAILED IT · ✓ PLAN HIT', () => {
    const g = doneGlance('nailed');
    expect(resolveDayState(g)).toBe('done_nailed');
    const p = buildPoster(g, 'done_nailed');
    expect(p.verb).toBe('NAILED IT.');
    expect(p.stat_trio?.some((s) => s.label === 'PLAN HIT')).toBe(true);
  });

  it('short → done_nailed state, but honest copy (no "NAILED IT" / no "PLAN HIT")', () => {
    const g = doneGlance('short');
    expect(resolveDayState(g)).toBe('done_nailed');
    const p = buildPoster(g, 'done_nailed');
    expect(p.verb).toBe('CAME UP SHORT.');
    expect(p.stat_trio?.some((s) => s.label === 'PLAN HIT')).toBe(false);
    expect(p.stat_trio?.some((s) => s.label === 'PARTIAL' && s.valueColor === 'amber')).toBe(true);
    const sib = buildSibling(g, 'done_nailed');
    expect(sib.title.main).toBe('CAME UP SHORT');
    // prose is variant-specific on the SiblingPayload union; narrow by state.
    if (sib.state === 'done_nailed') {
      expect(sib.prose).toMatch(/Came up short/);
    }
  });

  it('over (overreach) → done_ease_off, keeps ✓ PLAN HIT', () => {
    const g = doneGlance('over');
    expect(resolveDayState(g)).toBe('done_ease_off');
    const p = buildPoster(g, 'done_ease_off');
    expect(p.stat_trio?.some((s) => s.label === 'PLAN HIT')).toBe(true);
  });

  it('absent verdict (fixtures / non-watch) defaults to nailed (no regression)', () => {
    const g = doneGlance(null);
    expect(resolveDayState(g)).toBe('done_nailed');
    expect(buildPoster(g, 'done_nailed').verb).toBe('NAILED IT.');
  });
});

/**
 * P1-49 (phone+watch audit 2026-07-06) · the breakdown fabricated HR caps
 * ('148 bpm' / '145 bpm') and fuel checkpoints ('mi 4 · 8 · 11') when real
 * data was absent. Lilian is the no-LTHR / no-goal persona — she must see
 * effort cues, and fuel rows only when the run's real distance calls for
 * them. Consumed by /api/briefing → iPhone, and the web /today poster.
 */
describe('P1-49 · no fabricated HR caps or fuel checkpoints', () => {
  /** Patch today's weekday entry on a persona glance. */
  const withToday = (g: GlanceState, patch: Partial<GlanceWeekDay>): GlanceState => ({
    ...g,
    weekDays: g.weekDays.map((d) => (d.date === g.today ? { ...d, ...patch } : d)),
  });
  const lilian = () => getPersonaGlanceState('lilian'); // lthr null · no goal

  it('easy spec with null hr_cap_bpm → effort cue, never 148 bpm', () => {
    const spec: WorkoutSpec = {
      kind: 'easy', pace_target_s_per_mi_lo: 690, pace_target_s_per_mi_hi: 750,
      hr_cap_bpm: null, fuel_mi: [],
    };
    const g = withToday(lilian(), { plannedType: 'easy', plannedMi: 4, plannedSpec: spec, doneMi: 0 });
    const rows = buildPoster(g, 'easy').workout_breakdown!;
    const hrRow = rows.find((r) => r.label === 'HR CAP')!;
    expect(hrRow.tail).toBe('Aerobic · Z2');
    expect(JSON.stringify(rows)).not.toContain('148 bpm');
  });

  it('long spec · empty fuel_mi (run under 8 mi) → NO fuel row, no 145 bpm', () => {
    const spec: WorkoutSpec = {
      kind: 'long', pace_target_s_per_mi_lo: 700, pace_target_s_per_mi_hi: 760,
      hr_cap_bpm: null, fuel_mi: [],
    };
    const g = withToday(lilian(), { plannedType: 'long', plannedMi: 6, plannedSpec: spec, doneMi: 0 });
    const rows = buildPoster(g, 'long').workout_breakdown!;
    expect(rows.some((r) => r.label === 'FUEL')).toBe(false);
    const hrRow = rows.find((r) => r.label === 'HR CAP')!;
    expect(hrRow.tail).toBe('Aerobic ceiling');
    expect(JSON.stringify(rows)).not.toContain('145 bpm');
  });

  it('long spec with real fuel_mi keeps the checkpoints', () => {
    const spec: WorkoutSpec = {
      kind: 'long', pace_target_s_per_mi_lo: 520, pace_target_s_per_mi_hi: 560,
      hr_cap_bpm: 147, fuel_mi: [5, 9, 13],
    };
    const g = withToday(lilian(), { plannedType: 'long', plannedMi: 16, plannedSpec: spec, doneMi: 0 });
    const rows = buildPoster(g, 'long').workout_breakdown!;
    expect(rows.find((r) => r.label === 'FUEL')?.tail).toBe('mi 5 · 9 · 13');
    expect(rows.find((r) => r.label === 'HR CAP')?.tail).toBe('147 bpm');
  });

  it('no-spec long · fuel derives from REAL distance (mi 5 ladder), omitted under 8 mi', () => {
    const short = withToday(lilian(), { plannedType: 'long', plannedMi: 6, plannedSpec: null, doneMi: 0 });
    const shortRows = buildPoster(short, 'long').workout_breakdown!;
    expect(shortRows.some((r) => r.label === 'FUEL')).toBe(false);
    expect(JSON.stringify(shortRows)).not.toContain('mi 4 · 8 · 11');

    const long14 = withToday(lilian(), { plannedType: 'long', plannedMi: 14, plannedSpec: null, doneMi: 0 });
    const longRows = buildPoster(long14, 'long').workout_breakdown!;
    expect(longRows.find((r) => r.label === 'FUEL')?.tail).toBe('mi 5 · 9 · 13');
  });

  it('quality WU/CD minute tails ride the week easy band, by feel when absent (P1-47)', () => {
    const tempoSpec: WorkoutSpec = {
      kind: 'tempo', warmup_mi: 2, tempo_distance_mi: 4,
      tempo_pace_s_per_mi: 502, cooldown_mi: 1, hr_target_bpm: null,
    };
    // No easy band anywhere + no goal → by feel, never a 510-based minute count.
    const bare = withToday(lilian(), { plannedType: 'tempo', plannedMi: 7, plannedSpec: tempoSpec, doneMi: 0 });
    const bareRows = buildPoster(bare, 'quality').workout_breakdown!;
    expect(bareRows.find((r) => r.label === 'WARMUP')?.tail).toBe('by feel');

    // An easy spec elsewhere in the week (mid 630 = 10:30/mi) anchors the
    // estimate: 2 mi × 630 s = 21 min.
    const easySpec: WorkoutSpec = {
      kind: 'easy', pace_target_s_per_mi_lo: 600, pace_target_s_per_mi_hi: 660,
      hr_cap_bpm: null, fuel_mi: [],
    };
    const g2: GlanceState = {
      ...bare,
      weekDays: bare.weekDays.map((d, i) => (i === 0 ? { ...d, plannedSpec: easySpec } : d)),
    };
    const rows2 = buildPoster(g2, 'quality').workout_breakdown!;
    expect(rows2.find((r) => r.label === 'WARMUP')?.tail).toBe('~21 min');
    expect(rows2.find((r) => r.label === 'COOLDOWN')?.tail).toBe('~11 min');
  });
});
