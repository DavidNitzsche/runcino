/**
 * lib/audit/_readiness_isolation_scan.test.ts · READINESS-ISOLATION-1.
 *
 * Constitution §D: "Readiness does NOT change underlying fitness. Hard rule:
 * tired ≠ less fit." §4: no side door "Readiness → Threshold Capacity
 * directly". §18: "Readiness does not redefine fitness."
 *
 * That was decided, written in three module headers (`runner-state.ts`: "IT
 * NEVER TOUCHES CAPACITY ... there is no import of it here";
 * `capacity-resolver.ts`: "NO PRESCRIPTION ... applies a readiness modifier";
 * `load-prescription-anchors.ts`: "WHY IT DOES NOT CONSULT READINESS") — and
 * per Rule 20 a header claim nothing verifies is a hypothesis. This is the
 * check, in BOTH directions:
 *
 *   A · READINESS MAY NOT WRITE A BELIEF. No readiness/state module may import
 *       a capacity or anchor writer, and none may issue SQL that writes the
 *       columns a capacity belief or a prescribed pace lives in
 *       (`profile.lthr`, `users.max_hr`, `plan_workouts.pace_target*`,
 *       `training_plans.authored_state`).
 *   B · A BELIEF MAY NOT READ READINESS. No capacity/anchor resolver may
 *       import a readiness, state, convergence or ACWR module.
 *
 * Both are TEXT SCANS with a positive control (a synthetic violating source is
 * run through the same matcher and must be flagged) and a liveness floor (the
 * scanner states how many files it read and fails on zero) — Rule 18.
 *
 * ── WHAT THIS CANNOT FAIL ON (Rule 22) ──────────────────────────────────────
 *   · A readiness value that reaches a capacity write through a THIRD module
 *     (readiness → adapt.ts → recompute) is invisible: it scans direct imports
 *     and direct SQL only. `lib/plan/adapt.ts`'s readiness_pullback is the
 *     known indirect path and it downgrades TODAY's session type only — its
 *     own comment says "Readiness does NOT re-anchor paces here or anywhere",
 *     and `check-goal-pace-leak.sh` / `_race_row_refresh_gate` cover pace
 *     writes from that file's neighbours, not this gate.
 *   · Dynamic `import()` strings are matched the same as static imports; a
 *     path assembled at run time is not.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..');

/** Side A · the readiness / current-state family. */
const READINESS_FILES = [
  'lib/coach/readiness.ts',
  'lib/coach/readiness-brief.ts',
  'lib/coach/readiness-snapshot.ts',
  'lib/coach/readiness-history.ts',
  'lib/coach/convergence.ts',
  'lib/coach/convergence-loader.ts',
  'lib/coach/acwr.ts',
  'lib/coach/acknowledge.ts',
  'lib/training/runner-state.ts',
  'app/api/readiness/route.ts',
  'app/api/readiness/brief/route.ts',
  'app/api/readiness/subjective/route.ts',
  'app/api/cron/readiness-snapshot/route.ts',
];

/** Side B · the capacity / anchor family. */
const CAPACITY_FILES = [
  'lib/training/capacity-resolver.ts',
  'lib/training/pace-corpus.ts',
  'lib/training/durability-anchor.ts',
  'lib/training/vdot-corpus.ts',
  'lib/training/vdot-inputs.ts',
  'lib/training/load-prescription-anchors.ts',
  'lib/training/lthr-reanchor.ts',
  'lib/training/coaching-thesis.ts',
];

/** Modules a readiness file may not import (belief writers and resolvers). */
const BELIEF_MODULES = /@\/lib\/training\/(capacity-resolver|pace-corpus|durability-anchor|vdot-corpus|lthr-reanchor|lthr-reanchor-store|load-prescription-anchors|coaching-thesis)|@\/lib\/plan\/(recompute-paces|reanchor-plan)/;
/** Modules a capacity file may not import (readiness / state). */
const READINESS_MODULES = /@\/lib\/coach\/(readiness|readiness-brief|readiness-snapshot|readiness-history|convergence|convergence-loader|acwr|acknowledge)|@\/lib\/training\/runner-state/;
/** SQL that writes a belief or a prescribed pace. */
const BELIEF_WRITE_SQL = /\b(UPDATE\s+(profile|users|plan_workouts|training_plans)\b|INSERT\s+INTO\s+(plan_workouts|training_plans)\b)/i;
const BELIEF_COLUMNS = /\b(lthr|max_hr|pace_target_s_per_mi(?:_lo|_hi)?|authored_state)\b/;

function importsOf(src: string): string[] {
  const out: string[] = [];
  const re = /(?:from\s+|import\()\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) != null) out.push(m[1]);
  return out;
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function beliefWriteFindings(src: string): string[] {
  const code = stripComments(src);
  const findings: string[] = [];
  const re = /`([^`]*)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) != null) {
    const sql = m[1];
    if (BELIEF_WRITE_SQL.test(sql) && BELIEF_COLUMNS.test(sql)) findings.push(sql.replace(/\s+/g, ' ').slice(0, 120));
  }
  return findings;
}

function read(rel: string): string | null {
  const abs = path.join(ROOT, rel);
  return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
}

describe('READINESS-ISOLATION-1 · readiness never writes a belief, a belief never reads readiness', () => {
  it('liveness · both file lists resolve to real files', () => {
    const a = READINESS_FILES.filter((f) => read(f) != null);
    const b = CAPACITY_FILES.filter((f) => read(f) != null);
    expect(a.length, `readiness files read: ${a.length}`).toBeGreaterThanOrEqual(10);
    expect(b.length, `capacity files read: ${b.length}`).toBeGreaterThanOrEqual(7);
    // A listed file that has vanished is a stale list, not a clean scan.
    expect(READINESS_FILES.filter((f) => read(f) == null)).toEqual([]);
    expect(CAPACITY_FILES.filter((f) => read(f) == null)).toEqual([]);
  });

  it('positive control · the matcher flags a synthetic readiness module that writes LTHR and imports the resolver', () => {
    const synthetic = `
      import { resolveThresholdCapacity } from '@/lib/training/capacity-resolver';
      await pool.query(\`UPDATE profile SET lthr = $1 WHERE user_uuid = $2\`, [x, y]);
    `;
    expect(importsOf(synthetic).some((i) => BELIEF_MODULES.test(i))).toBe(true);
    expect(beliefWriteFindings(synthetic).length).toBe(1);
    const syntheticB = `const { gradeConvergence } = await import('@/lib/coach/convergence');`;
    expect(importsOf(syntheticB).some((i) => READINESS_MODULES.test(i))).toBe(true);
  });

  it('A · no readiness module imports a belief writer or resolver', () => {
    const findings: string[] = [];
    for (const f of READINESS_FILES) {
      const src = read(f)!;
      for (const imp of importsOf(stripComments(src))) {
        if (BELIEF_MODULES.test(imp)) findings.push(`${f} imports ${imp}`);
      }
    }
    expect(findings).toEqual([]);
  });

  it('A · no readiness module issues SQL that writes a belief or a prescribed pace', () => {
    const findings: string[] = [];
    for (const f of READINESS_FILES) {
      for (const sql of beliefWriteFindings(read(f)!)) findings.push(`${f}: ${sql}`);
    }
    expect(findings).toEqual([]);
  });

  it('B · no capacity or anchor module imports readiness, state, convergence or ACWR', () => {
    const findings: string[] = [];
    for (const f of CAPACITY_FILES) {
      const src = read(f)!;
      for (const imp of importsOf(stripComments(src))) {
        if (READINESS_MODULES.test(imp)) findings.push(`${f} imports ${imp}`);
      }
    }
    expect(findings).toEqual([]);
  });
});
