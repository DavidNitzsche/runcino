/**
 * MOVEREADJUDICATE-1 · `PATCH /api/plan/workout` can no longer move a session.
 *
 * See `app/api/plan/workout/route.ts`'s own header for the full argument:
 * `new_date_iso` used to write `date_iso` + `dow` + `week_id` directly against
 * `plan_workouts`, with none of the nine re-adjudication checks Move-a-Run
 * runs, and it was the mover census's (`_move_readjudication.test.ts`) second
 * named bypass. It had zero callers anywhere in the app (the one Swift
 * function that could send it, `API+Toolkit.swift`'s
 * `patchPlannedWorkout(newDateIso:)`, was itself never called), so it was
 * retired rather than wired.
 *
 * This is a SOURCE SCAN, not a behavioural test — the route opens a real pool
 * connection and a full behavioural test would need a scratch database this
 * gate does not require. It reads the route file as text and asserts two
 * things: the refusal exists, and the old unguarded write is gone. Rule 18: a
 * scanner is only trusted once it has been made to fail, so both directions
 * are exercised on synthetic source below, not just on the real file.
 *
 * ── WHAT THIS SCANNER CANNOT FAIL ON (Rule 22) ─────────────────────────────
 *
 * · Whether the refusal branch actually RUNS, or returns the stated reason at
 *   runtime — it reads source, not behaviour.
 * · A move written through a DIFFERENT column name or a helper that builds the
 *   SET clause elsewhere. It looks for this file's own literal shape.
 * · Whether some OTHER route reintroduces the same bypass — that is the mover
 *   census's (`lib/brain/orchestration/_move_readjudication.test.ts`) job,
 *   over the whole app, not this file's.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..');
const ROUTE_PATH = path.join(ROOT, 'app/api/plan/workout/route.ts');

/** The refusal is present: a `new_date_iso` request is told no and told why. */
function refusesNewDateIso(src: string): boolean {
  return /new_date_iso/.test(src) && /move_not_supported/.test(src);
}

/** The OLD unguarded write is gone: nothing sets `updates.date_iso` /
 *  `updates.week_id` from request input. */
function hasUnguardedDateWrite(src: string): boolean {
  return /updates\.date_iso\s*=/.test(src) || /updates\.week_id\s*=/.test(src);
}

describe('PATCH /api/plan/workout · new_date_iso is retired, not silently accepted', () => {
  const src = fs.readFileSync(ROUTE_PATH, 'utf8');

  it('the scanner reads a real file — a silent empty read would prove nothing', () => {
    expect(src.length).toBeGreaterThan(500);
  });

  it('POSITIVE CONTROL · the pre-fix shape is caught by hasUnguardedDateWrite', () => {
    const bad = `if (body.new_date_iso) { updates.date_iso = newDate; updates.week_id = w.id; }`;
    expect(hasUnguardedDateWrite(bad)).toBe(true);
  });

  it('NEGATIVE CONTROL · a route with no date-move code at all is not flagged', () => {
    const good = `if (body.sub_label !== undefined) updates.sub_label = body.sub_label;`;
    expect(hasUnguardedDateWrite(good)).toBe(false);
  });

  it('POSITIVE CONTROL · a route that never mentions the refusal fails refusesNewDateIso', () => {
    expect(refusesNewDateIso('if (body.new_date_iso) { /* silently ignored */ }')).toBe(false);
  });

  it('the real route refuses new_date_iso by name, with a reason', () => {
    expect(refusesNewDateIso(src), 'route.ts no longer names move_not_supported for new_date_iso').toBe(true);
  });

  it('the real route no longer writes date_iso/week_id from request input', () => {
    expect(
      hasUnguardedDateWrite(src),
      'route.ts still assigns updates.date_iso or updates.week_id — the retired move capability is back, '
      + 'unguarded, with none of the nine re-adjudication checks. Route the move through '
      + 'POST /api/plan/move or POST /api/today/reschedule instead.',
    ).toBe(false);
  });
});
