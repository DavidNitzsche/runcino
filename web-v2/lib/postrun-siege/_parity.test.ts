/**
 * lib/postrun-siege/_parity.test.ts · TWO ROUTES, ONE RUN, ONE STORY.
 *
 * `deriveRecap` is called from two places — the web recap route and the phone's
 * v5 today route — and on 2026-08-24 they were assembling its input four
 * different ways off the same row:
 *
 *   splits          the recap route dropped an array flagged `splits_unreliable`;
 *                   the phone fed it in, and `detectPaceFade` reads exactly the
 *                   timestamps that flag declares unusable. 11 canonical rows.
 *   splits, which   the phone drew the absorbed twin's array on the map and
 *                   read the canonical's in the prose. 26 of 71 merged runs.
 *   heart rate      `Number(data.avgHr)` versus `runAvgHr`, which bounds a
 *                   reading to something a heart can do.
 *   weather         the phone passed null, which is not "no weather" but "do
 *                   not look" — and the branch it silences is the one that
 *                   decides WHY the heart rate climbed. The same run told the
 *                   web it was hot and told the phone to eat earlier.
 *
 * A unit test cannot catch that: both routes were individually correct. This
 * reads the two files and checks they still ask the same questions.
 *
 * SOURCE-SCANNING, so mind the traps this repo has already been bitten by. The
 * call body is extracted by BRACE MATCHING rather than by a line regex — the
 * calls are thirty lines long and a single-line grep sees none of it — and the
 * check that a needle is present is run against the extracted body only, so a
 * doc comment elsewhere in the file cannot satisfy it.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const WEB = path.resolve(__dirname, '../..');

/** Every `fn({ ... })` call body in `src`, braces balanced, strings skipped. */
function callBodies(src: string, fn: string): string[] {
  const out: string[] = [];
  const needle = `${fn}({`;
  let from = 0;
  for (;;) {
    const at = src.indexOf(needle, from);
    if (at === -1) return out;
    let i = at + needle.length;
    let depth = 1;
    let quote: string | null = null;
    while (i < src.length && depth > 0) {
      const ch = src[i];
      const prev = src[i - 1];
      if (quote) {
        if (ch === quote && prev !== '\\') quote = null;
      } else if (ch === '"' || ch === "'" || ch === '`') {
        quote = ch;
      } else if (ch === '{') depth++;
      else if (ch === '}') depth--;
      i++;
    }
    out.push(src.slice(at, i));
    from = i;
  }
}

/** The comments carry the argument; the checks must not be satisfied by it. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

const ROUTES: Array<[string, string]> = [
  ['app/api/runs/[id]/recap/route.ts', 'the web post-run recap'],
  ['app/api/v5/today/route.ts', "the phone's after-run screen"],
];

/**
 * What both routes must be seen to do. Each entry is a field of `RecapInput`
 * and the shapes that count as reading it honestly.
 */
const PARITY: Array<{ field: string; why: string; accept: RegExp; binding?: RegExp }> = [
  {
    field: 'actualAvgHr',
    why: 'a sensor sentinel reaches prose unless the bounded reader is used',
    accept: /actualAvgHr\s*(:\s*runAvgHr\(|,)/,
    binding: /\bactualAvgHr\s*=\s*runAvgHr\(/,
  },
  {
    field: 'actualMaxHr',
    why: 'same reader, same reason',
    accept: /actualMaxHr\s*(:\s*runMaxHr\(|,)/,
    binding: /\bactualMaxHr\s*=\s*runMaxHr\(/,
  },
  {
    field: 'splits',
    why: 'an array flagged unreliable must not reach detectPaceFade',
    // Either route may name its own prepared variable; what may NOT appear is
    // `data.splits` fed in raw, which is the shape that skips the flag.
    accept: /splits:\s*(splitsForRecap|undefined)\b/,
    binding: /\bsplitsForRecap\s*=[\s\S]{0,400}?splits_unreliable/,
  },
  {
    field: 'weather',
    why: 'null here is not "no weather", it is "do not look" and it changes '
       + 'what the runner is told caused the drift',
    accept: /weather:\s*(recapWeather|weatherInput)\b/,
  },
];

describe('PARITY · the two routes that author the post-run sentence', () => {
  for (const [file, what] of ROUTES) {
    const src = stripComments(fs.readFileSync(path.join(WEB, file), 'utf8'));
    const bodies = callBodies(src, 'deriveRecap');

    it(`${what} calls deriveRecap`, () => {
      expect(bodies.length, `${file} · no deriveRecap call found`).toBeGreaterThan(0);
    });

    for (const rule of PARITY) {
      it(`${what} reads ${rule.field} honestly`, () => {
        for (const body of bodies) {
          expect(rule.accept.test(body),
            `${file} · ${rule.field}: ${rule.why}\n${body}`).toBe(true);
        }
        // A property SHORTHAND (`actualAvgHr,`) satisfies the body check
        // without naming its source, so the binding is checked in the file.
        if (rule.binding && !bodies.some((b) => new RegExp(`${rule.field}\\s*:`).test(b))) {
          expect(rule.binding.test(src),
            `${file} · ${rule.field} is passed by shorthand and is not bound to the shared reader`,
          ).toBe(true);
        }
      });
    }

    it(`${what} never hands the recap a raw data.splits`, () => {
      for (const body of bodies) {
        expect(/splits:\s*Array\.isArray\(data\.splits\)/.test(body),
          `${file} · feeding data.splits straight in skips the splits_unreliable flag`,
        ).toBe(false);
      }
    });
  }

  it('the brace matcher actually finds a multi-line call', () => {
    // A positive control for the scanner itself. The traps this repo has hit
    // are all "the check silently matched nothing and passed".
    const fake = 'const x = deriveRecap({\n  a: 1,\n  b: { c: "})" },\n});\nmore';
    const [body] = callBodies(fake, 'deriveRecap');
    expect(body).toContain('b: { c: "})" }');
    expect(callBodies('nothing here', 'deriveRecap')).toEqual([]);
  });

  it('the comment stripper does not let a doc comment satisfy a check', () => {
    const commented = stripComments('/** weather: weatherInput */\nweather: null,');
    expect(commented).not.toContain('weatherInput');
    expect(commented).toContain('weather: null');
    // A URL keeps its slashes · `//` after a colon is not a line comment.
    expect(stripComments("const u = 'https://a.example/b';")).toContain('https://a.example/b');
  });
});
