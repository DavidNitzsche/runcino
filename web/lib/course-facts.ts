/**
 * Course facts loader + validator.
 *
 * Every race we support has a JSON file in `data/courses/*.json` that
 * carries its landmarks, expected geometry, and **source citations**.
 * This file enforces the invariant that nothing lands on the Watch
 * without a primary-source citation.
 *
 * See docs/FACT_SYSTEM.md for the full integrity story.
 */

import bigSur from '../data/courses/big-sur-marathon.json';
import sombreroHalf from '../data/courses/sombrero-half.json';
import cim from '../data/courses/cim.json';
import afc from '../data/courses/americas-finest-city.json';
import type { GpxTrack } from './types';

/** Slugs of courses with curated facts files. Add a new entry here +
 *  drop a JSON in data/courses/ to register a new race with first-class
 *  landmark/phase support. Anything else falls through to synthesized
 *  facts derived from the uploaded GPX. */
export const REGISTERED_COURSES = ['big-sur-marathon', 'sombrero-half', 'cim', 'americas-finest-city'] as const;
export type RegisteredCourseSlug = typeof REGISTERED_COURSES[number];

export interface SourceCitation {
  url: string;
  title?: string;
  confidence: 'primary_source_verified' | 'secondary_source' | 'unverified_rumor';
  verified_at: string;            // ISO date
  verified_quote?: string;
}

export interface PhaseFact {
  index: number;
  label: string;
  start_mi: number;
  end_mi: number;
  expected_mean_grade_pct?: number;
  expected_gain_ft?: number;
  note: string;
  sources: SourceCitation[];
}

export interface LandmarkFact {
  at_mi: number;
  kind: 'landmark' | 'summit' | 'climb_warning' | 'aid_station';
  label: string;
  note: string;
  sources: SourceCitation[];
}

export interface CourseFacts {
  race: {
    name: string;
    slug: string;
    description: string;
    course_type: 'point_to_point' | 'loop' | 'out_and_back';
    typical_date: string;
    expected_facts: {
      distance_mi: number;
      distance_m: number;
      total_gain_ft: number;
      total_loss_ft: number;
      net_ft: number;
      /** Verified start elevation from official source. */
      start_elevation_ft?: number;
      /** Verified finish elevation from official source. */
      finish_elevation_ft?: number;
      /** Verified peak elevation — overrides noisy GPX computation when present. */
      peak_elevation_ft?: number;
      /** Mile mark of the peak — overrides GPX when present. */
      peak_mi?: number;
    };
    expected_tolerances: {
      distance_mi: number;
      gain_ft: number;
      loss_ft: number;
    };
    sources: SourceCitation[];
  };
  phases: PhaseFact[];
  landmarks: LandmarkFact[];
  notes_from_sources: Record<
    string,
    {
      status: 'primary_source_verified' | 'secondary_source' | 'unverified_rumor';
      [k: string]: unknown;
    }
  >;
  warnings: Record<string, string>;
}

/** Returns the curated facts file for a known course, or null if the slug
 *  is unrecognized — callers can then fall back to synthesizeCourseFacts(). */
export function getCourseFacts(slug: string): CourseFacts | null {
  switch (slug) {
    case 'big-sur-marathon':     return bigSur as CourseFacts;
    case 'sombrero-half':        return sombreroHalf as CourseFacts;
    case 'cim':                  return cim as CourseFacts;
    case 'americas-finest-city': return afc as CourseFacts;
    default:                     return null;
  }
}

/** Build a minimal CourseFacts object from a parsed GPX + user-supplied
 *  metadata. Used when the user types in a brand-new race that doesn't
 *  yet have a curated facts file. The auto-grouping in groupPhases will
 *  invent geometry-based phase labels; landmarks are empty (we never
 *  invent landmark names). */
export function synthesizeCourseFacts(
  track: GpxTrack,
  meta: { name: string; slug: string; date: string; type?: 'point_to_point' | 'loop' | 'out_and_back' }
): CourseFacts {
  const distMi = track.totalDistanceM / 1609.344;
  const isLoop = meta.type === 'loop' || isLoopShape(track);
  return {
    race: {
      name: meta.name,
      slug: meta.slug,
      description: `${meta.name} (custom course — synthesized from uploaded GPX).`,
      course_type: meta.type ?? (isLoop ? 'loop' : 'point_to_point'),
      typical_date: meta.date,
      expected_facts: {
        distance_mi: Math.round(distMi * 100) / 100,
        distance_m: Math.round(track.totalDistanceM),
        total_gain_ft: Math.round(track.demGainFt ?? track.smoothedGainFt),
        total_loss_ft: Math.round(track.demLossFt ?? track.smoothedLossFt),
        net_ft: Math.round((track.demGainFt ?? track.smoothedGainFt) - (track.demLossFt ?? track.smoothedLossFt)),
      },
      // Permissive tolerances so the synthesized "expected" never errors
      // its own GPX out — this validation is meaningful only for curated
      // courses where expected_facts come from primary sources.
      expected_tolerances: { distance_mi: 99, gain_ft: 99999, loss_ft: 99999 },
      sources: [],
    },
    phases: [],     // empty → groupPhases falls back to geometric labels
    landmarks: [],  // never invent landmark names
    notes_from_sources: {},
    warnings: { synthesized: 'Auto-generated from uploaded GPX. Add a curated facts file to register this course first-class.' },
  };
}

function isLoopShape(track: GpxTrack): boolean {
  if (track.points.length < 2) return false;
  const a = track.points[0];
  const b = track.points[track.points.length - 1];
  // Compare lat/lon directly: a loop closes within ~0.005° (~500 m at most latitudes)
  return Math.abs(a.lat - b.lat) < 0.005 && Math.abs(a.lon - b.lon) < 0.005;
}

/** Return only landmarks whose sources include at least one primary_source_verified citation. */
export function shippableLandmarks(facts: CourseFacts | null): LandmarkFact[] {
  if (!facts) return [];
  return facts.landmarks.filter(l =>
    l.sources.some(s => s.confidence === 'primary_source_verified')
  );
}

/** Return phases safe to ship (all have at least one primary-source citation). */
export function shippablePhases(facts: CourseFacts): PhaseFact[] {
  const unsafe = facts.phases.filter(
    p => !p.sources.some(s => s.confidence === 'primary_source_verified')
  );
  if (unsafe.length > 0) {
    throw new Error(
      `Course ${facts.race.name}: ${unsafe.length} phase(s) lack primary-source citations: ${unsafe.map(p => p.label).join(', ')}`
    );
  }
  return facts.phases;
}

/** Hard tests on the facts structure. Throws on any violation. */
export function validateCourseFactsStructure(facts: CourseFacts): void {
  // Phases contiguous and ordered
  for (let i = 1; i < facts.phases.length; i++) {
    if (facts.phases[i].start_mi < facts.phases[i - 1].start_mi) {
      throw new Error(`Phases out of order at index ${i}: ${facts.phases[i].label}`);
    }
    if (Math.abs(facts.phases[i].start_mi - facts.phases[i - 1].end_mi) > 0.01) {
      throw new Error(`Phases non-contiguous between ${facts.phases[i - 1].label} and ${facts.phases[i].label}`);
    }
  }
  if (facts.phases.length > 0) {
    const first = facts.phases[0];
    const last = facts.phases[facts.phases.length - 1];
    if (first.start_mi !== 0) {
      throw new Error(`First phase must start at 0.0 mi, got ${first.start_mi}`);
    }
    if (Math.abs(last.end_mi - facts.race.expected_facts.distance_mi) > 0.2) {
      throw new Error(`Last phase ends at ${last.end_mi} but course is ${facts.race.expected_facts.distance_mi} mi`);
    }
  }

  // Landmarks in ascending mile order
  for (let i = 1; i < facts.landmarks.length; i++) {
    if (facts.landmarks[i].at_mi < facts.landmarks[i - 1].at_mi) {
      throw new Error(`Landmarks out of order at index ${i}: ${facts.landmarks[i].label}`);
    }
  }

  // Every landmark has at least one source
  for (const l of facts.landmarks) {
    if (!l.sources || l.sources.length === 0) {
      throw new Error(`Landmark "${l.label}" has no source citation`);
    }
    for (const s of l.sources) {
      if (!s.url || !s.confidence || !s.verified_at) {
        throw new Error(`Landmark "${l.label}" source is missing required fields`);
      }
    }
  }
  for (const p of facts.phases) {
    if (!p.sources || p.sources.length === 0) {
      throw new Error(`Phase "${p.label}" has no source citation`);
    }
  }
}

export interface FactsValidation {
  ok: boolean;
  warnings: string[];
  errors: string[];
  geometry: {
    parsedDistanceMi: number;
    expectedDistanceMi: number;
    distanceDeltaMi: number;
    parsedGainFt: number;
    expectedGainFt: number;
    gainDeltaFt: number;
    parsedLossFt: number;
    expectedLossFt: number;
    lossDeltaFt: number;
  };
}

/**
 * Pre-flight check: compare a parsed GPX against the expected course facts.
 * Returns warnings/errors instead of throwing — callers decide whether to
 * proceed.
 */
export function validateGpxAgainstCourse(
  track: GpxTrack,
  facts: CourseFacts
): FactsValidation {
  const parsedDistanceMi = track.totalDistanceM / 1609.344;
  const expected = facts.race.expected_facts;
  const tol = facts.race.expected_tolerances;

  const distanceDelta = parsedDistanceMi - expected.distance_mi;
  const gainDelta = track.smoothedGainFt - expected.total_gain_ft;
  const lossDelta = track.smoothedLossFt - expected.total_loss_ft;

  const warnings: string[] = [];
  const errors: string[] = [];

  if (Math.abs(distanceDelta) > tol.distance_mi) {
    errors.push(
      `Parsed distance ${parsedDistanceMi.toFixed(2)} mi differs from expected ${expected.distance_mi} mi by ${distanceDelta.toFixed(2)} mi (tolerance ±${tol.distance_mi}).`
    );
  }
  if (Math.abs(gainDelta) > tol.gain_ft) {
    warnings.push(
      `Parsed total gain ${track.smoothedGainFt.toFixed(0)} ft differs from expected ${expected.total_gain_ft} ft by ${gainDelta.toFixed(0)} ft (tolerance ±${tol.gain_ft}).`
    );
  }
  if (Math.abs(lossDelta) > tol.loss_ft) {
    warnings.push(
      `Parsed total loss ${track.smoothedLossFt.toFixed(0)} ft differs from expected ${expected.total_loss_ft} ft by ${lossDelta.toFixed(0)} ft (tolerance ±${tol.loss_ft}).`
    );
  }

  return {
    ok: errors.length === 0,
    warnings,
    errors,
    geometry: {
      parsedDistanceMi,
      expectedDistanceMi: expected.distance_mi,
      distanceDeltaMi: distanceDelta,
      parsedGainFt: track.smoothedGainFt,
      expectedGainFt: expected.total_gain_ft,
      gainDeltaFt: gainDelta,
      parsedLossFt: track.smoothedLossFt,
      expectedLossFt: expected.total_loss_ft,
      lossDeltaFt: lossDelta,
    },
  };
}
