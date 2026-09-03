/**
 * lib/audit/coercion-scan.ts · find the places where a MEASURED ZERO is
 * rewritten as "I have no data".
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS SEPARATELY FROM swallow-scan.ts
 *
 * Rule 11 says "don't know", "measured zero" and "the read failed" are three
 * facts, never one. It also says, in its own enforcement paragraph, that only
 * HALF of it is gated:
 *
 *   > `check-swallowed-failure.sh` and its ratcheted `EMPTIED_BASELINE` cover
 *   > the catch-and-return-empty half. The coercion half — `x > 0 ? x :
 *   > undefined` over a legitimately-zero measurement — is not yet gated and
 *   > should be.
 *
 * This is that half. `swallow-scan` asks "did a FAILURE become a value?".
 * This asks the mirror question: "did a VALUE become an absence?".
 *
 * ── THE INCIDENT ────────────────────────────────────────────────────────────
 *
 * `recentQualityPerWeek` returned a correct, measured **0**. The runner was in
 * a prescribed post-half recovery block; he had genuinely done no quality work.
 * `composeForUserInternal` held it as:
 *
 *     recentQualityPerWeek: recentQualityPW > 0 ? recentQualityPW : undefined
 *
 * `densityForWeek` reads `undefined` as "no habit evidence, cold start" and
 * answers with the runner's FULL preferred quality density. So the single most
 * cautious observation the engine can make — *he has done nothing hard in a
 * month* — produced the single most aggressive plan available. The zero was
 * right. The erasure was the bug.
 *
 * Its sibling `easyDayMedianMi` runs the same collapse from the other side: a
 * failed read returns `0`, and `0` silently disables the easy-day floor. By its
 * own header comment, *"the Rule 2 floor never fired since it shipped."*
 *
 * Both are one shape. A quantity that is legitimately zero is squeezed through
 * a truthiness test until it becomes indistinguishable from never having been
 * measured, and every downstream branch that meant to be careful takes the
 * confident path instead.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * WHAT COUNTS AS A VIOLATION · the ZERO-ERASURE
 *
 * A conditional expression where both hold:
 *
 *   1 · the TEST is emptiness — `X > 0`, `X >= 1`, `X !== 0`, `X.length > 0`,
 *       `X.size > 0`;
 *   2 · the ALTERNATE is exactly `null` or `undefined`.
 *
 * i.e. `X > 0 ? f(X) : null`. When X is zero the caller is handed an absence,
 * and an absence is a different fact.
 *
 * ── AND WHAT DELIBERATELY DOES NOT ──────────────────────────────────────────
 *
 * NOT EVERY ZERO IS A REFUSAL. A count of zero races is zero races, and a
 * scanner that flagged every `> 0` ternary would make the engine refuse to
 * answer questions it can answer perfectly well — which is its own failure and
 * a worse one than the disease, because it teaches everyone to suppress the
 * gate.
 *
 * So a site is exonerated STRUCTURALLY — provably, by syntax, never by
 * judgement — when the operation in the consequent is genuinely undefined at
 * zero. There is no ratio without a denominator and no maximum of an empty
 * list, and `null` is the honest answer in both. Five provable shapes:
 *
 *   · DIVISOR       `den > 0 ? num / den : null`
 *   · INDEX         `xs.length > 0 ? xs[0] : null`, `xs[xs.length - 1]`
 *   · SPREAD-EXTREME `xs.length > 0 ? Math.max(...xs) : null`
 *   · MEAN          `xs.length > 0 ? xs.reduce(…) / xs.length : null`
 *   · NEGATIVE-SLICE `w > 0 ? median(vals.slice(-w)) : null` — `slice(-0)`
 *                    returns the WHOLE array, so zero is not merely empty
 *                    there, it is wrong.
 *
 * These are ARITHMETIC GUARDS, not erasures, and they are not counted against
 * anything. The test is syntactic on purpose: the same posture as
 * `swallow-scan`'s blind-handler test. A handler that takes no error parameter
 * is not "probably" unable to tell what went wrong; it is provably unable. A
 * consequent that divides by the tested quantity is not "probably" a guard.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * TWO SEVERITIES, split on BLAST RADIUS rather than on shape
 *
 *   LOAD-BEARING · the erased value CROSSES A MODULE BOUNDARY from inside the
 *                  engine — it is `return`ed from a function, or written as a
 *                  property of an object literal, in `lib/plan`, `lib/coach`,
 *                  `lib/adaptation`, `lib/training` or `lib/runs`. This is
 *                  exactly the `recentQualityPerWeek` position: a reader hands
 *                  a caller an absence, the caller cannot see the zero that
 *                  produced it, and a prescription changes. Every one of these
 *                  needs an argued entry in the registry. No baseline, no
 *                  grace: an unlisted load-bearing site fails the build.
 *
 *   PERIPHERAL   · everything else — display adapters, route serialisers,
 *                  `.tsx`, `lib/` outside the engine. The same collapse, but
 *                  its worst outcome is a blank field rather than a changed
 *                  prescription. Held to a RATCHET: `PERIPHERAL_BASELINE` may
 *                  never rise, and every fix lowers it permanently.
 *
 * The ratchet is the honest instrument for a legacy, and the argument for it is
 * `swallowed-failure-registry.ts`'s verbatim: individually arguing a hundred
 * exemptions in one sitting produces a hundred sentences nobody meant, which
 * launders the problem into the appearance of having thought about it.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * SECOND CLASS · ABSENT-AS-ZERO, the same collapse running backwards
 *
 * `?? 0` / `|| 0` applied to a call to a MEASUREMENT READER. This is the
 * `easyDayMedianMi` direction: a reader that could not answer is defaulted to a
 * number, and the number then fails an `if (median > 0)` floor check silently.
 *
 * Scoped narrowly and on purpose — `Number(rows[0]?.n ?? 0)` appears in this
 * codebase hundreds of times and is usually a COUNT, where zero is right. The
 * class only fires when the defaulted expression is a call whose name says it
 * is a statistic: `median`, `mean`, `avg`, `average`, `rate`, `…PerWeek`,
 * `…PerDay`, `percentile`, `…Baseline`, `…Median`. A statistic has no zero; it
 * has an absence.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * WHAT THIS SCANNER CANNOT CATCH · required by Rule 22, and read it before you
 * cite a green run as evidence of anything
 *
 * A gate inherits the bias of whoever wrote it, so here is what mine is
 * structurally incapable of seeing:
 *
 *   1 · THE STATEMENT FORM. Only the conditional-expression shape is parsed.
 *       `let x = null; if (n > 0) x = n;` is the identical collapse and is
 *       invisible here. So is a collapse split across a helper — `toNullIfZero(n)`
 *       — and so is one hidden behind `||`, because `x || undefined` cannot be
 *       distinguished from a legitimate string-or-default without type
 *       information this scanner does not have.
 *
 *   2 · WHETHER THE COLLAPSE MATTERS. It sees the READER and never the
 *       CONSUMER. Whether an erased zero goes on to disable a safety mechanism
 *       or to blank a caption is not a syntactic property, and the
 *       LOAD-BEARING / PERIPHERAL split is a proxy for blast radius, not a
 *       measurement of it. Ranking is a human's job. A clean run means no NEW
 *       erasure crossed an engine boundary — it does not mean the engine can
 *       say "I don't know".
 *
 *   3 · THE THIRD FACT. Rule 11 names THREE states and this scanner sees two.
 *       It cannot tell "the read failed" from "there is no data" — both arrive
 *       as `null`. `swallow-scan` covers the failure half for DATABASE reads
 *       only; a failed `fetch`, a failed parse or a failed helper call
 *       collapsing to a value is gated by NEITHER scanner and is a known hole.
 *
 *   4 · STALENESS. A value that was measured correctly and has since gone out
 *       of date — the 60%-Zone-5 distribution frozen at a threshold anchor that
 *       had moved — is a fourth state, and nothing here looks at it.
 *       `check-anchor-derivation.sh` is the gate for that one.
 *
 *   5 · THE DISPLAY HALF. A surface that renders REST for a day it could not
 *       resolve is the same failure wearing pixels, and no scanner over `lib/`
 *       reaches it. That is verified by RENDERING, per Rule 13.
 *
 *   6 · ITS OWN EXEMPTIONS. Structural exoneration is syntactic, so a consequent
 *       that divides by the tested quantity is exonerated even if the division
 *       is incidental. That direction is deliberate — this scanner is
 *       conservative toward SILENCE on arithmetic guards, because crying wolf
 *       on `den > 0 ? n / den : null` is how a gate gets suppressed.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * HOW IT PARSES
 *
 * Comments and string/template contents are masked first — the same lesson
 * `swallow-scan` records, where `SELECT max_hr FROM profile` inside a doc
 * comment produced a false positive. Ternaries are matched by walking forward
 * from the `?` and tracking BOTH bracket depth and nested-ternary depth, so
 * `a > 0 ? (b > 0 ? x : y) : null` resolves to the outer pair. `?.` and `??`
 * are skipped explicitly; they are not ternaries and matching them was the
 * first version's bug.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  maskSource, lineAt, enclosingSymbol, matchBrace, matchParen,
  statementStart, handlerObservesError, walkTs,
} from './swallow-scan';

export type CoercionSeverity = 'load-bearing' | 'peripheral';
export type CoercionKind = 'zero-erasure' | 'absent-as-zero' | 'blind-indirect';

export interface CoercionSite {
  /** Repo-relative, e.g. `lib/plan/generate.ts`. */
  file: string;
  /** 1-based line of the `?` (zero-erasure) or the `??`/`||` (absent-as-zero). */
  line: number;
  /** Registry key: `file::symbol::testExpression`. Never a line number. */
  id: string;
  /** Nearest enclosing function name, or `<module>`. */
  symbol: string;
  kind: CoercionKind;
  severity: CoercionSeverity;
  /** The quantity tested for emptiness, e.g. `recentQualityPW`, `xs.length`. */
  test: string;
  /** The whole collapsing expression, collapsed to one line, for the report. */
  expr: string;
}

export interface CoercionScanResult {
  filesScanned: number;
  /** Every `? … :` conditional seen. The liveness floor guards this. */
  ternariesSeen: number;
  /** Emptiness tests exonerated as arithmetic guards. Reported, never failed. */
  guardsExonerated: number;
  /** Every `.catch(` seen. The liveness floor guards this too. */
  catchesSeen: number;
  sites: CoercionSite[];
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · FINDING THE CONDITIONAL
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * An emptiness test immediately followed by `?`.
 *
 * The test expression is captured so the guard classifier can ask whether the
 * consequent divides by it, indexes it, or spreads it. `\.length` / `\.size`
 * are captured as part of it and stripped later — `xs.length > 0 ? xs[0]` has
 * to resolve `xs`, not `xs.length`, to see the index.
 */
const EMPTINESS_TEST = new RegExp(
  String.raw`([A-Za-z_$][\w$]*(?:(?:\?\.|\.)[\w$]+|\[[^\]\n]{0,40}\]|\([^()\n]{0,60}\))*)` +
    String.raw`\s*(?:>\s*0|>=\s*1|!==?\s*0)\s*\?(?!\.|\?)`,
  'g',
);

/**
 * Index of the `:` that closes the ternary opened by the `?` at `qmark`, in
 * MASKED source. -1 when it cannot be resolved.
 *
 * Both depths matter. Bracket depth keeps a `:` inside an object literal or a
 * call argument from closing us; ternary depth keeps a nested `a ? b : c` in
 * the consequent from stealing our colon. `?.` and `??` are not ternaries.
 */
export function ternaryColon(masked: string, qmark: number): number {
  let bracket = 0;
  let tern = 0;
  for (let i = qmark + 1; i < masked.length; i++) {
    const c = masked[i];
    if (c === '(' || c === '[' || c === '{') bracket++;
    else if (c === ')' || c === ']' || c === '}') {
      if (bracket === 0) return -1; // ran out of the enclosing expression
      bracket--;
    } else if (c === '?' && bracket === 0) {
      if (masked[i + 1] === '.' || masked[i + 1] === '?') { i++; continue; }
      tern++;
    } else if (c === ':' && bracket === 0) {
      if (tern === 0) return i;
      tern--;
    } else if (c === ';' && bracket === 0) return -1;
  }
  return -1;
}

/** `null` / `undefined` standing alone as the alternate, else null. */
export function alternateIsAbsence(masked: string, colon: number): string | null {
  const m = /^\s*(null|undefined)\s*(?=[,;)\]}\n]|$)/.exec(masked.slice(colon + 1));
  return m ? m[1] : null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · STRUCTURAL EXONERATION
 * ═══════════════════════════════════════════════════════════════════════ */

function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Is the consequent an operation that is genuinely UNDEFINED at zero?
 *
 * Five provable shapes, listed in the file header. Anything else is an erasure.
 * `test` arrives as written (`xs.length`); `base` is it with the emptiness
 * accessor removed (`xs`), because the guard shapes reference the collection
 * rather than its size.
 */
export function isArithmeticGuard(test: string, consequent: string): boolean {
  const base = test.replace(/\s*(?:\?\.|\.)(?:length|size)\s*$/, '');
  const B = esc(base);
  const T = esc(test);
  const c = consequent;
  // DIVISOR — `num / den`, `num / xs.length`.
  if (new RegExp(String.raw`\/\s*\(?\s*(?:${B}|${T})\b`).test(c)) return true;
  // MEAN — a reduce over the collection, divided by anything.
  if (new RegExp(String.raw`${B}\s*\.\s*reduce\b`).test(c) && c.includes('/')) return true;
  // SPREAD-EXTREME — Math.max/min of the collection.
  if (new RegExp(String.raw`Math\s*\.\s*(?:max|min)\s*\(\s*\.\.\.\s*${B}\b`).test(c)) return true;
  // INDEX — `xs[0]`, `xs[xs.length - 1]`, `xs.at(-1)`.
  if (new RegExp(String.raw`${B}\s*\[`).test(c)) return true;
  if (new RegExp(String.raw`${B}\s*\.\s*at\s*\(`).test(c)) return true;
  // NEGATIVE-SLICE — `slice(-w)` returns the WHOLE array at w === 0.
  if (new RegExp(String.raw`\.\s*slice\s*\(\s*-\s*${B}\b`).test(c)) return true;
  return false;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · BLAST-RADIUS SEVERITY
 * ═══════════════════════════════════════════════════════════════════════ */

/** The directories where an erased zero can change a PRESCRIPTION. */
const ENGINE_DIRS = ['lib/plan/', 'lib/coach/', 'lib/adaptation/', 'lib/training/', 'lib/runs/'];

export function inEngine(file: string): boolean {
  const f = file.split(path.sep).join('/');
  return ENGINE_DIRS.some((d) => f.startsWith(d));
}

/**
 * Does this expression HAND THE ABSENCE TO SOMEBODY ELSE?
 *
 * Two positions, and they are the two the incident lived in:
 *   · `return X > 0 ? X : undefined` — a reader's answer;
 *   · `recentQualityPerWeek: X > 0 ? X : undefined` — a property written into
 *     an options/history object another module will read.
 *
 * A collapse into a bare local (`const x = n > 0 ? n : null`) stays where its
 * reader can see the zero that produced it, so it is peripheral even inside the
 * engine. Resolved by looking backwards from the start of the test expression
 * to the nearest `return` / `PROPERTY:` on the same statement.
 */
export function crossesBoundary(masked: string, testStart: number): boolean {
  // Walk back to the start of this statement / property value.
  let i = testStart - 1;
  let depth = 0;
  while (i >= 0) {
    const c = masked[i];
    if (c === ')' || c === ']' || c === '}') depth++;
    else if (c === '(' || c === '[' || c === '{') {
      if (depth === 0) break;
      depth--;
    } else if (depth === 0 && (c === ';' || c === ',' || c === '\n')) break;
    i--;
  }
  const head = masked.slice(i + 1, testStart);
  if (/\breturn\b/.test(head)) return true;
  // `name:` or `name =` at the head of the fragment — an object property or an
  // assignment into a field the caller reads.
  if (/^\s*[A-Za-z_$][\w$]*\s*:\s*$/.test(head)) return true;
  if (/\b[A-Za-z_$][\w$]*\s*\.\s*[A-Za-z_$][\w$]*\s*=\s*$/.test(head)) return true;
  return false;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · ABSENT-AS-ZERO · the collapse running backwards
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * A call whose NAME says it returns a statistic. A statistic has no zero — it
 * has an absence — so defaulting one to `0` invents an observation.
 *
 * Deliberately narrow. `count`, `total`, `sum` and `n` are excluded because
 * zero is a perfectly good answer for all four, and including them turned this
 * class into noise on the first attempt.
 */
const STATISTIC_CALL = new RegExp(
  String.raw`\b([A-Za-z_$][\w$]*(?:[Mm]edian|[Mm]ean|[Aa]verage|[Aa]vg|[Pp]ercentile|` +
    String.raw`PerWeek|PerDay|PerMi|[Bb]aseline|[Rr]ate)[\w$]*)\s*\(`,
);

/** `?? 0` / `|| 0` on a statistic call. */
export function findAbsentAsZero(
  file: string,
  src: string,
  masked: string,
): CoercionSite[] {
  const out: CoercionSite[] = [];
  const re = /(\?\?|\|\|)\s*0(?![\w.])/g;
  for (const m of masked.matchAll(re)) {
    // Look back over the preceding expression for a statistic-shaped call.
    const from = Math.max(0, m.index! - 160);
    const before = masked.slice(from, m.index!);
    const stat = STATISTIC_CALL.exec(before);
    if (!stat) continue;
    // The call must actually be the left operand, not merely nearby: nothing
    // may close the expression between the call and the `??`.
    const tail = before.slice(stat.index);
    if (/[;{}]/.test(tail)) continue;
    const line = lineAt(src, m.index!);
    const symbol = enclosingSymbol(masked, m.index!);
    out.push({
      file,
      line,
      id: `${file}::${symbol}::${stat[1]}`,
      symbol,
      kind: 'absent-as-zero',
      severity: inEngine(file) ? 'load-bearing' : 'peripheral',
      test: stat[1],
      expr: collapse(src.slice(from + stat.index, m.index! + m[0].length)),
    });
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 5 · BLIND-INDIRECT · the failure half, one indirection out of reach
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * `swallow-scan` anchors on a DATABASE CALL: `pool.query(`, `client.query(`.
 * That anchor is the reason the SAME BUG KEEPS COMING BACK ONE LAYER LATER.
 *
 * The proof is in this repo, in the file that documents its own earlier fix.
 * `app/api/cron/notifications/route.ts`'s `shakeoutDoneToday` shipped a
 * false-negative, was fixed, and the fix MOVED THE QUERY BEHIND A HELPER —
 * `mileageByDay()` — leaving `catch { return false }` exactly where it was.
 * The bug survived the fix and left the scanner's field of view in the same
 * commit. Nothing was checking any more, and nothing said so.
 *
 * A sweep on 2026-08-30 counted roughly 155 sites of this shape, and one rule
 * covers 115 of them: **a blind `.catch(…)` returning a literal, attached to an
 * awaited expression that CALLS something — whatever the callee is.** The
 * remainder need the try/catch form with an `await import(` or `JSON.parse(`
 * body.
 *
 * The failure direction is what makes it worth a gate rather than a note. From
 * that sweep, the worst by blast radius:
 *
 *   · `runnerIsCompromised` — the guard for the whole adaptation engine —
 *     resolves its detector calls each `.catch(() => null | false)`. Any ONE
 *     failing reads as "not compromised", and the caller's next line is
 *     `if (compromised) return null`. So a database blip re-enables a rebuild
 *     on a runner the guard has not actually cleared. Three call sites of that
 *     same helper DISAGREED about the direction: two failed closed, one failed
 *     open (reconciled 2026-08-31 by `runnerIsCompromisedFailClosed`).
 *
 *     As swept it read illness / injury / niggle / training-gap across five
 *     detectors. Since 2026-09-02 it reads TRAINING-GAP ONLY, across two —
 *     the runner owns his readiness and no self-reported symptom decides his
 *     training. The finding narrowed with it and did not go away; the live
 *     count and argument are in `coercion-registry.ts`'s HANDED_BACK entry
 *     rather than restated here, so the two cannot drift apart.
 *   · `computeAcwr` resolves its mileage map through `.catch(() => new Map())`
 *     and reports the acute:chronic injury ratio ABSENT for insufficient
 *     coverage — when the truth was a failed read.
 *   · `loadSettings(userId).catch(() => null)?.units_distance ?? 'mi'` on the
 *     watch, which silently prescribes MILES to a kilometre runner.
 *
 * Same severities as the other classes, same ratchet, and deliberately
 * cross-checked against `swallow-scan`: a site whose expression contains a db
 * call is SKIPPED here, so the two gates never count one bug twice.
 */
const DB_CALL_ANY = /\b(?:pool|client|db|tx|conn)\s*\.\s*query\s*(?:<|\()/;
/** A call, an `await import`, or a parse — something that can actually fail. */
const FALLIBLE = /\b(?:await\s+import\s*\(|JSON\s*\.\s*parse\s*\(|[A-Za-z_$][\w$]*\s*\()/;

/** Literal fallbacks — the same two tiers `swallow-scan` classifies. */
function literalFallback(expr: string): boolean {
  const e = expr.trim().replace(/^\(+|\)+$/g, '').trim().replace(/\s+as\s+[\s\S]*$/, '').trim();
  if (!e) return false;
  return (
    /^-?\d+(?:\.\d+)?$/.test(e) ||
    /^(?:true|false|null|undefined)$/.test(e) ||
    /^\[\s*\]$/.test(e) ||
    /^\{\s*\}$/.test(e) ||
    /^new\s+(?:Map|Set)\s*(?:<[^>]*>)?\s*\(\s*\)$/.test(e) ||
    /^['"][^'"]*['"]$/.test(e) ||
    /^\{[^{}]*\}$/.test(e)
  );
}

export function findBlindIndirect(file: string, src: string, masked: string): CoercionSite[] {
  const out: CoercionSite[] = [];
  for (const m of masked.matchAll(/\.catch\s*\(/g)) {
    const open = m.index! + m[0].length - 1;
    const close = matchParen(masked, open);
    if (close < 0) continue;
    const handler = masked.slice(open + 1, close - 1);
    const arrow = /^\s*(?:\(\s*([^)]*?)\s*\)|([A-Za-z_$][\w$]*))\s*=>/.exec(handler);
    if (!arrow) continue; // a named handler can see the error
    const param = (arrow[1] ?? arrow[2] ?? '').trim() || null;
    const body = handler.slice(arrow[0].length);
    if (handlerObservesError(param, body)) continue;
    const fallback = body.replace(/^\s*\{\s*return\s*/, '').replace(/;?\s*\}\s*$/, '');
    if (!literalFallback(fallback)) continue;

    const stmtStart = statementStart(masked, m.index!);
    const guarded = masked.slice(stmtStart, m.index!);
    // swallow-scan already owns this one. Never count a bug twice.
    if (DB_CALL_ANY.test(guarded)) continue;
    if (!FALLIBLE.test(guarded)) continue;
    // `req.json().catch(() => null)` is a 400, not a swallowed reading.
    if (/\breq(?:uest)?\s*\.\s*json\s*\(/.test(guarded)) continue;

    const symbol = enclosingSymbol(masked, m.index!);
    out.push({
      file,
      line: lineAt(src, m.index!),
      id: `${file}::${symbol}::catch`,
      symbol,
      kind: 'blind-indirect',
      severity: inEngine(file) ? 'load-bearing' : 'peripheral',
      test: collapse(src.slice(stmtStart, m.index!)).slice(0, 60),
      expr: collapse(src.slice(m.index!, close)).slice(0, 100),
    });
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 6 · THE SCAN
 * ═══════════════════════════════════════════════════════════════════════ */

function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Scan one file's source. Exported so the tests can drive it on fixtures. */
export function scanSource(
  file: string,
  src: string,
): { sites: CoercionSite[]; ternaries: number; guards: number; catches: number } {
  const masked = maskSource(src);
  const sites: CoercionSite[] = [];
  let guards = 0;

  let ternaries = 0;
  for (let i = 0; i < masked.length; i++) {
    if (masked[i] !== '?') continue;
    if (masked[i + 1] === '.' || masked[i + 1] === '?') { i++; continue; }
    if (masked[i - 1] === '?') continue;
    ternaries++;
  }

  EMPTINESS_TEST.lastIndex = 0;
  for (const m of masked.matchAll(EMPTINESS_TEST)) {
    const qmark = m.index! + m[0].length - 1;
    const colon = ternaryColon(masked, qmark);
    if (colon < 0) continue;
    if (!alternateIsAbsence(masked, colon)) continue;

    const test = m[1];
    const consequent = masked.slice(qmark + 1, colon);
    if (isArithmeticGuard(test, consequent)) { guards++; continue; }

    const symbol = enclosingSymbol(masked, m.index!);
    const boundary = crossesBoundary(masked, m.index!);
    sites.push({
      file,
      line: lineAt(src, qmark),
      id: `${file}::${symbol}::${test}`,
      symbol,
      kind: 'zero-erasure',
      severity: inEngine(file) && boundary ? 'load-bearing' : 'peripheral',
      test,
      expr: collapse(src.slice(m.index!, colon + 12)).slice(0, 140),
    });
  }

  sites.push(...findAbsentAsZero(file, src, masked));
  sites.push(...findBlindIndirect(file, src, masked));
  const catches = [...masked.matchAll(/\.catch\s*\(/g)].length;
  return { sites, ternaries, guards, catches };
}

/** Scan `lib/` and `app/` under `root` (the `web-v2` directory). */
export function scanTree(root: string): CoercionScanResult {
  const files = [
    ...walkTs(path.join(root, 'lib')),
    ...walkTs(path.join(root, 'app')),
  ];
  const sites: CoercionSite[] = [];
  let ternariesSeen = 0;
  let guardsExonerated = 0;
  let catchesSeen = 0;
  for (const abs of files) {
    const rel = path.relative(root, abs).split(path.sep).join('/');
    const r = scanSource(rel, fs.readFileSync(abs, 'utf8'));
    sites.push(...r.sites);
    ternariesSeen += r.ternaries;
    guardsExonerated += r.guards;
    catchesSeen += r.catches;
  }
  sites.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return { filesScanned: files.length, ternariesSeen, guardsExonerated, catchesSeen, sites };
}

/** Re-exported so the gate script can assert one import surface. */
export { maskSource, matchBrace };
