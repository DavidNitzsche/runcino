/**
 * lib/audit/_evidence_classifier_ownership.test.ts · DECISION-3 (2026-09-06)
 * · the ownership gate the owner asked for.
 *
 * "Two evidence classifiers may not independently assign coaching meaning...
 * Add an ownership gate." `lib/evidence/activity-evidence.ts#readEnvironment`
 * is THE canonical read of "how much did heat/humidity cost this activity" —
 * doctrine-anchored (BRIEF 02), already reachable from the real capacity
 * pipeline (`capacity-resolver.ts`), already gated by `lib/doctrine/
 * registry.ts` as the Evidence Engine's own answer. `lib/evidence/
 * classify-evidence.ts` used to call `heatEffort` a second time and draw its
 * own present/absent line independently (CLASSIFYCTXWIRE-2 fixed this — it
 * now reads `readEnvironment`'s own `load`, it does not re-derive one).
 *
 * This gate is what stops a THIRD file from making the same mistake: any new
 * or existing file that imports `heatEffort` directly from `lib/training/
 * heat-model.ts` is either the canonical owner itself, or must be a named,
 * argued exemption explaining why it is a genuinely different LEVER (a
 * forward-looking prescription/display concern) rather than a second
 * historical-evidence classifier competing with `readEnvironment`.
 *
 * ── RULE 22 · WHAT THIS GATE CANNOT FAIL ON ─────────────────────────────────
 *
 *   · Whether an exempted file's OWN threshold is correct. It only asks
 *     whether the file is named and argued, not whether the argument is
 *     right — that judgement is the reviewer's, on record in the exemption
 *     text.
 *   · A classifier that avoids importing `heat-model.ts` directly but still
 *     independently invents an environmental verdict some OTHER way (a
 *     hand-rolled temperature threshold with no shared model at all). This
 *     gate can only see the one import edge it was built to watch.
 *   · Whether `weather-adjust.ts`'s recap-caption threshold and `race/
 *     representativeness.ts`'s race-conditions-normal test SHOULD be
 *     migrated onto `readEnvironment` too — both are EXEMPTED here as
 *     reviewed, different-purpose consumers (display captioning; a
 *     race-specific representativeness rule from a different doctrine
 *     document), not as closed questions. A future session narrowing them
 *     onto the canonical read is real, separate work, named here rather than
 *     silently left for this gate to imply is already settled.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');

const CANONICAL_OWNER = 'lib/evidence/activity-evidence.ts';

/**
 * Every file besides the canonical owner that may import `heatEffort`
 * directly, with an argued reason. A RATCHET: this list may shrink (a file
 * migrated onto `readEnvironment`) but a NEW entry needs its own argued
 * reason added here, in the same change that adds the import — it cannot
 * simply grow silently.
 */
const HEAT_MODEL_EXEMPTIONS: Record<string, string> = {
  'lib/coach/heat-gate.ts':
    'HEAT-1 (2026-08-17). Forward-looking SAFETY GATING for the session about to be run today '
    + '(Research/06 §§3, 11 — run as written / as time-on-feet / not at all), not a historical '
    + 'evidence classification of a completed activity. A different question from '
    + '"what did this PAST activity demonstrate", answered from forecast conditions activity-evidence.ts '
    + 'has no way to see.',
  'lib/coach/weather-adjust.ts':
    'Feeds ONLY a recap-caption decision (`shouldFlagInRecap`) — whether to tell the runner "it was '
    + 'hot" on the activity summary screen. REVIEWED 2026-09-06: this DOES independently threshold '
    + '`slowdownPct` (>= 2) for that one purpose, which is display presentation, not a coaching-lever '
    + 'input — it does not feed capacity evidence, admissibility, or any adaptation decision. Left '
    + 'exempted rather than migrated tonight; narrowing it onto `readEnvironment`\'s own bands so a '
    + 'recap caption and the canonical load agree in TONE (not necessarily identical) is real, '
    + 'separate follow-on work, named here rather than assumed already done.',
  'lib/race/execution-plan.ts':
    'Forward-looking RACE EXECUTION PLANNING (pace/fueling strategy for a race that has not happened '
    + 'yet), not a historical evidence read. Reads `heat-model.ts` for the SAME reason `heat-gate.ts` '
    + 'does: a prescriptive question activity-evidence.ts is not built to answer.',
  'lib/race/representativeness.ts':
    'Implements a NAMED, DIFFERENT doctrine rule — `Design/adaptive-progression-engine.md` rule 8\'s '
    + '"poor_race + conditions_normal + tapered + well_paced + maximal" test for whether a race was a '
    + 'valid measurement of fitness. REVIEWED 2026-09-06: this is a race-specific representativeness '
    + 'question with its own citation, not a general per-activity environmental-load read, and is '
    + 'closer to a SECOND evidence-adjacent classifier than the other five exemptions here — flagged '
    + 'honestly rather than waved through. Whether its "conditions_normal" leg should call '
    + '`readEnvironment` instead of its own read is a real open question for a future session, not '
    + 'settled by this exemption.',
  'lib/watch/heat.ts':
    'Watch-face DISPLAY only — renders a heat indicator on the wrist from forecast/current conditions '
    + 'for the session in progress, not a historical evidence classification.',
  'lib/weather/heat-adjustment.ts':
    'The shared PRESCRIPTIVE pace-adjustment utility (`applyHeatToPace`) for an upcoming/race workout '
    + 'whose forecast or historical temperature is known — a forward pace calculation, not a backward '
    + 'evidence read of a completed activity.',
  'lib/doctrine/registry.ts':
    'The DOCTRINE-CITATION GATE (Rule 7) — it imports heat-model.ts\'s own constants (e.g. '
    + '`dewpointAddPct`) to verify THE MODEL ITSELF still matches its Research/06 citation at build '
    + 'time. It classifies no activity; it is a CI check reading the model\'s source, not a caller of '
    + 'it, and never produces a coaching verdict about anything a runner did.',
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

function importsHeatModelDirectly(file: string): boolean {
  const src = readFileSync(file, 'utf8');
  return /from ['"]@\/lib\/training\/heat-model['"]/.test(src)
    || /from ['"]\.\.?\/(?:.*\/)?heat-model['"]/.test(src);
}

describe('DECISION-3 · evidence-classifier ownership gate · heatEffort has one canonical caller', () => {
  it('finds the heat-model importers at all (the scan is not silently empty)', () => {
    const files = [...walk(join(ROOT, 'lib')), ...walk(join(ROOT, 'app'))]
      .filter(importsHeatModelDirectly)
      .map((f) => f.slice(ROOT.length + 1));
    expect(files.length).toBeGreaterThanOrEqual(6);
    expect(files).toContain(CANONICAL_OWNER);
  });

  it('the canonical owner exists and exports readEnvironment', () => {
    const src = readFileSync(join(ROOT, CANONICAL_OWNER), 'utf8');
    expect(/export function readEnvironment\(/.test(src)).toBe(true);
  });

  it('classify-evidence.ts no longer imports heatEffort directly — it reads readEnvironment', () => {
    const src = readFileSync(join(ROOT, 'lib/evidence/classify-evidence.ts'), 'utf8');
    expect(/from ['"]@\/lib\/training\/heat-model['"]/.test(src)).toBe(false);
    expect(/readEnvironment/.test(src)).toBe(true);
  });

  it('every other direct importer of heatEffort is the canonical owner or a named, argued exemption', () => {
    const files = [...walk(join(ROOT, 'lib')), ...walk(join(ROOT, 'app'))]
      .filter(importsHeatModelDirectly)
      .map((f) => f.slice(ROOT.length + 1))
      .filter((f) => f !== CANONICAL_OWNER);
    const unexplained = files.filter((f) => !(f in HEAT_MODEL_EXEMPTIONS));
    expect(
      unexplained,
      unexplained.length === 0 ? '' :
        `\nUNEXPLAINED DIRECT heat-model IMPORTERS:\n  ${unexplained.join('\n  ')}\n\n` +
        'A new file computing its own heat/environmental verdict independently of ' +
        '`activity-evidence.ts#readEnvironment` is the exact "two evidence classifiers assign coaching ' +
        'meaning independently" shape the owner ruled out. Either call readEnvironment instead, or add ' +
        'an argued HEAT_MODEL_EXEMPTIONS entry explaining why this is a genuinely different (forward-' +
        'looking prescription/display) question.',
    ).toEqual([]);
  });

  it('every HEAT_MODEL_EXEMPTIONS entry still actually imports heat-model.ts (no stale exemption)', () => {
    for (const rel of Object.keys(HEAT_MODEL_EXEMPTIONS)) {
      const full = join(ROOT, rel);
      let imports = false;
      try {
        imports = importsHeatModelDirectly(full);
      } catch {
        imports = false;
      }
      expect(imports, `${rel} no longer imports heat-model.ts — delete this exemption`).toBe(true);
    }
  });

  it('every exemption carries a real, non-trivial argued reason', () => {
    for (const [file, reason] of Object.entries(HEAT_MODEL_EXEMPTIONS)) {
      expect(reason.length, `${file}'s exemption reason is too thin to be an argument`).toBeGreaterThan(80);
    }
  });
});
