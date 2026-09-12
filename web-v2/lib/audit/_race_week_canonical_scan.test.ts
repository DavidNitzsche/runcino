/**
 * RACEWEEK-SCAN-1 (2026-09-11) · a tenth undisclosed `is_race_week`-column-
 * only instance does not land silently.
 *
 * See `race-week-canonical-registry.ts` for the full argument, the five
 * canonical answers, and every currently-exempt file with its reason. In
 * short: `plan_weeks.is_race_week` marks ONLY the plan's GOAL race's week
 * (`lib/plan/race-week.ts`'s own header); a B/C tune-up embedded mid-block
 * reads `is_race_week = false` even though the runner races that week too.
 * Nine confirmed instances of that exact shape were fixed piecemeal across
 * one session before this scanner existed, and an independent reviewer found
 * two of those nine were themselves missed by an earlier "exhaustive" claim —
 * which is precisely why a scanner exists now instead of a checklist.
 *
 * ── WHAT THIS SCANNER DOES ──────────────────────────────────────────────
 *
 * Walks every non-test, non-script `.ts`/`.tsx` file under `web-v2/lib` and
 * `web-v2/app`, counts the lines matching `/is_race_week|isRaceWeek/`, and
 * asserts that count against `RACE_WEEK_EXEMPTIONS`' pinned, EXACT number —
 * not a ceiling. A file matching zero times is not registered and not
 * checked (nothing to argue about). A file matching one or more times that is
 * NOT in the registry fails immediately: the tenth undisclosed instance.
 *
 * ── WHAT THIS SCANNER CANNOT FAIL ON (Rule 22) ───────────────────────────
 *
 * · WHETHER A GOAL-ONLY READ IS ACTUALLY CORRECT. It can only tell you the
 *   count changed, or that a brand-new file appeared. `GOAL_ONLY_DELIBERATE`
 *   entries are exempted on ARGUED REASONING, not verified against doctrine
 *   here — that argument lives in the registry's prose and in this session's
 *   commit history, and a reviewer has to actually read it.
 * · A REFACTOR THAT RENAMES THE FIELD. `isRaceWeek`/`is_race_week` are the
 *   literal strings; a field renamed to `raceWeekFlag` or similar would slip
 *   through unnoticed. The doctrine-registry pattern (`check-doctrine.sh`)
 *   has the identical blind spot and accepts it for the same reason: a
 *   rename big enough to dodge a literal-string scan is big enough that a
 *   human is already looking at every call site.
 * · A HELPER THAT HIDES THE RAW READ. `containsRaceOf`, `weekContainsRace`
 *   and `resolveRaceWeekRole` are themselves exempt (`CANONICAL_DEFINITION`)
 *   because they HAVE to read the raw fields to answer the question at all.
 *   A new helper that reads the raw column and does NOT go through one of
 *   the five canonical answers would need its own registry entry to pass —
 *   which is the point: it forces a reviewer to say why, not to sneak past.
 * · COMMENT-ONLY DRIFT. The count includes prose mentions, so a large doc
 *   comment rewrite can legitimately change a file's number without any
 *   behavioural change at all — the registry's own header says so and asks
 *   the next editor to restate the count and the argument together (Rule 18
 *   §4: a changed exemption is re-argued, not silently adjusted).
 *
 * ── FALSIFICATION (Rule 18 §1) ────────────────────────────────────────────
 *
 * Run against `git show <pre-fix-sha>:web-v2/lib/plan/replan-scenarios.ts`
 * (RACEPROT-2's own before-state) and `git show <pre-fix-sha>:web-v2/lib/
 * brain/orchestration/move-orchestrator.ts` (RACEPROT-3's before-state), both
 * of which this scanner would have caught had it existed then — see
 * `scripts/check-race-week-canonical-reads.sh`'s own falsification run for
 * the verbatim failing output. The point of running it against HISTORY,
 * not a hand-built violation, is Rule 18's own standard: a check that has
 * only ever been tested against a fixture the author wrote agrees with
 * itself.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { RACE_WEEK_EXEMPTIONS, RACE_WEEK_REGISTERED_FILES } from './race-week-canonical-registry';

const WEB_ROOT = path.resolve(__dirname, '..', '..');
const SCAN_DIRS = ['lib', 'app'];
const MATCH = /is_race_week|isRaceWeek/;

/** This scanner and its own registry are exempt from themselves by
 *  construction — they exist to NAME the pattern, not to hide a read of it. */
const SELF_EXEMPT = new Set([
  'lib/audit/race-week-canonical-registry.ts',
  'lib/audit/_race_week_canonical_scan.test.ts',
]);

function isScannable(relPath: string): boolean {
  if (!relPath.endsWith('.ts') && !relPath.endsWith('.tsx')) return false;
  if (relPath.endsWith('.test.ts') || relPath.endsWith('.test.tsx')) return false;
  if (relPath.endsWith('.script.ts')) return false;
  if (path.basename(relPath).startsWith('._')) return false;   // AppleDouble sidecars
  return true;
}

function walk(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.isFile()) out.push(full);
  }
}

interface ScanResult {
  file: string;   // relative to web-v2/
  count: number;
}

function scan(): ScanResult[] {
  const files: string[] = [];
  for (const d of SCAN_DIRS) walk(path.join(WEB_ROOT, d), files);
  const out: ScanResult[] = [];
  for (const abs of files) {
    const rel = path.relative(WEB_ROOT, abs).split(path.sep).join('/');
    if (!isScannable(rel)) continue;
    if (SELF_EXEMPT.has(rel)) continue;
    let text: string;
    try {
      text = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    const count = text.split('\n').filter((line) => MATCH.test(line)).length;
    if (count > 0) out.push({ file: rel, count });
  }
  return out;
}

describe('RACEWEEK-SCAN-1 · every raw is_race_week / isRaceWeek read is registered', () => {
  it('LIVENESS · the scanner actually reads real source, not an empty tree', () => {
    // A scanner reporting clean because it read nothing is the worst outcome
    // available (Rule 18 §2), and this repo has shipped that exact failure
    // twice (check-modelled-mark.sh, check-automatic-mutations.sh guard 2).
    let totalFiles = 0;
    for (const d of SCAN_DIRS) {
      const acc: string[] = [];
      walk(path.join(WEB_ROOT, d), acc);
      totalFiles += acc.length;
    }
    expect(totalFiles, 'the scanner walked zero files · lib/app are not where it thinks they are').toBeGreaterThan(500);

    const found = scan();
    expect(found.length, 'the scanner matched zero files · the regex or the walk is broken').toBeGreaterThan(10);
  });

  it('REGISTRY SHAPE · every exemption is argued and the registry is not empty', () => {
    expect(RACE_WEEK_EXEMPTIONS.length).toBeGreaterThan(30);
    for (const e of RACE_WEEK_EXEMPTIONS) {
      expect(e.argument.length, `${e.file} has no argued reason`).toBeGreaterThan(20);
      expect(e.count, `${e.file} is pinned at a non-positive count`).toBeGreaterThan(0);
      expect(
        ['CANONICAL_DEFINITION', 'CANONICAL_CONSUMER', 'GOAL_ONLY_DELIBERATE', 'STRUCTURAL_NONREAD', 'WEB_FRONTEND_OUT_OF_SCOPE', 'FOLLOWUP'],
        `${e.file} has an unrecognised reason "${e.reason}"`,
      ).toContain(e.reason);
    }
    // No file listed twice — a duplicate silently drops one entry's reasoning
    // out of `RACE_WEEK_REGISTERED_FILES` (a Set), which is exactly the
    // "second answer to the same question" shape Rule 16 forbids.
    const files = RACE_WEEK_EXEMPTIONS.map((e) => e.file);
    expect(new Set(files).size, 'a file appears more than once in the registry').toBe(files.length);
  });

  it('THE RATCHET · a file not in the registry, or a count that drifted, fails', () => {
    const found = scan();
    const foundByFile = new Map(found.map((f) => [f.file, f.count]));
    const registeredFiles = new Set(RACE_WEEK_EXEMPTIONS.map((e) => e.file));

    const unregistered = found.filter((f) => !registeredFiles.has(f.file));
    if (unregistered.length > 0) {
      const lines = unregistered.map((f) => `  ${f.file} (${f.count} line(s))`).join('\n');
      throw new Error(
        `${unregistered.length} file(s) read is_race_week/isRaceWeek with NO registry entry — the tenth `
        + `undisclosed instance. Route the read through weekContainsRace / isGoalRaceWeek / resolveRaceWeekRole `
        + `/ containsRaceOf (lib/plan/race-week.ts, race-week-role.ts, adjudication/adjudicate.ts), or add an `
        + `argued RACE_WEEK_EXEMPTIONS entry in lib/audit/race-week-canonical-registry.ts if the raw read is `
        + `genuinely correct as-is:\n${lines}`,
      );
    }

    const drifted: string[] = [];
    for (const e of RACE_WEEK_EXEMPTIONS) {
      const actual = foundByFile.get(e.file) ?? 0;
      if (actual !== e.count) {
        drifted.push(
          `  ${e.file} · registry says ${e.count}, actual is ${actual} `
          + `(${actual > e.count ? 'NEW unreviewed read(s) — argue or fix them' : 'stale pin — lower it, Rule 18 §4'})`,
        );
      }
    }
    if (drifted.length > 0) {
      throw new Error(`${drifted.length} file(s) drifted from their registered count:\n${drifted.join('\n')}`);
    }

    // A registry entry for a file the scanner no longer finds at all is the
    // most extreme stale case — the site was fully removed and the entry
    // should have been deleted, not left at a phantom count.
    const ghosts = RACE_WEEK_EXEMPTIONS.filter((e) => !foundByFile.has(e.file));
    expect(ghosts.map((g) => g.file), 'registry entries for files with zero matches · delete these').toEqual([]);
  });

  it('THE FIVE CANONICAL ANSWERS STILL EXIST AND ARE EXPORTED', async () => {
    const raceWeek = await import('@/lib/plan/race-week');
    expect(typeof raceWeek.isGoalRaceWeek).toBe('function');
    expect(typeof raceWeek.weekContainsRace).toBe('function');
    expect(typeof raceWeek.racePresence).toBe('function');

    const role = await import('@/lib/plan/race-week-role');
    expect(typeof role.resolveRaceWeekRole).toBe('function');
    expect(typeof role.resolveRaceWeekRoleWithoutPriority).toBe('function');

    const adjudicate = await import('./../plan/adjudication/adjudicate');
    expect(typeof adjudicate.containsRaceOf).toBe('function');

    // And the resolvers still agree with each other (Rule 16, checked
    // behaviourally rather than just "the export exists"): a goal week is
    // `containsRace` true through `isGoalRaceWeek` alone, with no `days`.
    expect(raceWeek.weekContainsRace({ isRaceWeek: true })).toBe(true);
    expect(role.resolveRaceWeekRole({ isRaceWeek: true }).role).toBe('goal');
    expect(adjudicate.containsRaceOf({ isRaceWeek: true })).toBe(true);
  });

  it('registered files count matches the Set (no accidental collapse)', () => {
    expect(RACE_WEEK_REGISTERED_FILES.size).toBe(
      new Set(RACE_WEEK_EXEMPTIONS.map((e) => e.file)).size,
    );
  });
});
