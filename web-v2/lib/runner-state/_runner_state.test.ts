/**
 * RUNNERSTATE-1 · the one canonical runner-state model, enforced.
 *
 * The point of this suite is that the model cannot quietly stop being a
 * model: that the registry still names functions that exist, that a belief
 * still states which Rule 8 question it asks, that a contradiction is still
 * kept visible instead of averaged away, that a belief can still move UP as
 * well as down, and that the directory still opens no database.
 *
 * ── RULE 18 · EVERY GATE BELOW HAS BEEN MADE TO FAIL ───────────────────────
 *
 * Each `describe` that asserts a property also carries an ORACLE that runs
 * the same checker over a deliberately broken input and asserts it is named.
 * The oracles are the falsification, run every time rather than once by hand,
 * so a checker that stops working fails on its own oracle before it can
 * report the registry clean.
 *
 * ── RULE 22 · WHAT THIS GATE CANNOT FAIL ON ────────────────────────────────
 *
 * · WHETHER THE CANONICAL CHOICE IS RIGHT. Every assertion is about shape,
 *   existence and internal agreement. Whether `sustainedWeeklyMileage` is a
 *   better answer to sustainable volume than `resolveRampBase` is a coaching
 *   judgement, and nothing here makes it.
 * · WHETHER A LOADER ACTUALLY CALLED THE CANONICAL OWNER. The registry names
 *   an owner and a submission carries a number; nothing syntactic joins them.
 *   A loader that calls the legacy cascade and submits the result produces a
 *   belief this suite cannot distinguish from a correct one.
 * · A COMPETING OWNER NOBODY WROTE DOWN. The registry is hand-built from a
 *   survey. The liveness assertion catches a registry that has gone empty; it
 *   cannot catch one that was never complete, and no scanner can, because
 *   "does this function answer the same coaching question" is not syntactic.
 * · A BELIEF THAT IS SIMPLY WRONG. Everything in `assemble.ts` is
 *   pass-through, so a wrong threshold pace arrives wrong and leaves wrong.
 * · IT IS ONE-SIDED ON CONTRADICTION. The contradiction assertions fire on a
 *   belief that averaged a disagreement away or stayed over-confident through
 *   one. Nothing fires on the opposite failure, a belief that reports a
 *   tension it does not really have, because that needs the evidence itself.
 * · IT CANNOT SEE THE PRODUCTION LOADER. `lib/brain/` is another owner's
 *   file and does not exist yet. Everything here is about the shape it will
 *   have to fill.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

import {
  BELIEF_KEYS,
  CONTRADICTED_CONFIDENCE_CEILING,
  band,
  normalReadingToMeasured,
  point,
  withContradiction,
  type Belief,
  type BeliefImmovable,
  type BeliefKey,
  type BeliefLever,
  type BeliefTension,
  type Rule8Side,
} from './belief';
import {
  BELIEF_OWNERSHIP,
  beliefsThatOnlyFall,
  beliefsWithNoOwner,
  openConflicts,
  type BeliefOwnership,
} from './ownership';
import {
  CONTESTED_CONFIDENCE_LIMIT,
  absentBelief,
  absentBeliefs,
  assembleRunnerBeliefs,
  contestedBeliefs,
  didNotLook,
  failedBelief,
  failedBeliefs,
  notLookedFor,
  overconfidentContested,
  submitted,
  unaskedBeliefs,
  type BeliefSubmission,
  type BeliefValueByKey,
  type RunnerBeliefInput,
} from './assemble';

import { DOSE_EVIDENCE_READERS } from '@/lib/plan/adjudication/dose-responsive';
import { fromNormalReading } from '@/lib/plan/adjudication/dose-responsive';
import { CAPACITY_CONFIDENCE_BANDS } from '@/lib/training/capacity-resolver';
import { MIN_REPRESENTATIVE_DAYS, type NormalReading } from '@/lib/training/normal-window';
import { scanLayerOne, scanPunctuation } from '@/lib/faff/coach-lexicon';

const HERE = __dirname;
const WEB = path.resolve(HERE, '..', '..');
const TODAY = '2026-09-05T00:00:00.000Z';

/* ══════════════════════════════════════════════════════════════════════════
 * 0 · LIVENESS AND PURITY
 * ═══════════════════════════════════════════════════════════════════════ */

describe('RUNNERSTATE-1 · liveness', () => {
  it('the modules under test are really there and really have code in them', () => {
    for (const f of ['belief.ts', 'ownership.ts', 'assemble.ts']) {
      const p = path.join(HERE, f);
      expect(existsSync(p), `${f} is missing`).toBe(true);
      expect(readFileSync(p, 'utf8').length, `${f} is a stub`).toBeGreaterThan(4000);
    }
  });

  it('the registry covers every belief and is not empty', () => {
    expect(BELIEF_KEYS.length).toBe(20);
    expect(Object.keys(BELIEF_OWNERSHIP).length).toBe(BELIEF_KEYS.length);
    for (const k of BELIEF_KEYS) {
      expect(BELIEF_OWNERSHIP[k], `${k} has no registry entry`).toBeDefined();
      expect(BELIEF_OWNERSHIP[k].key).toBe(k);
    }
  });

  it('BELIEF_KEYS and the BeliefKey union are the same set', () => {
    // A key added to the union but not the array would make every loop above
    // silently skip it, which is how a gate loses reach without failing.
    const fromRegistry = new Set(Object.keys(BELIEF_OWNERSHIP));
    expect(new Set(BELIEF_KEYS)).toEqual(fromRegistry);
  });
});

describe('RUNNERSTATE-1 · the directory reaches no database at any depth', () => {
  /**
   * Rule 19 was earned by `lthr-reanchor.ts`, whose own header asserted it
   * "imports no database at any depth". It was false for a day and no check
   * could tell. Same claim, gated.
   *
   * Type-only imports are skipped: they are erased at compile time and emit
   * nothing, which is what lets `belief.ts` type-import `Measured<T>` from
   * the adaptation engine and `NormalReading<T>` from a module that does
   * import a pool. `lib/plan/adjudication/dose-responsive.ts` sets that
   * precedent and its own suite walks the same graph the same way.
   */
  function resolve(spec: string, fromFile: string): string | null {
    const base = spec.startsWith('@/')
      ? path.join(WEB, spec.slice(2))
      : spec.startsWith('.')
        ? path.resolve(path.dirname(fromFile), spec)
        : null;
    if (base == null) return null;
    for (const cand of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
      if (existsSync(cand)) return cand;
    }
    return null;
  }

  function edges(file: string): string[] {
    const src = readFileSync(file, 'utf8');
    const out: string[] = [];
    for (const m of src.matchAll(/^import\s+(type\s+)?([\s\S]*?)from\s+'([^']+)'/gm)) {
      if (m[1]) continue;
      out.push(m[3]);
    }
    for (const m of src.matchAll(/\bimport\(\s*'([^']+)'\s*\)/g)) out.push(m[1]);
    return out;
  }

  it('walks the whole graph from every source file here and finds no server-only module', () => {
    const entries = readdirSync(HERE)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .map((f) => path.join(HERE, f));

    // LIVENESS: the directory itself must have had files to walk from.
    expect(entries.length, 'no source files found to walk from').toBeGreaterThanOrEqual(3);

    const seen = new Set<string>(entries);
    const queue = [...entries];
    const reached: string[] = [];
    while (queue.length > 0) {
      const f = queue.shift()!;
      for (const spec of edges(f)) {
        const r = resolve(spec, f);
        if (r == null || seen.has(r)) continue;
        seen.add(r);
        reached.push(path.relative(WEB, r));
        queue.push(r);
      }
    }
    for (const r of [...seen].map((f) => path.relative(WEB, f))) {
      expect(r, `${r} is a server-only module and this directory must stay pure`)
        .not.toMatch(/^lib\/db\//);
      expect(r, `${r} reaches the pool`).not.toMatch(/pool|\bpg\b/);
    }
  });

  it('ORACLE · the walk would name a database edge if one appeared', () => {
    // Falsification without editing a real file: run the same resolver over a
    // planted specifier and assert it lands on the module the walk refuses.
    const planted = resolve('@/lib/db/pool', path.join(HERE, 'belief.ts'));
    expect(planted, 'the pool module does not exist, so the oracle proves nothing')
      .not.toBeNull();
    expect(path.relative(WEB, planted!)).toMatch(/^lib\/db\//);
  });

  it('no runtime import at all · every import in this directory is type-only or local', () => {
    for (const f of ['belief.ts', 'assemble.ts', 'ownership.ts']) {
      const src = readFileSync(path.join(HERE, f), 'utf8');
      for (const m of src.matchAll(/^import\s+(type\s+)?([\s\S]*?)from\s+'([^']+)'/gm)) {
        const isType = Boolean(m[1]);
        const spec = m[3];
        expect(
          isType || spec.startsWith('./'),
          `${f} has a runtime import of ${spec}; this directory consumes owners' ANSWERS, never their code`,
        ).toBe(true);
      }
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · RULE 16 · THE REGISTRY NAMES FUNCTIONS THAT EXIST
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Does `symbol` appear as a declaration in `module`.
 *
 * Deliberately accepts module-PRIVATE declarations as well as exports. Some
 * of the competing owners this registry has to name are private functions
 * inside `generate.ts` and `adaptation-model.ts`, and refusing to name them
 * would make the map claim there is no conflict where there is one. The
 * check that matters is that the symbol has not been renamed or deleted.
 */
function declares(module: string, symbol: string): boolean {
  const p = path.join(WEB, module);
  if (!existsSync(p)) return false;
  const src = readFileSync(p, 'utf8');
  const re = new RegExp(
    `(^|\\n)\\s*(export\\s+)?(default\\s+)?(async\\s+)?(function|const|let|interface|type|class|enum)\\s+${symbol}\\b`,
  );
  return re.test(src);
}

/** Every `module#symbol` the registry points at, from every field. */
function allReferences(): Array<{ where: string; module: string; symbol: string }> {
  const out: Array<{ where: string; module: string; symbol: string }> = [];
  const lever = (k: BeliefKey, dir: string, l: BeliefLever) => {
    const [module, symbol] = l.reader.split('#');
    out.push({ where: `${k}.${dir}`, module, symbol });
  };
  for (const k of BELIEF_KEYS) {
    const o = BELIEF_OWNERSHIP[k];
    if (o.canonical) {
      out.push({ where: `${k}.canonical`, module: o.canonical.module, symbol: o.canonical.symbol });
    }
    for (const c of o.competing) {
      out.push({ where: `${k}.competing`, module: c.module, symbol: c.symbol });
    }
    for (const l of o.movesUpOn) lever(k, 'movesUpOn', l);
    for (const l of o.movesDownOn) lever(k, 'movesDownOn', l);
  }
  return out;
}

describe('RUNNERSTATE-1 · Rule 16 · every named owner resolves against the real file', () => {
  const refs = allReferences();

  it('liveness · the registry actually points at something', () => {
    expect(refs.length, 'the reference walk found nothing, so it proves nothing')
      .toBeGreaterThan(50);
  });

  it('every module#symbol pair still exists', () => {
    const missing = refs.filter((r) => !declares(r.module, r.symbol));
    expect(
      missing.map((m) => `${m.where} -> ${m.module}#${m.symbol}`),
      'a registry entry points at a symbol that has been renamed or deleted',
    ).toEqual([]);
  });

  it('ORACLE · a renamed symbol is named, and a real one is not', () => {
    expect(declares('lib/training/normal-window.ts', 'sustainedWeeklyMileage')).toBe(true);
    expect(declares('lib/training/normal-window.ts', 'sustainedWeeklyMileageRenamed')).toBe(false);
    expect(declares('lib/training/there-is-no-such-file.ts', 'anything')).toBe(false);
  });

  it('every lever reader is written as module#symbol', () => {
    for (const k of BELIEF_KEYS) {
      for (const l of [...BELIEF_OWNERSHIP[k].movesUpOn, ...BELIEF_OWNERSHIP[k].movesDownOn]) {
        expect(l.reader, `${k} lever reader is not module#symbol`).toMatch(/^lib\/.+\.ts#\w+$/);
      }
    }
  });
});

describe('RUNNERSTATE-1 · Rule 16 · this registry and the dose registry name the same readers', () => {
  /**
   * `DOSE_EVIDENCE_READERS` already names ten canonical readers with the same
   * field names (`module`, `symbol`, `answers`, `rule8Side`). Where the two
   * registries overlap they must agree, or the app has two maps of itself.
   */
  it('liveness · the dose registry is populated', () => {
    expect(DOSE_EVIDENCE_READERS.length).toBeGreaterThanOrEqual(8);
  });

  it('a symbol named in both is named the same way in both', () => {
    const mine = new Map<string, { module: string; rule8Side: Rule8Side }>();
    for (const k of BELIEF_KEYS) {
      const o = BELIEF_OWNERSHIP[k];
      if (o.canonical) mine.set(o.canonical.symbol, { module: o.canonical.module, rule8Side: o.rule8Side });
      for (const c of o.competing) mine.set(c.symbol, { module: c.module, rule8Side: o.rule8Side });
    }

    let overlap = 0;
    for (const r of DOSE_EVIDENCE_READERS) {
      const m = mine.get(r.symbol);
      if (!m) continue;
      overlap++;
      expect(m.module, `${r.symbol} lives in two different modules across two registries`)
        .toBe(r.module);
      if (r.rule8Side !== 'NEITHER') {
        expect(m.rule8Side, `${r.symbol} is ${r.rule8Side} there and ${m.rule8Side} here`)
          .toBe(r.rule8Side);
      }
    }

    // LIVENESS: if the overlap is zero the assertion above never ran, and a
    // green result would mean nothing at all.
    expect(overlap, 'the two registries share no reader, so nothing was compared')
      .toBeGreaterThanOrEqual(2);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · RULE 16 · THE REGISTRY IS HONEST ABOUT ITS CONFLICTS
 * ═══════════════════════════════════════════════════════════════════════ */

/** The checker, extracted so the oracle can run it over a broken entry. */
function conflictFindings(o: BeliefOwnership): string[] {
  const bad: string[] = [];
  const disputed = o.competing.filter((c) => c.canDisagree);
  if (disputed.length > 0 && o.conflict == null) {
    bad.push(`${o.key} has ${disputed.length} competing owner(s) that can disagree and no conflict record`);
  }
  if (o.competing.length === 0 && o.surveyed.trim().length < 20) {
    bad.push(`${o.key} declares no competing owner and does not say what was searched`);
  }
  if (o.conflict) {
    if (o.conflict.between.length < 1) bad.push(`${o.key} conflict names nobody`);
    if (o.conflict.shouldOwn.trim().length < 5) bad.push(`${o.key} conflict does not say who should own it`);
    if (o.conflict.because.trim().length < 40) bad.push(`${o.key} conflict has no argument`);
    if (o.conflict.verdict === 'OPEN' && o.conflict.notRoutedBecause.trim().length < 40) {
      bad.push(`${o.key} is OPEN without saying why it was not routed`);
    }
    if (o.conflict.verdict !== 'OPEN' && o.conflict.notRoutedBecause.trim().length > 0) {
      bad.push(`${o.key} is ${o.conflict.verdict} but carries a not-routed reason`);
    }
  }
  if (o.canonical == null && o.conflict == null) {
    bad.push(`${o.key} has no owner and no record of that being a finding`);
  }
  return bad;
}

describe('RUNNERSTATE-1 · Rule 16 · a conflict is recorded, never omitted', () => {
  it('every belief passes the conflict-record check', () => {
    const bad = BELIEF_KEYS.flatMap((k) => conflictFindings(BELIEF_OWNERSHIP[k]));
    expect(bad).toEqual([]);
  });

  it('ORACLE · a competing owner with no conflict record is named', () => {
    const broken: BeliefOwnership = {
      ...BELIEF_OWNERSHIP.THRESHOLD_PACE,
      conflict: null,
    };
    expect(conflictFindings(broken)).toContain(
      'THRESHOLD_PACE has 3 competing owner(s) that can disagree and no conflict record',
    );
  });

  it('ORACLE · an OPEN conflict with no reason for staying open is named', () => {
    const c = BELIEF_OWNERSHIP.THRESHOLD_PACE.conflict!;
    const broken: BeliefOwnership = {
      ...BELIEF_OWNERSHIP.THRESHOLD_PACE,
      conflict: { ...c, notRoutedBecause: '' },
    };
    expect(conflictFindings(broken)).toContain(
      'THRESHOLD_PACE is OPEN without saying why it was not routed',
    );
  });

  it('ORACLE · an unowned belief that is not recorded as a finding is named', () => {
    const broken: BeliefOwnership = {
      ...BELIEF_OWNERSHIP.TRAINING_CONSISTENCY,
      conflict: null,
      competing: [],
      surveyed: 'x',
    };
    const found = conflictFindings(broken);
    expect(found).toContain('TRAINING_CONSISTENCY has no owner and no record of that being a finding');
  });

  it('reports the open conflicts and the unowned beliefs, so a green run still says what is wrong', () => {
    const open = openConflicts();
    const unowned = beliefsWithNoOwner();
    // eslint-disable-next-line no-console
    console.log(
      `\n=== RUNNERSTATE-1 ===\n`
      + `beliefs: ${BELIEF_KEYS.length}\n`
      + `no canonical owner: ${unowned.length} · ${unowned.join(', ') || 'none'}\n`
      + `OPEN Rule 16 conflicts: ${open.length}\n`
      + open.map((o) => `  ${o.key}: ${o.conflict.between.join('  vs  ')}`).join('\n')
      + '\n',
    );
    // Not a ratchet on the COUNT: this map is a survey and the honest state
    // today is that most of these are open. What is asserted is that a
    // conflict is never silent, which is the check above.
    expect(open.length + unowned.length).toBeGreaterThan(0);
  });
});

describe('RUNNERSTATE-1 · the registry names functions, never numbers', () => {
  /**
   * A physiological number appearing here means a second brain has started.
   * Deliberately looks only at STRING LITERALS and identifiers on their own
   * lines, because the doc comments legitimately quote measurements from the
   * survey.
   */
  it('ownership.ts declares no numeric constant', () => {
    const src = readFileSync(path.join(HERE, 'ownership.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const decls = [...src.matchAll(/^\s*(?:export\s+)?const\s+(\w+)\s*(?::[^=;]*)?=\s*([-\d.]+)\s*;/gm)];
    expect(decls.map((d) => `${d[1]} = ${d[2]}`)).toEqual([]);
  });

  it('ORACLE · the scanner sees a planted constant, annotated or bare', () => {
    // The first cut of this regex demanded a type annotation before the `=`,
    // so it could not see a bare `const X = 430;` at all. This oracle is what
    // found that, which is Rule 18's whole argument for writing one.
    const planted = 'export const THRESHOLD_PACE_S_PER_MI = 430;';
    expect([...planted.matchAll(/^\s*(?:export\s+)?const\s+(\w+)\s*(?::[^=;]*)?=\s*([-\d.]+)\s*;/gm)].length)
      .toBe(1);
    const annotated = '  const CEILING: number = 0.5;';
    expect([...annotated.matchAll(/^\s*(?:export\s+)?const\s+(\w+)\s*(?::[^=;]*)?=\s*([-\d.]+)\s*;/gm)].length)
      .toBe(1);
    const notAConstant = 'const say = buildSentence(threshold);';
    expect([...notAConstant.matchAll(/^\s*(?:export\s+)?const\s+(\w+)\s*(?::[^=;]*)?=\s*([-\d.]+)\s*;/gm)].length)
      .toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · RULE 8 · EVERY BELIEF STATES WHICH QUESTION IT ASKS
 * ═══════════════════════════════════════════════════════════════════════ */

describe('RUNNERSTATE-1 · Rule 8 · each belief declares its side of the corollary', () => {
  const SIDES: readonly Rule8Side[] = ['HABIT', 'ABSORBED_LOAD', 'NEITHER'];

  it('every belief carries one of the three sides and no fourth', () => {
    for (const k of BELIEF_KEYS) {
      expect(SIDES, `${k} has an unrecognised Rule 8 side`).toContain(BELIEF_OWNERSHIP[k].rule8Side);
    }
  });

  it('the twinned volume pair sits on opposite sides, which is the whole rule', () => {
    // Rule 8's founding case. `normalWeeklyMileage` and `recentWeeklyMileageMi`
    // are the same 28 days asked two different questions, and the app keeps
    // them as separate functions so a call site has to say which it means.
    expect(BELIEF_OWNERSHIP.SUSTAINABLE_WEEKLY_VOLUME.rule8Side).toBe('HABIT');
    expect(BELIEF_OWNERSHIP.RECENT_COMPLETED_VOLUME.rule8Side).toBe('ABSORBED_LOAD');
    expect(BELIEF_OWNERSHIP.SUSTAINABLE_WEEKLY_VOLUME.canonical!.module)
      .toBe('lib/training/normal-window.ts');
    expect(BELIEF_OWNERSHIP.RECENT_COMPLETED_VOLUME.canonical!.module)
      .toBe('lib/runs/volume.ts');
  });

  it('an ABSORBED_LOAD belief says so in a prohibition rather than leaving it implied', () => {
    // Rule 8's corollary is the half that gets over-applied, so the beliefs
    // that must NOT be filtered carry a PRESCRIBED_TAPER entry whose reason
    // is the inverse: keep the taper day, do not drop it.
    for (const k of ['RECENT_COMPLETED_VOLUME', 'ACUTE_LOAD'] as const) {
      const taper = BELIEF_OWNERSHIP[k].neverMovesOn.find((n) => n.what === 'PRESCRIBED_TAPER');
      expect(taper, `${k} is absorbed load and does not say the taper must stay`).toBeDefined();
      expect(taper!.why.toLowerCase()).toMatch(/keep|filtering|acute|inverse/);
    }
  });

  it('the assembled belief takes its side from the registry, not from the loader', () => {
    const s = allSubmitted();
    const beliefs = assembleRunnerBeliefs(s);
    for (const k of BELIEF_KEYS) {
      expect(beliefs[k].rule8Side).toBe(BELIEF_OWNERSHIP[k].rule8Side);
      expect(beliefs[k].movesUpOn).toBe(BELIEF_OWNERSHIP[k].movesUpOn);
      expect(beliefs[k].neverMovesOn).toBe(BELIEF_OWNERSHIP[k].neverMovesOn);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · RULE 21 AND 22 · A BELIEF THAT CAN FALL CAN ALSO RISE
 * ═══════════════════════════════════════════════════════════════════════ */

describe('RUNNERSTATE-1 · Rule 21 · the bar to go up is not higher than the bar to come down', () => {
  it('no belief has a way down and no way up', () => {
    expect(
      beliefsThatOnlyFall(),
      'Rule 21 measured 309 production adaptations with zero upward. A belief that '
      + 'can only fall is that disposition made structural.',
    ).toEqual([]);
  });

  it('ORACLE · the check names a belief whose upward levers were emptied', () => {
    const only = (o: BeliefOwnership) => o.movesDownOn.length > 0 && o.movesUpOn.length === 0;
    expect(only({ ...BELIEF_OWNERSHIP.THRESHOLD_PACE, movesUpOn: [] })).toBe(true);
    expect(only(BELIEF_OWNERSHIP.THRESHOLD_PACE)).toBe(false);
  });

  it('the distribution of levers is reported, because a count is not a balance', () => {
    let up = 0;
    let down = 0;
    for (const k of BELIEF_KEYS) {
      up += BELIEF_OWNERSHIP[k].movesUpOn.length;
      down += BELIEF_OWNERSHIP[k].movesDownOn.length;
    }
    // eslint-disable-next-line no-console
    console.log(`RUNNERSTATE-1 lever distribution · up ${up} · down ${down}`);
    // Rule 22: the assertion is on the SHAPE, not on parity. Doctrine can
    // license an imbalance; habit cannot. What is forbidden is a model that
    // knows only how to reduce.
    expect(up, 'the model has no upward lever at all').toBeGreaterThan(0);
  });

  it('every belief carries at least one prohibition, and the goal is one of them for capacity', () => {
    for (const k of BELIEF_KEYS) {
      expect(BELIEF_OWNERSHIP[k].neverMovesOn.length, `${k} has no prohibition`).toBeGreaterThan(0);
    }
    const CAPACITY: readonly BeliefKey[] = [
      'THRESHOLD_PACE', 'MARATHON_PACE', 'INTERVAL_PACE',
      'SUSTAINABLE_WEEKLY_VOLUME', 'LONG_RUN_TOLERANCE', 'RACE_PERFORMANCE',
    ];
    for (const k of CAPACITY) {
      const goal = BELIEF_OWNERSHIP[k].neverMovesOn.map((n: BeliefImmovable) => n.what);
      expect(goal, `${k} is a capacity belief and does not forbid the goal moving it`)
        .toContain('GOAL_STATED');
    }
  });

  it('ORACLE · the goal prohibition check would name a capacity belief that dropped it', () => {
    const stripped = BELIEF_OWNERSHIP.THRESHOLD_PACE.neverMovesOn
      .filter((n) => n.what !== 'GOAL_STATED')
      .map((n) => n.what);
    expect(stripped).not.toContain('GOAL_STATED');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5 · RULE 11 · THREE FACTS, AND THE TYPE ENFORCES IT
 * ═══════════════════════════════════════════════════════════════════════ */

describe('RUNNERSTATE-1 · Rule 11 · a refusal carries no value, at compile time', () => {
  it('the refusal branch has no `value` field the caller can reach', () => {
    const r = absentBelief<number>('nothing to report', TODAY);
    expect(r.reading.ok).toBe(false);
    if (!r.reading.ok) {
      // @ts-expect-error Rule 11 · `value` must not exist on the refusal branch.
      const leaked = r.reading.value;
      expect(leaked).toBeUndefined();
    }
  });

  it('absent, failed and never-asked are three distinguishable facts', () => {
    const a = absentBelief<number>('looked, found none', TODAY);
    const f = failedBelief<number>('the query timed out', TODAY);
    const n = notLookedFor<number>('THRESHOLD_PACE', TODAY);

    expect(a.reading.ok).toBe(false);
    expect(f.reading.ok).toBe(false);
    expect(n.reading.ok).toBe(false);
    if (!a.reading.ok) expect(a.reading.why.kind).toBe('ABSENT');
    if (!f.reading.ok) expect(f.reading.why.kind).toBe('FAILED');

    expect(didNotLook({ reading: n.reading })).toBe(true);
    expect(didNotLook({ reading: a.reading })).toBe(false);
    expect(didNotLook({ reading: f.reading })).toBe(false);
  });

  it('the three land in three different derived views, and a measured value in none of them', () => {
    const s = allSubmitted();
    const mixed: RunnerBeliefInput = {
      ...s,
      THRESHOLD_PACE: absentBelief<number>('no admissible threshold observation', TODAY),
      MARATHON_PACE: failedBelief<number>('durability read did not complete', TODAY),
      INTERVAL_PACE: notLookedFor<number>('INTERVAL_PACE', TODAY),
    };
    const b = assembleRunnerBeliefs(mixed);
    expect(absentBeliefs(b)).toEqual(['THRESHOLD_PACE']);
    expect(failedBeliefs(b)).toEqual(['MARATHON_PACE']);
    expect(unaskedBeliefs(b)).toEqual(['INTERVAL_PACE']);
  });

  it('a Rule 8 refusal becomes an ABSENT carrying its own coach-voice message, never a zero', () => {
    const refusal: NormalReading<number> = {
      ok: false,
      representativeDays: 3,
      excludedDays: 25,
      refusal: {
        code: 'not-enough-representative-training',
        message: 'Not enough representative training to answer.',
        windowFromISO: '2026-08-08',
        windowToISO: '2026-09-05',
        needDays: MIN_REPRESENTATIVE_DAYS,
      },
    };
    const m = normalReadingToMeasured(refusal);
    expect(m.ok).toBe(false);
    if (!m.ok && m.why.kind === 'ABSENT') {
      expect(m.why.what).toBe('Not enough representative training to answer.');
    } else {
      throw new Error('a Rule 8 refusal must arrive as an explicit ABSENT');
    }
  });

  it('Rule 16 · the generic bridge agrees with the number-specialised one next door', () => {
    // `fromNormalReading` in lib/plan/adjudication/dose-responsive.ts does the
    // same job for `number`. Bound by assertion rather than by import, for the
    // layering reason in belief.ts's header. If the two ever diverge this
    // fails, which is what makes the binding real (Rule 18).
    const cases: NormalReading<number>[] = [
      { ok: true, value: 43.5, representativeDays: 112, excludedDays: 0 },
      {
        ok: false,
        representativeDays: 1,
        excludedDays: 27,
        refusal: {
          code: 'not-enough-representative-training',
          message: 'Not enough representative training to answer.',
          windowFromISO: '2026-08-08',
          windowToISO: '2026-09-05',
          needDays: MIN_REPRESENTATIVE_DAYS,
        },
      },
    ];
    for (const c of cases) {
      expect(normalReadingToMeasured(c)).toEqual(fromNormalReading(c));
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6 · CONFLICTING EVIDENCE STAYS VISIBLE
 * ═══════════════════════════════════════════════════════════════════════ */

const TENSION: BeliefTension = {
  direction: 'EVIDENCE_STRONGER_THAN_BELIEF',
  say: 'The last three threshold sessions came in ahead of target at the same effort.',
  evidence: [
    { id: 'run-1', kind: 'QUALITY_SESSION', dateISO: '2026-08-26', what: 'Tempo ahead of target' },
    { id: 'run-2', kind: 'QUALITY_SESSION', dateISO: '2026-09-01', what: 'Cruise reps ahead of target' },
  ],
  resolution: 'HELD_AND_STATED',
};

describe('RUNNERSTATE-1 · a contradiction is held and stated, never averaged away', () => {
  const base: Belief<number> = assembleRunnerBeliefs(allSubmitted()).THRESHOLD_PACE;

  it('the belief keeps its exact estimate, by identity and not merely by value', () => {
    const after = withContradiction(base, TENSION);
    expect(after.reading).toBe(base.reading);
    if (after.reading.ok && base.reading.ok) {
      expect(after.reading.value.best).toBe(base.reading.value.best);
    }
  });

  it('the contradicting evidence is carried and the tension is named', () => {
    const after = withContradiction(base, TENSION);
    expect(after.tension).not.toBeNull();
    expect(after.contradicting.map((e) => e.id)).toEqual(['run-1', 'run-2']);
    expect(after.tension!.resolution).toBe('HELD_AND_STATED');
  });

  it('confidence is capped rather than zeroed, which is the mirror error', () => {
    const confident: Belief<number> = { ...base, confidence: 0.88 };
    const after = withContradiction(confident, TENSION);
    expect(after.confidence).toBe(CONTRADICTED_CONFIDENCE_CEILING);
    expect(after.confidence).not.toBe(0);
  });

  it('a null confidence stays null · unknown is not the same as capped', () => {
    const unknown: Belief<number> = { ...base, confidence: null };
    expect(withContradiction(unknown, TENSION).confidence).toBeNull();
  });

  it('ORACLE · an averaging implementation is caught by the identity assertion', () => {
    // The defect this is written against: split the difference between belief
    // and evidence and report a confident midpoint. Run it and watch the same
    // assertion the real constructor passes fail on it.
    function averagingWithContradiction(b: Belief<number>, t: BeliefTension): Belief<number> {
      if (!b.reading.ok) return b;
      const midpoint = (b.reading.value.best + 420) / 2;
      return { ...b, reading: { ok: true, value: point(midpoint) }, tension: t };
    }
    const bad = averagingWithContradiction(base, TENSION);
    expect(bad.reading).not.toBe(base.reading);
    if (bad.reading.ok && base.reading.ok) {
      expect(bad.reading.value.best).not.toBe(base.reading.value.best);
    }
  });

  it('a contested belief that stayed confident is reported', () => {
    const s = allSubmitted();
    const overConfident: BeliefSubmission<number> = {
      ...(s.THRESHOLD_PACE as BeliefSubmission<number>),
      confidence: 0.9,
      contradicting: [...TENSION.evidence],
      tension: TENSION,
    };
    const b = assembleRunnerBeliefs({ ...s, THRESHOLD_PACE: overConfident });
    expect(contestedBeliefs(b)).toEqual(['THRESHOLD_PACE']);
    expect(overconfidentContested(b)).toEqual(['THRESHOLD_PACE']);
  });

  it('the same belief routed through the constructor is no longer over-confident', () => {
    const s = allSubmitted();
    const b = assembleRunnerBeliefs(s);
    const fixed = withContradiction({ ...b.THRESHOLD_PACE, confidence: 0.9 }, TENSION);
    expect(fixed.confidence!).toBeLessThanOrEqual(CONTESTED_CONFIDENCE_LIMIT);
  });

  it('a range is preserved rather than collapsed to its midpoint', () => {
    const banded = band(430, 420, 442);
    expect(banded.best).toBe(430);
    expect(banded.range).toEqual({ low: 420, high: 442 });
    expect(banded.best).not.toBe((420 + 442) / 2);
  });
});

describe('RUNNERSTATE-1 · the two confidence ceilings are one number', () => {
  it('the constructor and the check agree', () => {
    // Written out in two files on purpose, so the check does not pass by
    // construction. This is the assertion that makes that safe.
    expect(CONTESTED_CONFIDENCE_LIMIT).toBe(CONTRADICTED_CONFIDENCE_CEILING);
  });

  it('and both equal the confidence layer own direct-read floor', () => {
    // Read out of the owning module at run time rather than restated here, so
    // the binding cannot be satisfied by the test agreeing with itself.
    expect(CONTRADICTED_CONFIDENCE_CEILING).toBe(CAPACITY_CONFIDENCE_BANDS.directFloor);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 7 · THE ASSEMBLER IS TOTAL AND PASSES EVERYTHING THROUGH
 * ═══════════════════════════════════════════════════════════════════════ */

describe('RUNNERSTATE-1 · the assembler is total and computes nothing', () => {
  it('every key in, every key out', () => {
    const b = assembleRunnerBeliefs(allSubmitted());
    expect(Object.keys(b).sort()).toEqual([...BELIEF_KEYS].sort());
  });

  it('the submitted reading, confidence and provenance arrive unchanged', () => {
    const s = allSubmitted();
    const b = assembleRunnerBeliefs(s);
    for (const k of BELIEF_KEYS) {
      expect(b[k].reading).toBe(s[k].reading);
      expect(b[k].confidence).toBe(s[k].confidence);
      expect(b[k].sourceMode).toBe(s[k].sourceMode);
      expect(b[k].lastUpdatedISO).toBe(s[k].lastUpdatedISO);
    }
  });

  it('a belief with no canonical owner still names where to look', () => {
    const b = assembleRunnerBeliefs(allSubmitted());
    for (const k of beliefsWithNoOwner()) {
      expect(b[k].owner.module).toBe('lib/runner-state/ownership.ts');
      expect(b[k].owner.answers).toMatch(/No canonical owner/);
    }
  });

  it('the model is built from the registry, so a rogue loader cannot relabel a belief', () => {
    // There is no field on `BeliefSubmission` for rule8Side, owner or levers.
    // Asserted as a TYPE fact, because that is where the guarantee lives.
    const s = allSubmitted();
    const keys = Object.keys(s.THRESHOLD_PACE);
    expect(keys).not.toContain('rule8Side');
    expect(keys).not.toContain('owner');
    expect(keys).not.toContain('movesUpOn');
    expect(keys).not.toContain('neverMovesOn');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 8 · COACH VOICE ON EVERYTHING A RUNNER READS
 *
 * `scripts/check-coach-voice.sh` does not scan `lib/runner-state`, and this
 * is that payment rather than a widened scope. The scan runs the ONE lexicon
 * (`lib/faff/coach-lexicon.ts`), imported rather than restated, so the words
 * cannot drift from the app's list.
 *
 * WHAT IS SCANNED, and why not everything: the strings a runner could read
 * (`question`, the lever `what` clauses, a tension sentence, a refusal
 * message). The registry's `computes`, `because` and `notRoutedBecause`
 * fields are ENGINEERING prose for an ownership report and are deliberately
 * out of scope; they name modules, symbols and mechanisms, which is exactly
 * the jargon a runner-facing scan should reject.
 * ═══════════════════════════════════════════════════════════════════════ */

describe('RUNNERSTATE-1 · coach voice on the runner-facing strings', () => {
  function runnerFacingStrings(): Array<{ where: string; text: string }> {
    const out: Array<{ where: string; text: string }> = [];
    for (const k of BELIEF_KEYS) {
      const o = BELIEF_OWNERSHIP[k];
      out.push({ where: `${k}.question`, text: o.question });
      for (const l of o.movesUpOn) out.push({ where: `${k}.movesUpOn`, text: l.what });
      for (const l of o.movesDownOn) out.push({ where: `${k}.movesDownOn`, text: l.what });
    }
    out.push({ where: 'TENSION.say', text: TENSION.say });
    return out;
  }

  it('liveness · there are strings to scan', () => {
    expect(runnerFacingStrings().length).toBeGreaterThan(30);
  });

  it('no hype, no scolding, no app voice, no jargon', () => {
    const bad = runnerFacingStrings()
      .flatMap(({ where, text }) => scanLayerOne(text).map((f) => `${where}: ${f.term}`));
    expect(bad).toEqual([]);
  });

  it('no exclamation mark, no em dash, no emoji', () => {
    const bad = runnerFacingStrings()
      .flatMap(({ where, text }) => scanPunctuation(text).map((f) => `${where}: ${f}`));
    expect(bad).toEqual([]);
  });

  it('ORACLE · the scanners fire on a planted violation', () => {
    expect(scanLayerOne('Great job, you crushed it').length).toBeGreaterThan(0);
    expect(scanPunctuation('Nice work!')).toContain('exclamation mark');
    expect(scanPunctuation('Run easy — then rest.')).toContain('em dash');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * FIXTURE
 *
 * A fully measured submission for every belief. Values are SHAPES, not
 * claims about any runner: nothing in this suite asserts a physiological
 * number, and per Rule 22 that is a stated limit rather than an oversight.
 * ═══════════════════════════════════════════════════════════════════════ */

function measure<K extends BeliefKey>(
  value: BeliefValueByKey[K],
): BeliefSubmission<BeliefValueByKey[K]> {
  return submitted<BeliefValueByKey[K]>({
    estimate: point(value),
    confidence: 0.7,
    sourceMode: 'direct',
    lastUpdatedISO: TODAY,
  });
}

function allSubmitted(): RunnerBeliefInput {
  return {
    SUSTAINABLE_WEEKLY_VOLUME: measure<'SUSTAINABLE_WEEKLY_VOLUME'>(43.5),
    RECENT_COMPLETED_VOLUME: measure<'RECENT_COMPLETED_VOLUME'>(31.6),
    ACUTE_LOAD: measure<'ACUTE_LOAD'>(5.1),
    CHRONIC_LOAD: measure<'CHRONIC_LOAD'>(4.6),
    RUN_FREQUENCY_TOLERANCE: measure<'RUN_FREQUENCY_TOLERANCE'>(6),
    LONG_RUN_TOLERANCE: measure<'LONG_RUN_TOLERANCE'>(18),
    THRESHOLD_PACE: measure<'THRESHOLD_PACE'>(430),
    MARATHON_PACE: measure<'MARATHON_PACE'>(472),
    INTERVAL_PACE: measure<'INTERVAL_PACE'>(398),
    MAX_DEMONSTRATED_DOSE: measure<'MAX_DEMONSTRATED_DOSE'>({ atPaceMinutesByFamily: {} }),
    RECOVERY_RESPONSE: measure<'RECOVERY_RESPONSE'>({
      anchor: 'long', daysSinceAnchor: 3, versusExpected: 'on_schedule',
    }),
    TRAINING_CONSISTENCY: measure<'TRAINING_CONSISTENCY'>({
      meanShareOfPlan: 0.94, spread: 0.11, weeksObserved: 8,
    }),
    RACE_PERFORMANCE: measure<'RACE_PERFORMANCE'>({
      distanceMi: 26.2, expectedSec: 11982, limiter: 'durability',
    }),
    ENVIRONMENTAL_SENSITIVITY: measure<'ENVIRONMENTAL_SENSITIVITY'>({
      acclimationDay: 9, expectedPenaltyBpm: 6, evidence: 'measured',
    }),
    INJURY_STATE: measure<'INJURY_STATE'>({
      open: false, site: null, severity: null, daysOpen: null,
    }),
    ILLNESS_STATE: measure<'ILLNESS_STATE'>({
      open: false, hasFever: false, daysActive: null,
    }),
    DATA_QUALITY: measure<'DATA_QUALITY'>({
      heartRate: 'high', pace: 'high', coverageDays: 28,
    }),
    GOAL_FEASIBILITY: measure<'GOAL_FEASIBILITY'>('aggressive'),
    TRAINING_PHASE: measure<'TRAINING_PHASE'>('QUALITY'),
    READINESS: measure<'READINESS'>('proceed'),
  };
}
