/**
 * lib/adaptation/_belief_source_pins.test.ts · A BELIEF MAY NOT MOVE WITHOUT
 * SOMEONE DECIDING WHAT THAT DOES TO THE SHADOW EVIDENCE.
 *
 * The restart mechanism (`shadow-evidence-epoch.ts`) is only worth what its
 * check is worth. Without this file the epoch is a constant somebody has to
 * remember to bump — and the measured fact that motivated the whole design is
 * that belief version constants DON'T get bumped when beliefs change
 * (`origin/brain/beliefs-thesis` moves the thesis and the pace-admission rules
 * and leaves `CAPACITY_MODEL_VERSION` at 1.0.0). Relying on memory here would
 * repeat that failure one level up.
 *
 * So: every belief source the Adaptation Engine consumes is pinned by content
 * digest. Change one and this test fails, naming the file and both ways out —
 * bump the epoch, or re-pin with a stated reason. See `BELIEF_SOURCE_PINS`.
 *
 * Rule 18 · FALSIFIED. Broken and restored both directions, recorded in
 * `docs/reports/adaptation-shadow-phase9-2026-09-02.md`:
 *   · a changed belief file with a stale pin FAILS (the real case),
 *   · a pin naming a file that no longer exists FAILS (the stale-entry case).
 *
 * Rule 22 · what this CANNOT fail on:
 *   · a belief that moves because a file NOT on the list moved — the list is
 *     the eight direct sources, not their transitive closure. A change deep in
 *     `lib/training/vdot.ts` reaches capacity without tripping this.
 *   · a belief that moves because DATA moved (a new race result re-anchors
 *     LTHR). That is not a code change and is not what the epoch is for.
 *   · whether the engineer's judgement call was RIGHT. It forces the call to
 *     be made and recorded; it cannot grade it.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { BELIEF_SOURCE_PINS, SHADOW_EVIDENCE_EPOCH } from './shadow-evidence-epoch';

const WEB = path.resolve(__dirname, '..', '..');

/** THE digest function. Exported shape so the failure message can tell an
 *  engineer exactly how to recompute a pin by hand. */
export function digestOf(absPath: string): string {
  return createHash('sha256').update(readFileSync(absPath)).digest('hex').slice(0, 16);
}

describe('belief source pins · liveness', () => {
  it('pins every belief the engine consumes, and each entry is well-formed', () => {
    // Liveness (Rule 18 guard 2): an empty or truncated list would pass every
    // digest check below by looking at nothing.
    expect(BELIEF_SOURCE_PINS.length).toBeGreaterThanOrEqual(8);
    for (const pin of BELIEF_SOURCE_PINS) {
      expect(pin.file, 'file').toMatch(/^lib\/[a-z-]+\/[a-z-]+\.ts$/);
      expect(pin.digest, pin.file).toMatch(/^[0-9a-f]{16}$/);
      expect(pin.why.length, pin.file).toBeGreaterThan(40);
    }
    const files = BELIEF_SOURCE_PINS.map((p) => p.file);
    expect(new Set(files).size, 'no duplicate pins').toBe(files.length);
  });

  it('names the four beliefs the PACE lever cannot be resolved without', () => {
    const files = BELIEF_SOURCE_PINS.map((p) => p.file);
    for (const required of [
      'lib/training/capacity-resolver.ts',
      'lib/training/prescription-resolver.ts',
      'lib/evidence/activity-evidence.ts',
      'lib/training/pace-corpus.ts',
    ]) {
      expect(files, required).toContain(required);
    }
  });
});

describe('belief source pins · the ratchet', () => {
  for (const pin of BELIEF_SOURCE_PINS) {
    it(`${pin.file} is unchanged since the epoch was set`, () => {
      const abs = path.join(WEB, pin.file);
      // A pin whose file is gone is a stale entry, and stale entries fail until
      // deleted (Rule 18 guard 4) — never pass quietly.
      expect(existsSync(abs), `${pin.file} does not exist · delete or re-point its pin`).toBe(true);
      const actual = digestOf(abs);
      expect(
        actual,
        `\n\n  ${pin.file} CHANGED since SHADOW_EVIDENCE_EPOCH was set to "${SHADOW_EVIDENCE_EPOCH}".\n`
        + `  pinned ${pin.digest} · now ${actual}\n\n`
        + '  This is a decision, not a chore. Pick one, in shadow-evidence-epoch.ts:\n\n'
        + '   (a) The change moves what this belief RESOLVES to for the same activities.\n'
        + '       -> Bump SHADOW_EVIDENCE_EPOCH to a new dated slug AND re-pin this digest.\n'
        + '          Shadow records written before the bump stop counting toward promotion;\n'
        + '          they stay in the log as history and are never rewritten.\n\n'
        + '   (b) The change is comments, types, tests or a refactor that cannot move a\n'
        + '       resolved value.\n'
        + '       -> Re-pin this digest alone and say so in its `why`.\n\n'
        + `  Recompute:  node -e 'console.log(require("crypto").createHash("sha256")`
        + `.update(require("fs").readFileSync("${pin.file}")).digest("hex").slice(0,16))'\n`,
      ).toBe(pin.digest);
    });
  }
});
