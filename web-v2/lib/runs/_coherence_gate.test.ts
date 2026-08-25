/**
 * _coherence_gate.test.ts · the gate for the derived-value registry.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * IT MUST REFUSE TO PASS ON NOTHING
 *
 * The failure mode this file is written against is not "a family is wrong". It
 * is "the gate checked nothing and said OK" — a green light over a road nobody
 * is watching. `check-wire-keys.sh` shipped exactly that once: an awk regex
 * macOS awk does not honour matched no structs, extracted no keys, checked
 * nothing, and printed "0 key(s), all present".
 *
 * So every assertion here is paired with a FLOOR: a minimum number of things
 * that must have been examined for the pass to mean anything. If the registry
 * empties, if the source scanner stops resolving files, if the control runner
 * finds no controls — the gate fails rather than congratulating itself.
 *
 * And every guard is proved to FAIL as well as to pass. A positive control is
 * a row the guard must refuse; a negative control is a row it must leave
 * alone. Without the second, a guard that refuses everything scores full
 * marks.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { DERIVED_REGISTRY, refusalFamiliesFor } from '@/lib/runs/derived-registry';
import {
  reconcileRun,
  MAX_PAUSED_SHARE,
  MAX_DISPLAY_DRIFT_S_PER_MI,
  MAX_SPLIT_SUM_DRIFT_MI,
} from '@/lib/runs/coherence';

const WEB = join(__dirname, '..', '..');
const RUN_SHAPE = join(WEB, 'lib', 'runs', 'run-shape.ts');
const COHERENCE = join(WEB, 'lib', 'runs', 'coherence.ts');

/* ══════════════════════════════════════════════════════════════════════════
 * FLOORS
 *
 * Deliberately below today's numbers, so ordinary growth does not trip them,
 * and far enough above zero that an extractor which breaks cannot pass.
 * ═══════════════════════════════════════════════════════════════════════ */

const MIN_FAMILIES = 6;
const MIN_GUARDED_FAMILIES = 5;
const MIN_TOTAL_CONTROLS = 12;
const MIN_POSITIVE_CONTROLS = 6;
const MIN_RUNDATA_FIELDS = 50;

/** Field names declared on the `RunData` interface, read out of the source.
 *  TypeScript types do not survive to runtime, so the interface is parsed. */
function runDataFields(): Set<string> {
  const src = readFileSync(RUN_SHAPE, 'utf8');
  const start = src.indexOf('export interface RunData {');
  if (start < 0) return new Set();
  // Walk braces from the interface header so a nested object type cannot end
  // the block early (`hrZonePcts?: { z1: number; ... }` is exactly that shape).
  let depth = 0;
  let end = -1;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end < 0) return new Set();

  const body = src.slice(start, end);
  const out = new Set<string>();
  // Only declarations at the interface's own indent level (two spaces) count;
  // `z1: number` inside an inline object type sits deeper on the same line and
  // is excluded by anchoring to the line start.
  for (const line of body.split('\n')) {
    const m = /^ {2}([A-Za-z_][A-Za-z0-9_]*)\??\s*:/.exec(line);
    if (m) out.add(m[1]);
  }
  return out;
}

/** Symbols `coherence.ts` exports, read out of the source. */
function coherenceExports(): Set<string> {
  const src = readFileSync(COHERENCE, 'utf8');
  const out = new Set<string>();
  for (const m of src.matchAll(/^export (?:function|const) ([A-Za-z_][A-Za-z0-9_]*)/gm)) {
    out.add(m[1]);
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · THE EXTRACTORS THEMSELVES
 *
 * Checked first and hardest. Everything below trusts them.
 * ═══════════════════════════════════════════════════════════════════════ */

describe('the gate can see', () => {
  it('parses the RunData interface and finds a plausible number of fields', () => {
    const fields = runDataFields();
    // A parser that returns nothing is broken, not satisfied.
    expect(fields.size).toBeGreaterThanOrEqual(MIN_RUNDATA_FIELDS);
    // Spot-check both ends of the file so a truncated parse is caught.
    expect(fields.has('date')).toBe(true);          // first field
    expect(fields.has('distanceMi')).toBe(true);
    expect(fields.has('sufferScore')).toBe(true);   // near the end
    // And prove it is NOT just matching every identifier in the file: `z1`
    // lives inside an inline object type and must not be mistaken for a field.
    expect(fields.has('z1')).toBe(false);
  });

  it('finds the guards coherence.ts exports', () => {
    const exp = coherenceExports();
    expect(exp.size).toBeGreaterThanOrEqual(4);
    expect(exp.has('reconcileRun')).toBe(true);
    expect(exp.has('reconcileHrZones')).toBe(true);
    expect(exp.has('reconcileSplitsTotal')).toBe(true);
  });

  it('reads the registry and finds families in it', () => {
    expect(DERIVED_REGISTRY.length).toBeGreaterThanOrEqual(MIN_FAMILIES);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · THE REGISTRY IS WELL-FORMED
 * ═══════════════════════════════════════════════════════════════════════ */

describe('every registry entry', () => {
  const fields = runDataFields();
  const exports_ = coherenceExports();

  it('has a unique id', () => {
    const ids = DERIVED_REGISTRY.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const fam of DERIVED_REGISTRY) {
    describe(fam.id, () => {
      it('names only keys that exist on RunData', () => {
        // A rename in run-shape.ts must fail the build rather than silently
        // leave the family unwatched.
        for (const m of fam.members) {
          expect(fields.has(String(m)), `${fam.id} · unknown RunData key "${String(m)}"`).toBe(true);
        }
        expect(fam.members.length).toBeGreaterThanOrEqual(2);
      });

      it('names a guard that exists, or is honestly unguarded', () => {
        if (fam.guard === 'none') {
          expect(fam.winner, `${fam.id} · an unguarded family must be sound`).toBe('none');
        } else {
          expect(exports_.has(fam.guard), `${fam.id} · no such export "${fam.guard}"`).toBe(true);
        }
      });

      it('says what the invariant is and why the winner wins', () => {
        expect(fam.invariant.length).toBeGreaterThan(20);
        expect(fam.why.length).toBeGreaterThan(40);
        expect(fam.measured.length).toBeGreaterThan(20);
      });

      it('carries controls in both directions', () => {
        expect(fam.controls.length).toBeGreaterThanOrEqual(1);
        if (fam.guard !== 'none') {
          const pos = fam.controls.filter((c) => c.shouldRefuse !== null);
          const neg = fam.controls.filter((c) => c.shouldRefuse === null);
          expect(pos.length, `${fam.id} · needs a row the guard must refuse`).toBeGreaterThanOrEqual(1);
          expect(neg.length, `${fam.id} · needs a row the guard must leave alone`).toBeGreaterThanOrEqual(1);
        }
      });
    });
  }
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · THE CONTROLS · every guard proved to fire, and proved not to
 * ═══════════════════════════════════════════════════════════════════════ */

describe('controls', () => {
  let ran = 0;
  let positives = 0;

  for (const fam of DERIVED_REGISTRY) {
    for (const ctl of fam.controls) {
      it(`${fam.id} · ${ctl.label}`, () => {
        const fired = refusalFamiliesFor(ctl.row);
        if (ctl.shouldRefuse !== null) {
          expect(
            fired,
            `expected "${ctl.shouldRefuse}" to fire · got [${fired.join(', ')}]`,
          ).toContain(ctl.shouldRefuse);
        } else {
          // Scoped to this entry's own id. See FamilyControl's note.
          expect(
            fired,
            `"${fam.id}" must stay quiet on this row · got [${fired.join(', ')}]`,
          ).not.toContain(fam.id);
        }
        if (ctl.expect) {
          expect(ctl.expect(reconcileRun(ctl.row)), 'the extra assertion failed').toBe(true);
        }
      });
      ran++;
      if (ctl.shouldRefuse !== null) positives++;
    }
  }

  it('ran enough controls for the pass to mean anything', () => {
    expect(ran).toBeGreaterThanOrEqual(MIN_TOTAL_CONTROLS);
    expect(positives).toBeGreaterThanOrEqual(MIN_POSITIVE_CONTROLS);
    expect(DERIVED_REGISTRY.filter((f) => f.guard !== 'none').length)
      .toBeGreaterThanOrEqual(MIN_GUARDED_FAMILIES);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · EXEMPTIONS GO STALE
 *
 * An exemption names a file that still reads a family the wrong way. Fix the
 * file and the gate makes you delete the entry — otherwise the registry drifts
 * into a list of problems that were solved years ago, and nobody trusts it.
 * ═══════════════════════════════════════════════════════════════════════ */

describe('exemptions', () => {
  it('name files that exist', () => {
    let checked = 0;
    for (const fam of DERIVED_REGISTRY) {
      for (const path of Object.keys(fam.exempt ?? {})) {
        expect(existsSync(join(WEB, path)), `${fam.id} · no such file: ${path}`).toBe(true);
        checked++;
      }
    }
    // The exemption list is not empty today. If it empties legitimately, drop
    // this floor in the same commit that removes the last entry.
    //
    // 3 → 2 on 2026-08-24. `energy.total-vs-active` carried both remaining
    // entries and both are closed: the seed no longer coalesces a total into
    // the kcal column and run detail no longer serves one at tier 1. The
    // floor is lowered rather than the exemptions kept, because a stale
    // exemption is the thing this file exists to make impossible.
    expect(checked).toBeGreaterThanOrEqual(2);
  });

  it('carry a reason, not a shrug', () => {
    for (const fam of DERIVED_REGISTRY) {
      for (const [path, reason] of Object.entries(fam.exempt ?? {})) {
        expect(reason.length, `${fam.id} · ${path} · reason too thin`).toBeGreaterThan(40);
      }
    }
  });

  it('still describe a live violation', () => {
    // Each exempt file must still MENTION at least one member of the family it
    // is exempted from. When the reader is migrated the mention goes, and this
    // fails until the entry is deleted.
    for (const fam of DERIVED_REGISTRY) {
      for (const path of Object.keys(fam.exempt ?? {})) {
        const src = readFileSync(join(WEB, path), 'utf8');
        const stillThere = fam.members.some((m) => src.includes(String(m)));
        expect(
          stillThere,
          `${fam.id} · ${path} no longer reads any member of this family · ` +
          `delete the exemption`,
        ).toBe(true);
      }
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5 · THE TWO GUARDS AGREE ABOUT WHAT "TOO PAUSED" MEANS
 *
 * `run-shape.ts:runPaceSecPerMi` and `coherence.ts:reconcileRun` both judge a
 * row against its own clock. If their thresholds drift apart, one surface
 * refuses a pace while another prints it, which is the same bug wearing a
 * different hat.
 * ═══════════════════════════════════════════════════════════════════════ */

describe('the thresholds', () => {
  it('match run-shape.ts byte for byte', () => {
    const src = readFileSync(RUN_SHAPE, 'utf8');
    const m = /const MAX_PAUSED_SHARE = ([0-9.]+);/.exec(src);
    expect(m, 'run-shape.ts no longer declares MAX_PAUSED_SHARE').not.toBeNull();
    expect(Number(m![1])).toBe(MAX_PAUSED_SHARE);
  });

  it('are ratios and units, never claims about human speed', () => {
    // A share of a run, seconds per mile, and miles. Nothing here is a
    // physiological threshold, which is why this module carries no doctrine
    // registry entry and cannot go stale when the research moves.
    expect(MAX_PAUSED_SHARE).toBeGreaterThan(0);
    expect(MAX_PAUSED_SHARE).toBeLessThan(1);
    expect(MAX_DISPLAY_DRIFT_S_PER_MI).toBeGreaterThan(0);
    expect(MAX_SPLIT_SUM_DRIFT_MI).toBeGreaterThan(0);
  });
});
