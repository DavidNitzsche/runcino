/**
 * lib/faff/_voice_live.audit.test.ts · RENDER IT (Rule 13), for the VOICE.
 *
 * Calls the REAL `GET /api/v5/today` handler against the owner's real account
 * over the read-only role, walks every string on the payload that a runner can
 * read, and runs the lexicon over them. Then prints them, so a person can read
 * the actual copy rather than trust an assertion about it.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS SEPARATELY FROM THE SHELL GATE
 *
 * `scripts/check-coach-voice.sh` scans string LITERALS. Its own header names
 * what that cannot see: "a sentence assembled at run time from fragments that
 * are individually clean". Today's "why" is precisely that — it is stitched by
 * `why-voice.ts#composeWhy` out of a thesis capacity, a plan row's note and a
 * type fact, and no literal anywhere in the repo contains the result.
 *
 * The defect this file was written for was invisible to every gate in the
 * repo for as long as it shipped. On 2026-09-02, through this route, on three
 * consecutive days:
 *
 *     "Durability is the limiter right now, and this is the session that
 *      moves it. Keep it conversational throughout."
 *
 * "Limiter" is Layer-3 taxonomy in the Layer-1 sentence, which
 * `docs/PRODUCT_UX_SIMPLIFICATION_DOCTRINE.md` forbids and the review brief
 * §4 lists by name. Worse, `_today_thesis.audit.test.ts` ASSERTED it —
 * `expect(body.why.toLowerCase()).toContain('limiter')` — so a gate was
 * requiring the defect. That is Rule 22 in one line: the test had the same
 * instinct as the code because the same reasoning wrote both.
 *
 * ── HOW THE SESSION IS SATISFIED ───────────────────────────────────────────
 *
 * `requireUserId` is the ONE thing stubbed, exactly as the sibling thesis
 * audit does it, and `DATABASE_URL` is pinned to the read-only role before
 * `lib/db/pool` is constructed. Nothing else below the auth line is mocked.
 *
 * ── WHAT THIS CANNOT FAIL ON (Rule 22) ─────────────────────────────────────
 *
 *   · IT IS NOT THE PHONE. It reads the PAYLOAD, not the SwiftUI that draws
 *     it. Two clean strings rendered one above the other are a Rule 17 defect
 *     this cannot see, and that needs the simulator.
 *   · IT IS ONE ACCOUNT AND SEVEN DAYS. Skipped entirely without
 *     `DATABASE_URL_RO`, so CI never depends on it. A state this runner is
 *     not in — injury, illness, off-season, a race day — is not exercised
 *     here at all, and `_voice_corpus.test.ts` covers those only as fixtures.
 *   · IT CHECKS WORDS, NOT TRUTH. A sentence can pass every band and be
 *     factually wrong about the run it describes.
 *   · IT ONLY WALKS THE FIELDS LISTED IN `readableStrings`. A new prose field
 *     added to the wire is invisible until someone adds it there. The count
 *     assertion below is the partial defence: it fails if the walk suddenly
 *     finds far fewer strings than it used to.
 *
 * Run with:
 *   npx vitest run lib/faff/_voice_live.audit.test.ts
 */
import { describe, it, expect, vi } from 'vitest';
import { scanLayerOne, scanPunctuation } from './coach-lexicon';

const RO = process.env.DATABASE_URL_RO;
const OWNER = '0645f40c-951d-4ccc-b86e-9979cd26c795';

/* One week of the owner's real block, chosen to span the day states this
 * account actually has: easy, quality (threshold and intervals), rest, long,
 * and the day the thesis names as addressing the limiter. */
const DATES = [
  '2026-09-01', // threshold · 4x1mi
  '2026-09-02', // easy
  '2026-09-03', // intervals · hills
  '2026-09-04', // easy
  '2026-09-05', // rest
  '2026-09-06', // long · the session the thesis addresses
  '2026-09-08', // tempo
] as const;

vi.mock('@/lib/auth/session', () => ({
  requireUserId: async () => '0645f40c-951d-4ccc-b86e-9979cd26c795',
}));

/**
 * Every string on the payload a runner reads. Field paths are explicit rather
 * than a recursive walk, because a recursive walk would also pick up ids,
 * kinds, ISO dates and wire enums and drown the finding in noise.
 */
function readableStrings(body: any): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const push = (path: string, v: unknown) => {
    if (typeof v === 'string' && v.trim()) out.push([path, v]);
  };
  push('why', body.why);
  push('paceNote.title', body.paceNote?.title);
  push('paceNote.body', body.paceNote?.body);
  push('blockNote.title', body.blockNote?.title);
  push('blockNote.body', body.blockNote?.body);
  push('panel.headline', body.panel?.headline);
  push('panel.sub', body.panel?.sub);
  push('weatherKicker', body.weatherKicker);
  push('thesis.coachLine', body.thesis?.coachLine);
  push('thesis.reviewTrigger', body.thesis?.reviewTrigger);
  for (const [i, g] of (body.groups ?? []).entries()) {
    push(`groups[${i}].title`, g?.title);
    for (const [j, s] of (g?.steps ?? []).entries()) {
      push(`groups[${i}].steps[${j}].label`, s?.label);
      push(`groups[${i}].steps[${j}].detail`, s?.detail);
    }
  }
  for (const key of ['whereYouAre', 'beforeYouGo']) {
    for (const [i, r] of (body[key] ?? []).entries()) {
      push(`${key}[${i}].label`, r?.label);
      push(`${key}[${i}].sub`, r?.sub);
    }
  }
  for (const [i, c] of (body.contingency ?? []).entries()) {
    push(`contingency[${i}].evidence`, c?.evidence);
    push(`contingency[${i}].judgement`, c?.judgement);
  }
  const rr = body.recentRun;
  if (rr) {
    push('recentRun.verdict', rr.verdict);
    for (const [i, f] of (rr.facts ?? []).entries()) push(`recentRun.facts[${i}]`, f);
    push('recentRun.win', rr.win);
  }
  return out;
}

describe.skipIf(!RO)('TODAY · the voice, on the real payload', () => {
  it('carries no prohibited language on any day of the owner’s live week', async () => {
    process.env.DATABASE_URL = RO;
    const { GET } = await import('@/app/api/v5/today/route');

    const defects: string[] = [];
    let stringsSeen = 0;

    for (const date of DATES) {
      const res = await GET(new Request(`https://faff.run/api/v5/today?date=${date}`) as never);
      const body = await res.json();
      expect(res.status, date).toBe(200);

      const strings = readableStrings(body);
      stringsSeen += strings.length;

      /* eslint-disable no-console */
      console.log(`\n══ ${date} ══ state=${body.state} · panel=${body.panel?.type ?? '-'}`);
      console.log(`  why  = ${JSON.stringify(body.why)}`);
      /* eslint-enable no-console */

      for (const [path, text] of strings) {
        for (const f of scanLayerOne(text)) {
          defects.push(`${date} ${path} · ${f.band} "${f.term}" · ${JSON.stringify(text)}`);
        }
        for (const p of scanPunctuation(text)) {
          defects.push(`${date} ${path} · ${p} · ${JSON.stringify(text)}`);
        }
      }
    }

    /* eslint-disable-next-line no-console */
    console.log(`\n  ${stringsSeen} runner-readable strings scanned across ${DATES.length} days`);

    // LIVENESS (Rule 18 point 2). The walk is a hand-written field list, so
    // the way it fails silently is by finding nothing. Seven days of a real
    // block carry well over a hundred strings; the floor is set low enough
    // that a quiet week does not trip it.
    expect(stringsSeen, 'the payload walk found almost nothing to check')
      .toBeGreaterThan(60);

    expect(defects, defects.join('\n')).toEqual([]);
  }, 240_000);

  it('the Layer-1 "why" no longer names the mechanism, and still carries the claim', async () => {
    process.env.DATABASE_URL = RO;
    const { GET } = await import('@/app/api/v5/today/route');

    // The three days the thesis speaks on. Asserted on the SHAPE OF THE
    // RESULT, not the absence of the old word (Rule 13 clause 3): the
    // sentence has to still say what the block is trying to move.
    for (const date of ['2026-09-03', '2026-09-06', '2026-09-08']) {
      const res = await GET(new Request(`https://faff.run/api/v5/today?date=${date}`) as never);
      const body = await res.json();
      expect(body.why, date).toMatch(/the thing to move right now/);
      expect(String(body.why).toLowerCase(), date).not.toContain('limiter');
      // The thesis's own structured field keeps its taxonomy — it is Layer 2
      // and Block renders it under a heading that earns the mechanism.
      expect(body.thesis.limiter, date).toBeTruthy();
    }
  }, 180_000);
});

/* The owner's uuid is referenced above so a future reader can grep it. */
void OWNER;
