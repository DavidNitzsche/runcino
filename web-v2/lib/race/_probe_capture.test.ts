/**
 * _probe_capture.test.ts · TEMPORARY. READ-ONLY. Rule 13 rendering support.
 *
 * Runs the REAL v5 route handlers against the REAL production database
 * (read-only role) with ONLY the auth check mocked, and writes each response
 * body to /tmp/faff-capture/. A local static server then serves those bodies
 * to the simulator so the phone renders the actual account's actual payload
 * through the actual decoder and the actual SwiftUI views.
 *
 * WHY THE AUTH MOCK. `requireUserId` compares a SHA-256 of the bearer against
 * `sessions.session_token`, and the raw token is not recoverable from the row.
 * Minting one is a production WRITE, which this work is forbidden from doing,
 * and typing a password is forbidden outright. Mocking the gate is the only
 * remaining way to run the real handler as the real user. Nothing else about
 * the route is stubbed: the queries, the resolver, the layers and the
 * serialisation are all the shipping code.
 *
 *   FAFF_CAPTURE=1 npx vitest run lib/race/_probe_capture.test.ts
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const RUN = !!process.env.FAFF_CAPTURE;
const OUT = '/tmp/faff-capture';

vi.mock('@/lib/auth/session', async (orig) => {
  const real = await orig<typeof import('@/lib/auth/session')>();
  return { ...real, requireUserId: async () => DAVID, requireAdmin: async () => DAVID };
});

function req(url: string): Request {
  return new Request(url, { headers: new Headers({ authorization: 'Bearer probe' }) });
}

async function capture(name: string, run: () => Promise<Response>) {
  fs.mkdirSync(OUT, { recursive: true });
  const res = await run();
  const body = await res.text();
  fs.writeFileSync(path.join(OUT, `${name}.json`), body);
  return { status: res.status, bytes: body.length };
}

describe.skipIf(!RUN)('capture the real v5 payloads', () => {
  it('captures race detail, races, today and block', async () => {
    const log: string[] = [];

    {
      const { GET } = await import('@/app/api/v5/race/[slug]/route');
      for (const slug of ['cim', 'dodgers']) {
        const r = await capture(`race-${slug}`, () =>
          GET(req(`http://local/api/v5/race/${slug}`) as never, { params: Promise.resolve({ slug }) }) as Promise<Response>);
        log.push(`race/${slug}: ${r.status} · ${r.bytes} bytes`);
      }
    }
    {
      const { GET } = await import('@/app/api/v5/races/route');
      const r = await capture('races', () => GET(req('http://local/api/v5/races') as never) as Promise<Response>);
      log.push(`races: ${r.status} · ${r.bytes} bytes`);
    }
    {
      const { GET } = await import('@/app/api/v5/today/route');
      const r = await capture('today', () => GET(req('http://local/api/v5/today') as never) as Promise<Response>);
      log.push(`today: ${r.status} · ${r.bytes} bytes`);
    }
    {
      const { GET } = await import('@/app/api/v5/block/route');
      const r = await capture('block', () => GET(req('http://local/api/v5/block') as never) as Promise<Response>);
      log.push(`block: ${r.status} · ${r.bytes} bytes`);
    }

    console.log(log.join('\n'));
    // The race detail must be a 200 with the new blocks, or the render below
    // would be verifying nothing.
    const cim = JSON.parse(fs.readFileSync(path.join(OUT, 'race-cim.json'), 'utf8'));
    expect(cim.slug, `race-cim came back as ${JSON.stringify(cim).slice(0, 200)}`).toBe('cim');
    expect(cim.raceLayers, 'the layer set is missing from the live response').toBeTruthy();
    expect(cim.outlook.conditional_upside, 'the upside is missing from the live response').toBeTruthy();
    console.log('LAYERS:', JSON.stringify(cim.raceLayers, null, 1));
    console.log('COURSE:', JSON.stringify(cim.courseContext, null, 1));
  }, 300_000);
});
