/**
 * RULE 16 BOUNDARY GATE · the fitness model may not become a second owner of
 * "what marathon can this runner run".
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THIS GATE IS FOR
 *
 * `lib/fitness/fitness-model.ts` publishes `races`, a race-equivalent range at
 * 5K / 10K / HM / M, by walking Daniels' table from one VDOT. Daniels' table
 * carries a UNIVERSAL fade with distance. This runner's fade is measured, it
 * is personal, and `lib/training/durability-anchor.ts` owns it — it is the
 * whole reason his block exists ("your races fade with distance faster than
 * your speed predicts, so durability is where the work goes").
 *
 * So for any key far from the anchor's own distance, the two disagree, and the
 * canonical owner is the durability one. Measured on the owner's live data,
 * 2026-09-02, anchor = a 4.03 mi run at VDOT 47.7:
 *
 *     fitness model, marathon equivalent   3:08:00 - 3:29:30   (430 - 479 s/mi)
 *     canonical marathon anchor            7:52/mi             (472 s/mi, band 460-488)
 *
 * The fitness model's FAST EDGE for a marathon, 430 s/mi, is exactly his
 * measured THRESHOLD pace. It is saying he might race 26.2 miles at threshold.
 * That is the extrapolation error the personal exponent exists to remove.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY NOTHING IS BROKEN TODAY, AND WHAT THIS GATE PROTECTS
 *
 * Nothing renders that number. The only rendering consumer,
 * `lib/faff/fitness-read.ts`, calls `nearestKey(anchorDistanceMi)` and reports
 * the range at the distance the evidence actually covers — on his data that
 * is the 5K key, one bucket from the anchor. `/api/coach/read` publishes the
 * whole estimate but has no callers.
 *
 * That is a property of ONE line in ONE consumer, and nothing enforced it. A
 * future surface reading `estimate.races.m` directly would ship a marathon
 * prediction that contradicts the canonical durability owner by minutes, and
 * every existing test would stay green. This gate is that enforcement:
 *
 *   1. the renderer must keep choosing the key nearest its anchor, and
 *   2. no other module may read a far key off this model.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THIS GATE CANNOT FAIL ON (Rule 22)
 *
 * It does NOT check that the band's WIDTH is right, that `vdotLo`/`vdotHi` are
 * correctly derived, or that the near keys agree with the canonical owner — a
 * near key can still be wrong and this gate will pass it. It only enforces the
 * boundary that keeps the far keys unrendered. It also cannot see a consumer
 * that reaches the far keys through a dynamic index it computes at run time;
 * it reads static source text.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { resolveFitness } from './fitness-model';

const LIB = join(__dirname, '..');
const APP = join(__dirname, '..', '..', 'app');

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if ((p.endsWith('.ts') || p.endsWith('.tsx')) && !p.includes('.test.')) out.push(p);
  }
  return out;
}

/** Consumers permitted to read this model's output at all. A ratchet: it may
 *  shrink, never grow, and each entry carries why it is safe. */
const ALLOWED_CONSUMERS: Record<string, string> = {
  'lib/faff/fitness-read.ts':
    'Chooses the key NEAREST the anchor distance via nearestKey(), so it can '
    + 'never render a far extrapolation. Asserted structurally below.',
  'app/api/v5/today/route.ts':
    'Never touches `races`. It resolves the estimate and hands the whole object '
    + 'straight to buildFitnessRow, which applies nearestKey. Found by this gate '
    + 'on its first run, which is why the scan is by import and not by hand.',
  'app/api/coach/read/route.ts':
    'Publishes the whole estimate as the inspectable aggregate read. Has no '
    + 'callers (see lib/audit/generated-content-registry.ts). If it ever gains '
    + 'one, the far keys must route through lib/training/durability-anchor.ts.',
};

describe('Rule 16 · the fitness model is not a second marathon owner', () => {
  it('LIVENESS · the scanner reads a non-zero number of source files', () => {
    const files = [...walk(LIB), ...walk(APP)];
    expect(files.length).toBeGreaterThan(200);
  });

  it('the only rendering consumer picks the key nearest its own anchor', () => {
    const src = readFileSync(join(LIB, 'faff', 'fitness-read.ts'), 'utf8');
    // The structural property that makes the far keys unreachable from the
    // screen. If this line goes, the boundary goes with it.
    expect(src).toMatch(/nearestKey\(\s*estimate\.anchorDistanceMi\s*\)/);
    expect(src).toMatch(/function nearestKey\(/);
    // And it must index `races` by that resolved key, never by a literal.
    expect(src).toMatch(/estimate\.races\[key\]/);
    expect(src).not.toMatch(/estimate\.races\.(m|hm)\b/);
    expect(src).not.toMatch(/estimate\.races\[['"](m|hm)['"]\]/);
  });

  it('no module outside the allowlist imports the fitness model', () => {
    const files = [...walk(LIB), ...walk(APP)];
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      if (!/from ['"][^'"]*fitness\/fitness-model['"]/.test(src)) continue;
      const rel = f.slice(f.indexOf('web-v2/') >= 0 ? f.indexOf('web-v2/') + 7 : 0)
        .replace(/^.*?\/(lib|app)\//, '$1/');
      if (!(rel in ALLOWED_CONSUMERS)) offenders.push(rel);
    }
    expect(offenders, 'new consumer of fitness-model: a far race key here would '
      + 'contradict lib/training/durability-anchor.ts. Route long-distance '
      + 'equivalents through the canonical durability owner, then add an entry '
      + 'to ALLOWED_CONSUMERS saying why this one is safe.').toEqual([]);
  });

  it('RATCHET · every allowlisted consumer still exists and still imports it', () => {
    for (const [rel, reason] of Object.entries(ALLOWED_CONSUMERS)) {
      const p = join(LIB, '..', rel);
      const src = readFileSync(p, 'utf8');
      expect(src, `stale exemption for ${rel} — delete it`).toMatch(/fitness\/fitness-model/);
      expect(reason.length).toBeGreaterThan(40);
    }
  });

  it('DOCUMENTS THE DISAGREEMENT · a far key really does contradict the '
    + 'canonical anchor, so the boundary is load-bearing and not decorative', () => {
    // The owner's live shape on 2026-09-02: anchor is a ~4 mi threshold run.
    const best = { vdot: 47.7, source: 'run', distance_mi: 4.03, age_days: 1 } as never;
    const est = resolveFitness({ best, considered: [best] });
    expect(est).not.toBeNull();
    const m = est!.races.m;
    const fastSecPerMi = m.loSec / 26.2188;
    // His canonical marathon anchor is 472 s/mi with a 460-488 band, and his
    // canonical THRESHOLD is 430 s/mi. The Daniels walk's fast edge lands at or
    // inside threshold pace — i.e. it claims he could race a marathon at his
    // threshold. If this ever stops being true the model changed, and this
    // gate's premise must be re-argued rather than quietly deleted.
    expect(fastSecPerMi).toBeLessThan(460);
  });
});
