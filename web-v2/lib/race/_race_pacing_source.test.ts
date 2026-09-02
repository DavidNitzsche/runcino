/**
 * THE RACE PACE PLAN IS BUILT FROM THE TARGET, NEVER FROM THE GOAL.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE DEFECT THIS PINS, measured on the owner's live CIM detail 2026-09-02
 *
 * `GET /api/v5/race/[slug]` stated an execution target of 7:23/mi, carried
 * prose explaining why his 3:00:00 was out of reach, and then rendered a
 * mile-by-mile pace plan whose weighted mean was 412 s/mi — 6:52/mi, exactly
 * his goal pace — with its final phase labelled "Goal pace · 6:48/mi".
 *
 *     BEFORE   Settle 7:07 · Find rhythm 6:57 · Goal pace 6:48   (mean 412)
 *     AFTER    Settle 7:38 · Find rhythm 7:28 · Target pace 7:19 (mean 443)
 *
 * Thirty-one seconds per mile, about thirteen minutes across a marathon, in
 * the direction that ends a marathon at mile 18. The screen argued against the
 * goal in words and handed him a plan for it.
 *
 * Note what it is NOT: the execution target already honours a stated goal as
 * far as doctrine allows. On his account `execution.source` is
 * `stated_goal_clamped_to_range_edge` — the goal had already pulled the target
 * to the fast edge of the likely range. The pace plan was going 31 s/mi beyond
 * even that.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY NO EXISTING GATE SAW IT
 *
 * `check-goal-pace-leak.sh` hunts goal-derived pace EXPRESSIONS.
 * `buildRacePacing({ goalSec, … })` is a legitimate call to a shared builder
 * with a legitimately-named parameter — the retrospective passes a real goal
 * to it and is right to. Nothing in the source says which quantity this
 * particular caller hands over. It took a cross-surface contract reading both
 * numbers off ONE live response to see it.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THIS GATE CANNOT FAIL ON (Rule 22)
 *
 * It reads the route's source text, so it cannot see the value that actually
 * flows at run time: renaming a goal variable to `pacePlanTargetSec` and
 * assigning the goal to it would pass. It says nothing about whether
 * `race-outlook`'s target is CORRECT — only about which quantity is asked for.
 * It covers ONE route; the watch and the retrospective call the same builder
 * and are not checked here (both are believed correct — the watch passes a
 * target, the retrospective passes a real goal for a race already run — but
 * "believed" is the honest word). And it cannot see a future third caller.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROUTE = join(__dirname, '..', '..', 'app', 'api', 'v5', 'race', '[slug]', 'route.ts');
const SRC = readFileSync(ROUTE, 'utf8');

/** Source with comments removed — a claim about CODE must not be satisfied,
 *  or broken, by the prose describing it. An earlier gate tonight failed on
 *  its own explanatory comment quoting the code it replaced. */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

describe('the race detail pace plan is priced off the execution target', () => {
  it('LIVENESS · the route exists and still builds a pace plan', () => {
    expect(SRC.length).toBeGreaterThan(2000);
    expect(CODE).toContain('buildRacePacing');
    expect(CODE).toContain('pacePlan');
  });

  it('resolves its pacing target from the canonical race-outlook owner', () => {
    expect(CODE, 'the pace plan must come from lib/race/race-outlook.ts, which '
      + 'is the one owner of "what should this runner run this race at"')
      .toMatch(/pacePlanTargetSec\s*=\s*outlook\?\.execution\.targetSec/);
  });

  it('does NOT hand a goal to the pacing builder', () => {
    // The whole call, whatever its formatting.
    const call = CODE.slice(CODE.indexOf('buildRacePacing({'));
    const firstArgs = call.slice(0, call.indexOf('})') + 2);
    expect(firstArgs, 'this route must not price a pace plan off the runner\'s '
      + 'stated goal. Constitution §7 names the shape; on the owner it was 31 '
      + 's/mi and thirteen minutes.')
      .not.toMatch(/goalSec\s*:\s*goalSec|goalSec\s*,/);
    expect(firstArgs).toMatch(/goalSec\s*:\s*pacePlanTargetSec/);
  });

  it('RULE 11 · an unresolvable outlook yields NO pace plan, not a goal-priced one', () => {
    expect(CODE).toMatch(/if\s*\(\s*pacePlanTargetSec\s*&&/);
    // Assert on the DECLARATION, not on one spelling of the fallback. The
    // first draft of this test pinned `pacePlanTargetSec ?? goalSec` and was
    // falsified by `outlook?.execution.targetSec ?? goalSec` — the same defect
    // one token to the left. A gate that only catches the shape its author
    // imagined is the shape of gate this codebase keeps finding.
    const decl = CODE.slice(CODE.indexOf('const pacePlanTargetSec'));
    const declLine = decl.slice(0, decl.indexOf(';') + 1);
    expect(declLine, 'the goal must not be a fallback for the target here — '
      + 'falling back to it IS the defect, in any spelling')
      .not.toMatch(/goal/i);
  });

  it('does not label a target as the runner\'s goal pace', () => {
    expect(CODE, 'buildRacePacing labels its last phase "Goal pace", which is a '
      + 'lie once this route passes the target — 31 s/mi apart on the owner')
      .toMatch(/'Goal pace'\s*\?\s*'Target pace'/);
  });
});
