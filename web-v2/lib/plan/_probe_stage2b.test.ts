/**
 * _probe_stage2b.test.ts · TEMPORARY AUDIT HARNESS (not a gate).
 * Prints the owner's composed block with absolute dates, marking race days,
 * long runs, quality days, and the gap between each embedded race and the
 * next long run. Off by default:
 *   FAFF_S2B_PROBE=1 npx vitest run lib/plan/_probe_stage2b.test.ts
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { CRON_AUTHOR_INSTANT } from './probe-instant';
import { composeForUser } from './generate';

const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(CRON_AUTHOR_INSTANT); });
afterAll(() => { vi.useRealTimers(); });
const RUN = !!process.env.FAFF_S2B_PROBE;
const DOWN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function dateOf(weekStartISO: string, dow: number): string {
  const startDow = new Date(weekStartISO + 'T12:00:00Z').getUTCDay();
  return addDays(weekStartISO, ((dow - startDow) % 7 + 7) % 7);
}

describe.skipIf(!RUN)('stage2b · owner block placement', () => {
  it('prints dated rows and race to long gaps', async () => {
    const r = await composeForUser({ userId: DAVID, raceSlug: 'cim' });
    expect(r.ok, r.ok ? '' : (r as { reason: string }).reason).toBe(true);
    if (!r.ok) return;
    const { composed } = r.result;
    const rows: Array<{ date: string; dow: number; type: string; mi: number; q: boolean; l: boolean; sub: string | null; wk: number; phase: string }> = [];
    composed.weeks.forEach((w, i) => {
      for (const d of w.days) {
        rows.push({ date: dateOf(w.startISO, d.dow), dow: d.dow, type: d.type, mi: d.distanceMi, q: !!d.isQuality, l: !!d.isLong, sub: d.subLabel ?? null, wk: i + 1, phase: w.phase });
      }
    });
    rows.sort((a, b) => a.date.localeCompare(b.date));
    const out: string[] = [];
    out.push(`weeks=${composed.weeks.length}`);
    composed.weeks.forEach((w, i) => out.push(`W${String(i + 1).padStart(2)} ${w.startISO} ${w.phase.padEnd(14)} vol=${String(w.weeklyMi).padStart(5)} raceWk=${w.isRaceWeek ? 'Y' : 'n'} cutback=${w.isCutback ? 'Y' : 'n'} long=${Math.max(0, ...w.days.filter(d => d.isLong && d.type !== 'race').map(d => d.distanceMi))}`));
    out.push('');
    for (const r0 of rows) {
      if (r0.type === 'rest') continue;
      out.push(`${r0.date} ${DOWN[r0.dow]} W${String(r0.wk).padStart(2)} ${r0.phase.padEnd(14)} ${r0.type.padEnd(17)} ${String(r0.mi).padStart(5)}mi ${r0.q ? 'Q' : ' '}${r0.l ? 'L' : ' '} ${r0.sub ?? ''}`);
    }
    out.push('');
    out.push('--- race to next long ---');
    const races = rows.filter(x => x.type === 'race');
    for (const rc of races) {
      const nextLong = rows.find(x => x.l && x.type !== 'race' && x.date > rc.date);
      const gap = nextLong ? (Date.parse(nextLong.date) - Date.parse(rc.date)) / 86400000 : null;
      out.push(`race ${rc.date} ${rc.mi}mi -> next long ${nextLong?.date ?? '(none)'} ${nextLong?.mi ?? '-'}mi · gap ${gap ?? '-'} day(s) · 24h sum ${gap === 1 ? rc.mi + (nextLong?.mi ?? 0) : '-'}`);
      const nextQ = rows.find(x => x.q && x.type !== 'race' && x.date > rc.date);
      const gq = nextQ ? (Date.parse(nextQ.date) - Date.parse(rc.date)) / 86400000 : null;
      out.push(`   -> next quality ${nextQ?.date ?? '(none)'} ${nextQ?.type ?? ''} · day ${gq ?? '-'}`);
    }
    out.push('');
    out.push('--- placement_compromises ---');
    const pc = (composed.authoredState as Record<string, unknown>)?.placement_compromises;
    for (const c of (Array.isArray(pc) ? pc : [])) {
      const r = c as { code: string; dateISO: string; detail: string; citation: string };
      out.push(`${r.code} ${r.dateISO} · ${r.detail}`);
      out.push(`   cite: ${r.citation}`);
    }
    if (!Array.isArray(pc) || pc.length === 0) out.push('(none recorded)');
    const fs = await import('node:fs');
    fs.writeFileSync(process.env.FAFF_S2B_OUT ?? '/tmp/stage2b-owner-block.txt', out.join('\n'));
  }, 240_000);
});
