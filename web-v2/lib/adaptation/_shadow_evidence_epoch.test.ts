/**
 * lib/adaptation/_shadow_evidence_epoch.test.ts · the belief-model stamp a
 * shadow record carries, and the epoch a promotion review filters on.
 *
 * Pure — no database. What it proves: every record produced from here on
 * carries a stamp naming the belief generation and the live version of each
 * belief model it consumed; the stamp is persisted INSIDE `capacity_belief`
 * (Rule 10 · a persisted belief carries the model that produced it); the epoch
 * cannot drift into an undated counter.
 *
 * Rule 22 · what this file cannot fail on: it cannot tell whether the epoch
 * SHOULD have been bumped for a given belief correction. That is a judgement
 * the engineer landing the correction makes, and the report's promotion
 * checklist is where it is audited.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { SHADOW_EVIDENCE_EPOCH, SHADOW_EVIDENCE_EPOCH_PATTERN } from './shadow-evidence-epoch';
import { currentBeliefModelStamp } from './shadow-compare';
import { ADAPTATION_ENGINE_MODEL_VERSION } from './adaptation-engine';

const SEMVER = /^\d+\.\d+\.\d+$/;

describe('the shadow-evidence epoch', () => {
  it('is dated and named, never a bare counter', () => {
    expect(SHADOW_EVIDENCE_EPOCH).toMatch(SHADOW_EVIDENCE_EPOCH_PATTERN);
    // Liveness for the pattern itself: a bare counter and an undated label
    // must both be refused, or the pattern is decoration.
    expect('1').not.toMatch(SHADOW_EVIDENCE_EPOCH_PATTERN);
    expect('threshold-contract').not.toMatch(SHADOW_EVIDENCE_EPOCH_PATTERN);
    expect('2026-09-02.').not.toMatch(SHADOW_EVIDENCE_EPOCH_PATTERN);
  });

  it('starts at the P0 threshold-contract correction and no earlier', () => {
    // The first epoch names the correction that invalidated every prior
    // shadow record. A value dated before the correction would let those
    // records count.
    expect(SHADOW_EVIDENCE_EPOCH.slice(0, 10) >= '2026-09-02').toBe(true);
  });
});

describe('the belief-model stamp', () => {
  it('carries the epoch and a semver for every belief model the engine consumes', () => {
    const s = currentBeliefModelStamp();
    expect(s.epoch).toBe(SHADOW_EVIDENCE_EPOCH);
    expect(s.adaptationEngine).toBe(ADAPTATION_ENGINE_MODEL_VERSION);
    for (const key of ['capacity', 'prescription', 'runnerState', 'activityEvidence', 'reexamination', 'raceOutlook'] as const) {
      expect(s[key], key).toMatch(SEMVER);
    }
  });

  it('is read live from each owner\'s own constant, never retyped', () => {
    const src = readFileSync(path.join(__dirname, 'shadow-compare.ts'), 'utf8');
    for (const name of [
      'CAPACITY_MODEL_VERSION', 'PRESCRIPTION_MODEL_VERSION', 'RUNNER_STATE_MODEL_VERSION',
      'ACTIVITY_EVIDENCE_MODEL_VERSION', 'REEXAMINATION_MODEL_VERSION', 'RACE_OUTLOOK_MODEL_VERSION',
    ]) {
      expect(src, name).toMatch(new RegExp(`import \\{ ${name} \\} from '@/lib/`));
    }
    // No version literal of the belief models is typed in this file.
    const body = src.slice(src.indexOf('export function currentBeliefModelStamp'));
    expect(body.slice(0, body.indexOf('}'))).not.toMatch(/'\d+\.\d+\.\d+'/);
  });

  it('is persisted inside capacity_belief · Rule 10, and no DDL', () => {
    const src = readFileSync(path.join(__dirname, 'shadow-compare.ts'), 'utf8');
    const persist = src.slice(src.indexOf('async function persistToTable'));
    expect(persist.length).toBeGreaterThan(200);
    expect(persist).toMatch(/\{ \.\.\.record\.capacityBelief, beliefModel: record\.beliefModel \}/);
  });

  it('every record type carries it as a required field', () => {
    const src = readFileSync(path.join(__dirname, 'shadow-compare.ts'), 'utf8');
    const record = src.slice(src.indexOf('export interface ShadowCompareRecord'));
    expect(record.slice(0, record.indexOf('\n}\n'))).toMatch(/\n\s+beliefModel: BeliefModelStamp;/);
  });
});
