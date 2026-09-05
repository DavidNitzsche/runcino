/**
 * lib/plan/adjudication/_quality_minutes.test.ts · THE PARSE, AND THE THREE
 * FACTS IT KEEPS APART.
 *
 * `quality-minutes.ts` is the one owner of "how many minutes of this week are
 * quality", and it feeds the demand model's intensity component — which is the
 * term that decides whether a threshold-pace proposal costs anything at all.
 * Before it existed both live loaders passed a literal `0`, and a
 * zero-intensity week prices a pace correction at zero added demand, so
 * arbitration's rule 1 could never defer one however full the week was.
 *
 * ── RULE 22 · WHAT THIS FILE CANNOT FAIL ON ────────────────────────────────
 *
 * · A SPEC THAT LIES about the session it describes. Every fixture here IS the
 *   prescription; nothing compares it to what was run.
 * · WHETHER THE COEFFICIENT THAT SPENDS THESE MINUTES IS RIGHT. That is
 *   `QUALITY_MINUTE_TO_EASY_MILE`, a POLICY_ASSUMPTION in the demand model.
 * · A SPEC SHAPE HIS PLANS HAVE NEVER AUTHORED. The kinds covered are the ones
 *   `lib/faff/types.ts` declares and the ones the sealed history actually
 *   contains (easy, long, tempo, threshold, intervals); a future shape falls
 *   to the default branch and reports UNKNOWN, which is the safe direction but
 *   is not the same as being handled.
 */
import { describe, it, expect } from 'vitest';
import { qualitySecondsOfSpec, qualityMinutesOfWeek } from './quality-minutes';

const EASY = { isQuality: false, isLong: false };
const QUALITY = { isQuality: true, isLong: false };
const LONG = { isQuality: false, isLong: true };

describe('the parse, one kind at a time', () => {
  it('reps priced by distance and pace', () => {
    // 4 x 1 mi at 7:00/mi = 28 minutes of work. Warm-up and cool-down are NOT
    // counted: they are easy running, already inside the week's mileage at the
    // volume coefficient of 1.0, and counting them again would make a session
    // with a long warm-up look harder than the same reps off a short one.
    const r = qualitySecondsOfSpec({
      kind: 'threshold', rep_count: 4, rep_distance_mi: 1, rep_pace_s_per_mi: 420,
      warmup_mi: 2, cooldown_mi: 2,
    }, QUALITY);
    expect(r.minutes).toBeCloseTo(28, 6);
  });

  it('reps priced by DURATION, which an effort-prescribed session still carries', () => {
    // 6 x 90s hills. `by_effort` means there is no pace, and Rule 11's point
    // is that "no pace" is not "no information" — the duration IS the work.
    const r = qualitySecondsOfSpec({
      kind: 'threshold', rep_count: 6, rep_duration_s: 90, rep_pace_s_per_mi: null, by_effort: true,
    }, QUALITY);
    expect(r.minutes).toBeCloseTo(9, 6);
  });

  it('an effort-prescribed session with a DISTANCE and no pace is unknown', () => {
    const r = qualitySecondsOfSpec({
      kind: 'intervals', rep_count: 5, rep_distance_m: 1000, rep_pace_s_per_mi: null, by_effort: true,
    }, QUALITY);
    expect(r.minutes).toBeNull();
    expect(r.why).toMatch(/no pace and no duration/);
  });

  it('a tempo, and a marathon-pace block', () => {
    expect(qualitySecondsOfSpec(
      { kind: 'tempo', tempo_distance_mi: 5, tempo_pace_s_per_mi: 400 }, QUALITY,
    ).minutes).toBeCloseTo(33.333, 3);
    expect(qualitySecondsOfSpec(
      { kind: 'mp', mp_distance_mi: 8, mp_pace_s_per_mi: 420 }, QUALITY,
    ).minutes).toBeCloseTo(56, 6);
  });

  it('the LONG RUN counts only its finish block, and a plain long run is a measured ZERO', () => {
    // `Research/00a` §"Training Intensity Distribution (TID)" puts marathon-pace
    // work on the quality side, and the demand model's own field doc says
    // "plus race-pace work" in as many words.
    expect(qualitySecondsOfSpec(
      { kind: 'long', finish_mi: 4, finish_pace_s_per_mi: 420 }, LONG,
    ).minutes).toBeCloseTo(28, 6);
    // A long run with no authored finish block: the ABSENCE of the fields is
    // the prescription, so this is 0 and not unknown. That is the one branch
    // where missing fields mean something.
    const plain = qualitySecondsOfSpec({ kind: 'long', fuel_mi: [5, 10] }, LONG);
    expect(plain.minutes).toBe(0);
    expect(plain.why).toMatch(/no authored finish block/);
  });

  it('an easy or recovery session is a measured zero', () => {
    expect(qualitySecondsOfSpec({ kind: 'easy' }, EASY).minutes).toBe(0);
    expect(qualitySecondsOfSpec({ kind: 'recovery' }, EASY).minutes).toBe(0);
  });
});

describe('RULE 11 · a spec-less row is read off the plan\'s own flags', () => {
  /* FALSIFIED · deleting the `flags` branch (so every spec-less row is
   * unknown) makes the two tests below fail with "expected null to be +0" and
   * "expected null to be close to 61.333".
   * That is not hypothetical: it was the FIRST behaviour of this file, and it
   * produced a FAILED demand posture at nine of thirteen historical boundaries
   * in the counterfactual, because 180 of the owner's 262 spec-less
   * prescriptions are easy or rest days. */
  it('neither quality nor long, and no spec, is a MEASURED zero', () => {
    const r = qualitySecondsOfSpec(null, EASY);
    expect(r.minutes).toBe(0);
    expect(r.why).toMatch(/neither quality nor long/);
  });

  it('flagged quality with no spec is UNKNOWN, and says which fact it is', () => {
    const r = qualitySecondsOfSpec(null, QUALITY);
    expect(r.minutes).toBeNull();
    expect(r.why).toMatch(/authored no spec/);
  });

  it('with NO flags at all, a spec-less row stays unknown', () => {
    // A caller that does not hold the flags cannot be given the benefit of
    // them. The permissive branch is opt-in, on evidence.
    expect(qualitySecondsOfSpec(null).minutes).toBeNull();
  });
});

describe('a whole week', () => {
  it('sums the work phases and ignores the easy days', () => {
    const r = qualityMinutesOfWeek([
      { dateISO: '2026-09-07', spec: { kind: 'easy' }, ...EASY },
      { dateISO: '2026-09-08', spec: { kind: 'tempo', tempo_distance_mi: 5, tempo_pace_s_per_mi: 400 }, ...QUALITY },
      { dateISO: '2026-09-09', spec: null, ...EASY },
      { dateISO: '2026-09-13', spec: { kind: 'long', finish_mi: 4, finish_pace_s_per_mi: 420 }, ...LONG },
    ]);
    expect(r.minutes).toBeCloseTo(33.333 + 28, 2);
  });

  it('ONE unreadable session makes the WEEK unknown, not a partial sum', () => {
    // A partial sum understates the week, and understating a week is the
    // direction that licenses a bigger plan (PLAN_SIMPLIFICATION_DOCTRINE
    // invariant 11). So the refusal propagates rather than being absorbed.
    const r = qualityMinutesOfWeek([
      { dateISO: '2026-09-08', spec: { kind: 'tempo', tempo_distance_mi: 5, tempo_pace_s_per_mi: 400 }, ...QUALITY },
      { dateISO: '2026-09-10', spec: null, ...QUALITY },
    ]);
    expect(r.minutes).toBeNull();
    expect(r.why).toMatch(/1 of 2 sessions could not be priced/);
    expect(r.why).toMatch(/partial sum understates the week/);
  });

  it('a week with NO sessions is a measured zero, which is a different fact', () => {
    const r = qualityMinutesOfWeek([]);
    expect(r.minutes).toBe(0);
    expect(r.why).toMatch(/prescribes no sessions at all/);
  });
});
