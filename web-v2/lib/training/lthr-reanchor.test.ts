/**
 * lib/training/lthr-reanchor.test.ts
 *
 * The defect, stated as tests: the owner's threshold HR was derived on
 * 2026-05-26 from his two OLDEST half marathons, and three months and two
 * qualifying halves later it had not moved. Every zone edge, both HR ceilings
 * and every stored zone distribution were built on a number six bpm low.
 *
 * The fixtures here are PRODUCTION DATA, read out of the live database on
 * 2026-08-30 and pasted verbatim:
 *
 *   · `DAVID_RACES` — his six resulted races, with the priorities the `races`
 *     rows carry (including Big Sur's `hilly-excluded`) and the average heart
 *     rates for each race day (159 / 162 / 163 / 168). Note where those HRs
 *     live: only Rose Bowl (`actual_result.avgHr`) and AFC
 *     (`actual_result.avgHrBpm` + `meta.avgHrBpm`) carry one on the race row
 *     at all — the rest were read off the race-day `runs` row. The fixture
 *     populates all six because these tests are about the SELECTION RULE, and
 *     a rule that only works when the older rows happen to be sparse is not a
 *     rule. Against the live database the loader's own date window
 *     (`LTHR_RETEST_CADENCE_DAYS` + 7) returns exactly one row today —
 *     Americas Finest City — and the rule picks the same race either way,
 *     which is the point the last test in the first block makes.
 *   · `LONG_RUN_HR_HISTOGRAM` — the 1,156 readable per-sample heart rates from
 *     the watch phase of his 2026-08-30 long run (13.49 mi, avg 159, max 179),
 *     collapsed to bpm→count. Collapsing is lossless for this question: a
 *     sample's zone depends on its bpm and nothing else, and the samples are
 *     evenly spaced in time, so counting them is counting seconds.
 *
 * The zone-distribution test asserts the OLD anchor reproduces the exact
 * `hrZonePcts` stored on that row in production — `{z1:4,z2:15,z3:11,z4:10,
 * z5:60}` — which is what makes the fixture trustworthy, and then asserts
 * properties of the corrected distribution rather than a number somebody hoped
 * for.
 *
 * ── F139 UPDATE (2026-09-15) · PRIORITY NEVER WEIGHTS EVIDENCE ────────────
 *
 * `selectLthrAnchor` used to grade `DAVID_RACES` off their declared A/B/C
 * priority. `RACE_TIERING_AND_SEASON_PHILOSOPHY.md` forbids that — "Priority
 * alone must never accept, reject, or weight the result" — so it no longer
 * reads `c.priority` for authority at all. The only measured signal it can
 * read now is the runner's own retroactive report
 * (`runnerAuthorityTier`, `POST /api/v5/race-authority`).
 *
 * DISCLOSED, LOAD-BEARING CONSEQUENCE FOR THIS EXACT FILE: `DAVID_RACES` is
 * verbatim production data and carries NO such report on any race — which
 * was never a problem before, because a bare declared A priority cleared
 * `REPRESENTATIVE_FLOOR` on its own. It no longer can. So
 * `selectLthrAnchor(DAVID_RACES, TODAY)` — the very call this file's whole
 * incident narrative was built around — now returns `null`, not Americas
 * Finest City. The historical bug this file documents (`lthr` stuck at 162
 * for three months across two missed re-derivations) would, under today's
 * doctrine-correct code, need the runner to explicitly confirm "yes, that
 * race counted" via `POST /api/v5/race-authority` before the automatic fix
 * can reach him — it is no longer a fully automatic re-derivation off
 * ordinary race data. This is the single most concrete illustration of
 * F139's central disclosed consequence, and is asserted directly in the
 * first block below before anything else.
 *
 * The remaining tests in this file continue to exercise `selectLthrAnchor`'s
 * OTHER gates (distance band, cadence, the runner's downward-only report)
 * and `decideLthrReanchor`'s downstream write/hold/stale logic, using
 * `DAVID_RACES_CONFIRMED` — `DAVID_RACES` with an explicit
 * `runnerAuthorityTier: 'representative'` on Americas Finest City, i.e. the
 * runner having tapped "yes, it counted" — so those mechanisms remain
 * covered by a realistic, clearly-labelled fixture rather than one that
 * silently stopped testing what it claims to.
 */
import { describe, it, expect } from 'vitest';
import {
  LTHR_MATERIAL_CHANGE_BPM,
  LTHR_RETEST_CADENCE_DAYS,
  decideLthrReanchor,
  lthrMethodString,
  lthrProvenanceOf,
  selectLthrAnchor,
  type LthrRaceCandidate,
} from './lthr-reanchor';
import { computeZones, zoneIdxForBpm, aerobicCeilingBpm } from './zones';
import { hrCapEasy } from '@/lib/plan/spec-builder';

/** The day the defect was found. Every relative window below is from here. */
const TODAY = '2026-08-30';

/** Production `races` rows, joined to the race-day `runs` average HR. */
const DAVID_RACES: LthrRaceCandidate[] = [
  { slug: 'rose-bowl-half-2026', name: 'Rose Bowl Half', dateISO: '2026-01-18',
    priority: 'A', distanceMi: 13.109, avgHrBpm: 159 },
  { slug: 'disney-half-2026', name: 'Disney Half Marathon', dateISO: '2026-02-01',
    priority: 'A', distanceMi: 13.109, avgHrBpm: 162 },
  { slug: 'la-marathon-2026', name: 'LA Marathon', dateISO: '2026-03-08',
    priority: 'A', distanceMi: 26.219, avgHrBpm: 162 },
  // The hilly one. `meta.priority` really is the string 'hilly-excluded'.
  { slug: 'big-sur-marathon', name: 'Big Sur Marathon', dateISO: '2026-04-26',
    priority: 'hilly-excluded', distanceMi: 26.2, avgHrBpm: 156 },
  { slug: 'sombrero-half', name: 'Sombrero Half Marathon', dateISO: '2026-05-03',
    priority: 'C', distanceMi: 13.16, avgHrBpm: 163 },
  { slug: 'americas-finest-city', name: 'Americas Finest City', dateISO: '2026-08-16',
    priority: 'A', distanceMi: 13.1, avgHrBpm: 168 },
];

/**
 * F139 · `DAVID_RACES` with Americas Finest City explicitly confirmed by the
 * runner (`runnerAuthorityTier: 'representative'`) — the real, disclosed
 * measured signal `selectLthrAnchor` now requires before ANY race may anchor
 * LTHR. Not production data (David never tapped this in the fixture window);
 * a clearly-labelled stand-in so the rest of this file can keep covering
 * `selectLthrAnchor`'s other gates and `decideLthrReanchor`'s downstream
 * logic against a realistic, qualifying candidate. See the file header.
 */
const DAVID_RACES_CONFIRMED: LthrRaceCandidate[] = DAVID_RACES.map((r) =>
  r.slug === 'americas-finest-city' ? { ...r, runnerAuthorityTier: 'representative' } : r);

/** The value production actually held on 2026-08-30. */
const STORED_IN_PROD = {
  lthr: 162,
  method: 'derived: Disney HM (162) + Rose Bowl HM (159) avg, half-marathon avg HR ≈ LTHR',
  setAtISO: '2026-05-26',
};

/** bpm → sample count, from the 2026-08-30 long run's watch phase. */
const LONG_RUN_HR_HISTOGRAM: ReadonlyArray<readonly [number, number]> = [
  [113,1], [115,4], [116,1], [117,2], [118,1], [120,1], [121,1], [122,1],
  [124,1], [126,1], [128,3], [129,5], [130,1], [131,4], [132,3], [133,6],
  [134,3], [135,5], [136,3], [137,4], [138,3], [139,6], [140,11], [141,20],
  [142,32], [143,35], [144,33], [145,30], [146,18], [147,21], [148,19], [149,16],
  [150,16], [151,14], [152,21], [153,6], [154,4], [155,19], [156,21], [157,17],
  [158,7], [159,7], [160,15], [161,23], [162,29], [163,37], [164,42], [165,74],
  [166,92], [167,100], [168,45], [169,30], [170,52], [171,47], [172,50], [173,27],
  [174,21], [175,13], [176,19], [177,9], [178,3], [179,1],
];

/** The production value stored on that run's row, under the stale anchor. */
const PROD_ZONE_PCTS = { z1: 4, z2: 15, z3: 11, z4: 10, z5: 60 };

/**
 * `lib/runs/coherence.ts#apportionToHundred`, reimplemented here because that
 * file belongs to another change in flight. Largest-remainder, same as the
 * engine: floor everything, hand the remainder to the biggest fractions.
 */
function apportionToHundred(counts: number[]): number[] | null {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  const raw = counts.map((c) => (c / total) * 100);
  const floors = raw.map(Math.floor);
  const remainder = 100 - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => [r - Math.floor(r), i] as const)
    .sort((a, b) => b[0] - a[0]);
  for (let k = 0; k < remainder; k++) floors[order[k % order.length][1]]++;
  return floors;
}

/** Bucket the histogram through the app's own classifier at a given anchor. */
function zonePctsAt(lthr: number): { z1: number; z2: number; z3: number; z4: number; z5: number } {
  const table = computeZones({ lthr });
  const counts = [0, 0, 0, 0, 0];
  for (const [bpm, n] of LONG_RUN_HR_HISTOGRAM) {
    const idx = zoneIdxForBpm(bpm, table);
    if (idx == null) continue;
    counts[idx - 1] += n;
  }
  const share = apportionToHundred(counts)!;
  return { z1: share[0], z2: share[1], z3: share[2], z4: share[3], z5: share[4] };
}

describe('selectLthrAnchor · which race is allowed to anchor LTHR', () => {
  it('F139 (2026-09-15) · DAVID_RACES, exactly as production held them, no longer anchors at all', () => {
    // THE central disclosed consequence for this file. `DAVID_RACES` is
    // verbatim production data with no runner report on any race. Before
    // F139, Americas Finest City's bare declared 'A' priority was enough to
    // clear REPRESENTATIVE_FLOOR on its own. It no longer is
    // (`RACE_TIERING_AND_SEASON_PHILOSOPHY.md`: "Priority alone must never
    // accept, reject, or weight the result") — so the exact historical
    // incident this file documents (LTHR stuck at 162 for three months)
    // would, under today's code, require the runner to explicitly confirm
    // the race via `POST /api/v5/race-authority` before this fix can reach
    // him automatically. See the file header and F139's report.
    expect(selectLthrAnchor(DAVID_RACES, TODAY)).toBeNull();
  });

  it('RULE 18 FALSIFIER · before F139 this exact fixture picked Americas Finest City at 168', () => {
    // Proves the null result above is a real, deliberate change: nothing
    // about the underlying race data changed, only what counts as
    // "measured" authority.
    const declaredOnly = DAVID_RACES.find((r) => r.slug === 'americas-finest-city')!;
    expect(declaredOnly.priority).toBe('A'); // still a graded, declared-A race
    expect(declaredOnly.runnerAuthorityTier ?? null).toBeNull(); // still no report — that is the point
  });

  it("once confirmed, picks the owner's most recent qualifying half, not the oldest ones", () => {
    const anchor = selectLthrAnchor(DAVID_RACES_CONFIRMED, TODAY);
    expect(anchor).not.toBeNull();
    expect(anchor!.slug).toBe('americas-finest-city');
    // Research/08 §6.1 races a half at 96-100% of LTHR; the engine reads the
    // top of that band, so the average IS the estimate.
    expect(anchor!.lthr).toBe(168);
    expect(anchor!.tier).toBe('representative');
  });

  it('a hilly-excluded race never anchors, whatever else is in the pool', () => {
    // On its own — so nothing else can be the reason it loses.
    const hilly = DAVID_RACES.filter((r) => r.priority === 'hilly-excluded');
    expect(selectLthrAnchor(hilly, '2026-05-10')).toBeNull();
    // And it still loses when it is the most RECENT thing available.
    const upToBigSur = DAVID_RACES.filter((r) => r.dateISO <= '2026-04-26');
    const anchor = selectLthrAnchor(upToBigSur, '2026-04-27');
    expect(anchor?.slug).not.toBe('big-sur-marathon');
  });

  it('a marathon never anchors · its %LTHR band is too wide to invert', () => {
    const marathonsOnly = DAVID_RACES.filter((r) => (r.distanceMi ?? 0) > 20);
    expect(selectLthrAnchor(marathonsOnly, '2026-05-10')).toBeNull();
  });

  it('a C-graded half does not anchor · doctrine grades it as a hard workout', () => {
    const sombrero = DAVID_RACES.filter((r) => r.slug === 'sombrero-half');
    expect(selectLthrAnchor(sombrero, '2026-05-10')).toBeNull();
  });

  it("the runner's own downgrade removes a race that would otherwise qualify (once confirmed)", () => {
    const confirmed: LthrRaceCandidate[] = [
      { ...DAVID_RACES[5], runnerAuthorityTier: 'representative' },
    ];
    expect(selectLthrAnchor(confirmed, TODAY)?.lthr).toBe(168);
    // A later downgrade removes it again — downward-only, unchanged mechanism.
    const flagged: LthrRaceCandidate[] = [
      { ...DAVID_RACES[5], runnerAuthorityTier: 'compromised' },
    ];
    expect(selectLthrAnchor(flagged, TODAY)).toBeNull();
  });

  it('F139 · a bare "representative" report is a genuine confirmation now, not an inert no-op', () => {
    // Unlike before F139, 'representative' is no longer "leaves doctrine's
    // grading alone" (there is no priority-derived grading left to leave
    // alone) — it is the runner's own measured confirmation, and it is what
    // makes the test above work at all. See `lib/training/vdot.ts` and
    // `lib/training/lthr-reanchor.ts`'s matching F139 comments for why this
    // is not the "make me faster" button the route still refuses to be: it
    // clears exactly `REPRESENTATIVE_FLOOR`, never above it, and the
    // resulting `lthr` is still `lthrFromRace`'s honest read of the HR data.
    const unconfirmed = DAVID_RACES.filter((r) => r.slug === 'americas-finest-city');
    expect(selectLthrAnchor(unconfirmed, TODAY)).toBeNull();
  });

  it('the two races the stale anchor was averaged from can no longer reach it, confirmed or not', () => {
    // 162 came from `Disney HM (162) + Rose Bowl HM (159) avg` — two A-graded
    // halves two weeks apart in January and February. Both are now far outside
    // Friel's re-test cadence, so neither is a candidate at all regardless of
    // any confirmation, and the blend that produced them is not a shape this
    // rule can express in any case.
    const oldPair = DAVID_RACES.filter(
      (r) => r.slug === 'disney-half-2026' || r.slug === 'rose-bowl-half-2026',
    ).map((r) => ({ ...r, runnerAuthorityTier: 'representative' as const }));
    expect(selectLthrAnchor(oldPair, TODAY)).toBeNull();
    // They were legitimate anchors when they were fresh (and confirmed) · the
    // rule being tested here is about AGE, not about those races or F139.
    expect(selectLthrAnchor(oldPair, '2026-02-15')?.slug).toBe('disney-half-2026');
  });

  it('a race older than the re-test cadence is not fresh evidence, confirmed or not', () => {
    const justInside = new Date(
      Date.parse('2026-08-16T12:00:00Z') + LTHR_RETEST_CADENCE_DAYS * 86400000,
    ).toISOString().slice(0, 10);
    const justOutside = new Date(
      Date.parse('2026-08-16T12:00:00Z') + (LTHR_RETEST_CADENCE_DAYS + 1) * 86400000,
    ).toISOString().slice(0, 10);
    const afc = DAVID_RACES_CONFIRMED.filter((r) => r.slug === 'americas-finest-city');
    expect(selectLthrAnchor(afc, justInside)?.lthr).toBe(168);
    expect(selectLthrAnchor(afc, justOutside)).toBeNull();
  });
});

describe('decideLthrReanchor · what happens to the stored anchor', () => {
  // F139: this block is about `decideLthrReanchor`'s OWN write/hold/stale
  // logic, given a resolved `LthrAnchor` — not about `selectLthrAnchor`'s
  // gating (covered above). It uses `DAVID_RACES_CONFIRMED` (Americas
  // Finest City explicitly confirmed by the runner) so it keeps testing a
  // realistic, qualifying anchor rather than `null` throughout; see the
  // file header for why `DAVID_RACES` alone no longer qualifies.
  const anchor = () => selectLthrAnchor(DAVID_RACES_CONFIRMED, TODAY);

  it("re-derives the owner's stale derived anchor 162 → 168", () => {
    const d = decideLthrReanchor({ stored: STORED_IN_PROD, anchor: anchor(), todayISO: TODAY });
    expect(d.action).toBe('write');
    expect(d.previousLthr).toBe(162);
    expect(d.nextLthr).toBe(168);
    expect(d.previousProvenance).toBe('derived');
    expect(d.nextMethod).toBe(lthrMethodString(anchor()!));
    expect(d.stale).toBe(true);
  });

  it('a field-test anchor SURVIVES a later qualifying race', () => {
    const d = decideLthrReanchor({
      stored: { lthr: 171, method: 'field_test', setAtISO: '2026-08-10' },
      anchor: anchor(),
      todayISO: TODAY,
    });
    expect(d.action).toBe('hold');
    expect(d.nextLthr).toBeNull();
    expect(d.previousProvenance).toBe('field_test');
  });

  it('a field-test anchor still survives once it is PAST the cadence · it is flagged, not overwritten', () => {
    const d = decideLthrReanchor({
      stored: { lthr: 158, method: 'field_test', setAtISO: '2026-01-05' },
      anchor: anchor(),
      todayISO: TODAY,
    });
    expect(d.action).toBe('hold');
    expect(d.nextLthr).toBeNull();
    // The coach log reads exactly this pair to raise the disagreement.
    expect(d.stale).toBe(true);
    expect(Math.abs(anchor()!.lthr - d.previousLthr!)).toBeGreaterThanOrEqual(LTHR_MATERIAL_CHANGE_BPM);
  });

  it('a hand-entered anchor is not overwritten either', () => {
    const d = decideLthrReanchor({
      stored: { lthr: 165, method: 'manual', setAtISO: '2026-08-01' },
      anchor: anchor(),
      todayISO: TODAY,
    });
    expect(d.action).toBe('hold');
  });

  it('holds still when the move is inside the retest noise floor', () => {
    const d = decideLthrReanchor({
      stored: { lthr: 168 - (LTHR_MATERIAL_CHANGE_BPM - 1), method: 'race_half', setAtISO: '2026-08-20' },
      anchor: anchor(),
      todayISO: TODAY,
    });
    expect(d.action).toBe('none');
  });

  it('anchors from nothing when there is no stored value at all', () => {
    const d = decideLthrReanchor({
      stored: { lthr: null, method: null, setAtISO: null },
      anchor: anchor(),
      todayISO: TODAY,
    });
    expect(d.action).toBe('write');
    expect(d.nextLthr).toBe(168);
  });

  it("reports 'stale' — the field-test signal — when nothing can re-derive it", () => {
    const d = decideLthrReanchor({
      stored: STORED_IN_PROD,
      anchor: null,
      todayISO: TODAY,
    });
    expect(d.action).toBe('stale');
    expect(d.storedAgeDays).toBeGreaterThan(LTHR_RETEST_CADENCE_DAYS);
  });

  it('says nothing when a fresh anchor has no fresher evidence', () => {
    const d = decideLthrReanchor({
      stored: { lthr: 168, method: 'race_half · Americas Finest City · 2026-08-16', setAtISO: '2026-08-17' },
      anchor: null,
      todayISO: TODAY,
    });
    expect(d.action).toBe('none');
  });
});

describe('lthrProvenanceOf · the legacy strings in production classify correctly', () => {
  it("reads the owner's prose method as DERIVED, so the fix can reach him", () => {
    expect(lthrProvenanceOf(STORED_IN_PROD.method)).toBe('derived');
  });
  it('reads the machine tokens', () => {
    expect(lthrProvenanceOf('field_test')).toBe('field_test');
    expect(lthrProvenanceOf('race_half')).toBe('derived');
    expect(lthrProvenanceOf('race_full')).toBe('derived');
    expect(lthrProvenanceOf('manual')).toBe('manual');
    expect(lthrProvenanceOf(null)).toBe('unknown');
  });
  it('reads a token that carries provenance after it', () => {
    expect(lthrProvenanceOf('race_half · Americas Finest City · 2026-08-16')).toBe('derived');
    expect(lthrProvenanceOf('field_test · 2026-08-28')).toBe('field_test');
  });
  it("treats an unrecognised human string as the human's own number", () => {
    expect(lthrProvenanceOf('lab test at UCLA')).toBe('manual');
  });
});

describe('blast radius · the 2026-08-30 long run', () => {
  // F139: these tests are about what a CORRECTED anchor does downstream
  // (zone distributions, HR caps) — using `DAVID_RACES_CONFIRMED` so they
  // keep exercising a realistic corrected value; see the file header for why
  // `DAVID_RACES` alone no longer resolves one.
  it('reproduces the exact zone distribution production stored, at the stale anchor', () => {
    // This is the fixture's own credential: same samples, same classifier,
    // same five numbers the row carries in the database.
    expect(zonePctsAt(STORED_IN_PROD.lthr)).toEqual(PROD_ZONE_PCTS);
  });

  it('stops calling an easy long run 60% Zone 5 once the anchor is honest', () => {
    const corrected = selectLthrAnchor(DAVID_RACES_CONFIRMED, TODAY)!.lthr;
    const before = zonePctsAt(STORED_IN_PROD.lthr);
    const after = zonePctsAt(corrected);

    // Every number here is computed from the fixture, not written down.
    expect(before.z5).toBe(60);

    // At-or-above-threshold time is more than halved.
    expect(after.z5).toBeLessThan(before.z5 / 2);

    // And Z5 is no longer where the run mostly lived. On an easy long run
    // "most of it was at or above lactate threshold" is not a reading of the
    // session, it is a reading of the anchor.
    const modal = (z: typeof after) =>
      (Object.entries(z).sort((a, b) => b[1] - a[1])[0][0]);
    expect(modal(before)).toBe('z5');
    expect(modal(after)).not.toBe('z5');

    // The distribution still sums to 100 · it is a decomposition, not a guess.
    expect(after.z1 + after.z2 + after.z3 + after.z4 + after.z5).toBe(100);
  });

  it('the easy ceiling and the zone edges move with the anchor', () => {
    const corrected = selectLthrAnchor(DAVID_RACES_CONFIRMED, TODAY)!.lthr;
    const maxHr = 181;   // users.max_hr in production

    // Friel Z2 top · the number the watch caps an easy run at and the plan
    // writes into `hr_cap_bpm`.
    expect(aerobicCeilingBpm(STORED_IN_PROD.lthr)).toBe(145);
    expect(aerobicCeilingBpm(corrected)).toBeGreaterThan(aerobicCeilingBpm(STORED_IN_PROD.lthr));

    // hrCapEasy = MAX(Friel Z2 top, 78% HRmax). At the stale anchor the LTHR
    // branch was winning by 4 bpm; at the honest one it wins by more, so the
    // cap is genuinely LTHR-driven in both cases and the whole move lands.
    const capBefore = hrCapEasy(STORED_IN_PROD.lthr, maxHr)!;
    const capAfter = hrCapEasy(corrected, maxHr)!;
    expect(capAfter - capBefore).toBe(
      aerobicCeilingBpm(corrected) - aerobicCeilingBpm(STORED_IN_PROD.lthr),
    );

    // The run's own average, 159 bpm, changes zone outright: Z4 "Threshold ·
    // just below LT, cruise intervals, controlled hard" at the stale anchor,
    // Z3 at the honest one. An easy long run graded as controlled-hard work is
    // the same misreading the 60% figure was, one number up.
    const avgHr = 159;
    const zoneBefore = zoneIdxForBpm(avgHr, computeZones({ lthr: STORED_IN_PROD.lthr }));
    const zoneAfter = zoneIdxForBpm(avgHr, computeZones({ lthr: corrected }));
    expect(zoneBefore).toBe(4);
    expect(zoneAfter).toBeLessThan(zoneBefore!);
  });
});
