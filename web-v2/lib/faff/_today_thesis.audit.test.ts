/**
 * lib/faff/_today_thesis.audit.test.ts · RENDER IT (Rule 13).
 *
 * Calls the REAL `GET /api/v5/today` handler against the owner's real account
 * over the read-only role and prints the "why this run" block and the `thesis`
 * payload for the two quality days the wiring was written for: 2026-09-03
 * (10x60s hills, an intervals day that does NOT address the limiter) and
 * 2026-09-08 (continuous tempo, a day that does).
 *
 * NOT A FIXTURE, which is the whole point — Rule 13's second clause is that a
 * sample payload skips the exact code paths that break. The route's own
 * `composeWhy` call, its `thesisLeadClause` / `coachSafeSessionName` gating,
 * `resolveCoachingThesis` against real capacity resolvers, and
 * `composeV5Today`'s wire assembly all run here.
 *
 * HOW THE SESSION IS SATISFIED, stated rather than hidden: `requireUserId` is
 * the ONE thing stubbed, because a real session needs a `sessions` row and
 * this audit is read-only by construction (`DATABASE_URL` is pinned to the
 * read-only role before `lib/db/pool` is constructed, exactly as the
 * capacity-resolver and coaching-thesis audits do it). Nothing else in the
 * route is mocked: every query, every resolver and every composer below the
 * auth line runs against the owner's real rows.
 *
 * That stub is also this file's biggest limitation, and it is named here
 * rather than discovered later — a change that broke authentication on this
 * route would not show up in a green run.
 *
 * ── WHAT THIS CANNOT FAIL ON (Rule 22) ─────────────────────────────────────
 *
 *   · IT IS NOT THE PHONE. It renders the PAYLOAD the phone decodes, not the
 *     SwiftUI view that draws it. A Swift-side mistake — the About section
 *     drawing `why` and `thesis.coachLine` together, say — is invisible here
 *     and needs the simulator.
 *   · IT ASSERTS SHAPE, NOT TASTE. It can tell that the strategy sentence
 *     reached the screen and that it is not printed twice; it cannot tell you
 *     the sentence is the right thing to say.
 *   · IT IS PINNED TO ONE ACCOUNT AND TWO DATES. Skipped entirely without
 *     `DATABASE_URL_RO`, so CI never depends on it.
 *
 * Run with:
 *   npx vitest run lib/faff/_today_thesis.audit.test.ts
 */
import { describe, it, expect, vi } from 'vitest';

const RO = process.env.DATABASE_URL_RO;
const OWNER = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const DATES = ['2026-09-03', '2026-09-08'] as const;

// The auth line, and ONLY the auth line. Declared as a bare object rather than
// spread over `importOriginal` so the real module (and the pool it imports) is
// never constructed before `DATABASE_URL` is pinned below.
vi.mock('@/lib/auth/session', () => ({
  requireUserId: async () => '0645f40c-951d-4ccc-b86e-9979cd26c795',
}));

describe.skipIf(!RO)('TODAY · the thesis-composed "why", rendered on the real route', () => {
  it('renders 2026-09-03 (hills) and 2026-09-08 (tempo) from the live payload', async () => {
    process.env.DATABASE_URL = RO;
    const { GET } = await import('@/app/api/v5/today/route');

    for (const date of DATES) {
      const res = await GET(
        new Request(`https://faff.run/api/v5/today?date=${date}`) as never,
      );
      const body = await res.json();

      /* eslint-disable no-console */
      console.log(`\n══ GET /api/v5/today?date=${date} ══  status=${res.status}`);
      console.log(`  state       = ${body.state}`);
      console.log(`  panel.type  = ${body.panel?.type}`);
      console.log(`  panel.dose  = ${JSON.stringify(body.panel?.dose ?? null)}`);
      console.log(`  WHY         = ${JSON.stringify(body.why)}`);
      console.log(`  thesis      = ${JSON.stringify(body.thesis, null, 2)?.replace(/\n/g, '\n                ')}`);
      /* eslint-enable no-console */

      expect(res.status).toBe(200);

      // The thesis reached the wire, and it is the same object shape on every
      // day (Rule 16 · one quantity, one name).
      expect(body.thesis).toBeTruthy();
      expect(typeof body.thesis.coachLine).toBe('string');
      expect(body.thesis.coachLine.length).toBeGreaterThan(0);
      expect(typeof body.thesis.reviewTrigger).toBe('string');
      expect(['THRESHOLD', 'HIGH_INTENSITY', 'DURABILITY', 'UNKNOWN'])
        .toContain(body.thesis.limiter);

      // The why is composed FROM it: on a quality day it opens on the limiter,
      // not on the phase. Asserted on the SHAPE OF THE RESULT rather than on
      // the absence of the old string (Rule 13 clause 3).
      expect(typeof body.why).toBe('string');
      expect(body.why.toLowerCase()).toContain('limiter');

      // Coach voice, on the real sentence the runner reads.
      expect(body.why, body.why).not.toMatch(/[—!·]/);
      expect(body.why, body.why).not.toMatch(/Research\//);
      expect(body.thesis.coachLine, body.thesis.coachLine).not.toMatch(/[—!·]/);

      // RULE 17 · the strategy is not printed twice. `why` and
      // `thesis.coachLine` are alternatives on this screen, and the phone
      // draws one of them — so they must not be the same sentence arriving
      // through two keys either.
      expect(body.why).not.toBe(body.thesis.coachLine);
    }
  }, 120_000);
});
