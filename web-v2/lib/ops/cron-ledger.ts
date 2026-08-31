/**
 * lib/ops/cron-ledger.ts · the app's own clock, and the record of whether it ran.
 *
 * THE ENFORCEMENT OF CLAUDE.md RULE 23 — "a scheduled job guarantees its own
 * preconditions; a schedule is not a guarantee". This module is the third and
 * fourth clauses of that rule (lateness must be harmless; a job that does not
 * run must be NOTICED). The first two clauses — enumerate the assumptions and
 * remove them — live inside the jobs themselves, principally the LTHR ensure at
 * the top of `plan-drift`'s and `run-adaptations`' per-user loops.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE INCIDENT
 *
 * 2026-08-30. `run-adaptations` is scheduled `0 3 * * *`. Measured starts over
 * the four preceding days: 03:55, 13:56, 15:08, 09:50, 09:01 UTC. `plan-drift`
 * is scheduled `0 9` and `0 4`; measured starts 14:13, 14:07, 20:37. And
 * `keep-warm`, whose three cron lines ask for 75 ticks a day, fired EIGHT times
 * in the twenty-four hours of 2026-08-30. GitHub Actions cron is documented as
 * best-effort under load; this repo is being served the worst end of that
 * promise, and roughly nine in ten scheduled ticks never happen at all.
 *
 * On its own that is an annoyance. What made it a defect is that the jobs had
 * an ORDER. `plan-drift` authors a fourteen-week block and `generate.ts` stamps
 * every `workout_spec.hr_cap_bpm` from `profile.lthr` at that instant;
 * `run-adaptations` is what re-anchors `profile.lthr` from race evidence. Two
 * independent clocks, one hour apart on paper and six to twelve hours apart in
 * practice, deciding whether fourteen weeks of heart-rate ceilings are stamped
 * off the current anchor or a stale one. Nothing checked, nothing reported, and
 * the owner found the drift by running `gh run list` by hand.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS MODULE IS FOR
 *
 * Stop treating "the trigger fired at 03:00" as the guarantee. The guarantee is
 * a LEDGER: every job records when it last successfully completed, and the
 * scheduler asks "is this job due" rather than "is it three o'clock".
 *
 * Three consequences follow, and they are the whole point:
 *
 *   1 · LATENESS IS HARMLESS. A job whose slot passed at 03:00 and whose first
 *       trigger lands at 15:08 still runs, once, on the same day's data.
 *   2 · DOUBLE-TRIGGERING IS HARMLESS. GitHub Actions and the in-process
 *       heartbeat write to the same ledger, so whichever arrives first
 *       satisfies the slot and the other reads "not due" and skips. The two
 *       triggers cooperate rather than doubling — which is also why the old
 *       workflows can keep running unchanged while the new path is proved.
 *   3 · A MISS IS VISIBLE. `staleness()` answers "when did I last successfully
 *       complete, and is that too long ago", and the tick raises `cron_stale`
 *       on `ops_alerts` when the answer is bad. Per CLAUDE.md Rule 20 a
 *       scheduling guarantee with no check is a hypothesis.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHERE THE LEDGER LIVES, AND WHY IT IS NOT A NEW TABLE
 *
 * `ops_alerts` — the surface the brief names, already append-only, already
 * carrying `kind` / `source` / `created_at`, and with no CHECK constraint on
 * `kind` (verified against production 2026-08-30). A success is written with
 * `kind = 'cron_ok'`, `severity = 'info'` and `acked_at = NOW()`, so it is a
 * heartbeat rather than an alert and `recentUnackedAlerts()` — the admin
 * surface — never shows it. Ten rows a day.
 *
 * The alternative was a `cron_job_runs` table. It would be tidier and it is not
 * worth a migration that has to be applied by hand before the code that needs
 * it can deploy: the scheduler would then be inert between the deploy and the
 * DDL, which is exactly the failure mode this file exists to end.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS CANNOT CATCH (CLAUDE.md Rule 22)
 *
 *   · It cannot tell a job that ran and did nothing from a job that ran and did
 *     the wrong thing. `cron_ok` means the route returned 200, not that the
 *     coaching decision inside it was correct.
 *   · It cannot detect a job that is MISSING FROM THE REGISTRY. Nothing here
 *     derives the job set from the filesystem, so a new cron route that nobody
 *     adds to `CRON_JOBS` is unscheduled and unwatched, and this module will
 *     report the remaining jobs green. `_cron_ledger.test.ts` closes exactly
 *     this by deriving the route set from disk and failing on an unregistered
 *     one; without that test this paragraph would be the only thing standing
 *     between the registry and the rot every hardcoded list in this repo has
 *     eventually suffered.
 *   · It cannot see a job that succeeds for one runner and throws for another.
 *     Every route here loops per-user and reports partial failure in its body;
 *     the ledger sees the 200.
 *   · Staleness is measured against the SLOT, so a job whose slot is wrong in
 *     the first place is reported healthy forever.
 */
import { pool } from '@/lib/db/pool';
import { attempt } from '@/lib/db/read';
import { raiseAlert, type AlertKind } from '@/lib/ops/alerts';

/** How a read of the ledger came back. Three facts, never one (Rule 11). */
export type LastSuccess =
  /** Read succeeded and the job has completed at least once. */
  | { state: 'ran'; at: Date }
  /** Read succeeded and there is no record of this job EVER completing. */
  | { state: 'never' }
  /** The read itself failed. Not an answer about the job. */
  | { state: 'read_failed'; error: string };

export interface CronJob {
  /** Stable id, also the `source` suffix in the ledger. Never renamed. */
  readonly id: string;
  /** Route the scheduler POSTs to. */
  readonly path: string;
  /**
   * The UTC hours this job's day-slots open at — its EXISTING GitHub cron, kept
   * deliberately. The tick is a catch-up mechanism, not a re-timing: a job is
   * never run before the slot it was designed for, only after one it missed.
   * `run-adaptations` at 03:00 UTC is 20:00 PT the evening before, which is
   * where the owner asked for it ("I dont want to wake up to change runs"), and
   * moving it would be a product change wearing an infrastructure hat.
   */
  readonly slotsUtcHour: readonly number[];
  /**
   * Hours after a missed slot before the job is reported STALE. Generous on
   * purpose: the point is to catch "this has not run for a day", not to page on
   * a job that is forty minutes behind.
   */
  readonly staleAfterHours: number;
  /**
   * How long the tick will wait for this job, in ms. Mirrors the route's own
   * `maxDuration` with headroom.
   *
   * It exists because the first draft shared ONE budget across the whole pass,
   * which would have aborted `strava-sync` — `maxDuration = 300` and a real
   * thirty-day pull across every connected runner — at 100 seconds, forever.
   * A job the scheduler can never let finish is a job the scheduler has
   * silently switched off, and it would have looked like a flaky network rather
   * than a design error. The pass budget now decides only whether to START
   * another job; once started, a job gets its own clock.
   */
  readonly timeoutMs: number;
  /**
   * Jobs whose output this one reads.
   *
   * The tick runs the registry top to bottom and DEFERS a job whose predecessor
   * is itself still due (`blockedBy`), so a single pass satisfies a whole chain
   * in order. It does not FIRE the predecessor — a scheduler that invokes jobs
   * out of band to satisfy a read would make an expensive writer
   * (`snapshot-projections` is a plan writer) reachable from anywhere, which is
   * a worse defect than the ordering it fixes.
   *
   * This edge is therefore a scheduling preference, NOT a guarantee: a job can
   * still be triggered directly by its own workflow, which never consults it.
   * The guarantees live inside the jobs — `plan-drift` re-anchors LTHR itself
   * rather than trusting that `run-adaptations` did, and refuses its goal-gap
   * findings when the projection series it reads is stale.
   */
  readonly requires: readonly string[];
  /**
   * WHY it is safe for this job to be driven by a second trigger. Every entry
   * cites `lib/audit/automatic-mutation-registry.ts`, which audits idempotence
   * per writer — the brief's "verify they are, per job, rather than assuming".
   * A job the registry marks NOT idempotent does not appear in this list at
   * all; see `EXCLUDED_FROM_TICK` below for those and the reason each is out.
   */
  readonly idempotenceEvidence: string;
}

/**
 * The jobs the tick drives, in DEPENDENCY ORDER.
 *
 * Order is load-bearing. When several slots are open at once — which is the
 * normal case after a long GitHub outage — they run top to bottom, so runs are
 * ingested before they are deduped, deduped before they are projected,
 * projected before readiness reads them, and the plan is adapted before it is
 * re-authored. That ordering is currently an accident of four separate cron
 * expressions; here it is a declaration.
 */
export const CRON_JOBS: readonly CronJob[] = [
  {
    id: 'strava-sync',
    path: '/api/cron/strava-sync',
    slotsUtcHour: [8],
    staleAfterHours: 30,
    timeoutMs: 450000,
    requires: [],
    idempotenceEvidence:
      'automatic-mutation-registry cron/strava-sync · idempotent: true · fill-only writes, '
      + 'findCanonicalRow throws rather than swallowing so a DB error skips the activity '
      + 'instead of double-inserting.',
  },
  {
    id: 'dedupe-runs',
    path: '/api/cron/dedupe-runs',
    slotsUtcHour: [10],
    staleAfterHours: 30,
    timeoutMs: 180000,
    requires: ['strava-sync'],
    idempotenceEvidence:
      'automatic-mutation-registry cron/dedupe-runs · idempotent: true · the flag rewrite is '
      + 'one transaction under pg_advisory_xact_lock on (user, date) since 2026-08-30.',
  },
  {
    id: 'enrich-weather',
    path: '/api/cron/enrich-weather',
    slotsUtcHour: [7],
    staleAfterHours: 30,
    timeoutMs: 270000,
    requires: [],
    idempotenceEvidence:
      'automatic-mutation-registry cron/enrich-weather · idempotent: true · independent '
      + 'jsonb_set writes, each coherent alone, Rule 6 compliant.',
  },
  {
    id: 'snapshot-projections',
    path: '/api/cron/snapshot-projections',
    slotsUtcHour: [7],
    staleAfterHours: 30,
    timeoutMs: 120000,
    requires: [],
    idempotenceEvidence:
      'automatic-mutation-registry cron/snapshot-projections · idempotent: true · snapshots are '
      + 'independent upserts on (user_uuid, snapshot_date, distance_mi); the plan re-anchor runs '
      + 'through mutatePlan and rolls back whole.',
  },
  {
    id: 'max-hr-ratchet',
    path: '/api/cron/max-hr-ratchet',
    slotsUtcHour: [8],
    staleAfterHours: 30,
    timeoutMs: 120000,
    requires: ['snapshot-projections'],
    idempotenceEvidence:
      'automatic-mutation-registry cron/max-hr-ratchet · idempotent: true · one monotone '
      + 'statement per runner, gated on max_hr_override IS NULL.',
  },
  {
    id: 'readiness-snapshot',
    path: '/api/cron/readiness-snapshot',
    slotsUtcHour: [8],
    staleAfterHours: 30,
    timeoutMs: 120000,
    requires: ['strava-sync'],
    idempotenceEvidence:
      'automatic-mutation-registry cron/readiness-snapshot · idempotent: true · single upsert on '
      + '(user_uuid, snapshot_date). The registry notes it is structurally but not SEMANTICALLY '
      + 'idempotent — a re-run at a different hour writes a different score over the first. The '
      + 'ledger makes that better rather than worse: today two triggers can both land and the '
      + 'later hour wins arbitrarily, whereas a due-gated job runs once per slot.',
  },
  {
    id: 'run-adaptations',
    path: '/api/cron/run-adaptations',
    slotsUtcHour: [3],
    staleAfterHours: 30,
    timeoutMs: 180000,
    requires: ['readiness-snapshot', 'snapshot-projections'],
    idempotenceEvidence:
      'automatic-mutation-registry cron/run-adaptations · idempotent: true · mutatePlan '
      + 'transaction with differential doctrine validation and rollback; sealed days filtered out.',
  },
  {
    id: 'plan-drift',
    path: '/api/cron/plan-drift',
    slotsUtcHour: [4, 9],
    staleAfterHours: 20,
    timeoutMs: 120000,
    requires: ['run-adaptations', 'snapshot-projections'],
    idempotenceEvidence:
      'automatic-mutation-registry cron/plan-drift · idempotent: true · every fire is gated on a '
      + '24h-or-standing-pending proposal dedupe checked fresh, and generatePlan diffs both '
      + 'persisted blocks inside the transaction and rolls back as no_change when identical.',
  },
  {
    id: 'promote-courses',
    path: '/api/cron/promote-courses',
    slotsUtcHour: [7],
    staleAfterHours: 48,
    timeoutMs: 120000,
    requires: [],
    idempotenceEvidence:
      'automatic-mutation-registry cron/promote-courses · idempotent: FALSE on a CRASHED run '
      + '(contributor_count is incremented before promoted_to_library_iso is set, and that flag is '
      + 'the only dedupe), clean on a completed one. Driven anyway because due-gating strictly '
      + 'REDUCES the number of passes — today it runs on every trigger, here at most once a day — '
      + 'so the crash window is entered less often, not more. Nothing in the plan chain reads it.',
  },
] as const;

/**
 * Scheduled work the tick deliberately does NOT drive, and why. Read as part of
 * the registry: an empty version of this list would mean "everything is
 * covered", which has never been true of anything in this repo.
 */
export const EXCLUDED_FROM_TICK: readonly { id: string; why: string }[] = [
  {
    id: 'notifications',
    why:
      'automatic-mutation-registry cron/notifications · idempotent: FALSE, reach '
      + 'destructive_or_external, and "a sent push cannot be unsent". Its catchment windows are '
      + 'hours wide against a */30 tick with a non-unique dedup index, so a second driver is a '
      + 'second chance to send the same push. It also runs every thirty minutes, which is a '
      + 'cadence where lateness costs a delayed nudge rather than a corrupted plan.',
  },
  {
    id: 'strava-push-poll',
    why:
      'automatic-mutation-registry cron/strava-push-poll · idempotent: FALSE, writes to the '
      + "runner's public Strava feed, and re-uploads a run they deleted there. Never worth a "
      + 'second trigger.',
  },
  {
    id: 'keep-warm',
    why:
      'A heartbeat, not a job. Due-gating it to once a day would defeat it, and it has no output '
      + 'anything else reads.',
  },
  {
    id: 'silent-rebuild',
    why: 'workflow_dispatch only, by design — it lands code upgrades on a named runner, on demand.',
  },
  {
    id: 'emit-telemetry',
    why: 'Runs in the GitHub runner and pushes to the repo. It is not an app endpoint.',
  },
  {
    id: 'prune-adaptation-shadow-log',
    why:
      'automatic-mutation-registry-equivalent reasoning (no formal entry needed — this is a '
      + 'DELETE-only housekeeping job, never a writer of runner-visible state): idempotent by '
      + 'construction (deleting rows already past the retention window a second time deletes '
      + 'nothing further), and nothing downstream reads adaptation_shadow_log at all, let alone '
      + 'depends on its freshness — a late or missed prune costs a slightly larger table for a '
      + 'day, never a wrong coaching answer. The catch-up guarantee this tick provides protects '
      + "jobs whose lateness cascades into stale plan data; this job's lateness has no such "
      + 'downstream effect, so it runs on its own simple nightly schedule instead.',
  },
];

export const CRON_JOB_IDS: ReadonlySet<string> = new Set(CRON_JOBS.map((j) => j.id));

export function cronJob(id: string): CronJob | undefined {
  return CRON_JOBS.find((j) => j.id === id);
}

/* ── the pure scheduling arithmetic ─────────────────────────────────────────
 *
 * Kept free of the database so it can be falsified without one, which is the
 * only way the "make the gate fail on purpose" half of Rule 18 is cheap enough
 * to actually do.
 */

/**
 * The most recent instant at which one of this job's slots opened, at or before
 * `now`. Looks back across the UTC day boundary, so a job whose only slot is
 * 09:00 and which is asked at 02:00 gets YESTERDAY's 09:00 — the slot it is
 * currently late for — rather than a slot in the future.
 */
export function mostRecentSlot(now: Date, slotsUtcHour: readonly number[]): Date | null {
  if (slotsUtcHour.length === 0) return null;
  let best: Date | null = null;
  // Two days is enough: slots repeat every 24h, so the latest slot at or before
  // `now` is either today's or yesterday's.
  for (const dayOffset of [0, -1]) {
    for (const hour of slotsUtcHour) {
      const d = new Date(Date.UTC(
        now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + dayOffset,
        hour, 0, 0, 0,
      ));
      if (d.getTime() <= now.getTime() && (best === null || d.getTime() > best.getTime())) {
        best = d;
      }
    }
  }
  return best;
}

export type DueVerdict =
  | { due: true; slot: Date; reason: 'never_run' | 'slot_open' }
  | { due: false; reason: 'satisfied' | 'no_slot_yet' | 'unknown_last_success' };

/**
 * Is this job due?
 *
 * DUE when its most recent slot has opened and no success has been recorded
 * since that slot. NOT due when the read of the ledger failed — a scheduler
 * that cannot see the ledger must not conclude "nothing has run, run
 * everything", which is the Rule 11 shape pointed at a job runner. The tick
 * reports `unknown_last_success` and the staleness check raises on it.
 */
export function isDue(now: Date, job: CronJob, last: LastSuccess): DueVerdict {
  if (last.state === 'read_failed') return { due: false, reason: 'unknown_last_success' };
  const slot = mostRecentSlot(now, job.slotsUtcHour);
  if (slot === null) return { due: false, reason: 'no_slot_yet' };
  if (last.state === 'never') return { due: true, slot, reason: 'never_run' };
  return last.at.getTime() < slot.getTime()
    ? { due: true, slot, reason: 'slot_open' }
    : { due: false, reason: 'satisfied' };
}

/**
 * Which of this job's declared predecessors are themselves still due, and so
 * must run first.
 *
 * This is the ORDERING GUARANTEE, and it is deliberately a pure function of
 * three inputs so it can be made to fail on purpose without a database
 * (Rule 18). A non-empty answer means the tick defers the job rather than
 * running it out of order; the next tick, five minutes later, finds the
 * predecessor done.
 *
 * It is not the ONLY ordering defence and must not be treated as one: a job can
 * still be triggered directly by its own GitHub workflow, which never consults
 * this. That is precisely why the expensive assumptions are ENSURED inside the
 * jobs themselves (plan-drift re-anchors LTHR rather than trusting that
 * run-adaptations did). This function makes the common path orderly; the
 * in-job ensures make the uncommon path safe.
 */
export function blockedBy(
  now: Date,
  job: CronJob,
  lastByJob: ReadonlyMap<string, LastSuccess>,
  satisfiedThisPass: ReadonlySet<string>,
): string[] {
  return job.requires.filter((depId) => {
    if (satisfiedThisPass.has(depId)) return false;
    const dep = cronJob(depId);
    const depLast = lastByJob.get(depId);
    // An unknown predecessor blocks nothing. A dependency naming a job that is
    // not in the registry is a registry bug, and `_cron_ledger.test.ts` fails
    // on it — it must not also quietly wedge the dependent job forever.
    if (!dep || !depLast) return false;
    return isDue(now, dep, depLast).due;
  });
}

export type Staleness =
  | { state: 'ok'; ageHours: number }
  | { state: 'stale'; ageHours: number }
  | { state: 'never_run' }
  | { state: 'unknown' };

/**
 * "When did I last successfully complete, and is that too long ago."
 *
 * `never_run` and `unknown` are kept apart from `stale` on purpose: a job with
 * no history at all is a deploy that has not had its first slot yet OR a job
 * nothing is triggering, and a job whose ledger read failed is not a statement
 * about the job. All three are surfaced; only the first two are the runner's
 * problem.
 */
export function staleness(now: Date, job: CronJob, last: LastSuccess): Staleness {
  if (last.state === 'read_failed') return { state: 'unknown' };
  if (last.state === 'never') return { state: 'never_run' };
  const ageHours = (now.getTime() - last.at.getTime()) / 3600000;
  return ageHours > job.staleAfterHours
    ? { state: 'stale', ageHours }
    : { state: 'ok', ageHours };
}

/* ── the ledger itself ──────────────────────────────────────────────────────*/

const LEDGER_KIND: AlertKind = 'cron_ok';
const STALE_KIND: AlertKind = 'cron_stale';
const PRECONDITION_KIND: AlertKind = 'cron_precondition';

/** `ops_alerts.source` for a job. One spelling, derived, never typed twice. */
export function ledgerSource(jobId: string): string {
  return `cron/${jobId}`;
}

/**
 * When did this job last successfully complete?
 *
 * Reads the heartbeat rows this module writes. A job that has run only under
 * the OLD path — a GitHub workflow hitting the route before this shipped — has
 * no heartbeat and reads `never`, which makes it due once. That single
 * catch-up run is the intended behaviour on first deploy and is why every job
 * driven here had to be idempotent before it could be listed.
 */
export async function lastSuccessAt(jobId: string): Promise<LastSuccess> {
  const r = await attempt(
    `ops/cron-ledger · last success ${jobId}`,
    pool.query<{ at: Date | null }>(
      `SELECT MAX(created_at) AS at FROM ops_alerts
        WHERE kind = $1 AND source = $2`,
      [LEDGER_KIND, ledgerSource(jobId)],
    ),
  );
  if (!r.ok) return { state: 'read_failed', error: r.error.message };
  const at = r.value.rows[0]?.at;
  return at ? { state: 'ran', at: new Date(at) } : { state: 'never' };
}

/** Every job's last success in one round trip. Same three states, per job. */
export async function allLastSuccess(): Promise<Map<string, LastSuccess>> {
  const out = new Map<string, LastSuccess>();
  const r = await attempt(
    'ops/cron-ledger · last success (all)',
    pool.query<{ source: string; at: Date }>(
      `SELECT source, MAX(created_at) AS at FROM ops_alerts
        WHERE kind = $1 GROUP BY source`,
      [LEDGER_KIND],
    ),
  );
  if (!r.ok) {
    for (const j of CRON_JOBS) out.set(j.id, { state: 'read_failed', error: r.error.message });
    return out;
  }
  const bySource = new Map(r.value.rows.map((row) => [row.source, new Date(row.at)]));
  for (const j of CRON_JOBS) {
    const at = bySource.get(ledgerSource(j.id));
    out.set(j.id, at ? { state: 'ran', at } : { state: 'never' });
  }
  return out;
}

/**
 * Stamp a successful completion.
 *
 * Called by the ROUTE, not by the tick, so it records the job running WHOEVER
 * triggered it — the GitHub workflow, the in-process heartbeat, or a human with
 * curl. That is what lets the two triggers dedupe against each other instead of
 * doubling, and it is the whole reason the old workflows can stay switched on
 * while the new path is proved.
 *
 * `acked_at` is stamped at insert: a heartbeat is not an alert, and
 * `recentUnackedAlerts()` — the admin surface — must not fill with them.
 *
 * Never throws. A ledger write that fails costs one duplicated run of an
 * idempotent job; a ledger write that throws would cost the job's own response.
 */
export async function recordCronSuccess(
  jobId: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  const r = await attempt(
    `ops/cron-ledger · record success ${jobId}`,
    pool.query(
      `INSERT INTO ops_alerts (kind, severity, message, metadata, source, acked_at)
       VALUES ($1, 'info', $2, $3::jsonb, $4, NOW())`,
      [
        LEDGER_KIND,
        `${jobId} completed`,
        metadata ? JSON.stringify(metadata) : null,
        ledgerSource(jobId),
      ],
    ),
  );
  if (!r.ok) {
    // Already logged by `attempt`. Named here so the consequence is written
    // down where the next reader is: the job DID run, and the ledger will let
    // it run again.
    console.warn(`[cron-ledger] ${jobId} succeeded but its heartbeat did not persist`);
  }
}

/**
 * Which staleness states are worth an alert.
 *
 * `never_run` IS one, and that is a deliberate choice with a cost. On the very
 * first deploy of this module the ledger is empty, so every job reports
 * `never_run` and the first tick writes one `warn` row each. That burst is
 * accurate rather than noisy — "there is no record that this job has ever
 * completed" is exactly the true statement about a system whose entire problem
 * is jobs not running — it self-clears within a day as each job stamps its
 * first heartbeat, and the cooldown holds it to one row per job per half-budget
 * meanwhile.
 *
 * It also buys the thing Rule 20 asks for. An alert nobody has ever watched
 * fire is a hypothesis, and this is the only state reachable on day one: the
 * alternative (suppress `never_run`) would have shipped an alerting path whose
 * first real exercise was the incident it was built for.
 *
 * `ok` is not an alert. Pulled out as a named predicate so the tick and the
 * tests ask the same question in the same words (Rule 16).
 */
export function stalenessIsAlertable(s: Staleness): boolean {
  return s.state === 'stale' || s.state === 'unknown' || s.state === 'never_run';
}

/**
 * Raise a staleness alert, at most once per `staleAfterHours / 2` per job so a
 * job that has been dead for a week produces a handful of rows rather than one
 * per tick. Returns true when a row was written.
 */
export async function raiseStaleAlert(
  job: CronJob,
  s: Staleness,
): Promise<boolean> {
  const cooldownHours = Math.max(1, job.staleAfterHours / 2);
  const recent = await attempt(
    `ops/cron-ledger · stale dedupe ${job.id}`,
    pool.query(
      `SELECT 1 FROM ops_alerts
        WHERE kind = $1 AND source = $2
          AND created_at >= NOW() - make_interval(hours => $3::int)
        LIMIT 1`,
      [STALE_KIND, ledgerSource(job.id), Math.ceil(cooldownHours)],
    ),
  );
  // Fails CLOSED in the quiet direction: a dedupe check that cannot see must
  // not mint a duplicate every tick. The staleness itself is still reported in
  // the tick's response body, so the fact does not vanish with the row.
  if (!recent.ok || (recent.value.rowCount ?? 0) > 0) return false;

  const detail = s.state === 'never_run'
    ? 'has no recorded successful completion at all'
    : s.state === 'unknown'
      ? 'last-success read failed, so its health is unknown'
      : `last completed ${(s as { ageHours: number }).ageHours.toFixed(1)}h ago, budget ${job.staleAfterHours}h`;

  await raiseAlert({
    kind: STALE_KIND,
    // `stale` is an error: a job that ran and then stopped is a regression.
    // `never_run` and `unknown` are warnings: the first is usually a fresh
    // deploy and the second is a statement about the database, not the job.
    severity: s.state === 'stale' ? 'error' : 'warn',
    message: `Scheduled job ${job.id} ${detail}.`,
    source: ledgerSource(job.id),
    metadata: {
      job: job.id,
      path: job.path,
      slots_utc_hour: job.slotsUtcHour,
      stale_after_hours: job.staleAfterHours,
      state: s.state,
      age_hours: s.state === 'ok' || s.state === 'stale' ? s.ageHours : null,
    },
  });
  return true;
}

/** Record that a job ran with a precondition it could not satisfy. */
export async function raisePreconditionAlert(
  job: CronJob,
  unmet: readonly string[],
  detail: string,
): Promise<void> {
  await raiseAlert({
    kind: PRECONDITION_KIND,
    severity: 'error',
    message: `${job.id} ran with unmet preconditions: ${unmet.join(', ')}. ${detail}`,
    source: ledgerSource(job.id),
    metadata: { job: job.id, unmet, detail },
  });
}
