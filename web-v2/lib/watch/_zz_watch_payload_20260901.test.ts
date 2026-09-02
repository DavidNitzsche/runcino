/**
 * The WIRE PAYLOAD for the owner's 2026-09-01 session, as `buildWatchToday`
 * composes it after PACE-SHAPE-1.
 *
 * Rule 13 says render it. The watch lobby CANNOT be rendered against this
 * branch: the watch simulator gets its workout over WatchConnectivity from a
 * paired phone, and an unpaired watch simulator shows whatever payload it last
 * cached (a "5×7 · 6.40 mi · 6:21-6:41 /mi" from an earlier session). So this
 * is the payload, which is what the rule says to show when the render is
 * impossible — stated, not substituted quietly.
 *
 * Read-only. Writes a report; asserts only the wire facts.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const OWNER = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const DATE = '2026-09-01';
const OUT = '/private/tmp/claude-501/-Volumes-WP-06-Claude-Code-Runcino/5f870f9b-924e-42f5-9e67-a1225046505a/scratchpad/p0/watch-payload.md';

describe.runIf(!!process.env.DATABASE_URL)('WATCH PAYLOAD · 2026-09-01', () => {
  it('composes the wire and writes it out', async () => {
    const { buildWatchToday } = await import('./build-workout');
    const res = await buildWatchToday(OWNER, DATE);
    const w = res.workout ?? null;
    expect(w, `no workout on the wire for ${DATE}: ${res.message ?? '(no message)'}`).toBeTruthy();

    const lines: string[] = [];
    lines.push('# Watch wire payload · 2026-09-01 · `4×1 mi @ T pace · 1 min jog`');
    lines.push('');
    lines.push(`\`${w!.name}\` · ${w!.summary}`);
    lines.push(`distance ${w!.distanceMi} mi · pace label \`${w!.paceLabel}\``);
    lines.push(`hrCeilingBpm ${w!.hrCeilingBpm ?? 'null'}`);
    lines.push('');
    lines.push('| # | type | label | unit | value | target | **tol** | **paceShape** | hrTargetBpm |');
    lines.push('|---|---|---|---|---|---|---|---|---|');
    for (const p of w!.phases) {
      const value = p.repUnit === 'distance' ? `${p.distanceMi} mi` : `${p.durationSec} s`;
      lines.push(`| ${w!.phases.indexOf(p)} | ${p.type} | ${p.label} | ${p.repUnit} | ${value} | `
        + `${p.targetPaceSPerMi ?? '—'} | **${p.tolerancePaceSPerMi ?? '—'}** | `
        + `**${p.paceShape ?? '(absent)'}** | ${p.hrTargetBpm ?? '—'} |`);
    }
    lines.push('');
    lines.push('## Rules on the wire');
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify((w as unknown as { rules?: unknown }).rules ?? null, null, 2));
    lines.push('```');
    fs.writeFileSync(OUT, lines.join('\n') + '\n');

    const work = w!.phases.filter((p) => p.type === 'work');
    const rec = w!.phases.filter((p) => p.type === 'recovery');
    const wu = w!.phases.filter((p) => p.type === 'warmup' || p.type === 'cooldown');

    // The three shapes, on the wire, on the real session.
    expect(work.every((p) => p.paceShape === 'window')).toBe(true);
    expect(work.every((p) => p.tolerancePaceSPerMi === 8)).toBe(true);
    expect(rec.every((p) => p.paceShape === 'none')).toBe(true);
    expect(rec.every((p) => p.tolerancePaceSPerMi == null)).toBe(true);
    expect(wu.every((p) => p.paceShape === 'ceiling')).toBe(true);
    expect(wu.every((p) => p.tolerancePaceSPerMi === 30)).toBe(true);
  }, 120_000);
});
