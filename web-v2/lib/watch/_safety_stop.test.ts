/**
 * SAFETYSTOP-1 · a watch must not be handed a runnable session while the
 * canonical safety owner's posture withholds one.
 *
 * ── WHAT THIS FILE CANNOT FAIL ON (Rule 22) ─────────────────────────────────
 *
 *   · It tests the WIRE GATE, not the owner. `resolveWatchSafetyGate` maps a
 *     posture onto ship/withhold; nothing here checks that `classifySafety`
 *     reaches the right posture — `lib/safety/_safety_verdict.test.ts` owns
 *     that, and this file would stay green if the owner started returning
 *     PRESCRIBE for a broken femur.
 *   · It does not run `buildWatchToday`. Reaching the real function needs a
 *     live plan, a live profile and a database. The wiring assertions below
 *     are SOURCE assertions, which is weaker than a behavioural test and is
 *     the strongest thing available here — they fail loudly if the gate or
 *     the `resolveSafety` call is deleted, which a type check would not.
 *   · It says nothing about what the WATCH draws when the message branch
 *     arrives. That is the No-session board's own contract.
 *   · Under EASY_ONLY it asserts that a QUALITY session is withheld and an
 *     easy one ships. It cannot tell you whether withholding is better than
 *     down-scoping — the wire cannot author an easy version of a session, and
 *     if the plan engine ever does, this is where the decision changes.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { resolveWatchSafetyGate } from './safety-stop';
import type { SafetyResolution, SafetyPosture } from '@/lib/safety/safety-verdict';

/** A KNOWN resolution carrying the posture under test. */
function known(posture: Exclude<SafetyPosture, 'WITHHOLD_PENDING_CHECK'>): SafetyResolution {
  return {
    known: true,
    state: posture === 'NO_TRAINING' ? 'STOP' : posture === 'EASY_ONLY' ? 'MODIFY' : 'NORMAL',
    posture,
    reason: 'test',
    driver: posture === 'PRESCRIBE' ? null : 'injury',
    injury: null,
    illness: null,
    niggle: null,
    degradedSignals: [],
    explain: 'fixture',
  } as unknown as SafetyResolution;
}

/** The UNKNOWN branch — the check did not run. */
const unresolved: SafetyResolution = {
  known: false,
  posture: 'WITHHOLD_PENDING_CHECK',
  unreadable: [{ signal: 'injury', failure: 'READ_FAILED' }],
  floor: 'NORMAL',
  explain: 'fixture',
} as unknown as SafetyResolution;

describe('SAFETYSTOP-1 · the wire gate', () => {
  it('NO_TRAINING withholds the runnable session', () => {
    const g = resolveWatchSafetyGate(known('NO_TRAINING'), false);
    expect(g.kind).toBe('withhold');
    if (g.kind !== 'withhold') return;
    expect(g.why).toBe('stopped');
    expect(g.message.length).toBeGreaterThan(0);
    // Coach voice: no exclamation, no em dash.
    expect(g.message).not.toMatch(/[!—]/);
  });

  it('WITHHOLD_PENDING_CHECK also withholds, and says something DIFFERENT', () => {
    // Rule 11 · "safety stopped training" and "the check did not run" are two
    // facts. Both withhold; the runner is owed different sentences, and the
    // second one must not assert a verdict nobody reached.
    const stopped = resolveWatchSafetyGate(known('NO_TRAINING'), false);
    const unchecked = resolveWatchSafetyGate(unresolved, false);
    expect(unchecked.kind).toBe('withhold');
    if (unchecked.kind !== 'withhold' || stopped.kind !== 'withhold') return;
    expect(unchecked.why).toBe('unchecked');
    expect(unchecked.message).not.toBe(stopped.message);
    expect(unchecked.message).not.toMatch(/[!—]/);
  });

  it('an unresolved check can never fall through to a runnable session', () => {
    // The whole point of reading `posture` rather than `state`: the UNKNOWN
    // branch carries no state, and its posture is designed so that forgetting
    // to branch cannot produce a prescription.
    expect(resolveWatchSafetyGate(unresolved, false).kind).not.toBe('ship');
  });

  it('PRESCRIBE ships', () => {
    expect(resolveWatchSafetyGate(known('PRESCRIBE'), true).kind).toBe('ship');
  });

  it('EASY_ONLY ships an EASY session', () => {
    // MODIFY licenses easy running. Withholding it would be harsher than the
    // owner asked.
    expect(resolveWatchSafetyGate(known('EASY_ONLY'), false).kind).toBe('ship');
  });

  it('EASY_ONLY withholds a QUALITY session', () => {
    // `mayEmitQualityWorkout`'s own stated purpose: "prevent the app from
    // confidently presenting a quality session as cleared". The wire cannot
    // down-scope an interval session into an easy one — authoring an easy
    // version is a PRESCRIPTION decision owned by the plan engine, and
    // inventing one here would be a second answer to it. So the session is
    // withheld and the sentence says which running is licensed.
    const g = resolveWatchSafetyGate(known('EASY_ONLY'), true);
    expect(g.kind).toBe('withhold');
    if (g.kind !== 'withhold') return;
    expect(g.why).toBe('quality_not_cleared');
    expect(g.message).not.toMatch(/[!\u2014]/);
  });

  it('the three withholding sentences are all different', () => {
    // Rule 16 · three facts, three sentences. A shared string here would mean
    // the runner cannot tell "we stopped you" from "we could not check".
    const msgs = [
      resolveWatchSafetyGate(known('NO_TRAINING'), false),
      resolveWatchSafetyGate(unresolved, false),
      resolveWatchSafetyGate(known('EASY_ONLY'), true),
    ].map((g) => (g.kind === 'withhold' ? g.message : 'SHIPPED'));
    expect(new Set(msgs).size).toBe(3);
  });
});

describe('SAFETYSTOP-1 · the gate is actually wired into the payload', () => {
  const SRC = path.join(__dirname, 'build-workout.ts');

  it('liveness · the file read is the one that builds the watch payload', () => {
    // Rule 18 point 2. A source assertion that reads nothing reports clean,
    // which is the worst outcome available.
    const src = fs.readFileSync(SRC, 'utf8');
    expect(src.length).toBeGreaterThan(10_000);
    expect(src).toContain('export async function buildWatchToday');
  });

  it('the canonical owner is consulted, and NOT behind a catch', () => {
    const src = fs.readFileSync(SRC, 'utf8');
    expect(src).toContain('await resolveSafety(userId)');
    // `resolveSafety(...).catch(() => null)` would restore the exact Rule 11
    // collapse this change removed: a failed check reading as "fine".
    expect(src).not.toMatch(/resolveSafety\([^)]*\)\s*\.catch/);
  });

  it('the watch no longer reads the safety tables itself', () => {
    // `build-workout.ts` was author number four for these two signals.
    const src = fs.readFileSync(SRC, 'utf8');
    expect(src).not.toContain('FROM runner_injuries');
    expect(src).not.toContain('FROM sick_episodes');
  });

  it('a withheld posture takes the message branch and ships no workout', () => {
    const src = fs.readFileSync(SRC, 'utf8');
    const branch = src.match(/if\s*\(\s*safetyGate\.kind === 'withhold'\s*\)\s*\{[\s\S]{0,600}?\n  \}/);
    expect(branch).not.toBeNull();
    const body = branch![0];
    expect(body).toContain('message: safetyGate.message');
    // The assertion that fails if someone keeps the call and drops the branch.
    expect(body).not.toMatch(/\bworkout\b\s*[,:]/);
  });
});
