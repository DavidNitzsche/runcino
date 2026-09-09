/**
 * POST /api/internal/observability/record
 *
 * Internal-only write endpoint that lets `instrumentation.ts`'s
 * `onRequestError` hook record a `request_failures` row WITHOUT importing
 * `lib/observability/record.ts` (and therefore `@/lib/db/pool` → `pg`)
 * directly — see this route's own header note in `instrumentation.ts` for
 * why that indirection exists at all.
 *
 * THE RULE 19 REASON THIS FILE EXISTS: `instrumentation.ts` is bundled by
 * Next.js for BOTH the Node.js and Edge runtimes (its own `register()`
 * function has carried a `NEXT_RUNTIME !== 'nodejs'` early-return since
 * before this change, for exactly this reason). A `NEXT_RUNTIME` check at
 * RUN TIME does not stop webpack from needing to resolve the module graph at
 * BUILD time for the edge bundle target — `next build` failed outright
 * (`Module not found: Can't resolve 'fs'/'path'/'stream'`, tracing straight
 * through `pg` → `pg-connection-string`/`pgpass`) the first time this hook
 * imported `record.ts` directly, which is the EXACT incident Rule 19 records
 * (`lthr-reanchor.ts`, a dynamic import three modules deep, `fs`/`dns`/`net`/
 * `tls`) — caught this time by the pre-push build check that incident added,
 * rather than reaching Railway. `classify.ts`/`sanitize.ts`/`constants.ts`
 * are pure and stay imported directly in `instrumentation.ts`; ONLY the
 * actual database write is relayed through this ordinary Node-runtime route
 * (routes are never edge-bundled by default, and 154 of them already import
 * `@/lib/db/pool` directly with no issue — this file is not special, it is
 * just reached over a loopback HTTP call instead of a JS import).
 *
 * Same pattern this file's caller already established for the exact same
 * reason: `instrumentation.ts`'s `register()` heartbeat POSTs to
 * `/api/cron/tick` over `http://127.0.0.1:$PORT` rather than importing the
 * scheduler directly.
 *
 * AUTH: reuses `CRON_SECRET` (the same bearer secret `/api/cron/tick`
 * already gates on) rather than inventing a second internal secret David
 * would need to set in Railway before this works — this endpoint is called
 * only by the app's own process, over loopback, exactly like the tick.
 * Unconfigured `CRON_SECRET` fails closed (503), matching `/api/cron/tick`.
 */
import { NextRequest, NextResponse } from 'next/server';
import { recordRequestFailure } from '@/lib/observability/record';
import { ALL_FAILURE_CLASSES } from '@/lib/observability/types';

export const dynamic = 'force-dynamic';

interface InternalRecordBody {
  correlationId?: unknown;
  routePath?: unknown;
  httpMethod?: unknown;
  failureClass?: unknown;
  httpStatus?: unknown;
  errorMessage?: unknown;
  errorStack?: unknown;
  upstreamService?: unknown;
  metadata?: unknown;
  source?: unknown;
}

function isKnownClass(v: unknown): v is (typeof ALL_FAILURE_CLASSES)[number] {
  return typeof v === 'string' && (ALL_FAILURE_CLASSES as readonly string[]).includes(v);
}

export async function POST(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 });
  }
  const auth = req.headers.get('authorization') ?? '';
  if (auth.replace(/^Bearer\s+/i, '').trim() !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: InternalRecordBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  if (typeof body.correlationId !== 'string' || typeof body.routePath !== 'string' || !isKnownClass(body.failureClass)) {
    return NextResponse.json({ error: 'correlationId, routePath and a known failureClass are required' }, { status: 400 });
  }

  // Reconstructs a small Error-like object rather than passing the string
  // straight through, so `recordRequestFailure`'s own sanitize.ts pass still
  // runs on it here (defense in depth — the caller already classified this,
  // but sanitization is cheap and this route never assumes its caller did it).
  const errorLike = typeof body.errorMessage === 'string' ? new Error(body.errorMessage) : undefined;
  if (errorLike && typeof body.errorStack === 'string') errorLike.stack = body.errorStack;

  await recordRequestFailure({
    correlationId: body.correlationId,
    routePath: body.routePath,
    httpMethod: typeof body.httpMethod === 'string' ? body.httpMethod : 'UNKNOWN',
    failureClass: body.failureClass,
    httpStatus: typeof body.httpStatus === 'number' ? body.httpStatus : null,
    durationMs: null,
    error: errorLike,
    upstreamService: typeof body.upstreamService === 'string' ? body.upstreamService : undefined,
    metadata: typeof body.metadata === 'object' && body.metadata !== null ? body.metadata as Record<string, unknown> : undefined,
    source: typeof body.source === 'string' ? body.source : 'app/api/internal/observability/record',
  });

  return NextResponse.json({ recorded: true });
}
