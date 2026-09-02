/**
 * _probe_block_line.test.ts · TEMPORARY AUDIT HARNESS (not a gate).
 * Prints the exact `coachLine` and `thesis` the Block payload carries for the
 * owner, read-only. Off by default:
 *   FAFF_BLOCK_PROBE=1 npx vitest run lib/plan/_probe_block_line.test.ts
 */
import { describe, it, expect } from 'vitest';
import { loadV5Block } from './v5-block';

const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const RUN = !!process.env.FAFF_BLOCK_PROBE;

describe.skipIf(!RUN)('block payload · what WHERE THIS GOES actually reads', () => {
  it('prints coachLine and thesis', async () => {
    const b = await loadV5Block(DAVID) as {
      coachLine: string | null;
      thesis: { limiter: string; priority: string; confidence: number | null; coachLine: string } | null;
      panel?: unknown;
    };
    const fs = await import('node:fs');
    const out = [
      `coachLine: ${JSON.stringify(b.coachLine)}`,
      `thesis.limiter: ${b.thesis?.limiter ?? '(none)'}`,
      `thesis.confidence: ${b.thesis?.confidence ?? '(none)'}`,
      `thesis.coachLine: ${JSON.stringify(b.thesis?.coachLine ?? null)}`,
    ].join('\n');
    fs.writeFileSync(process.env.FAFF_BLOCK_OUT ?? '/tmp/block-line.txt', out);
    expect(typeof b.coachLine === 'string' || b.coachLine === null).toBe(true);
  }, 240_000);
});
