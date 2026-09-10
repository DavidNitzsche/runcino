/**
 * lib/plan/_primer_specific.test.ts · PRIMER-SPECIFIC-1 (2026-09-09)
 *
 * ── WHAT THIS GATES ─────────────────────────────────────────────────────────
 *
 * Two bugs, found together:
 *
 *   1 · TIEFIX-1. `applyRunnerVoice`'s "week's longest easy run" comparison
 *       used a bare `>` with no tie check, so a genuinely tied week still
 *       named the chronologically-first day as uniquely "the week's longest"
 *       — false, since a second day tied it. Measured firing on 63% of weeks
 *       in this project's own 8,781-archetype corpus.
 *
 *   2 · PRIMER-SPECIFIC-1. Fixing (1) surfaced a second, previously-masked
 *       bug: once a tie correctly assigns NEITHER day `volume`, both can fall
 *       through to `primer`, and two `primer` days in one week used to carry
 *       the byte-identical generic line — confirmed on `10k/advanced/35/6d`
 *       and `5k/advanced/35/6d` in `_sentence_repetition.test.ts`'s own
 *       corpus (0 findings before TIEFIX-1's fix landed, 8 after, until
 *       PRIMER-SPECIFIC-1 also landed).
 *
 * This file drives `applyRunnerVoice` directly against small, exact fixtures
 * built by hand — not the sim composer — so every scenario below is the
 * precise shape it claims to be, not "whatever the corpus happened to
 * produce". `_sentence_repetition.test.ts` is the corpus-level gate; this is
 * the falsification suite for the mechanism itself (Rule 18): every case here
 * was run against the pre-fix code and confirmed to fail first.
 *
 * ── WHAT THIS CANNOT FAIL ON (Rule 22) ──────────────────────────────────────
 *
 *   · A WEEK SHAPE THE HAND-BUILT FIXTURES DON'T COVER. `_sentence_
 *     repetition.test.ts`'s 11-archetype corpus is the breadth check; this
 *     file is depth on the exact mechanism.
 *   · WHETHER THE SPECIFIC WORDING IS GOOD COACHING. It asserts the CORRECT
 *     text is chosen and that two colliding days never say the same thing —
 *     not that the words are the best possible words.
 */
import { describe, it, expect } from 'vitest';
import { applyRunnerVoice, type ComposePlanResult, type ComposedWeek, type DayPlan, type DOW } from './generate';
import {
  BLOCK_STANDING_SENTENCES,
  EASY_DAY_ROLE_LINES,
  PRIMER_SESSION_LINE,
  PRIMER_COLLISION_FALLBACK,
  primerLineForNextSessionType,
  resolvePrimerLines,
} from './runner-instruction';

// The exact seed `applyRunnerVoice` looks for to decide a row is a "generic
// easy" row eligible for a role line — read off the standing table rather
// than retyped, so this fixture cannot drift from what the composer actually
// writes (the same discipline `generate.ts`'s own `GENERIC_EASY_SEED` uses).
const GENERIC_EASY_SEED = BLOCK_STANDING_SENTENCES.find((s) => s.id === 'easy.talk-test')!.text;

/** One day, defaulting `isQuality`/`isLong` from `type` the way the composer
 *  itself sets them (see `generate.ts`'s `isQuality: true` call sites). */
function day(dow: DOW, type: DayPlan['type'], distanceMi: number, opts: Partial<DayPlan> = {}): DayPlan {
  const isQuality = opts.isQuality
    ?? (type === 'threshold' || type === 'intervals' || type === 'tempo');
  const isLong = opts.isLong ?? (type === 'long');
  const notes = opts.notes ?? (type === 'easy' && distanceMi > 0 ? GENERIC_EASY_SEED : '');
  return { dow, type, distanceMi, isQuality, isLong, subLabel: opts.subLabel ?? null, notes };
}

/** One week. `startISO` must be a Sunday and dow 0 = that Sunday, matching
 *  `dowDateInWeek`'s own convention (the same one `_sentence_repetition.
 *  test.ts`'s CASES use). */
function week(startISO: string, days: DayPlan[], opts: Partial<ComposedWeek> = {}): ComposedWeek {
  return { startISO, phase: opts.phase ?? 'QUALITY', weeklyMi: opts.weeklyMi ?? 0, days, isRaceWeek: opts.isRaceWeek ?? false };
}

/** Minimal `ComposePlanResult` — `applyRunnerVoice` reads only `.weeks`. */
function plan(weeks: ComposedWeek[]): ComposePlanResult {
  return { weeks, blocks: {} as never, totalWeeks: weeks.length, vols: [], authoredState: {} } as unknown as ComposePlanResult;
}

/** Sentences in a note, split the same crude way the sentence-repetition
 *  gate does — a full stop then whitespace — but reading the RAW authored
 *  text rather than the rendered/citation-stripped form, which is a
 *  genuinely different check from `_sentence_repetition.test.ts`'s. */
function sentencesOf(note: string): string[] {
  return note.split(/(?<=\.)\s+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
}

describe('PRIMER-SPECIFIC-1 · falsification 1 · tied longest easy runs claim no winner', () => {
  it('a genuine tie gets no "volume" line on either day; a clear winner still does', () => {
    const tiedWeek = week('2026-08-30', [
      day(0, 'easy', 6, {}),               // tied longest, 6mi
      day(1, 'rest', 0),
      day(2, 'easy', 6, {}),               // tied longest, 6mi
      day(3, 'rest', 0),
      day(4, 'easy', 4, {}),               // clearly not the longest
      day(5, 'rest', 0),
      day(6, 'rest', 0),
    ]);
    const controlWeek = week('2026-09-06', [
      day(0, 'easy', 7, {}),               // clear, untied winner
      day(1, 'rest', 0),
      day(2, 'easy', 5, {}),
      day(3, 'rest', 0),
      day(4, 'easy', 4, {}),
      day(5, 'rest', 0),
      day(6, 'rest', 0),
    ]);
    const composed = plan([tiedWeek, controlWeek]);
    applyRunnerVoice(composed);

    const volumeLine = EASY_DAY_ROLE_LINES.volume;
    expect(tiedWeek.days[0].notes).not.toContain(volumeLine);
    expect(tiedWeek.days[2].notes).not.toContain(volumeLine);
    // Falsified against the pre-TIEFIX-1 code: the strict `>` comparison
    // named `tiedWeek.days[0]` (chronologically first) the week's longest
    // even though `tiedWeek.days[2]` tied it exactly.

    expect(controlWeek.days[0].notes).toContain(volumeLine);
    expect(controlWeek.days[1].notes).not.toContain(volumeLine);
    expect(controlWeek.days[2].notes).not.toContain(volumeLine);
  });
});

describe('PRIMER-SPECIFIC-1 · falsification 2 · different next-day sessions get distinct, specific text', () => {
  it('an easy day before threshold and an easy day before intervals name their own session', () => {
    const w = week('2026-08-30', [
      day(0, 'rest', 0),
      day(1, 'easy', 5, {}),               // primes Tue's threshold
      day(2, 'threshold', 6),
      day(3, 'easy', 5, {}),               // primes Thu's intervals
      day(4, 'intervals', 7),
      day(5, 'easy', 5, {}),
      day(6, 'rest', 0),
    ]);
    applyRunnerVoice(plan([w]));

    expect(w.days[1].notes).toContain(PRIMER_SESSION_LINE.threshold);
    expect(w.days[3].notes).toContain(PRIMER_SESSION_LINE.intervals);
    expect(w.days[1].notes).not.toEqual(w.days[3].notes);
    // Neither day fell back to the old interchangeable line.
    expect(w.days[1].notes).not.toContain(EASY_DAY_ROLE_LINES.primer);
    expect(w.days[3].notes).not.toContain(EASY_DAY_ROLE_LINES.primer);
  });
});

describe('PRIMER-SPECIFIC-1 · falsification 3 · same next-day session type never repeats identically', () => {
  it('two easy days before two threshold sessions: the earlier keeps the specific line, the later steps down', () => {
    const w = week('2026-08-30', [
      day(0, 'rest', 0),
      day(1, 'easy', 5, {}),               // primes Tue's threshold — EARLIER
      day(2, 'threshold', 6),
      day(3, 'easy', 5, {}),               // primes Thu's threshold — LATER, collides
      day(4, 'threshold', 6),
      day(5, 'easy', 5, {}),
      day(6, 'rest', 0),
    ]);
    applyRunnerVoice(plan([w]));

    expect(w.days[1].notes).not.toEqual(w.days[3].notes);
    expect(w.days[1].notes).toContain(PRIMER_SESSION_LINE.threshold);
    // The later, colliding day steps down to the classic generic line rather
    // than repeating "Tomorrow's threshold session is the work." a second
    // time in the same week, and rather than being left blank.
    expect(w.days[3].notes).toContain(EASY_DAY_ROLE_LINES.primer);
    expect(w.days[3].notes).not.toContain(PRIMER_SESSION_LINE.threshold);
    expect(w.days[3].notes.length).toBeGreaterThan(0);
  });

  it('three easy days before three threshold sessions of the same type: all three ladder slots fire, none repeats', () => {
    // Exercises `resolvePrimerLines`'s full three-slot ladder (specific →
    // generic → `PRIMER_COLLISION_FALLBACK`) directly. Real doctrine bounds a
    // SAME-known-type collision at two (`tierTarget.qualityPerWeek`'s own
    // ceiling), so this is a synthetic stress case rather than a corpus
    // reproduction — it proves the mechanism does not silently degrade if
    // that ceiling ever moved, not that today's engine can produce it.
    const w = week('2026-08-30', [
      day(0, 'easy', 5, {}),               // primes threshold #1 — EARLIEST
      day(1, 'threshold', 6),
      day(2, 'easy', 5, {}),               // primes threshold #2
      day(3, 'threshold', 6),
      day(4, 'easy', 5, {}),               // primes threshold #3 — LATEST
      day(5, 'threshold', 6),
      day(6, 'rest', 0),
    ]);
    applyRunnerVoice(plan([w]));

    const texts = [w.days[0].notes, w.days[2].notes, w.days[4].notes];
    expect(new Set(texts).size, `three colliding primer days must carry three different sentences, got: ${JSON.stringify(texts)}`).toBe(3);
    expect(texts[0]).toContain(PRIMER_SESSION_LINE.threshold);
    expect(texts[1]).toContain(EASY_DAY_ROLE_LINES.primer);
    expect(texts[2]).toContain(PRIMER_COLLISION_FALLBACK);
  });

  it('two-way collision on an UNRESOLVABLE next-day type: neither is blank, neither repeats the other', () => {
    // `type: 'easy', isQuality: true` is the composer's own embedded-surge
    // shape (see `generate.ts` line ~12810) — `isHard()` reads it as hard
    // (isQuality), but `canonicalSessionType('easy')` is not a nameable
    // session, so this is the "cannot be determined" case (David's ruling's
    // second clause), not the "same known type" case test 3's first case
    // covers.
    const w = week('2026-08-30', [
      day(0, 'easy', 5, {}),                                    // primes day 1
      day(1, 'easy', 4, { isQuality: true }),                    // unresolvable "hard" day
      day(2, 'easy', 5, {}),                                    // primes day 3
      day(3, 'easy', 4, { isQuality: true }),                    // unresolvable "hard" day
      day(4, 'rest', 0),
      day(5, 'rest', 0),
      day(6, 'rest', 0),
    ]);
    applyRunnerVoice(plan([w]));

    const texts = [w.days[0].notes, w.days[2].notes];
    expect(new Set(texts).size, `two colliding primer days must carry two different sentences, got: ${JSON.stringify(texts)}`).toBe(2);
    for (const t of texts) expect(t.length).toBeGreaterThan(0);
    for (const specific of Object.values(PRIMER_SESSION_LINE)) {
      for (const t of texts) expect(t).not.toContain(specific);
    }
    // NOTE ON SCOPE — a documented, deliberate limit, not an oversight: a
    // THIRD day colliding on the same unresolvable type in one week would
    // exhaust this ladder's two non-specific slots (generic,
    // `PRIMER_COLLISION_FALLBACK`) and repeat the fallback. `_sentence_
    // repetition.test.ts`'s own corpus never produces more than a two-way
    // collision, and same-KNOWN-type collisions are bounded at two by
    // `tierTarget.qualityPerWeek`'s own doctrine ceiling (see
    // `PRIMER_COLLISION_FALLBACK`'s header in runner-instruction.ts) — but an
    // UNRESOLVABLE-type triple has not been proven unreachable the same way,
    // so this is named here rather than silently assumed away.
  });
});

describe('PRIMER-SPECIFIC-1 · falsification 4 · no false uniqueness, end to end', () => {
  it('reproduces the exact corpus defect shape: a tie widens to a primer collision, which now resolves distinctly', () => {
    // The exact shape TIEFIX-1 alone regresses into: two easy days tie for
    // "longest", so — correctly, post-TIEFIX-1 — neither wins `volume`, and
    // both fall through to `primer` because each precedes a hard day. Before
    // PRIMER-SPECIFIC-1 this produced the byte-identical generic line twice.
    const w = week('2026-08-30', [
      day(0, 'rest', 0),
      day(1, 'easy', 6, {}),               // tied at 6mi, primes Tue's threshold
      day(2, 'threshold', 6),
      day(3, 'easy', 6, {}),               // tied at 6mi, primes Thu's intervals
      day(4, 'intervals', 7),
      day(5, 'easy', 4, {}),
      day(6, 'rest', 0),
    ]);
    applyRunnerVoice(plan([w]));

    // Neither tied day falsely claims to be THE longest.
    expect(w.days[1].notes).not.toContain(EASY_DAY_ROLE_LINES.volume);
    expect(w.days[3].notes).not.toContain(EASY_DAY_ROLE_LINES.volume);
    // Both correctly resolve to primer, and — because their next-day types
    // differ — both get their own specific, non-identical sentence.
    expect(w.days[1].notes).toContain(PRIMER_SESSION_LINE.threshold);
    expect(w.days[3].notes).toContain(PRIMER_SESSION_LINE.intervals);
    expect(w.days[1].notes).not.toEqual(w.days[3].notes);
  });
});

describe('PRIMER-SPECIFIC-1 · falsification 5 · no sentence appears twice in one week (own check, not the byte-level gate)', () => {
  it('every sentence in a colliding week is counted at most once, read straight off the authored notes', () => {
    const w = week('2026-08-30', [
      day(0, 'rest', 0),
      day(1, 'easy', 6, {}),
      day(2, 'threshold', 6),
      day(3, 'easy', 6, {}),
      day(4, 'threshold', 6),   // same type as day 2 — forces the fallback path
      day(5, 'easy', 5, {}),
      day(6, 'rest', 0),
    ]);
    applyRunnerVoice(plan([w]));

    const perWeek = new Map<string, number>();
    for (const d of w.days) {
      for (const s of sentencesOf(d.notes)) perWeek.set(s, (perWeek.get(s) ?? 0) + 1);
    }
    const repeats = [...perWeek.entries()].filter(([, n]) => n > 1);
    expect(repeats, `repeated sentence(s) in one week: ${JSON.stringify(repeats)}`).toEqual([]);
  });
});

describe('PRIMER-SPECIFIC-1 · falsification 6 · no invented session purpose', () => {
  it('primerLineForNextSessionType never fabricates a reason for a type it does not recognise', () => {
    expect(primerLineForNextSessionType('easy')).toBeNull();
    expect(primerLineForNextSessionType('rest')).toBeNull();
    expect(primerLineForNextSessionType('shakeout')).toBeNull();
    expect(primerLineForNextSessionType(null)).toBeNull();
    expect(primerLineForNextSessionType(undefined)).toBeNull();
    expect(primerLineForNextSessionType('totally-unknown-type')).toBeNull();
  });

  it('a day before an unresolvable "hard" day never claims a session type it cannot know', () => {
    const w = week('2026-08-30', [
      day(0, 'easy', 4, {}),                // primes day 1, an unresolvable "hard" day — NOT the week's longest
      day(1, 'easy', 4, { isQuality: true }),
      day(2, 'easy', 6, {}),                // the week's actual longest, unrelated to this assertion
      day(3, 'rest', 0),
      day(4, 'rest', 0),
      day(5, 'rest', 0),
      day(6, 'rest', 0),
    ]);
    applyRunnerVoice(plan([w]));
    for (const specific of Object.values(PRIMER_SESSION_LINE)) {
      expect(w.days[0].notes).not.toContain(specific);
    }
    expect(w.days[0].notes).toContain(EASY_DAY_ROLE_LINES.primer);
  });
});

describe('PRIMER-SPECIFIC-1 · falsification 7 · deterministic, no randomness in the tie-break', () => {
  it('resolvePrimerLines gives the same answer for the same input, every time', () => {
    const candidates = [
      { key: '2026-09-01', nextType: 'threshold' },
      { key: '2026-09-03', nextType: 'threshold' },
      { key: '2026-09-05', nextType: 'intervals' },
    ];
    const runs = Array.from({ length: 5 }, () => resolvePrimerLines(candidates));
    const serialised = runs.map((m) => JSON.stringify([...m.entries()]));
    expect(new Set(serialised).size, 'resolvePrimerLines is not deterministic').toBe(1);
  });

  it('applyRunnerVoice gives byte-identical notes across two structurally identical plans', () => {
    const build = () => week('2026-08-30', [
      day(0, 'rest', 0),
      day(1, 'easy', 6, {}),
      day(2, 'threshold', 6),
      day(3, 'easy', 6, {}),
      day(4, 'threshold', 6),
      day(5, 'easy', 5, {}),
      day(6, 'rest', 0),
    ]);
    const a = build();
    const b = build();
    applyRunnerVoice(plan([a]));
    applyRunnerVoice(plan([b]));
    expect(a.days.map((d) => d.notes)).toEqual(b.days.map((d) => d.notes));
  });
});

describe('PRIMER-SPECIFIC-1 · falsification 8 · a normal single-primer week is not caught up in the collision machinery', () => {
  it('the one primer day in an otherwise unremarkable week gets a correct, non-collision line', () => {
    // Only ONE easy day in the week resolves to `primer` (the day before
    // Thursday's intervals); every other easy day is `plain` or `between`.
    // This is the majority shape in the real corpus (30 of the 11-archetype
    // corpus's 51 primer occurrences in `_sentence_repetition.test.ts` are
    // lone, non-colliding days) and the two-pass restructuring plus the
    // tie-break ladder must not perturb it: it should read exactly as
    // `resolvePrimerLines` would resolve a single candidate on its own —
    // the specific line, since the type resolves — with no fallback text
    // and no interference from the (in this case, empty) collision path.
    const w = week('2026-08-30', [
      day(0, 'rest', 0),
      day(1, 'easy', 5, {}),
      day(2, 'easy', 5, {}),               // between (yesterday's rest, no quality) → plain, not primer
      day(3, 'easy', 5, {}),               // primer: primes Thu's intervals
      day(4, 'intervals', 7),
      day(5, 'easy', 5, {}),               // between: yesterday was quality
      day(6, 'rest', 0),
    ]);
    applyRunnerVoice(plan([w]));

    expect(w.days[3].notes).toContain(PRIMER_SESSION_LINE.intervals);
    expect(w.days[3].notes).not.toContain(EASY_DAY_ROLE_LINES.primer);
    // Rerunning against a fresh, structurally identical week changes nothing.
    const w2 = week('2026-08-30', [
      day(0, 'rest', 0),
      day(1, 'easy', 5, {}),
      day(2, 'easy', 5, {}),
      day(3, 'easy', 5, {}),
      day(4, 'intervals', 7),
      day(5, 'easy', 5, {}),
      day(6, 'rest', 0),
    ]);
    applyRunnerVoice(plan([w2]));
    expect(w2.days[3].notes).toEqual(w.days[3].notes);
  });
});
