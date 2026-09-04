/**
 * lib/faff/_coach_lexicon.test.ts · the shell gate and the module read the
 * SAME list, and this is what proves it.
 *
 * `scripts/check-coach-voice.sh` parses `coach-lexicon.ts` as TEXT, because it
 * runs on a cold container with no TypeScript toolchain. That is the right
 * posture — Rule 18: read the numbers out of the cited source at run time
 * rather than hardcoding both sides — but it has one failure mode, and it is
 * the worst one available: a format slip makes a band parse EMPTY, the awk
 * loop iterates over nothing, and the guard reports clean because it checked
 * nothing.
 *
 * The gate defends itself against a WHOLLY empty band (it exits 1). It cannot
 * see a PARTIALLY empty one — an entry whose `term:` uses single quotes, say,
 * would silently drop out of the list while the band still parsed non-empty.
 * This test is the check for that: it re-runs the shell's own extraction and
 * asserts term-for-term equality with the module.
 *
 * ── WHAT THIS CANNOT FAIL ON (Rule 22) ─────────────────────────────────────
 *
 *   · IT DOES NOT RUN THE GATE. It reproduces the gate's `grep`/`sed`
 *     pipeline. If someone changes the pipeline in the shell script and not
 *     here, the two drift and this test still passes. The liveness assertion
 *     below is the partial answer: it pins the extraction expressions
 *     themselves as literals read out of the shell script.
 *   · IT SAYS NOTHING ABOUT WHETHER THE TERMS ARE THE RIGHT TERMS. A band
 *     full of harmless words agrees with itself perfectly.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { COACH_LEXICON, shellBands, scanCopy, scanLayerOne, scanPunctuation } from './coach-lexicon';

const REPO = path.resolve(__dirname, '../../..');
const LEXICON_PATH = path.join(REPO, 'web-v2/lib/faff/coach-lexicon.ts');
const GATE_PATH = path.join(REPO, 'scripts/check-coach-voice.sh');

/** The shell's own extraction, reproduced. Kept byte-identical in intent to
 *  `lex_terms()` in check-coach-voice.sh. */
function shellExtract(band: string): string[] {
  const strip = `grep -vE '^[[:space:]]*(\\*|//|/\\*)' "${LEXICON_PATH}"`;
  const filter = band === 'jargon'
    ? `${strip} | grep -E "band: 'jargon'" | grep -F 'always: true'`
    : `${strip} | grep -E "band: '${band}'"`;
  const out = execFileSync('bash', ['-c', `${filter} | sed -n 's/.*term: "\\([^"]*\\)".*/\\1/p'`], {
    encoding: 'utf8',
  });
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

describe('the lexicon is one list, and the shell gate reads it', () => {
  it('every band the shell extracts matches the module, term for term', () => {
    const fromModule = shellBands();
    for (const band of Object.keys(fromModule)) {
      const shell = shellExtract(band).sort();
      const mod = [...fromModule[band]].sort();
      expect(shell, `band ${band}`).toEqual(mod);
      // A band that parsed to nothing is the silent-guard-off failure.
      expect(shell.length, `band ${band} parsed empty`).toBeGreaterThan(0);
    }
  });

  it('the gate still contains the extraction this test reproduces', () => {
    // Rule 22, the named blind spot above, narrowed: if the shell's parse
    // expression changes, this literal stops matching and the test fails
    // rather than silently agreeing with a pipeline nobody runs any more.
    const gate = readFileSync(GATE_PATH, 'utf8');
    expect(gate).toContain(`sed -n 's/.*term: "\\([^"]*\\)".*/\\1/p'`);
    expect(gate).toContain(`grep -F 'always: true'`);
    expect(gate).toContain('lex_terms hype');
    expect(gate).toContain('lex_terms macho');
  });

  it('no term is empty, upper-cased, or a regex', () => {
    for (const e of COACH_LEXICON) {
      expect(e.term.trim(), JSON.stringify(e)).toBe(e.term);
      expect(e.term).not.toBe('');
      expect(e.term, e.term).toBe(e.term.toLowerCase());
      expect(e.term, e.term).not.toMatch(/[\\^$*+?()[\]{}|]/);
      // Every entry carries a reason. "Same." is allowed and means "the entry
      // above" — a legitimate style for a run of terms that share one
      // argument — so the floor here is presence, and the substance is
      // asserted on the first entry of each band below.
      expect(e.why.trim().length, `${e.term} has no reason`).toBeGreaterThan(3);
    }
    const seen = new Set<string>();
    for (const e of COACH_LEXICON) {
      if (seen.has(e.band)) continue;
      seen.add(e.band);
      expect(e.why.trim().length, `band ${e.band} opens with no argument`).toBeGreaterThan(25);
    }
  });

  it('no term is short enough to hide inside an ordinary word', () => {
    // "atl" was dropped before this shipped because "greatly" contains it.
    // Substring matching has no word boundaries, so length is the only
    // defence and four characters is the floor that survived the audit.
    for (const e of COACH_LEXICON) {
      expect(e.term.length, `"${e.term}" is short enough to match inside a word`)
        .toBeGreaterThanOrEqual(4);
    }
    // The specific words that caught this, asserted so a future addition of
    // a three-letter term shows up as this failure and not as a mystery.
    for (const word of ['greatly', 'neatly', 'atlas', 'strictly', 'gently']) {
      expect(scanLayerOne(`The pace held ${word} through the set.`), word).toEqual([]);
    }
  });

  it('the Layer-1-only half of jargon is NOT in the shell bands', () => {
    // The split is the whole reason the jargon band exists in two halves.
    // If "limiter" ever reaches the shell list, every Layer-2 "Why?" surface
    // that legitimately names a mechanism starts failing the build.
    expect(shellBands().jargon).not.toContain('limiter');
    expect(shellBands().jargon).toContain('vdot');
    // And it IS caught in Layer 1.
    expect(scanLayerOne('Durability is the limiter right now.').map((f) => f.term))
      .toContain('limiter');
    expect(scanCopy('Durability is the limiter right now.').map((f) => f.term))
      .not.toContain('limiter');
  });

  /**
   * LEXICONWORD-1 (2026-09-04) · a banned word is a WORD.
   *
   * `scanCopy` matched by bare substring, so the owner's shoe — "Asics
   * Superblast 3", printed in `beforeYouGo[0].label` — was reported as the hype
   * term "superb". A brand name is not coach prose and no rewording satisfies
   * it, so the only ways out were deleting a real hype term or exempting a
   * whole field. Found on 2026-08-31's payload the moment the live voice audit
   * started resolving its days from the plan instead of a pinned week.
   *
   * Falsified in BOTH directions, which is the point of the pairs below: a
   * boundary loose enough to let "Superblast" through must not also stop
   * catching "crushing" or "greatest".
   */
  it('a banned term matches as a word, not as a substring', () => {
    // The defect, verbatim.
    expect(scanLayerOne('Asics Superblast 3').map((f) => f.term)).not.toContain('superb');
    // Other real proper nouns that embed a banned term.
    expect(scanLayerOne('Nike Vaporfly 3').map((f) => f.term)).toEqual([]);
    // …and the term itself is still caught, inflections included.
    expect(scanLayerOne('That was superb.').map((f) => f.term)).toContain('superb');
    expect(scanLayerOne('You ran superbly.').map((f) => f.term)).toContain('superb');
  });

  it('EVERY term still matches itself — the round trip that keeps the gate live', () => {
    /* Rule 18 point 2, and the regression this fix nearly shipped.
     *
     * `\b` only asserts a boundary beside a WORD character, so wrapping every
     * term in one would have made `"· z2"` (leading interpunct) and
     * `"send it."` (trailing full stop) permanently unmatchable. The gate would
     * not have started failing — it would have gone SILENT on two real terms,
     * which is strictly worse, because it also keeps reporting confidence.
     *
     * Nothing here is hand-listed: it walks the lexicon itself, so a term added
     * tomorrow in a shape this matcher cannot express fails immediately. */
    const unmatched = COACH_LEXICON
      .filter((e) => scanCopy(e.term, [e.band]).every((f) => f.term !== e.term))
      .map((e) => `${e.band} · ${JSON.stringify(e.term)}`);
    expect(COACH_LEXICON.length, 'the lexicon is empty — this walk proves nothing')
      .toBeGreaterThan(40);
    expect(unmatched,
      'these terms no longer match their own text, so the matcher has gone silent on them',
    ).toEqual([]);
  });

  it('inflections of a banned term are still caught', () => {
    // The other direction: a boundary loose enough to let "Superblast" through
    // must not stop catching an ordinary inflection a coach would type.
    expect(scanLayerOne('You ran superbly.').map((f) => f.term)).toContain('superb');
    // Multi-word phrases are unaffected by the boundary change.
    expect(scanLayerOne('You crushed it out there.').map((f) => f.term)).toContain('crushed it');
    expect(scanLayerOne('Keep it up.').map((f) => f.term)).toContain('keep it up');
  });

  it('punctuation: the unreadable glyph survives, prose em dashes do not', () => {
    expect(scanPunctuation('—')).toEqual([]);
    expect(scanPunctuation('Good run — nothing changes.')).toContain('em dash');
    expect(scanPunctuation('Good run.')).toEqual([]);
    expect(scanPunctuation('Good run!')).toContain('exclamation mark');
    expect(scanPunctuation('Good run 🎉')).toContain('emoji');
  });
});
