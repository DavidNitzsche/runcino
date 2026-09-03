/**
 * lib/postrun/_postrun_wire_consumed.audit.test.ts · every field the post-run
 * wire EMITS is a field the phone DECODES.
 *
 * ── WHY THIS DIRECTION, AND WHY NOTHING ELSE COVERED IT ─────────────────────
 *
 * `scripts/check-wire-keys.sh` runs the other way: every key the phone decodes
 * must be a key the server writes. That catches the typo/rename class — a
 * decoder reading `date` where the server writes `date_iso` — and it is a good
 * net. It is structurally incapable of catching the opposite, which is a field
 * the server composes, documents, tests and ships, and which no screen ever
 * reads.
 *
 * That is not hypothetical. `wire.ts` has emitted `coverage` since it was
 * written, with a doc comment saying the phone can "lay out three quantities
 * against one total without parsing the sentence", and on 2026-09-02 a grep
 * for the word `coverage` across every Swift file in `native-v2` returned
 * NOTHING. Six numbers, composed on every post-run response, three routes
 * wide, read by no one. The wire-key gate passed the whole time, correctly,
 * because it was asked a different question.
 *
 * The failure mode is quiet in exactly the way Rule 11 warns about: the screen
 * draws nothing, and drawing nothing looks like a design decision.
 *
 * ── WHAT THIS GATE CANNOT FAIL ON (Rule 22) ─────────────────────────────────
 *
 *   · IT CHECKS DECODING, NOT RENDERING. A field with a `CodingKey` that no
 *     view ever draws passes here. `PostRunCoverageV5.structuredDistanceMi` is
 *     decoded and, today, only read by way of `mileTableQualifier`; a future
 *     field that is decoded into a stored property and never shown would look
 *     identical to this test. Only a render (Rule 13) settles that.
 *   · IT IS TEXT, NOT TYPES. It reads the interface bodies out of `wire.ts`
 *     and the `case` lists out of the Swift, by regex. A field added through a
 *     spread, a mapped type or an `extends` clause would be invisible.
 *   · IT CANNOT TELL YOU A FIELD SHOULD EXIST. A conclusion the runner needs
 *     and nothing computes is not a missing key; it is a missing feature, and
 *     no scan of two files can see it.
 *   · IT SAYS NOTHING ABOUT THE WATCH. The watch does not receive this object.
 *
 * ── THE ALLOWLIST IS A RATCHET (Rule 18 clause 4) ───────────────────────────
 *
 * It may shrink and never grow, every entry carries an argued reason, and an
 * entry whose field is now decoded FAILS until it is deleted. "We might need
 * it" is not a reason.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO = resolve(__dirname, '../../..');
const WIRE = resolve(REPO, 'web-v2/lib/postrun/wire.ts');

/**
 * Every Swift file that may decode a piece of this object.
 *
 * A FIXED LIST, AND MISSING FILES FAIL. A glob that silently matched nothing
 * after a rename is the `check-modelled-mark.sh` failure — a gate scanning
 * zero files and reporting clean, which is worse than no gate because it also
 * reports confidence.
 */
const SWIFT_DECODERS = [
  'native-v2/Faff/Faff/DesignV5/PostRunLearnedV5.swift',
];

/**
 * Fields on the wire that the phone deliberately does not decode.
 *
 * Each is a decision, not an oversight, and each says why.
 */
const NOT_DECODED_BY_DESIGN: Record<string, string> = {
  'PostRunWire.dateISO':
    'The phone already holds the run\'s date on the object it opened this screen from '
    + '(`RunDetail.date` on run detail, the day being viewed on Today). Decoding a second '
    + 'copy would be two names for one quantity (Rule 16), and the two could disagree on a '
    + 'run whose local date and the day the runner is looking at are not the same.',
};

/** `interface PostRunFooWire { ... }` → the field names inside it. */
function wireInterfaceFields(src: string, name: string): string[] {
  const open = src.indexOf(`export interface ${name} {`);
  if (open < 0) return [];
  let depth = 0;
  let i = src.indexOf('{', open);
  const start = i;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  const body = src.slice(start + 1, i);
  // Strip block and line comments so a field NAMED in prose is not counted.
  const clean = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const out: string[] = [];
  // Top-level members only: a nested object literal's members belong to it.
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

/** Every `case a, b, c` inside every `enum K: String, CodingKey { … }`. */
function swiftCodingKeys(src: string): Set<string> {
  const keys = new Set<string>();
  const re = /enum\s+\w+\s*:\s*String\s*,\s*CodingKey\s*\{([\s\S]*?)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const body = m[1].replace(/\/\/[^\n]*/g, '');
    for (const line of body.split('\n')) {
      const c = line.match(/^\s*case\s+(.+)$/);
      if (!c) continue;
      for (const raw of c[1].split(',')) {
        // `case foo = "bar"` decodes the WIRE name `bar`, not `foo`.
        const eq = raw.match(/^\s*\w+\s*=\s*"([^"]+)"/);
        if (eq) { keys.add(eq[1]); continue; }
        const bare = raw.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)$/);
        if (bare) keys.add(bare[1]);
      }
    }
  }
  return keys;
}

function loadWire(): string {
  expect(existsSync(WIRE), `wire.ts not found at ${WIRE}`).toBe(true);
  return readFileSync(WIRE, 'utf8');
}

function loadSwift(): { decoded: Set<string>; filesRead: number } {
  const decoded = new Set<string>();
  let filesRead = 0;
  for (const rel of SWIFT_DECODERS) {
    const p = resolve(REPO, rel);
    expect(existsSync(p), `post-run decoder missing: ${rel}`).toBe(true);
    for (const k of swiftCodingKeys(readFileSync(p, 'utf8'))) decoded.add(k);
    filesRead++;
  }
  return { decoded, filesRead };
}

/** Every emitted field, as `Interface.field`. */
function emitted(src: string): { iface: string; field: string }[] {
  const ifaces = ['PostRunWire', 'PostRunStridesWire', 'PostRunStrideWire'];
  const out: { iface: string; field: string }[] = [];
  for (const iface of ifaces) {
    for (const field of wireInterfaceFields(src, iface)) out.push({ iface, field });
  }
  // `coverage` is an inline object literal on `PostRunWire`, not its own
  // interface, so its members are pulled straight out of the declaration.
  const cov = src.match(/coverage:\s*\{([\s\S]*?)\n {2}\};/);
  if (cov) {
    for (const line of cov[1].split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\??\s*:/);
      if (m) out.push({ iface: 'PostRunWire.coverage', field: m[1] });
    }
  }
  return out;
}

describe('post-run wire · every field the server emits, the phone reads', () => {
  it('LIVENESS · it actually read both sides', () => {
    const src = loadWire();
    const { decoded, filesRead } = loadSwift();
    const fields = emitted(src);
    // Named numbers, so a parser that quietly stops matching fails loudly
    // instead of reporting a clean scan of nothing.
    expect(filesRead).toBe(SWIFT_DECODERS.length);
    expect(fields.length).toBeGreaterThan(20);
    expect(decoded.size).toBeGreaterThan(20);
    // And the parsers found the three shapes, not just the top-level one.
    expect(fields.some((f) => f.iface === 'PostRunStrideWire')).toBe(true);
    expect(fields.some((f) => f.iface === 'PostRunWire.coverage')).toBe(true);
  });

  it('no field is emitted that no Swift decoder reads', () => {
    const src = loadWire();
    const { decoded } = loadSwift();
    const missing = emitted(src)
      .map((f) => ({ ...f, id: `${f.iface}.${f.field}` }))
      .filter((f) => !decoded.has(f.field))
      .filter((f) => !(f.id in NOT_DECODED_BY_DESIGN));
    expect(
      missing.map((f) => f.id),
      'These fields are composed on every post-run response and no screen can read them. '
      + 'Either decode them, delete them from the wire, or add an argued entry to '
      + 'NOT_DECODED_BY_DESIGN.',
    ).toEqual([]);
  });

  it('RATCHET · every exemption is still needed', () => {
    const src = loadWire();
    const { decoded } = loadSwift();
    const all = new Set(emitted(src).map((f) => `${f.iface}.${f.field}`));
    for (const [id, reason] of Object.entries(NOT_DECODED_BY_DESIGN)) {
      const field = id.slice(id.lastIndexOf('.') + 1);
      // A reason, not a shrug.
      expect(reason.length, `${id} needs an argued reason`).toBeGreaterThan(60);
      // The field must still exist on the wire...
      expect(all.has(id), `${id} is exempt but is no longer emitted — delete the entry`).toBe(true);
      // ...and must still be undecoded. An exemption over a field the phone
      // now reads is stale, and a stale allowlist is how a gate stops meaning
      // anything.
      expect(decoded.has(field), `${id} is now decoded — delete the exemption`).toBe(false);
    }
  });

  it('the coverage block specifically — the field this gate was written for', () => {
    const src = loadWire();
    const { decoded } = loadSwift();
    // `coverage` was emitted and unread for the whole life of the wire. It is
    // named here so a regression is a failure with the right sentence on it
    // rather than one entry in a list.
    expect(src).toContain('coverage: {');
    for (const k of ['totalDistanceMi', 'structuredDistanceMi', 'overtimeDistanceMi',
                     'overtimeDurationSec', 'splitCount', 'splitDistanceMi']) {
      expect(decoded.has(k), `coverage.${k} is emitted and not decoded`).toBe(true);
    }
    expect(decoded.has('coverage')).toBe(true);
  });
});
