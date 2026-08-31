/**
 * POST /api/cron/tick · the scheduler.
 *
 * Hit this as often as anything can manage. It works out what is DUE and runs
 * it, in dependency order, once. Punctuality stops being a requirement.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * Every scheduled job in this app was triggered by a GitHub Actions cron, and
 * on 2026-08-30 that clock was measured firing `run-adaptations` between six
 * and twelve hours late four days running, and dropping roughly nine in ten of
 * `keep-warm`'s fifteen-minute ticks outright. GitHub documents its cron as
 * best-effort under load. Depending on it AS A CLOCK is the defect.
 *
 * The owner's words: "We need to trust the plan to fire on its own. It has to
 * be wired correctly. We cannot come here in the backend to fire everything
 * manually. Defeats the purpose."
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW IT IS DIFFERENT FROM A CRON
 *
 * A cron asks "is it three o'clock". This asks "has this job run since its
 * three o'clock slot opened". The difference is the entire fix:
 *
 *   · A trigger that arrives at 15:08 for an 03:00 slot still runs the job.
 *   · A trigger that arrives twice runs the job once.
 *   · A trigger that never arrives is VISIBLE, because the ledger can say when
 *     the job last completed and nothing said it since.
 *
 * The slots themselves are unchanged — each job keeps the UTC hour its GitHub
 * workflow already used, because those hours encode product decisions (the
 * owner asked for adaptations in the evening: "I dont want to wake up to change
 * runs"). This is a catch-up mechanism, not a re-timing. A job is never run
 * BEFORE its slot, only after one it missed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHO CALLS IT
 *
 *   1 · `instrumentation.ts` — an in-process heartbeat inside the Railway
 *       container itself, every five minutes. No cross-service dependency, no
 *       second Railway service, no third-party pinger. This is the primary.
 *   2 · `.github/workflows/cron-tick.yml` — the same call from outside, so a
 *       container that restarted, slept or wedged still gets swept. Given the
 *       measured drop rate this is a backstop, not a schedule.
 *   3 · The existing per-job workflows, UNCHANGED. They hit their own routes
 *       directly, exactly as before. Because the ledger is stamped by the ROUTE
 *       rather than by this tick, one of their runs satisfies the slot and this
 *       tick then reads "not due" and skips — the two triggers cooperate
 *       instead of doubling. That is what lets the old path stay switched on
 *       until the new one has been watched through a full cycle, per the
 *       instruction not to introduce a trigger and remove one in the same
 *       change.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS CANNOT CATCH (CLAUDE.md Rule 22)
 *
 *   · It cannot make an unreachable app run anything. If the container is down,
 *     the in-process heartbeat is down with it, and the only leg left is the
 *     GitHub tick — the very clock this exists to stop trusting. A dead
 *     container is still a dead container; what changes is that the miss is
 *     recorded and alerted rather than silent.
 *   · It drives only the jobs in `CRON_JOBS`. `notifications` and
 *     `strava-push-poll` are excluded because the mutation registry marks them
 *     NOT idempotent, so their lateness is unimproved by this work.
 *   · A 200 from a job means the route completed, not that its per-user loop
 *     succeeded for every runner. Each route reports partial failure in its own
 *     body and this records the 200.
 *   · Two containers running this concurrently would each see the same job due.
 *     Every driven job is idempotent (see `idempotenceEvidence` per entry), so
 *     the cost is a duplicated pass, not corruption — but this is NOT a
 *     distributed lock and must not be mistaken for one.
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  CRON_JOBS,
  EXCLUDED_FROM_TICK,
  allLastSuccess,
  blockedBy,
  isDue,
  mostRecentSlot,
  raiseStaleAlert,
  staleness,
  stalenessIsAlertable,
  type CronJob,
  type LastSuccess,
} from '@/lib/ops/cron-ledger';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/**
 * How long a pass will keep STARTING new jobs. Once the elapsed time passes
 * this, the remaining due jobs are left for the next tick — which is five
 * minutes away and loses nothing, because the ledger is durable.
 *
 * It bounds how many jobs a pass takes on, NOT how long any one of them may
 * run: each job gets its own `timeoutMs` from the registry, mirroring its
 * route's `maxDuration`. Sharing one clock would have aborted `strava-sync`
 * (maxDuration 300) at a hundred seconds on every single pass, permanently,
 * while looking like a flaky network.
 */
const START_BUDGET_MS = 100_000;

/**
 * Where the tick reaches the app's own routes. Loopback by default: the Next
 * server listens on 0.0.0.0:$PORT inside the container, so this never leaves
 * it, needs no public DNS, and cannot be affected by the edge being slow.
 */
function selfBaseUrl(): string {
  const explicit = process.env.CRON_TICK_BASE_URL;
  if (explicit) return explicit.replace(/\/+$/, '');
  const port = process.env.PORT ?? '3000';
  return `http://127.0.0.1:${port}`;
}

interface JobOutcome {
  job: string;
  ran: boolean;
  /** Why it did or did not run. Never a bare boolean — the reason is the point. */
  reason: string;
  status?: number;
  ms?: number;
  error?: string;
  preconditions_unmet?: string[];
}

async function invoke(job: CronJob, secret: string, timeoutMs: number): Promise<{
  status: number; ms: number; error?: string;
}> {
  const started = Date.now();
  try {
    const res = await fetch(`${selfBaseUrl()}${job.path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        // Provenance only, for the app log: it says a tick drove this call
        // rather than a workflow or a human with curl. Nothing branches on it,
        // and nothing should — a job that behaved differently depending on who
        // called it would defeat the point of the ledger being stamped by the
        // route.
        'x-faff-cron-origin': 'tick',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { status: res.status, ms: Date.now() - started };
  } catch (e: unknown) {
    return {
      status: 0,
      ms: Date.now() - started,
      error: e instanceof Error ? e.message : String(e),
    };
  }
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

  const now = new Date();
  const url = new URL(req.url);
  /**
   * `?dry=1` reports what WOULD run and changes nothing. This is the falsifier's
   * entry point and the safe way to look at the scheduler on production: per
   * Rule 18 a gate nobody can make fail on purpose is a hypothesis, and a
   * scheduler you cannot interrogate without firing it is the same thing.
   */
  const dryRun = url.searchParams.get('dry') === '1';
  /** Restrict the pass to one job, for falsification and for manual recovery. */
  const only = url.searchParams.get('only');

  const last = await allLastSuccess();

  // ── 1 · staleness, evaluated for EVERY job, before anything runs ───────────
  //
  // Deliberately first and deliberately unconditional. The question "is a job
  // not running at all" must be answered on a tick where nothing is due, which
  // is most of them — an observability check that only fires when there is work
  // to do cannot see the failure it exists for.
  const health: Array<{
    job: string; state: string; age_hours: number | null; last_success: string | null;
    next_slot_passed: string | null; alerted?: boolean;
  }> = [];
  for (const job of CRON_JOBS) {
    const l = last.get(job.id) ?? ({ state: 'never' } as LastSuccess);
    const s = staleness(now, job, l);
    const slot = mostRecentSlot(now, job.slotsUtcHour);
    const row = {
      job: job.id,
      state: s.state,
      age_hours: s.state === 'ok' || s.state === 'stale' ? Number(s.ageHours.toFixed(2)) : null,
      last_success: l.state === 'ran' ? l.at.toISOString() : null,
      next_slot_passed: slot ? slot.toISOString() : null,
    } as (typeof health)[number];
    if (!dryRun && stalenessIsAlertable(s)) {
      row.alerted = await raiseStaleAlert(job, s);
    }
    health.push(row);
  }

  // ── 2 · run what is due, in declared dependency order ──────────────────────
  const outcomes: JobOutcome[] = [];
  const started = Date.now();
  /** Jobs satisfied during THIS pass, so a dependent sees its predecessor. */
  const satisfiedThisPass = new Set<string>();

  for (const job of CRON_JOBS) {
    if (only && job.id !== only) continue;

    const l = last.get(job.id) ?? ({ state: 'never' } as LastSuccess);
    const verdict = isDue(now, job, l);
    if (!verdict.due) {
      outcomes.push({ job: job.id, ran: false, reason: verdict.reason });
      continue;
    }

    // A predecessor that is itself due and has not been run yet in this pass
    // means the ORDER is not satisfiable this tick. Skip rather than run out of
    // order: the next tick, five minutes later, will have the predecessor done.
    // `only` bypasses this — it is the manual-recovery lever and the falsifier's
    // handle, and an operator asking for one job has said which one they mean.
    const blocked = only ? [] : blockedBy(now, job, last, satisfiedThisPass);
    if (blocked.length > 0) {
      outcomes.push({
        job: job.id, ran: false,
        reason: 'waiting_on_predecessor',
        preconditions_unmet: blocked,
      });
      continue;
    }

    if (dryRun) {
      outcomes.push({ job: job.id, ran: false, reason: `would_run · ${verdict.reason}` });
      satisfiedThisPass.add(job.id);
      continue;
    }

    if (Date.now() - started > START_BUDGET_MS) {
      outcomes.push({ job: job.id, ran: false, reason: 'start_budget_exhausted · deferred to next tick' });
      continue;
    }

    const res = await invoke(job, expected, job.timeoutMs);
    const ok = res.status === 200;
    outcomes.push({
      job: job.id, ran: true,
      reason: verdict.reason,
      status: res.status, ms: res.ms,
      error: res.error,
    });
    // The route stamps its OWN ledger row on success, so nothing is recorded
    // here. That is what makes the stamp true regardless of who triggered the
    // job, and it is why a failed job stays due and is retried on the next tick
    // rather than being marked done by its caller.
    if (ok) satisfiedThisPass.add(job.id);
  }

  return NextResponse.json({
    ok: outcomes.every((o) => !o.ran || o.status === 200),
    now: now.toISOString(),
    dry_run: dryRun,
    ran: outcomes.filter((o) => o.ran).length,
    outcomes,
    health,
    excluded: EXCLUDED_FROM_TICK,
  });
}

/**
 * Health probe. Unauthenticated on purpose and carries NO runner data — it
 * reports the shape of the schedule, not its state, so it is safe to curl and
 * useful when the answer to "why did nothing fire" might be "CRON_SECRET is
 * unset again".
 */
export async function GET() {
  return NextResponse.json({
    endpoint: 'POST /api/cron/tick',
    auth: 'Authorization: Bearer <CRON_SECRET>',
    secret_configured: Boolean(process.env.CRON_SECRET),
    query: {
      dry: 'dry=1 · report what would run, change nothing',
      only: 'only=<job-id> · run one job, bypassing the predecessor wait',
    },
    jobs: CRON_JOBS.map((j) => ({
      id: j.id, path: j.path, slots_utc_hour: j.slotsUtcHour,
      stale_after_hours: j.staleAfterHours, requires: j.requires,
    })),
    excluded: EXCLUDED_FROM_TICK,
  });
}
