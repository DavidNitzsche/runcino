/**
 * lib/runs/_vocabulary_split.test.ts · two fields on `runs.data` hold two
 * vocabularies each, and a reader that knows only one is wrong on the rest.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE TWO FIELDS
 *
 * `data.type` — production, 2026-08-24, all 257 rows:
 *
 *     sportType 'Run' + type 'Run'    141    Strava's ACTIVITY KIND
 *     sportType 'Run' + type 'easy'    29    faff's WORKOUT TYPE
 *     no sportType   + type 'easy'     16    faff's WORKOUT TYPE
 *     no sportType   + no type         71
 *
 * `data.workoutType` — 130 rows carry a value:
 *
 *     semantic string ('easy','tempo','long','intervals','race','threshold')  78
 *     Strava's integer enum · 0 x50, 1 x2                                     52
 *
 * In Strava's enum 0 is "the runner picked nothing". It is a stored ABSENCE
 * wearing a value's clothes, and 28 canonical rows carry it. 1 is 'race',
 * 2 'long', 3 'workout'.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THIS COST
 *
 * `easy-discipline.ts` — the surface that says "N of your last M easy days ran
 * faster than the easy band" — filtered `(data->>'type') = 'Run'`. That reads
 * `type` as an activity kind, which it is on 141 rows and is not on 45. The
 * clause cannot have been excluding rides or swims: every row in this table
 * that carries a `sportType` carries 'Run'. What it did was keep the
 * Strava-shaped rows and silently drop the rest.
 *
 * Over the live 90-day window: 32 rows in, 13 of them easy. Without the
 * clause: 56 rows in, 22 easy. Nine easy runs — 41% of them — were invisible
 * to a finding whose entire output is a count of easy runs. It was counting to
 * thirteen and calling it his last M.
 *
 * Its second filter then read `String(d.workoutType ?? '')`, which turns a
 * Strava 2 into '2'. A LONG RUN and an unlabelled run were both rejected for
 * the same reason — neither string is in the easy set — and the fact that one
 * of those rejections was correct was luck.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE RULE
 *
 * `normalizeDataWorkoutType` reads the `workoutType` field's two vocabularies.
 * It maps 0 to null (honest: nothing was recorded), 1/2/3 to race/long/tempo,
 * and passes semantic strings through.
 *
 * `runStimulusType` is the answer to "what kind of session was this", across
 * BOTH fields: `workoutType` first, then `type` when `type` is not an activity
 * kind. It returns null when nothing recorded a stimulus, which is 68 of this
 * runner's 123 runs that carry both a pace and a heart rate.
 *
 * That last guard is not decoration. `normalizeDataWorkoutType('Run')` returns
 * 'run' — the loose normaliser passes unrecognised strings through on purpose,
 * so the log records what Strava said — and a caller that grouped on it would
 * build a bucket called `run` holding the 141 Strava-shaped rows. That is the
 * partition-by-importer this file exists to end, under a different name.
 *
 * Asking `sportType` whether a row is a run, and `runStimulusType` what kind of
 * session it was, covers every question. Comparing `data.type` to a literal is
 * the shape this file forbids.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { normalizeDataWorkoutType, runStimulusType } from '@/lib/runs/log-enrich';

const WEB = path.resolve(__dirname, '..', '..');
const ROOTS = ['lib', 'app', 'components'];
const MIN_FILES_SCANNED = 400;

function rel(abs: string): string {
  return path.relative(WEB, abs).split(path.sep).join('/');
}

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === '.next') continue;
        walk(p);
      } else if (/\.tsx?$/.test(e.name) && !e.name.startsWith('._') && !/\.test\.tsx?$/.test(e.name)) {
        out.push(p);
      }
    }
  };
  for (const r of ROOTS) walk(path.join(WEB, r));
  return out;
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/^[ \t]*--[^\n]*/gm, ' ');
}

/**
 * A SQL predicate comparing `data->>'type'` to a literal.
 *
 * Multi-line by construction: the clause lives inside a template literal and
 * the comparison is regularly on its own line, several lines from the SELECT.
 */
export function comparesRunTypeToLiteral(src: string): boolean {
  const code = stripComments(src);
  // The receiver must be `data` (bare or aliased). `phase->>'type'` is a
  // DIFFERENT object — a watch phase, whose type is warmup/work/recovery/
  // cooldown and has exactly one vocabulary — and flagging it would bury the
  // signal under six false findings in the plan engine.
  return /(?:\w+\.)?data\s*->>\s*'type'\s*\)?\s*(?:=|<>|!=|IN\b|LIKE\b|ILIKE\b|~)/i.test(code);
}

/**
 * Files allowed to compare `data->>'type'`, each with a reason.
 *
 * `sportType` answers "is this a run"; `runStimulusType` answers "what kind of
 * session". There is no third question `type` can be asked.
 */
const ALLOWLIST: Record<string, string> = {
  /* NOT MIGRATED, DELIBERATELY. This is a blocker raised with the owner on
   * 2026-08-24, not an oversight.
   *
   * `detectRampSignals` reads `data->>'type' IN ('threshold','intervals',
   * 'tempo')` for its quality signal and `= 'long'` for its long-run one.
   * Neither can ever match: across all 257 rows, `data.type` takes exactly
   * three values — 'Run' (141), 'easy' (45) and absent (71). It also
   * selects three keys that exist on ZERO rows:
   * `hr_on_pace_delta_bpm`, `pace_target_s_per_mi`, `aerobicDecouplingPct`.
   *
   * So `recentQuality` is always empty, `lastQualityOnPace` is always
   * false, and `allGreen` — which requires it — is never true. THE
   * ADAPTIVE RAMP HAS NEVER FIRED. Fixing the field would switch on an
   * auto-ramp that has never run against this runner's plan, and would do
   * it with `lastQualityDeltaBpm == null` taking the benefit of the doubt.
   * That is a plan-engine decision with a real trade-off, not a read fix,
   * and the current failure is in the safe direction. */
  'lib/plan/adaptive-ramp.ts':
    'Reads data.type as a session type; it never holds one, so both ramp '
    + 'signals are structurally dead and the ramp never fires. Turning them '
    + 'on is a plan-engine decision. Raised with the owner 2026-08-24.',
};

describe('vocabulary split · one field, two vocabularies', () => {
  it('normalizeDataWorkoutType reads BOTH vocabularies', () => {
    // Strava's enum. 0 is an absence, not a value.
    expect(normalizeDataWorkoutType(0)).toBeNull();
    expect(normalizeDataWorkoutType('0')).toBeNull();
    expect(normalizeDataWorkoutType(1)).toBe('race');
    expect(normalizeDataWorkoutType(2)).toBe('long');
    expect(normalizeDataWorkoutType(3)).toBe('tempo');
    // The semantic vocabulary.
    expect(normalizeDataWorkoutType('easy')).toBe('easy');
    expect(normalizeDataWorkoutType('Tempo')).toBe('tempo');
    // Absence stays absence. A default must not become a fact.
    expect(normalizeDataWorkoutType(null)).toBeNull();
    expect(normalizeDataWorkoutType(undefined)).toBeNull();
    expect(normalizeDataWorkoutType('')).toBeNull();
  });

  it('runStimulusType refuses an activity kind rather than making it a stimulus', () => {
    /* The trap that makes `type` unusable on its own. `normalizeWorkoutTypeLoose`
     * passes an unrecognised string through unchanged — deliberately, so the
     * log records what Strava said — so 'Run' comes back as 'run'. A caller
     * that used it to group runs would build a bucket called `run` holding the
     * 141 Strava-shaped rows, which IS the partition-by-importer this whole
     * file exists to end, wearing a different name. */
    expect(normalizeDataWorkoutType('Run')).toBe('run');       // the trap
    expect(runStimulusType({ type: 'Run' })).toBeNull();       // the guard
    expect(runStimulusType({ type: 'VirtualRun' })).toBeNull();
    expect(runStimulusType({ type: 'easy' })).toBe('easy');
    // workoutType wins when both are present and both are real.
    expect(runStimulusType({ workoutType: 'tempo', type: 'Run' })).toBe('tempo');
    expect(runStimulusType({ workoutType: 2, type: 'Run' })).toBe('long');
    // Strava's 0 is an absence, so the ladder falls through to `type`.
    expect(runStimulusType({ workoutType: 0, type: 'easy' })).toBe('easy');
    // Nothing recorded a stimulus. Null, never a guess.
    expect(runStimulusType({ workoutType: 0, type: 'Run' })).toBeNull();
    expect(runStimulusType({})).toBeNull();
    expect(runStimulusType(null)).toBeNull();
  });

  it('a bare string compare gets the Strava enum wrong · the shape this forbids', () => {
    // The negative control for the RULE, held as an executable statement of
    // what the old easy-discipline filter did. If this ever stops being true
    // the enum has gone away and this whole file can go with it.
    const EASY = new Set(['easy', 'recovery', 'shakeout']);
    const stravaLongRun = 2;
    expect(EASY.has(String(stravaLongRun).toLowerCase())).toBe(false);   // right answer
    expect(normalizeDataWorkoutType(stravaLongRun)).toBe('long');        // right REASON
    const stravaUnlabelled = 0;
    expect(EASY.has(String(stravaUnlabelled).toLowerCase())).toBe(false);
    expect(normalizeDataWorkoutType(stravaUnlabelled)).toBeNull();
  });

  it('no query filters on data.type as though it were one vocabulary', () => {
    const files = sourceFiles();
    expect(files.length, 'the scan walked almost nothing').toBeGreaterThanOrEqual(MIN_FILES_SCANNED);

    /**
     * Files allowed to compare `data->>'type'`, each with a reason.
     *
     * The list is empty and should stay that way. `sportType` answers "is this
     * a run"; `workoutType`, through `normalizeDataWorkoutType`, answers "what
     * kind of session". There is no third question `type` can be asked.
     */

    const offenders: string[] = [];
    for (const f of files) {
      const r = rel(f);
      if (ALLOWLIST[r]) continue;
      if (comparesRunTypeToLiteral(fs.readFileSync(f, 'utf8'))) offenders.push(r);
    }
    console.log(`\n=== data.type LITERAL COMPARES · ${files.length} files, ` +
                `${Object.keys(ALLOWLIST).length} allowed, ${offenders.length} new ===`);
    for (const o of offenders) console.log(`  ${o}`);
    expect(offenders,
      "a query compares `data->>'type'` to a literal. That field is Strava's activity " +
      "kind on 141 rows and the faff workout type on 45. Ask `sportType` whether it is " +
      'a run, and `normalizeDataWorkoutType(workoutType)` what kind of session it was.',
    ).toEqual([]);
  });

  it('the allowlist has no stale entries', () => {
    // The list may shrink. Fix adaptive-ramp and this makes you delete its
    // entry, the same way the doctrine registry's `exempt` map works.
    const stale: string[] = [];
    for (const [file, reason] of Object.entries(ALLOWLIST)) {
      const abs = path.join(WEB, file);
      if (!fs.existsSync(abs)) { stale.push(`${file} — file is gone (${reason})`); continue; }
      if (!comparesRunTypeToLiteral(fs.readFileSync(abs, 'utf8'))) {
        stale.push(`${file} — migrated, delete this entry (${reason})`);
      }
    }
    expect(stale, 'the allowlist may shrink; a migrated file must be removed from it').toEqual([]);
  });

  it('the scanner catches a planted corruption', () => {
    const PLANTED: Array<[string, string]> = [
      ['single line', "const q = `SELECT 1 FROM runs WHERE (data->>'type') = 'Run'`;"],
      ['multi-line SQL literal', "const q = `SELECT data FROM runs\n  WHERE user_uuid = $1\n    AND (data->>'type') = 'Run'\n  ORDER BY 1`;"],
      ['negated', "const q = `SELECT 1 FROM runs WHERE data->>'type' <> 'Run'`;"],
      ['IN list', "const q = `SELECT 1 FROM runs WHERE data->>'type' IN ('Run','VirtualRun')`;"],
      ['aliased', "const q = `SELECT 1 FROM runs r WHERE (r.data->>'type') = 'Run'`;"],
    ];
    for (const [label, src] of PLANTED) {
      expect(comparesRunTypeToLiteral(src), `planted corruption not caught · ${label}`).toBe(true);
    }
    const CLEAN = [
      "const q = `SELECT data->>'type' AS type FROM runs`;",           // reads it, does not judge it
      "const q = `SELECT 1 FROM runs WHERE data->>'sportType' = 'Run'`;",
      "const q = `SELECT 1 FROM plan_workouts WHERE type IN ('easy','long')`;",
      // A watch PHASE's type. One vocabulary, different object, six live
      // call sites in the plan engine. Must never be flagged.
      "const q = `SELECT 1 FROM x WHERE phase->>'type' = 'work'`;",
      "/* WHERE (data->>'type') = 'Run' was the bug. */",              // prose about the rule
      "// AND (data->>'type') = 'Run'  -- removed 2026-08-24",
    ];
    for (const src of CLEAN) {
      expect(comparesRunTypeToLiteral(src), `false positive · ${src.slice(0, 45)}`).toBe(false);
    }
  });
});
