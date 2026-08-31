/**
 * ANCHORSTAMP-1 · CLAUDE.md Rule 10 · a persisted derived value carries its
 * anchor, or it is recomputed.
 *
 * See `anchor-derivation-registry.ts` for the bug class, the three postures,
 * and every registered site with its argued reason.
 *
 * This is a SCANNER, not a behaviour test, for the reason Rule 10 states
 * outright: every existing guard asks whether a row agrees with ITSELF, and a
 * distribution frozen at last month's threshold agrees with itself perfectly.
 * The defect is only visible in the CALL — an anchor argument that is a literal
 * null, or absent — and in the WRITE that follows it.
 *
 * RULE 18 COMPLIANCE, which is binding on this file:
 *
 *   · Liveness is asserted first and hard. A scanner that reads nothing and
 *     reports clean is the worst outcome available, because it also reports
 *     confidence — `check-modelled-mark.sh` did exactly that for months.
 *   · The positive and negative controls run the SAME `findNullAnchors` the
 *     repo scan runs, over synthetic sources. A control that exercises a
 *     different code path proves nothing about the guard.
 *   · Exemptions FILTER findings; they never wrap the assertion. `exempt(...)`
 *     on the line above an assertion is how `PACE.interval-offset` switched its
 *     own claim off.
 *   · The allowlist is a ratchet, and an entry's `anchor` string is verbatim,
 *     so a fix or a refactor forces the entry to be deleted or re-pointed.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { scanSql, writersOf } from './sql-scan';
import { findNullAnchors, splitArgs, stripComments, declaresOwn } from './anchor-derivation-scan';
import {
  ANCHOR_DERIVATION_SITES,
  PERSISTED_DERIVATIONS,
  DERIVATION_BUILDERS,
  DERIVATION_BUILDER_FORKS,
} from './anchor-derivation-registry';

/** Repo root — the directory holding `web-v2/`. */
const ROOT = path.resolve(__dirname, '..', '..', '..');
const DIRS = ['web-v2/lib', 'web-v2/app', 'web-v2/scripts'];

/**
 * Floors, not guesses. Measured 2026-08-30: 1050 files, 1906 SQL literals.
 * Set well below so ordinary growth or pruning does not trip them, and well
 * above zero so a broken walk does.
 */
const MIN_FILES = 600;
const MIN_LITERALS = 800;

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.next' || e.name === '.git') continue;
      if (e.name.startsWith('._')) continue;    // macOS AppleDouble sidecars
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!/\.(ts|tsx|mts|mjs)$/.test(e.name)) continue;
      if (p.includes('.test.') || p.includes('.audit.')) continue;
      out.push(p);
    }
  };
  for (const d of DIRS) walk(path.join(ROOT, d));
  return out;
}

/** Files that write any registered persisted derivation column. */
function derivationWriters(): Set<string> {
  const scan = scanSql(ROOT, DIRS);
  const files = new Set<string>();
  for (const d of PERSISTED_DERIVATIONS) {
    for (const f of writersOf(scan, d.table, d.column)) files.add(f);
  }
  return files;
}

/**
 * The repo scan: null-or-absent anchors, restricted to files that ALSO write a
 * persisted derivation column.
 *
 * The restriction is what keeps this honest in the direction that matters. A
 * builder called for its shape and thrown away — `intensity-distribution.ts`
 * sizing an easy/hard split — is not a Rule 10 problem, and flagging it would
 * train people to add exemptions rather than read them.
 */
function scanRepo(): ReturnType<typeof findNullAnchors> {
  const writers = derivationWriters();
  const out: ReturnType<typeof findNullAnchors> = [];
  for (const abs of sourceFiles()) {
    const rel = path.relative(ROOT, abs);
    if (!writers.has(rel)) continue;
    let src: string;
    try { src = fs.readFileSync(abs, 'utf8'); } catch { continue; }
    if (!DERIVATION_BUILDERS.some((b) => src.includes(b.fn))) continue;
    // A file that declares its own function of the builder's name is a FORK,
    // and the registry's anchor positions do not describe it. Skipping is only
    // allowed for a fork named in DERIVATION_BUILDER_FORKS — an unnamed shadow
    // falls through and is scanned, so it fails loudly rather than vanishing.
    if (DERIVATION_BUILDERS.some((b) => declaresOwn(src, b.fn)
      && DERIVATION_BUILDER_FORKS.some((k) => k.file === rel && k.fn === b.fn))) continue;
    out.push(...findNullAnchors(src, rel));
  }
  return out;
}

describe('ANCHORSTAMP-1 · a persisted derivation names the anchor it came from', () => {
  const files = sourceFiles();
  const findings = scanRepo();

  // ── LIVENESS ──────────────────────────────────────────────────────────────

  it('LIVENESS · the scanner read real files and real SQL, and says how many', () => {
    expect(
      files.length,
      `walked ${files.length} source files under ${DIRS.join(', ')} — a scanner that `
      + 'reads nothing reports clean, which is the failure check-modelled-mark.sh shipped.',
    ).toBeGreaterThan(MIN_FILES);

    const scan = scanSql(ROOT, DIRS);
    expect(scan.filesScanned, 'sql-scan walked no files').toBeGreaterThan(MIN_FILES);
    expect(scan.literalsFound, 'sql-scan extracted no SQL').toBeGreaterThan(MIN_LITERALS);

    // A CANARY with a known answer. If the SQL walker silently stops resolving
    // writers, every coverage assertion below passes vacuously.
    expect(
      [...writersOf(scan, 'plan_workouts', 'workout_spec')],
      'sql-scan no longer sees generate.ts writing workout_spec — it is broken, not clean',
    ).toContain('web-v2/lib/plan/generate.ts');
  });

  it('LIVENESS · the builder scan finds the call sites it is supposed to police', () => {
    // The registry declares `buildWorkoutSpec`. If a rename lands and this file
    // is not updated, `findNullAnchors` matches nothing and reports zero
    // findings — indistinguishable from a clean repo without this assertion.
    //
    // 2026-08-31 · THE CANARY MOVED, because the old one was FIXED. This probe
    // used to read `reanchor-plan.ts`, whose maintenance arm passed a literal
    // null for both HR anchors under an argued exemption. PRESCRIPTION-WIRE-1
    // removed the parity argument that exemption rested on, so the site was
    // repaired rather than re-excused — and this assertion went red, which is
    // the probe doing exactly its job: it refuses to report clean once it can
    // no longer find the thing it was pointed at.
    //
    // Re-pointed at `seed-from-onboarding.ts`, which still passes `/* lthr */
    // null` under its own argued entry (correct for fifteen of sixteen
    // production profiles, wrong for the one that matters — see the registry).
    // When THAT is fixed this probe must move again, and a reader who finds it
    // red should check whether the canary was repaired before assuming a
    // parser break.
    const src = fs.readFileSync(path.join(ROOT, 'web-v2/lib/plan/seed-from-onboarding.ts'), 'utf8');
    const hits = findNullAnchors(src, 'seed-from-onboarding.ts');
    expect(
      hits.length,
      'the known null-anchor call in seed-from-onboarding.ts was not detected — the '
      + 'builder name in DERIVATION_BUILDERS is stale, the parser is broken, or the '
      + 'canary was fixed and this probe needs re-pointing at another exempted site',
    ).toBeGreaterThan(0);
  });

  // ── CONTROLS · Rule 18 point 1, run on every build, not just once by hand ──

  it('POSITIVE CONTROL · a null anchor and an omitted anchor are both caught', () => {
    const explicitNull = 'const b = buildWorkoutSpec(type, mi, t, null, label, maxHr, null);';
    const hitsNull = findNullAnchors(explicitNull, 'synthetic.ts');
    expect(hitsNull.map((h) => `${h.anchor}:${h.kind}`)).toEqual(['lthr:null']);

    // Stopping short is the same value as writing null, and is the majority
    // shape in this repo.
    const omitted = 'const b = buildWorkoutSpec(type, mi, t, lthr);';
    const hitsOmitted = findNullAnchors(omitted, 'synthetic.ts');
    expect(hitsOmitted.map((h) => `${h.anchor}:${h.kind}`)).toEqual(['hrmax:absent']);

    // A comment between arguments must not hide the null behind it.
    const commented = 'buildWorkoutSpec(t, mi, p, /* lthr */ null, /* rx */ sub, /* maxHr */ null);';
    expect(findNullAnchors(commented, 'synthetic.ts').map((h) => h.anchor))
      .toEqual(['lthr', 'hrmax']);
  });

  it('NEGATIVE CONTROL · live anchors, and lookalikes, are not findings', () => {
    const live = 'const b = buildWorkoutSpec(type, mi, t, lthr, label, maxHr, goal, i, e, false, null);';
    expect(findNullAnchors(live, 'synthetic.ts')).toEqual([]);

    // A null in a NON-anchor position is not this gate's business.
    const nullElsewhere = 'buildWorkoutSpec(type, mi, t, lthr, null, maxHr, null, null);';
    expect(findNullAnchors(nullElsewhere, 'synthetic.ts')).toEqual([]);

    // The declaration itself is not a call site.
    const decl = 'export function buildWorkoutSpec(type, distance_mi, tPaceSec, lthr) {';
    expect(findNullAnchors(decl, 'synthetic.ts')).toEqual([]);

    // A different function whose name merely ends in the builder's is not it.
    const lookalike = 'myBuildWorkoutSpec(a, b, c, null, d, null);';
    expect(findNullAnchors(lookalike, 'synthetic.ts')).toEqual([]);

    // A null inside a nested call in a non-anchor position must not shift the
    // argument positions — the splitter counts top-level commas only.
    const nested = 'buildWorkoutSpec(type, mi, pick(a, null, b), lthr, label, maxHr);';
    expect(findNullAnchors(nested, 'synthetic.ts')).toEqual([]);

    // A comma inside a string or a template literal is not an argument break.
    const strings = 'buildWorkoutSpec(type, mi, t, lthr, `a, b, c`, maxHr);';
    expect(findNullAnchors(strings, 'synthetic.ts')).toEqual([]);
  });

  it('PARSER CONTROL · the argument splitter refuses rather than guesses', () => {
    // An unbalanced call is a truncated read. Returning `[]` would let a
    // half-written file report clean.
    expect(splitArgs('a, b, c', 0)).toBeNull();
    expect(splitArgs('a, b)', 0)?.args).toEqual(['a', 'b']);
    expect(splitArgs('a, f(x, y), b)', 0)?.args).toEqual(['a', 'f(x, y)', 'b']);
    expect(stripComments('a /* n */ b')).toBe('a   b');
    expect(stripComments("const s = '/* not a comment */';")).toBe("const s = '/* not a comment */';");
  });

  // ── THE GATE ──────────────────────────────────────────────────────────────

  it('every null-anchor derivation that gets PERSISTED carries a registry entry', () => {
    // Exemptions FILTER, they do not wrap: the assertion below runs over every
    // finding regardless, and only registered ones are removed from the list.
    const registered = ANCHOR_DERIVATION_SITES;
    const unexcused = findings.filter((f) => !registered.some(
      (s) => s.file === f.file && fs.readFileSync(path.join(ROOT, s.file), 'utf8').includes(s.anchor),
    ));
    for (const f of unexcused) {
      // eslint-disable-next-line no-console
      console.log(`  ANCHORSTAMP  ${f.file}  ${f.anchor} @${f.index} (${f.kind})\n     ${f.snippet}`);
    }
    expect(
      unexcused.map((f) => `${f.file}:${f.anchor}`),
      'A derivation is being written into a persisted column with a physiological '
      + 'anchor passed as null (or omitted, which is the same value). The row will '
      + 'carry a number that describes nobody, or carry no number at all, and '
      + 'nothing downstream re-derives it — rendering and briefing are READ paths. '
      + 'Read the live anchor (profile.lthr raw, loadEffectiveMaxHr for HRmax), or '
      + 'add an argued entry to ANCHOR_DERIVATION_SITES saying which of Rule 10\'s '
      + 'three postures this site takes and why.',
    ).toEqual([]);
  });

  it('COVERAGE · every persisted derivation still has the writers we think it has', () => {
    // A new writer of workout_spec that nobody registered is exactly how the
    // next ANCHOR-STALE lands. This does not demand registration of every
    // writer — it demands that the ones we reasoned about still exist, so a
    // deleted or renamed module cannot leave a stale claim standing.
    const scan = scanSql(ROOT, DIRS);
    for (const d of PERSISTED_DERIVATIONS) {
      expect(
        writersOf(scan, d.table, d.column).size,
        `${d.table}.${d.column} has no writers at all — either the column was `
        + 'removed (delete this entry) or the scanner stopped resolving it',
      ).toBeGreaterThan(0);
    }
  });

  // ── RATCHET · Rule 18 point 4 ─────────────────────────────────────────────

  it('RATCHET · a registry entry whose anchor string is gone must be deleted', () => {
    const stale: string[] = [];
    for (const s of ANCHOR_DERIVATION_SITES) {
      let src: string;
      try { src = fs.readFileSync(path.join(ROOT, s.file), 'utf8'); } catch {
        stale.push(`${s.id} (file missing: ${s.file})`);
        continue;
      }
      if (!src.includes(s.anchor)) stale.push(`${s.id} (anchor not found in ${s.file})`);
    }
    expect(
      stale,
      'These entries no longer point at real code. Rule 7: anchor on quoted text, '
      + 'and when the quote stops matching, re-point the entry or delete it. The '
      + 'list may shrink, never grow.',
    ).toEqual([]);
  });

  it('RATCHET · a registry entry whose site is now clean must be deleted', () => {
    const flagged = new Set(findings.map((f) => f.file));
    const stale = ANCHOR_DERIVATION_SITES.filter((s) => !flagged.has(s.file));
    expect(
      stale.map((s) => s.id),
      'These sites no longer trip the scanner, so their entries are stale — a fix '
      + 'must force its own exemption out of the list, or the list stops meaning '
      + 'anything.',
    ).toEqual([]);
  });

  it('RATCHET · a named fork that no longer shadows must be deleted', () => {
    const stale: string[] = [];
    for (const k of DERIVATION_BUILDER_FORKS) {
      let src: string;
      try { src = fs.readFileSync(path.join(ROOT, k.file), 'utf8'); } catch {
        stale.push(`${k.file} (missing)`);
        continue;
      }
      if (!declaresOwn(src, k.fn)) stale.push(`${k.file} (no longer declares ${k.fn})`);
      expect(k.reason.length, `${k.file} fork has no argued reason`).toBeGreaterThan(60);
    }
    expect(
      stale,
      'A fork entry buys a file an exemption from the whole scan, so it must stop '
      + 'existing the moment the fork does. Delete it — the list may shrink, never grow.',
    ).toEqual([]);
  });

  it('every entry carries an argued reason, not a shrug', () => {
    for (const s of ANCHOR_DERIVATION_SITES) {
      expect(s.reason.length, `${s.id} has no argued reason`).toBeGreaterThan(60);
      expect(s.reason, `${s.id}'s reason is a shrug`).not.toMatch(/^(ok|fine|safe|n\/a|todo)\b/i);
      expect(
        s.reason,
        `${s.id} cites "we might need it", which Rule 18 names as a non-reason`,
      ).not.toMatch(/might need|for now|just in case/i);
    }
    // Ids are unique, so two entries cannot silently excuse each other.
    const ids = ANCHOR_DERIVATION_SITES.map((s) => s.id);
    expect(new Set(ids).size, 'duplicate registry ids').toBe(ids.length);
  });
});
