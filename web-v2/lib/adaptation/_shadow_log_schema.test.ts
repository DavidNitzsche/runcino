/**
 * lib/adaptation/_shadow_log_schema.test.ts · the shadow log's DDL admits
 * every state the code can emit.
 *
 * Migration 160 created `adaptation_shadow_log` with a four-state CHECK on
 * `convergence_state`; the guard gained a fifth state the same day and every
 * cycle resolving to it has failed its INSERT since. Nothing could tell: the
 * RO-role audit cannot insert at all, and the failure was a console line.
 *
 * This file reads the migrations directory — not the database — and asserts
 * the LATEST CHECK on that column admits every member of the guard's state
 * union. It goes red the moment a state is added to the code without a
 * migration beside it, and it is green with 161 queued even before 161 is
 * applied; whether 161 HAS been applied is a production fact the report
 * states, not something a source test can claim.
 *
 * Rule 22 · cannot fail on: a migration file that exists but was never run.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { AUTHORING_REANCHOR_CONVERGENCE_STATES } from './authoring-convergence';

const MIGRATIONS = path.resolve(__dirname, '..', '..', 'db', 'migrations');

/** The admitted list from the highest-numbered migration that (re)defines the CHECK. */
function latestAdmittedStates(): { file: string; states: string[] } {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => /^\d+_.*\.sql$/.test(f) && !f.startsWith('._'))
    .sort((a, b) => Number(a.split('_')[0]) - Number(b.split('_')[0]));
  let latest: { file: string; states: string[] } | null = null;
  for (const f of files) {
    const raw = readFileSync(path.join(MIGRATIONS, f), 'utf8');
    // Drop SQL comments so the DOWN block (commented out) cannot masquerade as UP.
    const src = raw.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
    const m = src.match(/adaptation_shadow_log_convergence_state_check\s*\n?\s*CHECK\s*\(convergence_state IN \(([\s\S]*?)\)\)/);
    if (!m) continue;
    const states = [...m[1].matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]);
    latest = { file: f, states };
  }
  if (!latest) throw new Error('no migration defines the convergence_state CHECK · liveness');
  return latest;
}

describe('adaptation_shadow_log.convergence_state', () => {
  it('liveness · the union and the migration were both read', () => {
    expect(AUTHORING_REANCHOR_CONVERGENCE_STATES.length).toBeGreaterThanOrEqual(5);
    const latest = latestAdmittedStates();
    expect(latest.states.length).toBeGreaterThanOrEqual(4);
  });

  it('the latest CHECK admits every state the guard can emit', () => {
    const latest = latestAdmittedStates();
    for (const s of AUTHORING_REANCHOR_CONVERGENCE_STATES) {
      expect(latest.states, `${s} is not admitted by ${latest.file}`).toContain(s);
    }
  });

  it('160 alone did NOT · the defect this file exists for is real', () => {
    const raw = readFileSync(path.join(MIGRATIONS, '160_adaptation_shadow_log.sql'), 'utf8');
    expect(raw).not.toMatch(/CANNOT_CONVERGE_NO_CANONICAL_PRICING/);
  });
});
