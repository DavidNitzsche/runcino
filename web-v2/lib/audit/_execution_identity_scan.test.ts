/**
 * EXECID-SCAN-1 · a surface that answers "did the runner complete this day"
 * calls the ONE resolver, and does not re-derive it from a calendar date.
 *
 * See `execution-identity-exemptions.ts` for the bug class and the four
 * separate defects it produced across 2026-09-03/04. In short: same-date was
 * read as identity in display, then in evidence, then in sealing, then in the
 * undo gate — four fixes, each believing it was the last, because nothing could
 * see a surface that simply did not call `lib/execution/day-resolver.ts`.
 *
 * WHAT THIS CANNOT FAIL ON (Rule 22):
 *   · a file that asks the wrong question through a HELPER rather than inline
 *     SQL — the scanner reads string literals, so a date-only completion test
 *     hidden behind another module's function is invisible here. The behaviour
 *     tests in `lib/plan/_sealing_identity.test.ts` are the other half.
 *   · intent. It cannot tell a mileage query from a completion query; it can
 *     only insist that a runner-scoped day-key read of `runs` is either
 *     obviously load-shaped or argued for. That is why the allowlist exists,
 *     and why every entry has to say which question its file is asking.
 *   · anything outside lib/ and app/.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { extractStringLiterals } from './sql-scan';
import { EXECUTION_IDENTITY_EXEMPTIONS } from './execution-identity-exemptions';

const ROOT = path.resolve(__dirname, '..', '..');
const DIRS = ['lib', 'app'];

/**
 * A day key selected out of `runs` — the shape every one of the four defects
 * had. `runDaySql()` renders to an `AT TIME ZONE ... ::date` expression, so
 * both the helper call and its expansion are matched.
 */
function selectsRunDayKey(sql: string): boolean {
  if (!/\bFROM\s+runs\b/i.test(sql)) return false;
  return /::date/i.test(sql) || /\bAT TIME ZONE\b/i.test(sql);
}

function scopesToOneRunner(sql: string): boolean {
  return /user_uuid\s*=|user_id\s*=/i.test(sql);
}

/**
 * THE FINGERPRINT, and why it is this and not a keyword search.
 *
 * The first draft of this scanner flagged any runner-scoped day-key read of
 * `runs` in a file whose text mentioned completion. That matched 20 files —
 * `vdot-inputs.ts`, `durability-anchor.ts`, `adaptive-ramp.ts`, every load and
 * volume reader in the engine — because they all legitimately ask "what did
 * this runner run", and almost every file in `lib/coach` says "complete"
 * somewhere. A 20-entry allowlist is a rubber stamp, and Rule 18 is explicit
 * that an exemption list which excuses the normal case has stopped meaning
 * anything.
 *
 * What separates the four real defects from all twenty of those readers is not
 * vocabulary, it is the SHAPE OF THE ANSWER. A load reader asks for
 * quantities — distance, duration, pace, HR, the `data` payload — keyed BY
 * date. A date-coincidence completion check asks for the DATES THEMSELVES and
 * nothing else: "give me the days this runner ran", and then treats membership
 * in that set as proof a prescription was executed. That is precisely the
 * query `app/api/plan/undo/route.ts` was running.
 *
 * So: flag a runner-scoped day-key read of `runs` whose projection carries no
 * quantity at all. A reader that wants a number is asking a load question and
 * is not this bug; a reader that wants only a set of dates is asserting
 * identity from the calendar, which is the thing that may not be done.
 */
// No leading \b: the engine reaches these columns through helper names like
// `runDistanceMiSql('r')`, where "Distance" is mid-identifier and a word
// boundary would miss it. That gap let `decoupling-trend.ts` and
// `durability-anchor.ts` — three plainly load-shaped reads — through as
// findings on the first run of this predicate.
const QUANTITY_COLUMNS =
  /(distance|duration|elapsed|moving|pace|avg_?hr|max_?hr|hr_|cadence|elevation|calor|\.data\b|data\s*->|shoe_id|SUM\s*\(|AVG\s*\(|MAX\s*\(|MIN\s*\()/i;

function projectsOnlyDates(sql: string): boolean {
  return !QUANTITY_COLUMNS.test(sql);
}

interface Finding { file: string; sql: string }

/** Rule 18 · a scanner states how much it read, so a silent zero is visible. */
const READ = { files: 0, literals: 0, runSql: 0 };

function scan(): Finding[] {
  READ.files = 0; READ.literals = 0; READ.runSql = 0;
  const out: Finding[] = [];
  const walk = (dir: string): void => {
    let entries: string[];
    try { entries = fs.readdirSync(dir); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e);
      let st: fs.Stats;
      try { st = fs.statSync(p); } catch { continue; }
      if (st.isDirectory()) {
        if (e === 'node_modules' || e === '.next') continue;
        walk(p);
        continue;
      }
      if (!p.endsWith('.ts') && !p.endsWith('.tsx')) continue;
      if (p.includes('.test.')) continue;
      // The resolver IS the owner; it is allowed to write this SQL.
      const rel = path.relative(ROOT, p);
      if (rel === 'lib/execution/day-resolver.ts') continue;
      let src: string;
      try { src = fs.readFileSync(p, 'utf8'); } catch { continue; }
      READ.files += 1;
      for (const raw of extractStringLiterals(src)) {
        READ.literals += 1;
        const sql = raw.replace(/\s+/g, ' ');
        if (/\bFROM\s+runs\b/i.test(sql)) READ.runSql += 1;
        if (!selectsRunDayKey(sql)) continue;
        if (!scopesToOneRunner(sql)) continue;
        if (!projectsOnlyDates(sql)) continue;
        out.push({ file: rel, sql: sql.slice(0, 180) });
      }
    }
  };
  for (const d of DIRS) walk(path.join(ROOT, d));
  return out;
}

describe('EXECID-SCAN-1 · completion is resolved, never inferred from a date', () => {
  const findings = scan();
  const exemptFiles = new Set(EXECUTION_IDENTITY_EXEMPTIONS.map((e) => e.file));

  it('the scanner reads real SQL — a silent zero would prove nothing', () => {
    // Rule 18 · a scanner states how much it read and fails on zero.
    // `check-modelled-mark.sh` reported clean for months while scanning
    // nothing, and that is the worst available outcome because it also
    // reported confidence.
    expect(READ.files, 'the walk read no source files at all').toBeGreaterThan(500);
    expect(READ.literals, 'no string literals were extracted').toBeGreaterThan(500);
    expect(READ.runSql, 'no `FROM runs` SQL anywhere in lib/ or app/ — the extractor is broken')
      .toBeGreaterThan(10);

    // And the predicate itself, falsified in BOTH directions (Rule 18 §1).
    // A gate with two directions must fail on a new violation AND on a
    // fingerprint that has stopped recognising the defect it was written for.
    const sealdate = 'SELECT DISTINCT d::date AS d FROM runs r WHERE r.user_uuid = $1::uuid';
    expect(
      selectsRunDayKey(sealdate) && scopesToOneRunner(sealdate) && projectsOnlyDates(sealdate),
      'the fingerprint no longer matches SEALDATE-1\'s own query shape — this gate would now '
      + 'report clean on the defect it was written for',
    ).toBe(true);
    const loadRead = 'SELECT d::date AS d, SUM(r.distance_mi) FROM runs r WHERE r.user_uuid = $1';
    expect(
      projectsOnlyDates(loadRead),
      'the fingerprint now matches a plain load query — it has gone broad again and its '
      + 'allowlist will become a rubber stamp',
    ).toBe(false);
  });

  it('no surface re-derives completion from a calendar date', () => {
    const unexcused = findings.filter((f) => !exemptFiles.has(f.file));
    for (const f of unexcused) {
      // eslint-disable-next-line no-console
      console.log(`  EXECID  ${f.file}\n     ${f.sql}`);
    }
    expect(
      unexcused.length,
      'A query reads a day key out of `runs` for one runner in a file that talks about '
      + 'completion/sealing. Same calendar date is NOT identity — that is the defect '
      + 'WORKOUT-EXECUTION-ID-1, EXECUTION-IDENTITY-1, SEALING-IDENTITY-1 and SEALDATE-1 each '
      + 'closed in a different place. Route the decision through '
      + '`lib/execution/day-resolver.ts` (or `isDaySealed`), or add an argued entry to '
      + 'EXECUTION_IDENTITY_EXEMPTIONS saying which question this file is actually asking.',
    ).toBe(0);
  });

  it('the allowlist is a ratchet — an exemption whose file is now clean must be deleted', () => {
    const flagged = new Set(findings.map((f) => f.file));
    const stale = EXECUTION_IDENTITY_EXEMPTIONS.filter((e) => !flagged.has(e.file));
    expect(
      stale.map((e) => e.file),
      'These files no longer trip the scanner, so their exemptions are stale. '
      + 'Delete them — the list may shrink, never grow.',
    ).toEqual([]);
  });

  it('every exemption carries an argued reason, not a shrug', () => {
    for (const e of EXECUTION_IDENTITY_EXEMPTIONS) {
      expect(e.reason.length, `${e.file} has no argued reason`).toBeGreaterThan(60);
      expect(e.reason, `${e.file}'s reason is a shrug`).not.toMatch(/^(ok|fine|safe|n\/a)\b/i);
    }
  });
});
