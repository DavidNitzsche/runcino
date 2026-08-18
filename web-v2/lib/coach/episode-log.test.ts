/**
 * lib/coach/episode-log.test.ts
 *
 * Locks `decideEpisodeWrite`, the generalised version of the two-state
 * machine `coach-log.ts`'s `updateEasyDisciplineLog` used to hand-roll for
 * easy-discipline alone. The DB shell (`updateEpisode`) is exercised in
 * prod, matching the house policy already used for `loadEasyDiscipline` /
 * `updateCoachLog` — only the pure decision is locked here.
 *
 * The fixture below mirrors `EasyDisciplineFinding`'s quiet reasons
 * (`resolved` / `insufficient_evidence` / `stale` / `hr_contradicts_pace` /
 * `no_basis`) so this test doubles as a guarantee that easy-discipline's
 * exact behaviour survives being routed through the generic module.
 */
import { describe, it, expect } from 'vitest';
import { decideEpisodeWrite, type EpisodeFinding, type EpisodeDetector } from './episode-log';

type QuietReason = 'resolved' | 'insufficient_evidence' | 'stale' | 'hr_contradicts_pace' | 'no_basis';

interface Finding extends EpisodeFinding<QuietReason> {
  over: number;
}

const detector: Pick<
  EpisodeDetector<Finding, QuietReason>,
  'openPrefix' | 'closePrefix' | 'resolvedReason' | 'composeOpen' | 'composeClose'
> = {
  openPrefix: 'easy:open:',
  closePrefix: 'easy:resolved:',
  resolvedReason: 'resolved',
  composeOpen: (f) => ({ title: 'EASY DAYS', body: `established, over=${f.over}` }),
  composeClose: (f) => ({ title: 'EASY DAYS', body: `resolved, over=${f.over}` }),
};

const established = (over = 4): Finding => ({ state: 'established', quietReason: null, over });
const quiet = (reason: QuietReason, over = 0): Finding => ({ state: 'quiet', quietReason: reason, over });

describe('decideEpisodeWrite · no open episode', () => {
  it('established with nothing open → writes OPEN keyed on today', () => {
    const d = decideEpisodeWrite(detector, null, established(4), '2026-08-17');
    expect(d.write).toBe('open');
    expect(d.field).toBe('easy:open:2026-08-17');
    expect(d.entry).toEqual({ title: 'EASY DAYS', body: 'established, over=4' });
  });

  it('quiet with nothing open → nothing to do, regardless of reason', () => {
    for (const reason of ['resolved', 'insufficient_evidence', 'stale', 'no_basis'] as const) {
      const d = decideEpisodeWrite(detector, null, quiet(reason), '2026-08-17');
      expect(d.write).toBe('none');
    }
  });

  it('a field from a DIFFERENT detector\'s prefix reads as "no open episode"', () => {
    const d = decideEpisodeWrite(detector, 'week:2026-08-03', established(4), '2026-08-17');
    expect(d.write).toBe('open');
  });
});

describe('decideEpisodeWrite · an episode is open', () => {
  const openField = 'easy:open:2026-07-20';

  it('genuine resolve → writes CLOSE keyed on the original episode id', () => {
    const d = decideEpisodeWrite(detector, openField, quiet('resolved', 0), '2026-08-17');
    expect(d.write).toBe('close');
    expect(d.field).toBe('easy:resolved:2026-07-20');
    expect(d.entry).toEqual({ title: 'EASY DAYS', body: 'resolved, over=0' });
  });

  it('running out of evidence does NOT close the episode — silence, not good news', () => {
    for (const reason of ['insufficient_evidence', 'stale', 'hr_contradicts_pace', 'no_basis'] as const) {
      const d = decideEpisodeWrite(detector, openField, quiet(reason), '2026-08-17');
      expect(d.write).toBe('none');
    }
  });

  it('still established → nothing to do (never re-open / re-announce mid-episode)', () => {
    const d = decideEpisodeWrite(detector, openField, established(5), '2026-08-17');
    expect(d.write).toBe('none');
  });

  it('a CLOSE row as the newest row reads as "no open episode" — a relapse opens fresh', () => {
    const d = decideEpisodeWrite(
      detector,
      'easy:resolved:2026-07-20',
      established(4),
      '2026-08-17',
    );
    expect(d.write).toBe('open');
    expect(d.field).toBe('easy:open:2026-08-17');
  });
});

describe('never speaks twice for the same state', () => {
  it('open → open → close → close settles into exactly two writes', () => {
    let lastField: string | null = null;
    const timeline: Array<{ finding: Finding; today: string }> = [
      { finding: established(4), today: '2026-07-20' }, // → open
      { finding: established(4), today: '2026-07-21' }, // still established → none
      { finding: established(5), today: '2026-07-25' }, // still established → none
      { finding: quiet('insufficient_evidence'), today: '2026-08-01' }, // → none (not resolved)
      { finding: quiet('resolved', 0), today: '2026-08-05' }, // → close
      { finding: quiet('resolved', 0), today: '2026-08-06' }, // already closed → none
    ];
    const writes: string[] = [];
    for (const { finding, today } of timeline) {
      const d = decideEpisodeWrite(detector, lastField, finding, today);
      if (d.write !== 'none') {
        writes.push(d.write);
        lastField = d.field;
      }
    }
    expect(writes).toEqual(['open', 'close']);
  });
});
