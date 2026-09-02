/**
 * _probe_race_pace.test.ts · TEMPORARY AUDIT HARNESS (not a gate).
 *
 * Composes the owner's CIM block exactly as the `recovery_complete` cron will
 * author it on 2026-08-31 and prints ONLY the goal-relative pace path: what
 * every week prescribes at marathon pace, what the label calls it, and what
 * race day asks for.
 *
 * Deliberately NOT `/tmp/cim-block.txt`. `_probe_cim_block.test.ts` writes
 * there, several agents are auditing this same block at once, and a shared
 * absolute path in a temp directory means the file you read may not be the file
 * your run wrote. `FAFF_RACE_PACE_PROBE_OUT` names the destination.
 *
 * OFF by default: it reads one named production account against live rows.
 *   FAFF_RACE_PACE_PROBE=1 FAFF_RACE_PACE_PROBE_OUT=/path/out.txt \
 *     npx vitest run lib/plan/_probe_race_pace.test.ts
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { CRON_AUTHOR_INSTANT } from './probe-instant';
import { composeForUser } from './generate';

const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const AUTHOR_INSTANT = CRON_AUTHOR_INSTANT;

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AUTHOR_INSTANT);
});
afterAll(() => { vi.useRealTimers(); });

const RUN = !!process.env.FAFF_RACE_PACE_PROBE;
const OUT = process.env.FAFF_RACE_PACE_PROBE_OUT ?? '/tmp/faff-race-pace-probe.txt';

const pace = (n: number | null | undefined) =>
  n == null ? '   —   ' : `${Math.floor(n / 60)}:${String(Math.round(n % 60)).padStart(2, '0')}/mi`;

describe.skipIf(!RUN)('CIM block · the goal-relative pace path', () => {
  it('composes and prints', async () => {
    const r = await composeForUser({ userId: DAVID, raceSlug: 'cim' });
    const fs = require('fs');
    if (!r.ok) {
      fs.writeFileSync(OUT, 'COMPOSE FAILED: ' + r.reason);
      expect(r.ok, r.reason).toBe(true);
      return;
    }
    const { compose, composed } = r.result;
    const st = composed.authoredState as Record<string, any>;
    const out: string[] = [];

    out.push('=== INPUTS ===');
    out.push(`anchor VDOT ${compose.bestRecentVdot} (${st.pace_blend?.season_anchor_source})`);
    out.push(`goal ${compose.goalSec}s over ${compose.raceDistanceMi}mi = ${pace(compose.goalPaceSec)}  · goal VDOT ${st.pace_blend?.goal_vdot}`);
    out.push(`totalWeeks ${composed.totalWeeks} · buildWeeks ${st.pace_blend?.build_weeks} · measured fraction ${st.pace_blend?.measured_progress_fraction}`);

    out.push('');
    out.push('=== PRESCRIBED RACE TARGET ===');
    out.push(JSON.stringify(st.prescribed_race_pace, null, 1));
    out.push(`goal_pace_s_per_mi (ambition, untouched) = ${st.goal_pace_s_per_mi} (${pace(st.goal_pace_s_per_mi)})`);

    out.push('');
    out.push('=== PER-WEEK GOAL-RELATIVE PACE ===');
    out.push('wk  phase          T-pace    MP(T+18)  M-miles  sessions naming a marathon pace');
    for (let i = 0; i < composed.weeks.length; i++) {
      const w = composed.weeks[i];
      const t = w.tPaceSec ?? null;
      const mp = t != null ? t + 18 : null;
      const mRows = w.days.filter((d) => /@\s*(MP|M)\b/i.test(String(d.subLabel ?? '')));
      const mMi = mRows.reduce((s, d) => {
        const m = /(\d+(?:\.\d+)?)\s*mi\s*@\s*(MP|M)\b/i.exec(String(d.subLabel ?? ''));
        return s + (m ? Number(m[1]) : 0);
      }, 0);
      const raceRow = w.days.find((d) => d.type === 'race');
      out.push(
        `W${String(i + 1).padStart(2)} ${w.phase.padEnd(13)} ${pace(t)}  ${pace(mp)}  ` +
        `${String(mMi || '-').padStart(6)}   ` +
        (mRows.map((d) => d.subLabel).join(' | ') || (raceRow ? 'RACE DAY' : '')),
      );
      for (const d of mRows) out.push(`        note: ${d.notes}`);
      if (raceRow) out.push(`        RACE: ${raceRow.subLabel} | ${raceRow.notes}`);
    }

    // What the ROW actually carries · `specForComposedDay` is the same call
    // `persistPlan` makes, so this is the number that lands in
    // `plan_workouts.pace_target_s_per_mi` and reaches the phone and the watch.
    out.push('');
    out.push('=== PERSISTED pace_target_s_per_mi · the number the runner is shown ===');
    const { specForComposedDay } = await import('./generate');
    const prescribed = ((): number | null => {
      const v = st.prescribed_race_pace?.pace_s_per_mi;
      return typeof v === 'number' && v > 0 ? v : null;
    })();
    // The SAME easy anchor `persistComposedPlan` resolves. Passing the
    // plan-level (goal-derived) tPaceSec here instead would change what
    // `marathonPaceSPerMi` computes, and an audit that reproduces the code it
    // is auditing proves nothing.
    const { resolveCurrentTPace } = await import('@/lib/training/vdot');
    const { conservativeVdotFromMileage } = await import('./spec-builder');
    const easyAnchorTSec = resolveCurrentTPace(
      compose.bestRecentVdot ?? null,
      compose.belowTableAnchor ?? null,
      compose.recentWeeklyMi,
      conservativeVdotFromMileage,
    ).tPaceSec;
    const specArgs = {
      lthr: compose.lthr, maxHr: compose.maxHr,
      goalPaceSec: compose.goalPaceSec,
      prescribedRacePaceSec: prescribed,
      easyAnchorTSec,
      goalIPaceEligible: false,
      belowTableAnchor: compose.belowTableAnchor ?? null,
    } as Parameters<typeof specForComposedDay>[2];
    for (let i = 0; i < composed.weeks.length; i++) {
      const w = composed.weeks[i];
      for (const d of w.days) {
        const isMp = /@\s*(MP|M)\b/i.test(String(d.subLabel ?? ''));
        if (!isMp && d.type !== 'race') continue;
        // The plan's OWN race day only (an embedded tune-up carries its own goal).
        const isPlanRace = d.type === 'race' && d.raceGoalPaceSec === undefined;
        const built = specForComposedDay(d, w.tPaceSec ?? null, specArgs);
        const sp = built.spec as Record<string, unknown> | null;
        const finish = sp && typeof sp.finish_pace_s_per_mi === 'number' ? sp.finish_pace_s_per_mi : null;
        out.push(
          `W${String(i + 1).padStart(2)} ${String(d.type).padEnd(14)} ` +
          `${isPlanRace ? 'GOAL RACE ' : d.type === 'race' ? 'tune-up   ' : '          '}` +
          `pace_target=${pace(built.paceTargetSPerMi)}` +
          (finish != null ? `  finish_pace=${pace(finish)}` : '') +
          `  | ${d.subLabel}`,
        );
      }
    }

    out.push('');
    out.push('=== goal_vdot_sanity ===');
    out.push(JSON.stringify(st.goal_vdot_sanity));

    fs.writeFileSync(OUT, out.join('\n'));
    expect(composed.weeks.length).toBeGreaterThan(0);
  }, 120_000);
});
