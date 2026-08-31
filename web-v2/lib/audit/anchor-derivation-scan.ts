/**
 * lib/audit/anchor-derivation-scan.ts · the scanner behind CLAUDE.md Rule 10.
 *
 * Split out of the test file so the POSITIVE AND NEGATIVE CONTROLS can run the
 * same code path over synthetic sources. Rule 18: a gate is not trusted until
 * it has been made to fail, and a control that exercises a different function
 * than the one guarding the repo proves nothing about the guard.
 *
 * WHAT IT LOOKS FOR. A call to a `DERIVATION_BUILDER` whose anchor-carrying
 * argument is a literal `null`/`undefined` — or is ABSENT, which by the
 * signature's own defaults is the same value. Omission is the majority case:
 * `app/api/plan/restore` wipes `hr_cap_bpm` by stopping at the fourth argument.
 *
 * PRECISION. The argument splitter is hand-rolled rather than regex'd for the
 * reason `sql-scan.ts` gives about its own literal extractor: these calls span
 * a dozen lines, carry block comments BETWEEN arguments (`/* maxHr *\/ null`),
 * nest parentheses and ternaries, and contain template literals. A comma-split
 * gets every one of them wrong, and a scanner that mis-parses reports clean.
 */
import { DERIVATION_BUILDERS, type PhysiologicalAnchor } from './anchor-derivation-registry';

export interface AnchorFinding {
  file: string;
  fn: string;
  anchor: PhysiologicalAnchor;
  /** Zero-based argument position that was null or absent. */
  index: number;
  /** `null`, or `absent` when the call stopped short of this position. */
  kind: 'null' | 'absent';
  /** The call as written, collapsed and clipped — for the failure message. */
  snippet: string;
}

/**
 * Strip line and block comments, leaving string and template literals intact.
 *
 * Comments must go BEFORE argument splitting: `/* maxHr *\/ null` is a null
 * argument, and `// null` inside a comment is not an argument at all. Both
 * shapes are present in this repo.
 */
export function stripComments(src: string): string {
  let out = '';
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      // Leave a space so `/*maxHr*/null` does not become `null` glued to what
      // preceded it, and so an argument that was ONLY a comment stays empty.
      out += ' ';
      continue;
    }
    if (c === '`' || c === "'" || c === '"') {
      const quote = c;
      out += c;
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') { out += src[j] + (src[j + 1] ?? ''); j += 2; continue; }
        out += src[j];
        if (src[j] === quote) { j++; break; }
        if (quote !== '`' && src[j] === '\n') { j++; break; }
        j++;
      }
      i = j;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * Split a call's argument list at TOP-LEVEL commas only.
 *
 * `src` starts immediately after the opening paren. Returns the arguments and
 * the index just past the matching close paren, or null when unbalanced (a
 * truncated file — which must not be read as "no arguments").
 */
export function splitArgs(src: string, start: number): { args: string[]; end: number } | null {
  const args: string[] = [];
  let depth = 0;
  let cur = '';
  let i = start;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '(' || c === '[' || c === '{') { depth++; cur += c; i++; continue; }
    if (c === ')' && depth === 0) {
      if (cur.trim() !== '' || args.length > 0) args.push(cur.trim());
      return { args, end: i + 1 };
    }
    if (c === ')' || c === ']' || c === '}') { depth--; cur += c; i++; continue; }
    if (c === ',' && depth === 0) { args.push(cur.trim()); cur = ''; i++; continue; }
    if (c === '`' || c === "'" || c === '"') {
      const quote = c;
      cur += c;
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') { cur += src[j] + (src[j + 1] ?? ''); j += 2; continue; }
        cur += src[j];
        if (src[j] === quote) { j++; break; }
        j++;
      }
      i = j;
      continue;
    }
    cur += c;
    i++;
  }
  return null;   // unbalanced — refuse rather than guess
}

/** True when an argument expression is the literal null/undefined. */
function isNullLiteral(arg: string): boolean {
  const a = arg.trim();
  return a === 'null' || a === 'undefined';
}

/**
 * True when THIS file declares its own function of that name, shadowing the
 * canonical import.
 *
 * `scripts/backfill-workout-spec.mjs` carries a fork:
 * `buildWorkoutSpec(type, subLabel, distanceMi, paceSet, lthr)` — five
 * parameters in a different order, with its own HR math (88/85/75 % of LTHR
 * against the canonical `hrCapEasy`'s 89 % plus an HRmax cross-check). The
 * registry's anchor POSITIONS describe the canonical signature, so applying
 * them to a fork reports a position that means something else entirely.
 *
 * Skipping is correct and is also a blind spot, so it is not done silently:
 * `DERIVATION_BUILDER_FORKS` names every file allowed to shadow, the scanner
 * refuses to skip one that is not named there, and the ratchet fails when a
 * named fork's declaration disappears.
 */
export function declaresOwn(src: string, fn: string): boolean {
  const re = new RegExp(`\\b(?:async\\s+)?function\\s+${fn}\\s*\\(`);
  return re.test(stripComments(src));
}

/**
 * Find every null-or-absent anchor argument in one source.
 *
 * `file` is only used to label findings. A call is reported once per offending
 * anchor position, so `buildWorkoutSpec(t, d, p, null)` yields two findings —
 * an explicit null lthr and an absent maxHr — which is correct: they are two
 * separate values the row will not carry.
 */
export function findNullAnchors(src: string, file: string): AnchorFinding[] {
  const out: AnchorFinding[] = [];
  const clean = stripComments(src);
  for (const builder of DERIVATION_BUILDERS) {
    // Word-boundary the callee so `myBuildWorkoutSpec(` is not a match, and
    // skip the declaration itself (`function buildWorkoutSpec(`).
    const re = new RegExp(`(^|[^A-Za-z0-9_$.])${builder.fn}\\s*\\(`, 'g');
    for (const m of clean.matchAll(re)) {
      const open = m.index! + m[0].length;
      const before = clean.slice(Math.max(0, m.index! - 40), m.index!);
      if (/\b(function|const|let|var|class)\s*$/.test(before)) continue;
      const split = splitArgs(clean, open);
      if (!split) continue;
      const snippet = clean.slice(m.index!, split.end).replace(/\s+/g, ' ').slice(0, 150);
      for (const { index, anchor } of builder.anchorArgs) {
        if (index >= split.args.length) {
          out.push({ file, fn: builder.fn, anchor, index, kind: 'absent', snippet });
          continue;
        }
        if (isNullLiteral(split.args[index])) {
          out.push({ file, fn: builder.fn, anchor, index, kind: 'null', snippet });
        }
      }
    }
  }
  return out;
}
