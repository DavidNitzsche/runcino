/**
 * scripts/walks/_organic_push_restart_child.ts · PROOF 11's SECOND PROCESS.
 *
 * Not a vitest file (no `.script.ts` suffix, so `vitest.organic-push.config.ts`'s
 * `include` glob does not pick it up as a suite) and not run by vitest at all —
 * it is handed to a plain `node`, bundled by `scripts/_bundle-script.mjs` with the
 * same `@` alias vitest uses, by `_organic_push_proofs.script.ts`'s PROOF 11 via
 * `child_process.spawnSync`. Its only job is to fire the real
 * `POST /api/cron/run-adaptations` route exactly once, in a process that shares
 * NO module state whatsoever with the parent test — no `vi.resetModules()`
 * simulation, an actual separate OS process with its own cold
 * `lib/brain/ledger/decision-ledger.ts` table-probe cache, its own fresh `pg`
 * pool, its own fresh import graph.
 *
 * Only `Date` is faked, exactly as the parent does with `vi.useFakeTimers`, so
 * this process reads the same simulated "now" the scheduled boundary was
 * scheduled under. A plain `node` process has no vitest fake-timer machinery, so
 * this hand-rolls the one thing that matters: `new Date()` and `Date.now()`
 * return the walk's AS_OF instant. Nothing else about time needs faking — the pg
 * driver and every timer in the import graph run on the real clock.
 *
 * DATABASE_URL and CRON_SECRET arrive from the parent's `env`, passed explicitly
 * by PROOF 11 rather than inherited from this process's own ambient
 * environment — the parent test process already validated `faff_push_walk` is
 * the loopback scratch target before it ever got here, and repeating that
 * validation in a script with no test framework and no assertions would be
 * decoration.
 */
const AS_OF_MS = new Date(process.env.WALK_AS_OF_ISO ?? '2026-09-20T19:00:00Z').getTime();
const RealDate = Date;
class FixedDate extends RealDate {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(...args: any[]) {
    if (args.length === 0) {
      super(AS_OF_MS);
    } else {
      super(...(args as ConstructorParameters<typeof RealDate>));
    }
  }
  static now(): number { return AS_OF_MS; }
}
// @ts-expect-error intentional global override — this process exists only to
// stand in for "a fresh worker resolving what a previous one scheduled."
globalThis.Date = FixedDate;

async function main(): Promise<void> {
  // Arms the SAME production write barrier the parent's `vitest.setup.ts`
  // arms, so this process cannot reach anything but the loopback scratch
  // database even if some environment variable were wrong.
  await import('@/lib/verify/install-barrier');
  const { POST } = await import('@/app/api/cron/run-adaptations/route');
  const { NextRequest } = await import('next/server');
  const req = new NextRequest('http://localhost/api/cron/run-adaptations', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.CRON_SECRET ?? ''}` },
  });
  const res = await POST(req);
  const body = await res.json();
  // A single delimited line on stdout, so the parent's `spawnSync` can find it
  // even if some import along the way logged something else first.
  process.stdout.write(`\n@@RESTART_CHILD_RESULT@@${JSON.stringify(body)}@@END@@\n`);
}

await main();

// Makes this a module (rather than a script) in TypeScript's eyes, which is
// what permits the top-level `await` above — there is otherwise no `import`
// or `export` anywhere in this file.
export {};
