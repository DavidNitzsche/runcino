/**
 * _probe_vocabulary.test.ts · WORKOUT-VOCABULARY AUDIT HARNESS (not a gate).
 *
 * The question this answers: across a whole block, WHICH named sessions does
 * the engine actually reach for, and how does the block's running split against
 * `Research/01`'s "Polarized distribution Daniels recommends: 70–80% E, 10–15%
 * M+T, 10–15% I+R"?
 *
 * `_probe_cim_block.test.ts` answers it for one live account against the
 * database. This answers it with NO database at all, through `buildSimPlan`,
 * so a marathon build and a half build can be measured side by side, on any
 * machine, byte-reproducibly. That matters here because the defect under
 * investigation is comparative: the half build that shipped ran two workout
 * families for seventeen quality sessions, and the question is whether the
 * marathon build's shape would repeat it.
 *
 * OFF by default. `FAFF_VARIETY_PROBE=1 npx vitest run
 * lib/plan/_probe_vocabulary.test.ts --disable-console-intercept`.
 */
import { describe, it, expect } from 'vitest';
import { buildSimPlan } from './sim-inputs';
import { inlinePrescriptions } from './generate';
import { weekDose, planDosingFindings, summarizeDosing } from './dosing';
import type { SimInputs } from './sim-constants';

const RUN = !!process.env.FAFF_VARIETY_PROBE;

/** The engine's own inline doctrine strings, so the harness needs no DB. */
const rxFor = (cat: Parameters<typeof inlinePrescriptions>[0]) => ({
  rxQuality: inlinePrescriptions(cat),
  rxRaceSpecific: inlinePrescriptions(cat),
});

/**
 * The runner under audit: a competitive marathoner, sub-3 goal, six days a
 * week, long run Sunday. Deliberately expressed in ONBOARDING terms rather
 * than as a fixed weekly mileage, so the block re-measures itself if the
 * volume anchors move underneath it.
 */
const MARATHON: SimInputs = {
  goalMode: 'race',
  distance: 'marathon',
  startDateISO: '2026-08-31',
  raceDateISO: '2026-12-06',
  planWeeks: 14,
  goalTimeSec: 10800,
  experienceLevel: 'advanced',
  weeklyFrequency: 6,
  weeklyMileageBucket: 45,
  longestRunBucket: '10+',
  raceHistory: [],
  longRunDay: 'sun',
  availableDays: null,
  bestRecentVdotOverride: 52,
} as unknown as SimInputs;

/** The same runner, on the half build whose vocabulary is the counter-example. */
const HALF: SimInputs = {
  ...MARATHON,
  distance: 'half',
  raceDateISO: '2026-12-06',
  planWeeks: 14,
  goalTimeSec: 5100,
} as unknown as SimInputs;

/** Which named workout a day's coaching note attributes it to. */
function vocabOf(notes: string, subLabel: string): string {
  const m = notes.match(/^([^·]+·\s*Research\/04\s*§[\d.]+)/);
  if (m) return m[1].replace(/\s+/g, ' ').trim();
  const s = subLabel.replace(/^LONG · /, 'long finish ').trim();
  return `[trajectory] ${s}`;
}

function report(label: string, sim: SimInputs, cat: Parameters<typeof inlinePrescriptions>[0]): string[] {
  const out: string[] = [];
  const built = buildSimPlan(sim, rxFor(cat));
  if (!built.ok) return [`${label}: REFUSED · ${built.reason}`];
  const weeks = built.composed.weeks;

  out.push(`\n════════ ${label} ════════`);
  out.push(`weeks=${weeks.length} peak=${Math.max(...built.composed.vols)} vols=[${built.composed.vols.join(',')}]`);

  out.push('\n── SESSION BY SESSION ──');
  const vocabCount = new Map<string, number>();
  for (let i = 0; i < weeks.length; i++) {
    const w = weeks[i];
    const d = weekDose(w as never);
    const mt = d.byPace.M + d.byPace.T;
    const ir = d.byPace.I + d.byPace.R;
    const e = Math.max(0, d.weeklyMi - mt - ir);
    const p = (n: number) => (d.weeklyMi > 0 ? `${((n / d.weeklyMi) * 100).toFixed(0)}%` : '-');
    out.push(
      `W${String(i + 1).padStart(2)} ${w.startISO} ${String(w.phase).padEnd(14)} vol=${String(w.weeklyMi).padStart(5)}` +
      ` E=${p(e).padStart(4)} M+T=${p(mt).padStart(4)} I+R=${p(ir).padStart(4)}` +
      `${w.isCutback ? ' CUTBACK' : ''}${w.isRaceWeek ? ' RACEWK' : ''}`,
    );
    for (const day of w.days) {
      if (!day.isQuality && !(day.isLong && /@\s*(MP|HM|M)\b/i.test(String(day.subLabel ?? '')))) continue;
      const v = vocabOf(String(day.notes ?? ''), String(day.subLabel ?? ''));
      vocabCount.set(v, (vocabCount.get(v) ?? 0) + 1);
      out.push(`       ${day.type.padEnd(17)} ${String(day.distanceMi).padStart(5)}mi | ${day.subLabel ?? ''}`);
      out.push(`       ${''.padEnd(17)} ${''.padStart(5)}   └ ${v}`);
    }
  }

  out.push('\n── VOCABULARY, most used first ──');
  for (const [v, n] of [...vocabCount].sort((a, b) => b[1] - a[1])) out.push(`${String(n).padStart(3)} × ${v}`);
  out.push(`distinct named sessions: ${[...vocabCount.keys()].filter((k) => !k.startsWith('[')).length}`);

  out.push('\n── THREE-BAND SPLIT (Research/01 · 70-80 E · 10-15 M+T · 10-15 I+R) ──');
  let tE = 0, tMT = 0, tIR = 0, tAll = 0;
  const irByWeek: string[] = [];
  for (const w of weeks) {
    const d = weekDose(w as never);
    const mt = d.byPace.M + d.byPace.T;
    const ir = d.byPace.I + d.byPace.R;
    const e = Math.max(0, d.weeklyMi - mt - ir);
    if (!w.isRaceWeek) { tE += e; tMT += mt; tIR += ir; tAll += d.weeklyMi; }
    irByWeek.push(ir > 0 ? ir.toFixed(2) : '·');
  }
  out.push(`BLOCK (excl. race week): E=${((tE / tAll) * 100).toFixed(1)}% M+T=${((tMT / tAll) * 100).toFixed(1)}% I+R=${((tIR / tAll) * 100).toFixed(1)}%`);
  out.push(`I+R miles by week: ${irByWeek.join(' ')}`);

  const findings = planDosingFindings(weeks as never);
  out.push(`\n── DOSING ── ${JSON.stringify(summarizeDosing(findings))}`);
  for (const f of findings) {
    out.push(`   ${f.weekStartISO} ${f.phase} ${f.context} ${f.pace} ${f.scope} dose=${f.doseMi} cap=${f.capMi} over=${f.overByMi} enforced=${f.enforced}`);
  }
  return out;
}

describe.skipIf(!RUN)('workout vocabulary + three-band split', () => {
  it('marathon build', () => {
    const lines = report('MARATHON · sub-3 · advanced', MARATHON, 'm');
    // eslint-disable-next-line no-console
    console.log(lines.join('\n'));
    expect(lines.length).toBeGreaterThan(0);
  });

  it('half build', () => {
    const lines = report('HALF · advanced', HALF, 'hm');
    // eslint-disable-next-line no-console
    console.log(lines.join('\n'));
    expect(lines.length).toBeGreaterThan(0);
  });
});
