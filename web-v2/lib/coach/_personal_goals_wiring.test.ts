/**
 * lib/coach/_personal_goals_wiring.test.ts — the write side may not outlive
 * the read side again.
 *
 * `personal_goals` spent months as a loop with one end. The runner set a goal
 * on Targets, `NewGoalSheet` POSTed it, and — once migration 152 gave the row
 * somewhere to land — it landed correctly and was never read by anything. The
 * POST handler even carried a comment saying the state-loader picked goals up.
 * It did not. Nothing did.
 *
 * Every gate in the repo was green throughout, because a stored value nobody
 * reads breaks no test. These are the assertions that would have gone red.
 *
 * They are deliberately about WIRING, not rendering: the failure was never a
 * bad pixel, it was two halves of a feature that never met. Each one names the
 * edge that has to exist.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { personalGoalHorizon, personalGoalTypeLabel } from '@/lib/faff/personal-goal-copy';
import type { PersonalGoal } from '@/lib/coach/personal-goals';

const ROOT = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
/** Source with comments stripped. Several assertions below are of the form
 *  "this shape is GONE", and every one of those shapes is also quoted in a
 *  header explaining why it went — same trick `_swallowed_failure_fixes.test.ts`
 *  uses. A prose mention is not a call site. */
const code = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1 ');

const goal = (over: Partial<PersonalGoal> = {}): PersonalGoal => ({
  id: '1',
  goal_type: 'volume',
  target: '40 mi/wk',
  current: null,
  deadline: null,
  tolerance: null,
  rationale: null,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
  days_to_deadline: null,
  ...over,
});

describe('a goal the runner sets is read back by something', () => {
  it('the coach loads them onto ProfileState', () => {
    const s = read('lib/coach/profile-state.ts');
    expect(s).toContain('loadPersonalGoals');
    expect(s).toContain('personalGoals');
  });

  it('reciteMe states them on the ME surface', () => {
    // /api/coach/facts?surface=me and /api/briefing both render this block,
    // and iPhone's ProfileView is a client of the first — so this one edge is
    // what gives the phone the read without a native list.
    const s = read('lib/coach/fact-reciter.ts');
    expect(s).toContain('state.personalGoals');
    expect(s).toContain('CHASING');
  });

  it('the web seed carries them to Targets, and Targets renders them', () => {
    expect(read('components/faff-app/seed.ts')).toContain('personalGoals');
    const view = read('components/faff-app/views/TargetsView.tsx');
    expect(view).toContain('StandingGoals');
    expect(view).toContain('seed.personalGoals');
    // The runner's own reason for the goal, which the generated-content
    // registry marks 'surfaced' and points at this file.
    expect(view).toContain('rationale');
  });

  it('the create pill and the list it writes to are on the same page', () => {
    // The pill existed for months next to nothing it produced. If a future
    // edit moves one without the other, this is the tripwire.
    const view = read('components/faff-app/views/TargetsView.tsx');
    expect(view).toContain('NewGoalSheet');
    expect(view).toContain('StandingGoals');
  });

  it('the DELETE the list offers is the route that exists', () => {
    expect(read('components/faff-app/views/TargetsView.tsx')).toContain('`/api/goals/${goal.id}`');
    expect(read('app/api/goals/[id]/route.ts')).toContain('export async function DELETE');
  });

  it('the POST handler no longer claims a consumer it does not have', () => {
    const s = read('app/api/goals/route.ts');
    // The exact sentence that was false. It named the state-loader, which has
    // never queried this table.
    expect(s).not.toContain('Coach picks goals up via state-loader');
    expect(code('lib/coach/state-loader.ts')).not.toContain('personal_goals');
  });
});

describe('one query, and it can still fail out loud', () => {
  it('only the shared loader names the table for reading', () => {
    // Four statements used to be spread across two route files. The reads are
    // one query now; the writes stay where they are.
    expect(read('lib/coach/personal-goals.ts')).toContain('FROM personal_goals');
    expect(code('app/api/goals/route.ts')).not.toContain('FROM personal_goals');
  });

  it('the loader uses the runner day, never the server clock', () => {
    // lib/runtime/runner-tz.ts: CURRENT_DATE is server-clock UTC and must be
    // replaced by a $N::date parameter. A goal due today would otherwise stop
    // being active at 5pm Pacific.
    expect(code('lib/coach/personal-goals.ts')).not.toContain('CURRENT_DATE');
    expect(read('lib/coach/personal-goals.ts')).toContain('$2::date');
  });

  it('a failed read stays distinguishable from a runner with no goals', () => {
    // `?? []` in the loader is the entire original bug, one level down.
    const s = read('lib/coach/personal-goals.ts');
    expect(s).toContain('if (rows === null) return null;');
    // And the surfaces branch on it rather than collapsing it.
    expect(read('lib/coach/fact-reciter.ts')).toContain('state.personalGoals === null');
    expect(read('components/faff-app/views/TargetsView.tsx')).toContain('goals === null');
  });

  it('a malformed id is a 400, not an outage', () => {
    // `Number(id)` sent NaN to a bigint column, so /api/goals/banana answered
    // "we could not read your goals" for a request that was simply wrong.
    expect(code('app/api/goals/[id]/route.ts')).not.toContain('Number(id)');
    expect(read('app/api/goals/[id]/route.ts')).toContain('parseGoalId');
  });
});

describe('the words a goal is shown in', () => {
  it('are pure — no pool reaches the reciter or the client bundle', () => {
    // TargetsView is a client component and every reciter is documented pure.
    // The copy helpers live apart from the loader for exactly that reason.
    const copy = read('lib/faff/personal-goal-copy.ts');
    expect(copy).not.toContain("from '@/lib/db/pool'");
    expect(copy).toContain('import type');
  });

  it('name a legacy strength goal rather than dropping it', () => {
    // STRENGTH-3 stopped accepting new strength goals and kept existing rows
    // readable. The reader has to know a word the writer refuses.
    expect(personalGoalTypeLabel('strength')).toBe('STRENGTH');
    expect(personalGoalTypeLabel('volume')).toBe('VOLUME');
  });

  it('read the horizon off the row, not off a clock', () => {
    expect(personalGoalHorizon(goal())).toBe('no deadline');
    expect(personalGoalHorizon(goal({ deadline: '2026-08-31', days_to_deadline: 7 })))
      .toBe('Aug 31 · 7 days');
    expect(personalGoalHorizon(goal({ deadline: '2026-08-24', days_to_deadline: 0 })))
      .toBe('Aug 24 · today');
    expect(personalGoalHorizon(goal({ deadline: '2026-08-31', days_to_deadline: 1 })))
      .toBe('Aug 31 · 1 day');
  });
});
