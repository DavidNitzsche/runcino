/**
 * _probe_cim_sessions.test.ts · TEMPORARY AUDIT HARNESS (not a gate).
 *
 * Sibling of `_probe_cim_block.test.ts`. That one prints the SHAPE of the
 * block (volumes, phases, spacing). This one prints what the RUNNER SEES:
 * every session run through `persistedDayShape`, which is the same hop
 * `persistPlan` makes on the way into `plan_workouts` — so the pace target,
 * the sub_label and the workout_spec printed here are the ones the phone
 * renders.
 *
 * OFF by default, same reasoning as the sibling: named production account,
 * live rows, asserts almost nothing.
 *   FAFF_CIM_PROBE=1 npx vitest run lib/plan/_probe_cim_sessions.test.ts
 *   → /tmp/cim-sessions.txt
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { CRON_AUTHOR_INSTANT } from './probe-instant';
import { composeForUser, persistedDayShape } from './generate';
import { conservativeVdotFromMileage } from './spec-builder';
import { resolveCurrentTPace } from '@/lib/training/vdot';

const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const AUTHOR_INSTANT = CRON_AUTHOR_INSTANT;

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AUTHOR_INSTANT);
});
afterAll(() => {
  vi.useRealTimers();
});

const RUN = !!process.env.FAFF_CIM_PROBE;

const pace = (s: number | null | undefined) =>
  s == null ? '   -   ' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}/mi`;

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

describe.skipIf(!RUN)('CIM block · what the phone shows', () => {
  it('prints every session as persisted', async () => {
    const r = await composeForUser({ userId: DAVID, raceSlug: 'cim' });
    expect(r.ok, r.ok ? '' : (r as { reason: string }).reason).toBe(true);
    if (!r.ok) return;
    const { compose, composed } = r.result;

    const easyAnchorTSec = resolveCurrentTPace(
      compose.bestRecentVdot ?? null,
      compose.belowTableAnchor ?? null,
      compose.recentWeeklyMi,
      conservativeVdotFromMileage,
    ).tPaceSec;

    const args = {
      lthr: compose.lthr,
      maxHr: compose.maxHr,
      goalPaceSec: compose.goalPaceSec,
      easyAnchorTSec,
      goalIPaceEligible: false, // marathon · not 5k/10k/hm
      belowTableAnchor: compose.belowTableAnchor ?? null,
    };

    const out: string[] = [];
    out.push(`goalPaceSec (what the app calls his goal MP) = ${pace(compose.goalPaceSec)}`);
    out.push(`easyAnchorTSec (current-fitness T)           = ${pace(easyAnchorTSec)}`);
    out.push(`plan tPaceSec                                = ${pace(compose.tPaceSec)}`);
    out.push('');

    for (let i = 0; i < composed.weeks.length; i++) {
      const w = composed.weeks[i];
      const weekT = w.tPaceSec ?? compose.tPaceSec;
      out.push(`\n=== W${i + 1} ${w.startISO} ${w.phase} vol=${w.weeklyMi} weekT=${pace(weekT)} ===`);
      for (const d of w.days) {
        if (d.type === 'rest') continue;
        const row = persistedDayShape(d, weekT, args, null);
        out.push(
          `  ${DOW[d.dow]} ${row.type.padEnd(17)} ${String(row.distanceMi).padStart(5)}mi ` +
          `${row.isQuality ? 'Q' : ' '}${row.isLong ? 'L' : ' '} pace=${pace(row.paceTargetSPerMi)}`,
        );
        out.push(`      sub_label: ${row.subLabel ?? '(none)'}`);
        out.push(`      notes    : ${row.notes}`);
        if (row.workoutSpec) out.push(`      spec     : ${JSON.stringify(row.workoutSpec)}`);
      }
    }
    require('fs').writeFileSync('/tmp/cim-sessions.txt', out.join('\n'));
    expect(composed.weeks.length).toBeGreaterThan(0);
  }, 300_000);
});
