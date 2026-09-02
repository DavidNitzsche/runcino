/**
 * _zz_brain_probe_corpus.test.ts · archetype corpus probe for the workout
 * lane (2026-09-01). Persisted-row shape (`specForComposedDay` +
 * `capSpecToDistance`, the exact persist hop), anchors null (population
 * offsets — the STRUCTURE does not depend on them). Measures WU/CD in minutes
 * at the E band, label/spec drift, cutdown identity vs uniform spec, interval
 * recovery ratio, lever distribution (Rule 15), long-run finish shapes.
 *
 * Gated on BRAIN_PROBE=1 so it never runs in the suite. Writes a report.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { matrix, simInputsForArc, arcStr } from './sim-matrix';
import { buildSimPlan } from './sim-inputs';
import { specForComposedDay } from './generate';
import { capSpecToDistance, totalDistanceMiFromSpec, EASY_BAND_LO_OFFSET_S, EASY_BAND_WIDTH_S } from './spec-builder';
import { subLabelFromSpec } from '@/lib/training/expand-spec';

const OUT = process.env.BRAIN_PROBE_OUT ?? '/tmp/brain-probe-corpus.txt';
const CUTDOWN = /cutdown|Canova 2K|5K progression/i;

describe.runIf(process.env.BRAIN_PROBE === '1')('BRAIN PROBE · corpus', () => {
  it('sweeps the archetype corpus and writes the report', () => {
    const stride = Number(process.env.BRAIN_PROBE_STRIDE ?? 9);
    const tot: Record<string, number> = {};
    const inc = (k: string, n = 1) => { tot[k] = (tot[k] ?? 0) + n; };
    const examples: Record<string, string[]> = {};
    const ex = (k: string, s: string) => { (examples[k] ??= []); if (examples[k].length < 8) examples[k].push(s); };
    const levers: Record<string, number> = {};
    const wuHist: Record<string, number> = {};
    let i = 0, composed = 0;
    for (const arc of matrix()) {
      i++;
      if (i % stride !== 0 && !arc.history) continue;
      const res = buildSimPlan(simInputsForArc(arc));
      if (!res.ok) continue;
      composed++;
      const t = res.derived.tPaceSec;
      const easyMid = t + EASY_BAND_LO_OFFSET_S + EASY_BAND_WIDTH_S / 2;
      const goalPace = res.derived.goalPaceSec;
      res.composed.weeks.forEach((wk, wi) => {
        for (const d of wk.days) {
          if (!['threshold', 'intervals', 'tempo', 'race_week_tuneup'].includes(d.type)) continue;
          const built = specForComposedDay(d, t, { lthr: null, maxHr: null, goalPaceSec: goalPace, easyAnchorTSec: t, anchors: null });
          if (!built.spec) continue;
          const spec = capSpecToDistance(built.spec, d.distanceMi) as Record<string, unknown>;
          const total = totalDistanceMiFromSpec(spec, d.distanceMi);
          inc('quality');
          const tag = `${arcStr(arc)} wk${wi} ${d.type}`;
          const wu = Number(spec.warmup_mi ?? 0), cd = Number(spec.cooldown_mi ?? 0);
          const wuMin = wu * easyMid / 60, cdMin = cd * easyMid / 60;
          const bucket = wuMin < 5 ? '<5' : wuMin < 10 ? '5-10' : wuMin < 15 ? '10-15' : wuMin < 20 ? '15-20' : wuMin < 25 ? '20-25' : wuMin < 30 ? '25-30' : '30+';
          wuHist[bucket] = (wuHist[bucket] ?? 0) + 1;
          if (wuMin > 20) { inc('wuOver20'); ex('wuOver20', `${tag} · WU ${wu} mi = ${wuMin.toFixed(0)} min · day ${total} · "${d.subLabel}"`); }
          if (wuMin < 8 && d.type !== 'race_week_tuneup') { inc('wuUnder8'); ex('wuUnder8', `${tag} · WU ${wu} mi = ${wuMin.toFixed(0)} min · day ${total} · "${d.subLabel}"`); }
          if (cdMin > 20) { inc('cdOver20'); ex('cdOver20', `${tag} · CD ${cd} mi = ${cdMin.toFixed(0)} min · day ${total}`); }
          if ((wu + cd) / Math.max(0.1, total) > 0.6) { inc('easyLegsOver60pct'); ex('easyLegsOver60pct', `${tag} · WU ${wu} CD ${cd} of ${total} · "${d.subLabel}"`); }
          const derived = subLabelFromSpec(spec);
          if (derived && d.subLabel && derived !== d.subLabel) { inc('labelDrift'); ex('labelDrift', `${tag} · composed "${d.subLabel}" · derived "${derived}"`); }
          if (CUTDOWN.test(d.notes ?? '') && !Array.isArray(spec.steps)) { inc('cutdownUniform'); ex('cutdownUniform', `${tag} · "${d.subLabel}" · notes "${(d.notes ?? '').slice(0, 40)}"`); }
          if (String(spec.kind) === 'intervals') {
            const repS = Number(spec.rep_duration_s ?? 0) || Number(spec.rep_distance_mi ?? 0) * Number(spec.rep_pace_s_per_mi ?? 0);
            const rest = Number(spec.rep_rest_s ?? 0);
            if (repS > 0 && rest < 0.5 * repS && spec.by_effort !== true) { inc('intervalRestShort'); ex('intervalRestShort', `${tag} · "${d.subLabel}" · rep ${repS.toFixed(0)}s rest ${rest}s`); }
          }
          if (d.progressionLever) levers[d.progressionLever] = (levers[d.progressionLever] ?? 0) + 1;
          if (d.workShape) inc('shapeDays');
        }
      });
    }
    const lines: string[] = [];
    lines.push(`composed ${composed} plans (stride ${stride})`);
    lines.push(JSON.stringify(tot, null, 2));
    lines.push('WU minutes histogram ' + JSON.stringify(wuHist));
    lines.push('levers ' + JSON.stringify(levers));
    for (const [k, v] of Object.entries(examples)) { lines.push(`\n## ${k}`); for (const s of v) lines.push(`- ${s}`); }
    fs.writeFileSync(OUT, lines.join('\n') + '\n');
    expect(composed).toBeGreaterThan(0);
  }, 1_800_000);
});
