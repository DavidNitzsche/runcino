/**
 * _probe_cim_block.test.ts · TEMPORARY AUDIT HARNESS (not a gate).
 *
 * Composes David's CIM block exactly as the `recovery_complete` cron will
 * author it on 2026-08-31, and prints it. Nothing is asserted beyond
 * "compose succeeded" — this exists to be READ, not to pass.
 *
 * THE SEAM: `composeForUserInternal` reads today from `runnerToday(userId)`,
 * which is `Intl.DateTimeFormat(tz).format(new Date())`. Faking ONLY `Date`
 * (`toFake: ['Date']`) moves the runner's calendar day without touching
 * timers, so `pg`'s socket timeouts still work. No production code changes.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { CRON_AUTHOR_INSTANT } from './probe-instant';
import { composeForUser } from './generate';
import { planDosingFindings, summarizeDosing } from './dosing';
import { weekIntensity } from './intensity-distribution';

const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
/** Noon Pacific on the day the cron fires. */
const AUTHOR_INSTANT = CRON_AUTHOR_INSTANT;

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AUTHOR_INSTANT);
});
afterAll(() => {
  vi.useRealTimers();
});

// OFF by default. This is an AUDIT HARNESS, not a gate: it reads one named
// production account, it composes a fourteen-week block against live rows, and
// it asserts almost nothing. Leaving it in the normal suite would add ~25s of
// database work to every run and would go red the day that account changes,
// which is the shape of failure `vitest.setup.ts`'s header warns about. Run it
// with `FAFF_CIM_PROBE=1 npx vitest run lib/plan/_probe_cim_block.test.ts` and
// read /tmp/cim-block.txt.
const RUN = !!process.env.FAFF_CIM_PROBE;

describe.skipIf(!RUN)('CIM block as the cron will author it', () => {
  it('composes and prints', async () => {
    const r = await composeForUser({ userId: DAVID, raceSlug: 'cim' });
    if (!r.ok) {
      require('fs').writeFileSync('/tmp/cim-block.txt', 'COMPOSE FAILED: ' + r.reason);
      expect(r.ok, r.reason).toBe(true);
      return;
    }
    const { compose, composed, mode, todayISO, trailingAvgWeeklyMi } = r.result;
    const out: string[] = [];
    out.push('=== HEADER ===');
    out.push(JSON.stringify({
      todayISO, mode, trailingAvgWeeklyMi,
      startMondayISO: compose.startMondayISO,
      raceDateISO: compose.raceDateISO,
      raceDistanceMi: compose.raceDistanceMi,
      goalSec: compose.goalSec, goalPaceSec: compose.goalPaceSec,
      level: compose.level,
      recentWeeklyMi: compose.recentWeeklyMi,
      rampBaseMi: compose.rampBaseMi,
      recentLongMi: compose.recentLongMi,
      easyDayMedianMi: compose.easyDayMedianMi,
      recentQualityDistanceMi: compose.recentQualityDistanceMi,
      recentQualityPerWeek: compose.recentQualityPerWeek,
      bestRecentVdot: compose.bestRecentVdot,
      seasonAnchorVdot: (compose as any).seasonAnchorVdot,
      measuredProgressFraction: (compose as any).measuredProgressFraction,
      longRunDow: compose.longRunDow, restDow: compose.restDow,
      qualityDows: compose.qualityDows,
      trainingDaysPerWeek: compose.trainingDaysPerWeek,
      totalWeeks: composed.totalWeeks,
      blocks: composed.blocks,
      vols: composed.vols,
    }, null, 1));

    out.push('\n=== HORIZON / TUNEUP INPUTS ===');
    for (const k of Object.keys(compose as any)) {
      if (/race|horizon|tune|midblock|mid_block/i.test(k)) {
        out.push(`${k} = ${JSON.stringify((compose as any)[k])}`);
      }
    }

    out.push('\n=== RAMP BASE EVIDENCE ===');
    out.push(JSON.stringify(compose.rampBaseEvidence, null, 1));

    out.push('\n=== WEEKS ===');
    for (let i = 0; i < composed.weeks.length; i++) {
      const w = composed.weeks[i];
      const long = w.days.find((d) => d.isLong);
      const q = w.days.filter((d) => d.isQuality);
      out.push(
        `W${String(i + 1).padStart(2)} ${w.startISO} ${w.phase.padEnd(10)} ` +
        `vol=${String(w.weeklyMi).padStart(5)} long=${String(long?.distanceMi ?? 0).padStart(4)} ` +
        `${w.isCutback ? 'CUTBACK ' : '        '}${w.isRaceWeek ? 'RACEWK ' : '       '}` +
        `T=${w.tPaceSec ?? '-'} q=${q.length}`,
      );
      for (const d of w.days) {
        if (d.type === 'rest') continue;
        out.push(
          `      ${d.dow} ${d.type.padEnd(16)} ${String(d.distanceMi).padStart(5)}mi ` +
          `${d.isQuality ? 'Q' : ' '}${d.isLong ? 'L' : ' '} | ${d.subLabel ?? ''} | ${d.notes}`,
        );
      }
    }

    // ── real history, for the rolling-30d long-run rule and the ramp base ──
    const { mileageByDay, isoDaysBefore } = await import('@/lib/runs/volume');
    const hist = await mileageByDay(DAVID, isoDaysBefore(todayISO, 120), todayISO);
    const dayMi = new Map<string, number>();
    for (const [iso, v] of hist) dayMi.set(iso, (v as any).mi ?? 0);
    out.push('\n=== REAL HISTORY · rolling 7-day sums, most recent first ===');
    const roll: string[] = [];
    for (let end = 0; end < 112; end += 7) {
      let sum = 0;
      for (let k = 0; k < 7; k++) sum += dayMi.get(isoDaysBefore(todayISO, end + k)) ?? 0;
      roll.push(`${isoDaysBefore(todayISO, end + 6)}..${isoDaysBefore(todayISO, end)} = ${sum.toFixed(1)}`);
    }
    out.push(roll.join('\n'));
    {
      let peak = 0;
      for (let end = 0; end < 112; end++) {
        let sum = 0;
        for (let k = 0; k < 7; k++) sum += dayMi.get(isoDaysBefore(todayISO, end + k)) ?? 0;
        if (sum > peak) peak = sum;
      }
      out.push(`rolling-7d PEAK over 112d = ${peak.toFixed(1)}`);
      const longs = [...dayMi.entries()].filter(([, m]) => m >= 8).sort();
      out.push('runs >= 8mi in last 120d: ' + longs.map(([d, m]) => `${d}:${m.toFixed(1)}`).join(' '));
    }

    // ── the 110%-of-longest-in-prior-30-days rule (Research/00a Practical load rules) ──
    out.push('\n=== LONG-RUN 110%/30d RULE ===');
    {
      const planned = new Map<string, number>();
      for (const w of composed.weeks) {
        for (const d of w.days) {
          if (d.distanceMi > 0) {
            const iso = isoDaysBefore(w.startISO, -(d.dow === 0 ? 6 : d.dow - 1));
            planned.set(iso, Math.max(planned.get(iso) ?? 0, d.distanceMi));
          }
        }
      }
      const all = new Map<string, number>(dayMi);
      for (const [iso, mi] of planned) all.set(iso, Math.max(all.get(iso) ?? 0, mi));
      const dates = [...planned.keys()].sort();
      for (const iso of dates) {
        const mi = planned.get(iso)!;
        if (mi < 10) continue;
        let prior = 0;
        for (let k = 1; k <= 30; k++) {
          const d = isoDaysBefore(iso, k);
          prior = Math.max(prior, all.get(d) ?? 0);
        }
        const cap = prior * 1.1;
        const flag = prior > 0 && mi > cap + 0.05 ? '  *** BREACH' : '';
        out.push(`${iso} ${mi.toFixed(1)}mi · longest prior 30d = ${prior.toFixed(1)} · cap ${cap.toFixed(1)}${flag}`);
      }
    }

    out.push('\n=== WEEK-OVER-WEEK VOLUME + LONG SHARE ===');
    for (let i = 0; i < composed.weeks.length; i++) {
      const w = composed.weeks[i];
      const prev = i > 0 ? composed.weeks[i - 1].weeklyMi : 0;
      const wow = prev > 0 ? ((w.weeklyMi - prev) / prev) * 100 : 0;
      const long = Math.max(0, ...w.days.filter((d) => d.isLong).map((d) => d.distanceMi));
      const share = w.weeklyMi > 0 ? (long / w.weeklyMi) * 100 : 0;
      out.push(`W${i + 1} ${w.startISO} vol=${w.weeklyMi} wow=${wow.toFixed(1)}% long=${long} share=${share.toFixed(1)}%${share > 30 ? ' >30%' : ''}`);
    }

    out.push('\n=== HARD-SESSION SPACING (48h rule) ===');
    {
      const hard: string[] = [];
      for (const w of composed.weeks) {
        for (const d of w.days) {
          const iso = isoDaysBefore(w.startISO, -(d.dow === 0 ? 6 : d.dow - 1));
          const mpFinish = /@\s*(MP|HM|M)\b/i.test(String(d.subLabel ?? ''));
          if (d.isQuality || d.type === 'race' || (d.isLong && mpFinish)) hard.push(iso);
        }
      }
      hard.sort();
      for (let i = 1; i < hard.length; i++) {
        const gap = (Date.parse(hard[i]) - Date.parse(hard[i - 1])) / 86400000;
        if (gap < 2) out.push(`  *** ${hard[i - 1]} -> ${hard[i]} = ${gap}d (<48h)`);
      }
      out.push('hard days: ' + hard.join(' '));
    }

    out.push('\n=== RAMP-BASE SENSITIVITY (my snapshot has 0 mi for 08-26..08-31; the block prescribes 34) ===');
    {
      const g = await import('./generate');
      const series0 = [0, 32.4, 19.2, 38.1, 10.0, 37.8, 40.3, 46.4, 6.0, 27.9, 41.4, 40.0, 45.9, 38.7, 40.8, 43.5];
      for (const [label, ran] of [['ran 0 (my snapshot)', 0], ['ran 20', 20], ['ran 34 (as prescribed)', 34]] as const) {
        const series = [ran, ...series0.slice(1)];
        const mean = (series[0] + series[1] + series[2] + series[3]) / 4;
        const r = (g as any).resolveRampBase({ meanWeeklyMi: mean, weeklySeries: series, allowedInterruptionWeeks: 4 });
        out.push(`${label}: mean=${mean.toFixed(1)} -> ${JSON.stringify(r)} · curve base = ${r.lifted ? r.baseMi : mean.toFixed(1)}`);
      }
    }

    out.push('\n=== PACE ANCHORS ===');
    {
      const v = await import('@/lib/training/vdot');
      const bv = compose.bestRecentVdot ?? 0;
      const fmt = (n: number | null | undefined) =>
        n == null ? 'null' : `${n.toFixed(0)}s/mi (${Math.floor(n / 60)}:${String(Math.round(n % 60)).padStart(2, '0')})`;
      out.push(`bestRecentVdot=${bv}`);
      out.push(`tPaceFromVdot(${bv}) = ${fmt((v as any).tPaceFromVdot(bv))}  iPace = ${fmt((v as any).iPaceFromVdot(bv))}  rPace = ${fmt((v as any).rPaceFromVdot(bv))}`);
      out.push(`marathon racePaceFromVdot(${bv}) = ${fmt((v as any).racePaceFromVdot(bv, 26.22))}`);
      const goalVdot = (v as any).vdotFromRace?.(compose.goalSec, compose.raceDistanceMi);
      out.push(`goalVdot(3:00 marathon) = ${goalVdot}`);
      out.push(`tPaceFromVdot(goalVdot) = ${fmt((v as any).tPaceFromVdot(goalVdot))}`);
      out.push(`plan-level tPaceSec = ${fmt(compose.tPaceSec)}`);
      out.push('per-week tPaceSec: ' + composed.weeks.map((w, i) => `W${i + 1}=${w.tPaceSec}`).join(' '));
      out.push(`goalPaceSec (MP) = ${fmt(compose.goalPaceSec)}`);
      out.push(`AFC actual: 1:41:53 over 13.1 = ${fmt(6113 / 13.1)}`);
      out.push(`vdotFromRace(1:41:53, 13.1) = ${(v as any).vdotFromRace(6113, 13.1)}`);
      out.push(`bestRecentVdotSelfReported = ${compose.bestRecentVdotSelfReported}`);
      out.push(`seasonAnchorSource = ${(compose as any).seasonAnchorSource}`);
      const as: any = composed.authoredState;
      out.push('authoredState.pace_blend = ' + JSON.stringify(as.pace_blend));
      out.push('authoredState.derived_from = ' + JSON.stringify(as.derived_from));
      out.push('authoredState keys = ' + Object.keys(as).join(', '));
      out.push('authoredState.goal_vdot_sanity = ' + JSON.stringify(as.goal_vdot_sanity));
    }

    out.push('\n=== POLARIZED DISTRIBUTION (Research/01: 70-80% E · 10-15% M+T · 10-15% I+R) ===');
    {
      const { weekDose } = await import('./dosing');
      let tE = 0, tMT = 0, tIR = 0, tAll = 0;
      for (let i = 0; i < composed.weeks.length; i++) {
        const w = composed.weeks[i];
        const d = weekDose(w as any);
        const mt = d.byPace.M + d.byPace.T;
        const ir = d.byPace.I + d.byPace.R;
        const e = Math.max(0, d.weeklyMi - mt - ir);
        if (!w.isRaceWeek) { tE += e; tMT += mt; tIR += ir; tAll += d.weeklyMi; }
        const p = (n: number) => d.weeklyMi > 0 ? `${((n / d.weeklyMi) * 100).toFixed(0)}%` : '-';
        out.push(`W${i + 1} ${w.startISO} ${w.phase.padEnd(14)} wk=${d.weeklyMi} E=${p(e)} M+T=${p(mt)} (M ${d.byPace.M} T ${d.byPace.T}) I+R=${p(ir)} (I ${d.byPace.I} R ${d.byPace.R})`);
      }
      out.push(`BLOCK (excl. race week): E=${((tE / tAll) * 100).toFixed(1)}% M+T=${((tMT / tAll) * 100).toFixed(1)}% I+R=${((tIR / tAll) * 100).toFixed(1)}%`);
    }

    out.push('\n=== DOSING FINDINGS ===');
    const findings = planDosingFindings(composed.weeks as any);
    out.push('summary ' + JSON.stringify(summarizeDosing(findings)));
    for (const f of findings) {
      out.push(`${f.weekStartISO} ${f.phase} ${f.context} ${f.pace} ${f.scope}/${f.basis} ` +
        `dose=${f.doseMi} cap=${f.capMi} over=${f.overByMi} share=${f.sharePct}% enforced=${f.enforced}`);
    }

    out.push('\n=== INTENSITY SPLIT ===');
    for (let i = 0; i < composed.weeks.length; i++) {
      const w = composed.weeks[i];
      try {
        const sp = weekIntensity(w as any);
        out.push(`W${i + 1} ${w.startISO} ${w.phase} easy=${sp.easyMi} quality=${sp.qualityMi} easyShare=${(sp.easyShare * 100).toFixed(1)}%`);
      } catch (e: any) { out.push(`W${i + 1} split err ${e.message}`); }
    }

    out.push('\n=== AUTHORED STATE (keys) ===');
    out.push(JSON.stringify(composed.authoredState, null, 1).slice(0, 12000));

    require('fs').writeFileSync('/tmp/cim-block.txt', out.join('\n'));
    expect(composed.weeks.length).toBeGreaterThan(0);
  }, 300_000);

  it('same block on the days either side, in case the cron slips', async () => {
    const lines: string[] = [];
    for (const iso of ['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-07']) {
      vi.setSystemTime(new Date(iso + 'T19:00:00Z'));
      const r = await composeForUser({ userId: DAVID, raceSlug: 'cim' });
      if (!r.ok) { lines.push(`${iso}: REFUSED · ${r.reason}`); continue; }
      const { composed, mode, compose } = r.result;
      lines.push(
        `${iso}: mode=${mode} start=${compose.startMondayISO} weeks=${composed.totalWeeks} ` +
        `base=${compose.rampBaseMi ?? compose.recentWeeklyMi} ` +
        `phases=${composed.blocks.phases.map((p) => `${p.label}:${p.weeks}`).join('/')} ` +
        `peak=${Math.max(...composed.vols)} vols=[${composed.vols.join(',')}]`,
      );
    }
    vi.setSystemTime(AUTHOR_INSTANT);
    require('fs').writeFileSync('/tmp/cim-dates.txt', lines.join('\n'));
    expect(lines.length).toBe(4);
  }, 300_000);
});