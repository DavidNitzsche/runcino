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

/* THE DAYS ARE RESOLVED BY ROLE, NOT PINNED — see `_live_plan_dates.ts`.
 *
 * This was a hard-coded week with `'2026-09-06', // long · the session the
 * thesis addresses` in it. True on 2026-09-02, when this file was written. On
 * 09-03 the owner moved his week by hand around travel, the long run went to
 * 09-04, and 09-06 became a 7.5 mi easy day — so the second test below demanded
 * the thesis opener on a day the engine is CORRECTLY silent on, and failed
 * against working code. It failed only where DATABASE_URL_RO is set, which is
 * nowhere in CI, so nothing reported it.
 *
 * "Chosen to span the day states this account actually has" is the real intent
 * and it is now computed, so a plan rebuild stops breaking a voice audit. */

/** Days spanning the account's states, and the days the thesis speaks on. */
async function liveDates(): Promise<{ spanning: string[]; thesisDays: string[] }> {
  const { runnerToday } = await import('@/lib/runtime/runner-tz');
  const { livePlanDays, thesisRoleDates, spanningStateDates } = await import('./_live_plan_dates');
  const anchor = await runnerToday(OWNER);
  const shift = (iso: string, n: number): string => {
    const d = new Date(`${iso}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const days = await livePlanDays(OWNER, shift(anchor, -4), shift(anchor, 10));
  const roles = thesisRoleDates(days);
  return {
    spanning: spanningStateDates(days),
    thesisDays: [...roles.quality, ...(roles.long ? [roles.long] : [])].sort(),
  };
}

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

    const { spanning } = await liveDates();
    expect(spanning.length, 'the active plan window yielded no days to audit').toBeGreaterThan(2);
    // eslint-disable-next-line no-console
    console.log(`\n[voice-live] spanning days = ${spanning.join(', ')}`);

    for (const date of spanning) {
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
    console.log(`\n  ${stringsSeen} runner-readable strings scanned across ${spanning.length} days`);

    // LIVENESS (Rule 18 point 2). The walk is a hand-written field list, so
    // the way it fails silently is by finding nothing. Measured 2026-09-02 on
    // the owner's account: 64 strings across these seven days, six of them
    // pre-run and one after-run. The floor sits well under that — a week with
    // no completed run, no contingency rules and no weather loses most of the
    // optional fields at once, and this must fail on "the walk broke", not on
    // "the runner had a quiet week".
    expect(stringsSeen, 'the payload walk found almost nothing to check')
      .toBeGreaterThan(35);

    expect(defects, defects.join('\n')).toEqual([]);
  }, 240_000);

  it('the Layer-1 "why" no longer names the mechanism, and still carries the claim', async () => {
    process.env.DATABASE_URL = RO;
    const { GET } = await import('@/app/api/v5/today/route');

    // The days the thesis speaks on — the quality days and the long run,
    // resolved from the live plan rather than named. Asserted on the SHAPE OF
    // THE RESULT, not the absence of the old word (Rule 13 clause 3): the
    // sentence has to still say what the block is trying to move.
    const { thesisDays } = await liveDates();
    expect(thesisDays.length, 'no quality or long day in the active plan window')
      .toBeGreaterThanOrEqual(2);
    // eslint-disable-next-line no-console
    console.log(`\n[voice-live] thesis days = ${thesisDays.join(', ')}`);
    for (const date of thesisDays) {
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
