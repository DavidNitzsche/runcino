/**
 * lib/safety/_safety_wired_live.test.ts · NO PRODUCTION PATH MAY MINT A SAFETY
 * VERDICT OUT OF A STRING LITERAL.
 *
 * ── THE DEFECT THIS EXISTS FOR ─────────────────────────────────────────────
 *
 * `lib/adaptation/canonical-shadow/live-input.ts` built the Adaptation
 * Engine's entire `PhaseContext` from production data and then wrote this:
 *
 *     safety: 'NORMAL',
 *
 * with a comment conceding the whole problem: "The Safety owner has no
 * persisted verdict this loader can read either [...] If that ever changes,
 * this field must be wired to Safety BEFORE it does, and this comment is the
 * marker for whoever does it."
 *
 * The literal was correct only while the engine's output reached nobody. That
 * is a property of the deployment, not of the code, and it is exactly the kind
 * of guarantee that quietly stops holding. Deleting the literal is a one-time
 * fix; this gate is the part that lasts.
 *
 * ── WHAT IT SCANS FOR ──────────────────────────────────────────────────────
 *
 * Any production source file that assigns a `TrainingSafetyPosture` literal to
 * a `safety:` key. Tests and fixtures may (a hand-built posture is how you
 * exercise a branch), production may not: it must call the Safety owner, or
 * carry a value it received from a caller that did.
 *
 * ── RULE 22 · WHAT THIS GATE CANNOT FAIL ON ────────────────────────────────
 *
 *   · IT IS A TEXT SCAN. `const p = 'NORM' + 'AL'; ctx.safety = p;` passes.
 *     `safety: someVariableThatIsAlwaysNormal` passes. It catches the SHAPE
 *     that actually occurred and shipped, and nothing cleverer.
 *   · IT CANNOT SEE A WRONG READ. `resolveSafety` could query the wrong user,
 *     return a stale row, or misclassify every input, and this stays green. It
 *     pins that Safety is CONSULTED, never that the answer is right.
 *   · IT CANNOT SEE REACHABILITY. A module could call `resolveSafety`, throw
 *     the answer away, and pass. `_safety_precedence.test.ts` covers the
 *     resolver's behaviour and `_phase_arbitration.test.ts` covers what
 *     arbitration does with a stop; nothing here proves the value travels.
 *   · IT CANNOT SEE SWIFT, and `native-v2` renders safety on two devices.
 *   · IT SAYS NOTHING ABOUT THE OTHER TWO UNKNOWNS. `phaseContext.limiter` is
 *     still hard-coded `'UNKNOWN'` in the live loader because no Coaching
 *     Thesis is persisted, and that remains an open gap. It is honest (Rule
 *     11) rather than wrong, so this gate does not fail on it, and saying so
 *     here is the point: green here does not mean the live input is complete.
 *
 * ── FALSIFICATION (Rule 18 §1) ─────────────────────────────────────────────
 *
 * Both directions were run before this file was trusted, and the verbatim
 * output is in the commit message: reintroducing `safety: 'NORMAL'` into
 * `live-input.ts` fails the scan, and deleting an allowlist entry whose site is
 * still live fails the ratchet.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');

/**
 * Production files permitted to write a safety posture literal, with an argued
 * reason. RATCHET: it may shrink, never grow, and an entry whose site is clean
 * fails until deleted (Rule 18 §4).
 *
 * It is currently EMPTY, and that is the strongest state it can be in. A
 * reviewer adding a row here is asserting that some production path knows the
 * runner is safe without asking, which is the claim this gate exists to make
 * expensive.
 */
const ALLOWLIST: ReadonlyArray<{ file: string; reason: string }> = [];

/** Every posture that could stand in for a real read. `UNREADABLE` is NOT one:
 *  writing it is the honest refusal, and banning it would push callers back
 *  toward the literal this gate exists to remove. */
const MINTABLE = ['NORMAL', 'CONSTRAINED', 'HARD_STOP'] as const;

/** `safety: 'NORMAL'` / `safety:'HARD_STOP'` / `safety = 'CONSTRAINED'`. */
const MINTS = new RegExp(
  String.raw`\bsafety\s*[:=]\s*'(${MINTABLE.join('|')})'`,
  'g',
);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    // `startsWith('.')` also drops the `._foo.ts` AppleDouble sidecars this
    // exFAT volume writes beside every file. Without it the local file count is
    // double what CI sees and a liveness floor tuned locally fails on CI.
    if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const isTestOrFixture = (rel: string): boolean =>
  /\.test\.tsx?$/.test(rel)
  || /\.script\.ts$/.test(rel)
  || /(^|\/)_fixtures\.ts$/.test(rel)
  || rel.startsWith('scripts/');

describe('Safety is wired, not minted', () => {
  const files = [
    ...sourceFiles(join(ROOT, 'lib')),
    ...sourceFiles(join(ROOT, 'app')),
  ];

  it('LIVENESS · the scanner actually read source (Rule 18 §2)', () => {
    expect(files.length).toBeGreaterThan(400);
    // and it can see the file the defect lived in, so a move or a rename
    // cannot make this gate report clean by scanning a tree without it.
    expect(files.some((f) => f.endsWith(
      join('lib', 'adaptation', 'canonical-shadow', 'live-input.ts'),
    ))).toBe(true);
  });

  const found = new Map<string, string[]>();
  for (const f of files) {
    const rel = f.slice(ROOT.length + 1);
    const src = readFileSync(f, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')       // block comments
      .replace(/^[ \t]*\/\/.*$/gm, '');       // line comments
    MINTS.lastIndex = 0;
    const hits = [...src.matchAll(MINTS)].map((m) => m[0]);
    if (hits.length > 0) found.set(rel, hits);
  }

  it('LIVENESS · the pattern still matches something it should (Rule 18 §2)', () => {
    // The probe is the TEST corpus, which is allowed to mint and which would
    // have to be rewritten wholesale for this to stop matching. A gate whose
    // predicate silently stops matching reports clean while seeing nothing,
    // which is the worst outcome available because it also reports confidence.
    const inTests = [...found.keys()].filter(isTestOrFixture);
    expect(
      inTests.length,
      'the safety-literal pattern matched nothing anywhere, including in tests that '
      + 'deliberately build postures by hand. The predicate has probably rotted.',
    ).toBeGreaterThan(0);
  });

  it('no PRODUCTION file mints a safety posture from a literal', () => {
    const offenders: string[] = [];
    for (const [rel, hits] of found) {
      if (isTestOrFixture(rel)) continue;
      if (ALLOWLIST.some((a) => a.file === rel)) continue;
      offenders.push(
        `${rel} writes ${hits.join(', ')} · a production path may not assert a safety `
        + 'verdict it did not read. Call resolveSafety / resolveTrainingSafety, or carry '
        + 'the value from a caller that did.',
      );
    }
    expect(offenders).toEqual([]);
  });

  it('RATCHET · every allowlist entry still names a live site (Rule 18 §4)', () => {
    const stale = ALLOWLIST
      .filter((a) => !found.has(a.file))
      .map((a) => `${a.file} no longer mints a safety posture · delete this entry`);
    expect(stale).toEqual([]);
  });

  it('every allowlist entry carries an argued reason (Rule 18 §4)', () => {
    expect(ALLOWLIST.filter((a) => a.reason.trim().length < 60).map((a) => a.file)).toEqual([]);
  });
});

describe('the live loader consults the Safety owner', () => {
  const LIVE = join(ROOT, 'lib', 'adaptation', 'canonical-shadow', 'live-input.ts');
  const src = readFileSync(LIVE, 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

  it('LIVENESS · the loader was read and is the file it claims to be', () => {
    expect(src.length).toBeGreaterThan(1000);
    expect(code).toContain('CanonicalAdaptationInput');
  });

  it('it calls the owner rather than deriving a verdict', () => {
    expect(code).toContain('resolveTrainingSafety');
    expect(code).toContain('loadSafetyInputs');
    // and it does NOT read a health table itself · that is the ownership
    // violation `_safety_ownership.test.ts` scans the whole tree for, asserted
    // here as well because this is the file most tempted to.
    expect(code).not.toMatch(/FROM\s+(runner_injuries|sick_episodes|niggles)\b/);
  });

  it('the safety read goes over the READ-ONLY connection', () => {
    // The shadow loader is fenced (`read-only-db.ts`). A safety read that went
    // through the app's shared writable pool would be a hole in that fence,
    // and it would be invisible because the statements are SELECTs either way.
    expect(code).toMatch(/loadSafetyInputs\([\s\S]{0,120}query:\s*roQuery/);
  });

  it('a throw from the safety read does NOT become NORMAL', () => {
    // The catch exists (a dead connection must not abort the evaluation) and
    // what it falls back to is the whole question. Asserted on the text of the
    // catch block, because this is the exact line the defect would reappear on.
    const i = code.indexOf('resolveTrainingSafety(');
    expect(i).toBeGreaterThan(-1);
    const after = code.slice(i, i + 600);
    expect(after).toContain('catch');
    expect(after).toContain('TRAINING_SAFETY_NOT_RESOLVED');
    expect(after).not.toMatch(/=\s*'NORMAL'/);
  });

  it('the unreadable-input path is UNREADABLE, not NORMAL', () => {
    const i = code.indexOf('buildUnreadableInput');
    expect(i).toBeGreaterThan(-1);
    const fn = code.slice(i);
    expect(fn).toContain('TRAINING_SAFETY_NOT_RESOLVED.posture');
    expect(fn).not.toMatch(/safety:\s*'NORMAL'/);
  });
});

describe('the automatic-authority seal is untouched by this wiring', () => {
  it('AUTOMATIC_ADAPTATION_AUTHORITY is still the literal false', () => {
    // Wiring Safety in makes this engine SAFER to eventually let out, and is
    // not a decision to let it out. Asserted here so a future session reading
    // "safety is wired now" cannot take it as the missing permission.
    const src = readFileSync(join(ROOT, 'lib', 'plan', 'adaptation-authority.ts'), 'utf8');
    expect(src).toMatch(/export const AUTOMATIC_ADAPTATION_AUTHORITY\s*:\s*false\s*=\s*false\s*;/);
  });
});
