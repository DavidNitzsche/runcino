/**
 * lib/plan/_sentence_repetition.test.ts · SENTENCEREP-1 (2026-09-03)
 *
 * RULE 17, MEASURED. The runner reads a sentence once.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * The owner, on his own composed fourteen-week block: remove the shorthand,
 * "replace them with direct running instructions that tell me what to do".
 * RUNNERLANG-1 did that — and it replaced the WORDS while leaving the
 * REPETITION exactly where it was. Counted on a freshly composed block the day
 * after that change shipped:
 *
 *      before                                   after RUNNERLANG-1
 *   33 conversational.                       33 easy enough to talk in full sentences.
 *   33 z2 hr cap.                            33 if the heart rate drifts up, slow down …
 *   28 off.                                  28 off.
 *   27 sleep, mobility, fuel.                27 sleep, mobility, fuel.
 *
 * Thirty-three rows carrying one sentence became thirty-three rows carrying a
 * longer one. Nothing in the repository could tell, because nothing counted:
 * `check-coach-voice.sh` grades WORDS, `_block_says_it_once.test.ts` watches
 * ONE PAIR of strings on the Block screen, and the substitution table in
 * `runner-instruction.ts` sees one string at a time by construction.
 *
 * That is Rule 20 exactly — "a product rule with no gate is a hypothesis" —
 * and Rule 20's own corollary about what to do next: fix the gate, not just
 * the instance, because the instance is one block and the gap is still open
 * the moment you have rewritten it.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 *
 * A runner-facing sentence appears on at most ONE row of any one week.
 *
 * The week is the unit because the week is the SCREEN: the plan surface draws
 * a week at a time, and the design contract's standing rule is that no content
 * is printed twice on one screen. It is also the unit that does not punish a
 * legitimate role line — "recovery day after the long run" is true of one row
 * a week for fourteen weeks and is a fact about that row every time, where the
 * same sentence on three rows of one week is a fact about none of them.
 *
 * The check reads the RENDERED text, not the authored literal, and not a row
 * id — `stripResearchCitations` then `renderRunnerInstruction`, which is what
 * `week-loader.ts` hands the phone. Rule 17 is explicit about that: "it yields
 * on the rendered text, because that is what the runner actually sees."
 *
 * ── WHAT THIS GATE CANNOT FAIL ON (Rule 22) ─────────────────────────────────
 *
 *   · TWO SENTENCES THAT SAY THE SAME THING IN DIFFERENT WORDS. The comparison
 *     is normalised text. A composer that paraphrased itself onto six rows
 *     would pass clean, and the reviewer's eye is still the only thing that
 *     catches it.
 *   · REPETITION ACROSS WEEKS. By design: a sentence on one row a week for
 *     fourteen weeks is what a role line looks like. So a genuinely
 *     block-level sentence that happens to fall once per week is invisible
 *     here. `BLOCK_STANDING_SENTENCES` is the list that retires those, and it
 *     is maintained by hand.
 *   · ANYTHING OUTSIDE `notes`. Sub-labels, pace strings, HR rows and the
 *     phase copy on the Block screen are not read. `notes` is where the
 *     defect was and where the prose is.
 *   · A RUNNER THE CORPUS CANNOT EXPRESS (Rule 15). `buildSimPlan` is the
 *     onboarding-shaped path: no injury builder, no embedded tune-up, no
 *     mid-block rebuild. Copy that only those paths author is unreached, and
 *     the liveness block below states how much IS reached rather than
 *     implying the whole engine.
 *   · WHETHER THE SURVIVING SENTENCE IS GOOD COACHING. It counts. The words
 *     were reviewed by hand.
 */
import { describe, it, expect } from 'vitest';
import { buildSimPlan } from './sim-inputs';
import {
  renderRunnerInstruction,
  BLOCK_STANDING_SENTENCES,
  EASY_DAY_ROLE_LINES,
  easyDayRole,
  type EasyDayRole,
} from './runner-instruction';
import * as voiceModule from './runner-instruction';
import { stripResearchCitations } from './strip-citations';
import { scanLayerOne, scanPunctuation } from '@/lib/faff/coach-lexicon';
import { SENTENCE_REPEAT_EXEMPTIONS } from '@/lib/audit/sentence-repetition-registry';

// ── the corpus ───────────────────────────────────────────────────────────────
//
// Spread across the axes that change how a week is SHAPED, because the defect
// is a property of the week's shape: how many easy days there are, whether
// they sit next to a session, and how many rest days a week holds. Named
// individually rather than swept combinatorially — this gate has to be fast
// enough to sit in `prebuild`, and the shapes below already cover 2-to-6 run
// days, four distances and three experience rungs.

interface Case {
  tag: string;
  distance: string;
  experienceLevel: string;
  weeklyFrequency: number;
  weeklyMileageBucket: number;
  longestRunBucket: string;
  goalTimeSec: number;
  raceDateISO: string;
  longRunDay: string;
  restDay: string;
}

const CASES: Case[] = [
  // The owner's own block shape, which is the one the defect was measured on.
  { tag: 'marathon/advanced/45/6d', distance: 'marathon', experienceLevel: 'advanced', weeklyFrequency: 6, weeklyMileageBucket: 45, longestRunBucket: '10+', goalTimeSec: 3 * 3600, raceDateISO: '2026-12-06', longRunDay: 'sun', restDay: 'sat' },
  { tag: 'marathon/intermediate/35/5d', distance: 'marathon', experienceLevel: 'intermediate', weeklyFrequency: 5, weeklyMileageBucket: 35, longestRunBucket: '10+', goalTimeSec: 4 * 3600, raceDateISO: '2026-12-06', longRunDay: 'sat', restDay: 'mon' },
  { tag: 'marathon/beginner/25/4d', distance: 'marathon', experienceLevel: 'beginner', weeklyFrequency: 4, weeklyMileageBucket: 25, longestRunBucket: '6-10', goalTimeSec: 5 * 3600, raceDateISO: '2027-01-10', longRunDay: 'sun', restDay: 'fri' },
  { tag: 'half/advanced/45/6d', distance: 'half', experienceLevel: 'advanced', weeklyFrequency: 6, weeklyMileageBucket: 45, longestRunBucket: '10+', goalTimeSec: 5100, raceDateISO: '2026-11-22', longRunDay: 'sun', restDay: 'sat' },
  { tag: 'half/intermediate/25/5d', distance: 'half', experienceLevel: 'intermediate', weeklyFrequency: 5, weeklyMileageBucket: 25, longestRunBucket: '6-10', goalTimeSec: 5400, raceDateISO: '2026-11-15', longRunDay: 'sun', restDay: 'sat' },
  { tag: 'half/beginner/15/3d', distance: 'half', experienceLevel: 'beginner', weeklyFrequency: 3, weeklyMileageBucket: 15, longestRunBucket: '6-10', goalTimeSec: 8100, raceDateISO: '2026-12-13', longRunDay: 'sat', restDay: 'sun' },
  { tag: '10k/advanced/35/6d', distance: '10k', experienceLevel: 'advanced', weeklyFrequency: 6, weeklyMileageBucket: 35, longestRunBucket: '10+', goalTimeSec: 2100, raceDateISO: '2026-11-01', longRunDay: 'sun', restDay: 'mon' },
  { tag: '10k/beginner/15/4d', distance: '10k', experienceLevel: 'beginner', weeklyFrequency: 4, weeklyMileageBucket: 15, longestRunBucket: '3-6', goalTimeSec: 3000, raceDateISO: '2026-11-01', longRunDay: 'sun', restDay: 'sat' },
  { tag: '5k/advanced/35/6d', distance: '5k', experienceLevel: 'advanced', weeklyFrequency: 6, weeklyMileageBucket: 35, longestRunBucket: '10+', goalTimeSec: 1080, raceDateISO: '2026-10-25', longRunDay: 'sun', restDay: 'sat' },
  { tag: '5k/intermediate/25/5d', distance: '5k', experienceLevel: 'intermediate', weeklyFrequency: 5, weeklyMileageBucket: 25, longestRunBucket: '6-10', goalTimeSec: 1500, raceDateISO: '2026-10-18', longRunDay: 'sat', restDay: 'sun' },
  { tag: '5k/beginner/15/2d', distance: '5k', experienceLevel: 'beginner', weeklyFrequency: 2, weeklyMileageBucket: 15, longestRunBucket: '3-6', goalTimeSec: 1800, raceDateISO: '2026-10-18', longRunDay: 'sun', restDay: 'mon' },
];

/** The sentence as the runner reads it, lower-cased and space-collapsed. */
function normalise(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Split a note into sentences. Deliberately crude: a full stop followed by
 * whitespace. The alternative is a sentence tokeniser, and a tokeniser that
 * disagrees with the eye about where a sentence ends would make the counts
 * argue with what the runner sees.
 */
function sentencesOf(note: string): string[] {
  const rendered = renderRunnerInstruction(stripResearchCitations(note)) ?? '';
  return rendered
    .split(/(?<=\.)\s+/)
    .map(normalise)
    .filter((s) => s.length > 0);
}

function exemptionFor(sentence: string) {
  return SENTENCE_REPEAT_EXEMPTIONS.find((e) => e.pattern.test(sentence)) ?? null;
}

interface Finding {
  block: string;
  weekIdx: number;
  sentence: string;
  rows: number;
}

interface Reading {
  findings: Finding[];
  exempted: Finding[];
  blocks: number;
  rows: number;
  sentences: number;
  refusals: string[];
}

/**
 * Compose every case and count, per week, how many rows carry each sentence.
 *
 * `mutate` lets the falsification tests below re-run the same reading over a
 * deliberately corrupted plan, so the gate is exercised against a block that
 * HAS the defect rather than only against one that does not (Rule 18.1).
 */
function readCorpus(mutate?: (note: string, ctx: { weekIdx: number; dow: number; type: string }) => string): Reading {
  const findings: Finding[] = [];
  const exempted: Finding[] = [];
  const refusals: string[] = [];
  let blocks = 0;
  let rows = 0;
  let sentences = 0;

  for (const c of CASES) {
    const built = buildSimPlan({
      goalMode: 'race',
      distance: c.distance,
      experienceLevel: c.experienceLevel,
      weeklyFrequency: c.weeklyFrequency,
      weeklyMileageBucket: c.weeklyMileageBucket,
      longestRunBucket: c.longestRunBucket,
      longRunDay: c.longRunDay,
      restDay: c.restDay,
      startDateISO: '2026-08-31',
      raceDateISO: c.raceDateISO,
      goalTimeSec: c.goalTimeSec,
      planWeeks: 0,
      lastRaceFinishedDaysAgo: 0,
      lastRaceDistance: null,
      raceHistory: [],
      availableDays: [],
      // `SimInputs` is the simulator's own onboarding-answer shape; the cast is
      // what every other sweep in this directory uses for the same reason.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    // Rule 11 · a block that could not be composed is a REFUSAL, not a clean
    // block. Counting it as zero findings is how a gate reports confidence
    // about a corpus it never read.
    if (!built.ok) { refusals.push(`${c.tag}: ${built.reason}`); continue; }
    blocks++;

    built.composed.weeks.forEach((w, weekIdx) => {
      const perWeek = new Map<string, number>();
      for (const d of w.days) {
        const raw = (d as unknown as { notes?: string }).notes;
        if (!raw) continue;
        rows++;
        const note = mutate ? mutate(raw, { weekIdx, dow: d.dow, type: d.type }) : raw;
        for (const s of sentencesOf(note)) {
          sentences++;
          perWeek.set(s, (perWeek.get(s) ?? 0) + 1);
        }
      }
      for (const [sentence, n] of perWeek) {
        if (n <= 1) continue;
        const f: Finding = { block: c.tag, weekIdx, sentence, rows: n };
        if (exemptionFor(sentence)) exempted.push(f); else findings.push(f);
      }
    });
  }
  return { findings, exempted, blocks, rows, sentences, refusals };
}

const READING = readCorpus();

describe('SENTENCEREP-1 · liveness (Rule 18.2)', () => {
  it('states what it read, and fails on nothing', () => {
    // Two gates in this repo have shipped green because they scanned zero
    // files. A scanner that reports clean over an empty corpus reports
    // CONFIDENCE over nothing, which is the worst outcome available.
    process.stderr.write(
      `SENTENCEREP-1 · ${READING.blocks}/${CASES.length} blocks composed · `
      + `${READING.rows} rows read · ${READING.sentences} sentences read · `
      + `${READING.findings.length} findings · ${READING.exempted.length} exempted\n`,
    );
    expect(READING.blocks, 'no block composed · the corpus is dead').toBeGreaterThan(0);
    expect(READING.rows, 'no row carried notes · the reader is looking at the wrong field').toBeGreaterThan(100);
    expect(READING.sentences, 'no sentence parsed · the splitter is dead').toBeGreaterThan(200);
  });

  it('every case in the corpus composes', () => {
    // A case that stops composing silently shrinks the corpus. Rule 11: a
    // refusal is a fact, and it is not the same fact as "clean".
    expect(READING.refusals, `blocks refused to compose:\n${READING.refusals.join('\n')}`).toEqual([]);
  });
});

describe('SENTENCEREP-1 · the runner reads a sentence once (Rule 17)', () => {
  it('no sentence appears on two rows of one week', () => {
    const worst = [...READING.findings].sort((a, b) => b.rows - a.rows).slice(0, 20);
    const detail = worst
      .map((f) => `  ${f.block} week ${f.weekIdx + 1} · ${f.rows}x · "${f.sentence}"`)
      .join('\n');
    expect(
      READING.findings.length,
      'RULE 17 · a sentence is printed more than once in one week.\n'
      + 'The week is the screen. If it is true of every row of its kind, it belongs to the\n'
      + 'block: add it to BLOCK_STANDING_SENTENCES in lib/plan/runner-instruction.ts and it\n'
      + 'will be said once. If it is true of THIS row, say what makes this row different.\n'
      + 'If it is a PRESCRIPTION the row cannot lose, argue it into\n'
      + 'lib/audit/sentence-repetition-registry.ts. Do not widen the rule.\n'
      + `${READING.findings.length} finding(s), worst first:\n${detail}`,
    ).toBe(0);
  });
});

describe('SENTENCEREP-1 · the exemption ratchet (Rule 18.4)', () => {
  it('every exemption is argued', () => {
    for (const e of SENTENCE_REPEAT_EXEMPTIONS) {
      expect(e.reason.length, `${e.id} has no argued reason`).toBeGreaterThan(80);
      expect(e.pattern.source.startsWith('^'), `${e.id} is not anchored at the start`).toBe(true);
      expect(e.pattern.source.endsWith('$'), `${e.id} is not anchored at the end`).toBe(true);
    }
  });

  it('every exemption still matches a real finding, or it is stale and must be deleted', () => {
    const live = new Set(READING.exempted.map((f) => exemptionFor(f.sentence)?.id).filter(Boolean));
    const stale = SENTENCE_REPEAT_EXEMPTIONS.filter((e) => !live.has(e.id)).map((e) => e.id);
    expect(
      stale,
      'STALE EXEMPTION · the repetition it forgave is gone. Delete the entry.\n'
      + 'An allowlist is a ratchet: it may shrink and may never quietly hold an entry\n'
      + 'that no longer names anything.',
    ).toEqual([]);
  });

  it('an exemption cannot forgive a sentence outside its own shape', () => {
    // Rule 18.3 · the exemption must be guarded by the violating condition, not
    // sit above the assertion. Falsified here rather than asserted in prose:
    // the two live patterns must NOT match the sentence this whole gate exists
    // for, or granting them would have switched the check off.
    const theDefect = 'easy enough to talk in full sentences.';
    expect(exemptionFor(theDefect)).toBeNull();
    expect(exemptionFor('if the heart rate drifts up, slow down even when the pace still looks right.')).toBeNull();
    expect(exemptionFor('off.')).toBeNull();
  });
});

describe('SENTENCEREP-1 · the copy in the module check-coach-voice cannot see', () => {
  /**
   * `check-coach-voice.sh` EXCLUDES `lib/plan/runner-instruction.ts` from its
   * scan, because that file's `find:` regexes necessarily spell out the very
   * phrases guard 7 forbids — scanning it would report the cure as the disease.
   *
   * RUNNERLANG-1 paid for that exclusion by scanning the `to` column in
   * `_runner_instruction.test.ts`. RUNNERLANG-2 then put TWO MORE TABLES OF
   * RUNNER-FACING COPY in the same unscanned file, and the payment did not
   * follow them. Falsified before this block was written: a role line rewritten
   * as "Short and easy — the session is tomorrow! Great work." — an em dash, an
   * exclamation mark and hype, three of guard four's five bans in eleven words —
   * left `check-coach-voice.sh` reporting "324 user-facing source file(s)
   * clean".
   *
   * That is Rule 20's own shape: a gate whose named cost stopped being paid the
   * moment the file grew a second job. This block is the payment, extended to
   * every string a runner can reach in that module.
   */
  const RUNNER_FACING = [
    ...voiceModule.BLOCK_STANDING_SENTENCES.map((s) => s.text),
    ...Object.values(voiceModule.EASY_DAY_ROLE_LINES).filter((s) => s.length > 0),
  ];

  it('every standing sentence and role line is clean by the lexicon', () => {
    expect(RUNNER_FACING.length, 'nothing scanned · the tables moved and this block went blind').toBeGreaterThan(15);
    for (const s of RUNNER_FACING) {
      expect(scanLayerOne(s), s).toEqual([]);
      expect(scanPunctuation(s), s).toEqual([]);
    }
  });

  it('the module exports nothing else that could hide runner copy', () => {
    // A ratchet on the file's surface. A new table of copy in this module has
    // to update this pin, and updating it is where the author reads the block
    // above and adds the new strings to RUNNER_FACING.
    expect(Object.keys(voiceModule).sort()).toEqual([
      'BLOCK_STANDING_SENTENCES',
      'BlockScopedSpeaker',
      'EASY_DAY_ROLE_LINES',
      'INSTRUCTION_REWRITES',
      'easyDayRole',
      'renderRunnerInstruction',
    ].sort());
  });
});

describe('SENTENCEREP-1 · the distribution, not just the count (Rule 22)', () => {
  it('every easy-day role fires somewhere in the corpus', () => {
    // Rule 22 · "a verdict no case can reach is decoration." The first draft
    // of `easyDayRole` put `primer` above `recovery`, and because the day
    // after the long run is almost always also the day before a session,
    // `recovery` fired ZERO times across a whole fourteen-week block while
    // every count looked healthy. Nothing but a per-verdict count could see
    // it.
    const counts: Record<string, number> = {};
    for (const c of CASES) {
      const built = buildSimPlan({
        goalMode: 'race', distance: c.distance, experienceLevel: c.experienceLevel,
        weeklyFrequency: c.weeklyFrequency, weeklyMileageBucket: c.weeklyMileageBucket,
        longestRunBucket: c.longestRunBucket, longRunDay: c.longRunDay, restDay: c.restDay,
        startDateISO: '2026-08-31', raceDateISO: c.raceDateISO, goalTimeSec: c.goalTimeSec,
        planWeeks: 0, lastRaceFinishedDaysAgo: 0, lastRaceDistance: null,
        raceHistory: [], availableDays: [],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      if (!built.ok) continue;
      for (const w of built.composed.weeks) {
        for (const d of w.days) {
          const note = (d as unknown as { notes?: string }).notes ?? '';
          for (const [role, line] of Object.entries(EASY_DAY_ROLE_LINES)) {
            if (line.length > 0 && note.includes(line)) counts[role] = (counts[role] ?? 0) + 1;
          }
        }
      }
    }
    process.stderr.write(`SENTENCEREP-1 · role distribution ${JSON.stringify(counts)}\n`);
    for (const role of Object.keys(EASY_DAY_ROLE_LINES) as EasyDayRole[]) {
      if (EASY_DAY_ROLE_LINES[role].length === 0) continue; // `plain` says nothing by design
      expect(counts[role] ?? 0, `role "${role}" never fires · it is decoration, or the priority order buries it`).toBeGreaterThan(0);
    }
  });

  it('the role classifier is total and its priority is the measured one', () => {
    // Falsifies the ordering directly rather than trusting the corpus to hit
    // it: the sandwiched day (after the long run AND before a session) must
    // resolve to `recovery`.
    expect(easyDayRole({ isLongestEasyOfWeek: false, nextIsHard: true, prevWasLong: true, prevWasQuality: false }))
      .toBe<EasyDayRole>('recovery');
    expect(easyDayRole({ isLongestEasyOfWeek: true, nextIsHard: true, prevWasLong: true, prevWasQuality: true }))
      .toBe<EasyDayRole>('volume');
    expect(easyDayRole({ isLongestEasyOfWeek: false, nextIsHard: false, prevWasLong: false, prevWasQuality: false }))
      .toBe<EasyDayRole>('plain');
  });

  it('no standing sentence spans more than one sentence', () => {
    // The pass matches whole sentences and rebuilds the note from what
    // survives. A two-sentence entry could be half-consumed by another entry
    // and leave "Cruise intervals.3." behind, which is the citation scrub's
    // failure and the reason this is asserted rather than commented.
    for (const s of BLOCK_STANDING_SENTENCES) {
      expect(s.text.split(/(?<=\.)\s+/).length, `"${s.text}" is more than one sentence`).toBe(1);
      expect(s.text.trim().endsWith('.'), `"${s.text}" does not end a sentence`).toBe(true);
    }
    const ids = BLOCK_STANDING_SENTENCES.map((s) => s.id);
    expect(new Set(ids).size, 'two standing entries share an id · one would silence the other').toBe(ids.length);
    const texts = BLOCK_STANDING_SENTENCES.map((s) => s.text);
    expect(new Set(texts).size, 'two standing entries share a text').toBe(texts.length);
  });
});

describe('SENTENCEREP-1 · falsification (Rule 18.1)', () => {
  it('fails when the retired sentence is put back on every easy row', () => {
    // The defect, reconstructed: RUNNERLANG-1's replacement on every easy day,
    // which is exactly the state `main` was in before SENTENCEREP-1 landed.
    const seeded = readCorpus((note, ctx) =>
      ctx.type === 'easy'
        ? 'Easy enough to talk in full sentences. If the heart rate drifts up, slow down even when the pace still looks right.'
        : note);
    expect(seeded.findings.length, 'the gate cannot see the defect it was written for').toBeGreaterThan(0);
    expect(seeded.findings.some((f) => f.sentence === 'easy enough to talk in full sentences.')).toBe(true);
  });

  it('fails on the ORIGINAL shorthand too, not only on its replacement', () => {
    // `renderRunnerInstruction` rewrites "Conversational. Z2 HR cap." at read
    // time, so a block still carrying the pre-RUNNERLANG-1 literal reaches this
    // gate as the replacement. It must still be counted: a plan authored months
    // ago and read today is the case the runner actually has.
    const seeded = readCorpus((note, ctx) =>
      ctx.type === 'easy' ? 'Conversational. Z2 HR cap.' : note);
    expect(seeded.findings.length).toBeGreaterThan(0);
  });

  it('does NOT fire on a block whose easy rows each say something different', () => {
    // Rule 22 · the opposite verdict. A gate that only ever says "too much
    // repetition" would pass an engine that says nothing at all, and would also
    // pass one that says everything twice if the corpus were empty.
    let n = 0;
    const varied = readCorpus((note, ctx) =>
      ctx.type === 'easy' ? `Distinct instruction number ${n++} for dow ${ctx.dow}.` : note);
    expect(varied.findings.filter((f) => f.sentence.startsWith('distinct instruction'))).toEqual([]);
  });
});
