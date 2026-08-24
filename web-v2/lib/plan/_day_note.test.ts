/**
 * The regression for instance #2 of the unread-content bug (2026-08-24):
 * `plan_workouts.notes`, written on 4431 of 4431 production rows and read by
 * nothing that a runner can see.
 *
 * FALSIFIER · the last describe block reads `app/api/v5/today/route.ts` and
 * asserts the composer is wired into it. Against the code as it stood before
 * this fix — `const why = [phaseRationale, purpose.verdict, ...purpose.facts]`
 * — every test in that block fails, because the route named neither
 * `loadDayNote` nor `composeWhy` and no SELECT in the repo put
 * `plan_workouts.notes` in front of a runner.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { houseVoice, composeWhy } from './day-note';

const REPO = path.resolve(__dirname, '../..');

describe('houseVoice · rule four applied at the read boundary', () => {
  it('replaces the em dash the database still holds', () => {
    // A real production value, written before check-coach-voice.sh existed.
    const legacy = 'Easy run — conversational pace, full stop.';
    expect(houseVoice(legacy)).toBe('Easy run · conversational pace, full stop.');
    expect(houseVoice(legacy)).not.toContain('—');
  });

  it('leaves house punctuation alone', () => {
    const clean = 'Recovery easy · conversational, no surges.';
    expect(houseVoice(clean)).toBe(clean);
  });

  it('collapses the whitespace an em-dash swap leaves behind', () => {
    expect(houseVoice('Cutback easy  —  shorter, slower.')).toBe('Cutback easy · shorter, slower.');
  });
});

describe('composeWhy · the plan speaks before the generic layer does', () => {
  it('leads with the phase rationale, then the day note', () => {
    const why = composeWhy({
      phaseRationale: 'Post-race recovery · Americas Finest City. Easy running only · no quality.',
      dayNote: 'Extra rest · still recovering.',
      verdict: 'Rest day.',
      facts: [],
    });
    expect(why.indexOf('Post-race recovery')).toBe(0);
    expect(why).toContain('Extra rest · still recovering.');
  });

  it('drops the generic verdict once the day note has spoken', () => {
    // This is the padding David objected to on 2026-08-21: three clauses,
    // none of them a reason. Once the plan's own sentence is present, the
    // type-keyed restatement adds nothing.
    const why = composeWhy({
      phaseRationale: null,
      dayNote: 'Recovery easy · conversational, no surges.',
      verdict: 'Easy day.',
      facts: [],
    });
    expect(why).toBe('Recovery easy · conversational, no surges.');
    expect(why).not.toContain('Easy day.');
  });

  it('answers a rest day, which the generic layer cannot', () => {
    // A rest day has no `todayPlan`, so `derivePurpose` sees 'unplanned' and
    // produces nothing at all. The row for that date is not empty.
    const why = composeWhy({
      phaseRationale: null, dayNote: 'Off. Still recovering.', verdict: '', facts: [],
    });
    expect(why).toBe('Off. Still recovering.');
  });

  it('does not repeat a sentence the rationale already said', () => {
    const why = composeWhy({
      phaseRationale: 'Post-race recovery. Easy running only · no quality.',
      dayNote: 'Easy running only · no quality.',
      verdict: null, facts: [],
    });
    expect(why).toBe('Post-race recovery. Easy running only · no quality.');
  });

  it('keeps the pre-existing "Easy day." suppression when there is no note', () => {
    const why = composeWhy({
      phaseRationale: 'Post-race recovery · AFC. Easy running only · no quality.',
      dayNote: null,
      verdict: 'Easy day.',
      facts: ['Conversational pace · should feel like nothing.'],
    });
    expect(why).not.toContain('Easy day.');
    expect(why).toContain('Conversational pace');
  });

  it('still falls back to the generic layer with no plan at all', () => {
    const why = composeWhy({
      phaseRationale: null, dayNote: null,
      verdict: 'Threshold day.', facts: ['Comfortably hard.'],
    });
    expect(why).toBe('Threshold day. Comfortably hard.');
  });

  it('emits no em dash, no exclamation mark and no emoji', () => {
    const why = composeWhy({
      phaseRationale: 'Peak phase. The volume is high.',
      dayNote: houseVoice('Cutback easy — shorter, slower, no agenda.'),
      verdict: 'Easy day.', facts: [],
    });
    expect(why).not.toMatch(/[—!]/);
    expect(why).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });
});

describe('FALSIFIER · the day note is wired to a surface, not just fetched', () => {
  const routePath = path.join(REPO, 'app/api/v5/today/route.ts');
  const route = fs.readFileSync(routePath, 'utf8');

  it('the v5 Today route imports the composer', () => {
    expect(route).toMatch(/import\s*\{[^}]*loadDayNote[^}]*\}\s*from\s*'@\/lib\/plan\/day-note'/);
    expect(route).toMatch(/composeWhy/);
  });

  it('`why` is built by composeWhy, not by concatenating the generic layer', () => {
    expect(route).toMatch(/const why = composeWhy\(/);
    // The shape this replaced. If it comes back, the note is unread again.
    expect(route).not.toMatch(/const why = \[phaseRationale, purpose\.verdict/);
  });

  it('`why` reaches the response', () => {
    // Whatever the field is called on the wire, the composed value must be
    // referenced after it is built — a variable nobody uses is the bug.
    const at = route.indexOf('const why = composeWhy(');
    expect(at).toBeGreaterThan(-1);
    const after = route.slice(at);
    expect(after).toMatch(/\bwhy\b/g);
    expect(after.match(/\bwhy\b/g)!.length).toBeGreaterThan(1);
  });

  it('some SELECT in the repo actually asks for plan_workouts.notes', () => {
    const src = fs.readFileSync(path.join(REPO, 'lib/plan/day-note.ts'), 'utf8');
    expect(src).toMatch(/SELECT\s+pw\.notes/);
  });
});
