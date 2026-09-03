/**
 * lib/postrun/_detail_wire_consumed.audit.test.ts · every field the run-detail
 * response EMITS for the chart stack and the matched workout is a field the
 * phone DECODES.
 *
 * ── WHY THIS FILE EXISTS AT ALL ─────────────────────────────────────────────
 *
 * `_postrun_wire_consumed.audit.test.ts` asks this question about `wire.ts`
 * and `PostRunLearnedV5.swift`, and it was written because `coverage` shipped
 * on every post-run response, three routes wide, documented and tested, and a
 * grep for the word across every Swift file in `native-v2` returned NOTHING.
 * Six numbers, composed for the life of the wire, read by no one.
 *
 * The shapes this file watches are the next two candidates for that fate. They
 * are bigger — an eight-hundred-sample series and a comparison card — they
 * travel on a DIFFERENT payload from the one that gate watches, and they are
 * decoded in a DIFFERENT Swift file. Every one of those differences is a
 * reason the existing gate cannot see them, and none of them is a reason the
 * failure would be less likely.
 *
 * ── HOW IT DIFFERS FROM ITS SIBLING, AND WHY ────────────────────────────────
 *
 * The sibling reads `enum CodingKey` blocks. These types decode through
 * SYNTHESISED keys — there is no enum to read — so this one reads the stored
 * properties instead. That is the stronger check of the two: a `CodingKey`
 * case proves a name was mapped, a stored property proves somewhere to put it.
 *
 * ── WHAT THIS GATE CANNOT FAIL ON (Rule 22) ─────────────────────────────────
 *
 *   · IT CHECKS DECODING, NOT RENDERING. A property nothing draws passes here
 *     and looks identical to one three views read. Only a render settles it
 *     (Rule 13), and this file makes no claim about the screen.
 *   · IT IS TEXT, NOT TYPES. Interface bodies and struct bodies, by regex. A
 *     field arriving through a spread, a mapped type or an `extends` clause
 *     would be invisible to it.
 *   · IT CANNOT SEE A FIELD THAT SHOULD EXIST. A conclusion the runner needs
 *     and nothing computes is a missing feature, not a missing key.
 *   · IT DOES NOT CHECK THE ROUTE. That `app/api/runs/[id]/route.ts` actually
 *     puts these objects on the response is asserted separately below, by
 *     name, because a composer nothing calls is the same silence one rung up.
 *
 * ── THE ALLOWLIST IS A RATCHET (Rule 18 clause 4) ───────────────────────────
 *
 * It may shrink and never grow, every entry carries an argued reason, and an
 * entry whose field is now decoded FAILS until it is deleted.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO = resolve(__dirname, '../../..');

/** The composers, and the interfaces on each that reach the phone. */
const SOURCES: { file: string; interfaces: string[] }[] = [
  {
    file: 'web-v2/lib/postrun/analysis.ts',
    interfaces: ['PostRunAnalysis', 'AnalysisPoint', 'AnalysisBand', 'AnalysisElevationPoint'],
  },
  {
    file: 'web-v2/lib/postrun/matched.ts',
    interfaces: ['MatchedWorkout', 'MatchLine'],
  },
];

/**
 * Every Swift file that may decode a piece of these objects.
 *
 * A FIXED LIST, AND A MISSING FILE FAILS. A glob that silently matched nothing
 * after a rename is `check-modelled-mark.sh`'s own failure — a scanner reading
 * zero files and reporting clean, which is worse than no scanner because it
 * also reports confidence.
 */
const SWIFT_DECODERS = ['native-v2/Faff/Faff/Models/Runs.swift'];

/** The route that must actually put them on the wire. */
const ROUTE = 'web-v2/app/api/runs/[id]/route.ts';

/**
 * Fields composed on the server that the phone deliberately does not decode.
 *
 * Each is a decision, not an oversight, and each says why.
 */
const NOT_DECODED_BY_DESIGN: Record<string, string> = {
  'MatchedWorkout.runId':
    'The id of the compared run. It is carried so that opening that run from this card is a '
    + 'wiring change rather than a re-composition, and there is no such navigation route today. '
    + 'Decoding it into a property nothing can act on would be a stored value with no reader, '
    + 'which is the exact shape this gate exists to catch — so it stays undecoded and named here '
    + 'until the tap target exists.',
};

/** `export interface Foo { ... }` -> its top-level field names. */
function interfaceFields(src: string, name: string): string[] {
  const open = src.indexOf(`export interface ${name} {`);
  if (open < 0) return [];
  let depth = 0;
  let i = src.indexOf('{', open);
  const start = i;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  const clean = src.slice(start + 1, i)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  const out: string[] = [];
  let d = 0;
  for (const line of clean.split('\n')) {
    const before = d;
    for (const ch of line) { if (ch === '{') d++; else if (ch === '}') d--; }
    if (before !== 0) continue;
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\??\s*:/);
    if (m) out.push(m[1]);
  }
  return out;
}

/**
 * Every STORED property on every `Decodable` struct in a Swift file.
 *
 * A computed property carries a `{` on its declaration line and is skipped —
 * `var id: Int { index }` is not somewhere a decoder can put a value, and
 * counting it would let a field pass this gate while decoding into nothing.
 */
function swiftStoredProperties(src: string): Set<string> {
  const out = new Set<string>();
  const re = /struct\s+(\w+)\s*:[^{]*Decodable[^{]*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    let depth = 0;
    let i = src.indexOf('{', m.index);
    const start = i;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) break; }
    }
    const body = src.slice(start + 1, i)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    for (const line of body.split('\n')) {
      const p = line.match(/^\s*(?:let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*[^={]+$/);
      if (p) out.add(p[1]);
    }
    // An explicit `case a = "wireName"` still counts, for a type that has one.
    for (const c of body.matchAll(/case\s+\w+\s*=\s*"([^"]+)"/g)) out.add(c[1]);
  }
  return out;
}

function emitted(): { id: string; field: string }[] {
  const out: { id: string; field: string }[] = [];
  for (const s of SOURCES) {
    const p = resolve(REPO, s.file);
    expect(existsSync(p), `composer missing: ${s.file}`).toBe(true);
    const src = readFileSync(p, 'utf8');
    for (const iface of s.interfaces) {
      const fields = interfaceFields(src, iface);
      expect(fields.length, `${iface} in ${s.file} parsed to nothing`).toBeGreaterThan(0);
      for (const field of fields) out.push({ id: `${iface}.${field}`, field });
    }
  }
  return out;
}

function decoded(): { keys: Set<string>; filesRead: number } {
  const keys = new Set<string>();
  let filesRead = 0;
  for (const rel of SWIFT_DECODERS) {
    const p = resolve(REPO, rel);
    expect(existsSync(p), `decoder missing: ${rel}`).toBe(true);
    for (const k of swiftStoredProperties(readFileSync(p, 'utf8'))) keys.add(k);
    filesRead++;
  }
  return { keys, filesRead };
}

describe('run-detail wire · every field the server emits, the phone reads', () => {
  it('LIVENESS · it actually read both sides, and found all six shapes', () => {
    const fields = emitted();
    const { keys, filesRead } = decoded();
    // Named numbers, so a parser that quietly stops matching fails loudly
    // instead of reporting a clean scan of nothing.
    expect(filesRead).toBe(SWIFT_DECODERS.length);
    expect(fields.length).toBeGreaterThan(20);
    expect(keys.size).toBeGreaterThan(40);
    for (const iface of SOURCES.flatMap((s) => s.interfaces)) {
      expect(fields.some((f) => f.id.startsWith(`${iface}.`)), `${iface} found no fields`).toBe(true);
    }
  });

  it('no field is emitted that no Swift decoder reads', () => {
    const { keys } = decoded();
    const missing = emitted()
      .filter((f) => !keys.has(f.field))
      .filter((f) => !(f.id in NOT_DECODED_BY_DESIGN));
    expect(
      missing.map((f) => f.id),
      'These fields are composed on the run-detail response and no screen can read them. '
      + 'Either decode them, delete them from the composer, or add an argued entry to '
      + 'NOT_DECODED_BY_DESIGN.',
    ).toEqual([]);
  });

  it('RATCHET · every exemption is still needed', () => {
    const { keys } = decoded();
    const all = new Set(emitted().map((f) => f.id));
    for (const [id, reason] of Object.entries(NOT_DECODED_BY_DESIGN)) {
      const field = id.slice(id.lastIndexOf('.') + 1);
      expect(reason.length, `${id} needs an argued reason`).toBeGreaterThan(60);
      expect(all.has(id), `${id} is exempt but is no longer emitted — delete the entry`).toBe(true);
      expect(keys.has(field), `${id} is now decoded — delete the exemption`).toBe(false);
    }
  });

  it('the ROUTE actually sends them · a composer nothing calls is the same silence', () => {
    /* One rung above the field check, and the rung the sibling gate does not
     * have. `coverage` was emitted AND routed AND unread; this catches the
     * other order — decoded on the phone, never put on the response. */
    const src = readFileSync(resolve(REPO, ROUTE), 'utf8');
    expect(src).toContain('loadPostRunDetailExtras');
    expect(src).toMatch(/\banalysis,/);
    expect(src).toMatch(/matchedWorkout:/);
    expect(src).toMatch(/matchedRefusal:/);
  });

  it('the phone reads the grade-adjusted pace the server has always sent', () => {
    /* PR-12 is not a new field. `lib/coach/run-state.ts` has published
     * `grade_adjusted_pace_s_per_mi` and `terrain_label` since 2026-08-17 and
     * `RunDetailV5`'s own header said, in as many words, that the payload "does
     * not yet carry" them — which was never true. It carried them and nothing
     * decoded them, for a fortnight, silently. This is that specific case
     * pinned so it cannot regress into the same silence. */
    const swift = readFileSync(resolve(REPO, SWIFT_DECODERS[0]), 'utf8');
    expect(swift).toContain('grade_adjusted_pace_s_per_mi');
    expect(swift).toContain('terrain_label');
    const state = readFileSync(resolve(REPO, 'web-v2/lib/coach/run-state.ts'), 'utf8');
    expect(state).toContain('grade_adjusted_pace_s_per_mi');
  });
});
