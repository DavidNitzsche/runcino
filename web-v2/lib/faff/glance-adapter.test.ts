import { describe, it, expect } from 'vitest';
import { getPersonaGlanceState } from './personas';
import { resolveDayState, buildPoster, buildSibling } from './glance-adapter';
import type { GlanceState } from '@/lib/coach/glance-state';

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
