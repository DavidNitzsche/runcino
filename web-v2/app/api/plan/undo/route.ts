/**
 * POST /api/plan/undo · PUT THE BLOCK BACK.
 *
 * ─── the decision this implements ────────────────────────────────────────────
 *
 * 2026-08-25. A cron re-authored the owner's training block overnight. The new
 * numbers were right. He had no way to know it had happened, no way to see what
 * changed, and no way to put it back. Asked what should happen when the engine
 * decides his plan should change, he chose APPLY, BUT LET ME UNDO — over asking
 * first, and over applying silently.
 *
 * The evidence behind that choice is what shapes this route. Of forty
 * engine-raised proposals in his history he has answered ZERO; thirty-nine
 * expired. Propose-and-wait is, for this runner, propose-and-expire, and an
 * under-prescription would have sat uncorrected for a fortnight while nobody
 * said no. So the engine keeps acting. This is the other half of that bargain,
 * and it has to actually work, because a bargain where the undo silently loses
 * a run he did is worse than no undo at all.
 *
 * ─── WHOLESALE RESTORE, NOT RE-APPLY. AND WHY ────────────────────────────────
 *
 * The two designs on the table were:
 *
 *   A · un-archive the old block and put the new one away.
 *   B · keep the new block and copy the old block's prescriptions into it.
 *
 * This route does A. The argument, in the order the reasons actually matter:
 *
 * 1 · B DOES NOT UNDO THE THING HE NOTICED. He found out his plan had changed
 *     because the WEEK COUNTER RESET. Block identity — how many weeks this
 *     block is, which week of it he is in — is not a cosmetic property, it is
 *     the frame he reads his training through. B keeps the new block's identity
 *     and its week count and changes the numbers inside it. It puts the miles
 *     back and leaves the thing he actually complained about broken.
 *
 * 2 · B IS NOT GENERALLY POSSIBLE. The incident replaced a fourteen-day block
 *     with a seven-day one. Copying the old prescriptions into the new block
 *     means inserting a week that block does not have: new `plan_weeks`, new
 *     `plan_phases` spans, seven `plan_workouts` the composer never authored in
 *     that arrangement. The result is a block neither `composePlan` nor
 *     `validateComposedPlan` has ever seen. That is re-authoring wearing the
 *     word "undo", and re-authoring is the thing being undone.
 *
 * 3 · THE COMPLETION HAZARD DOES NOT FAVOUR B. This was the reason to expect B
 *     to win, and it turns out not to apply — see the next section. Neither
 *     design moves a stored pointer, because there is no stored pointer.
 *
 * 4 · A IS EXACT AND LOSES NOTHING. Both blocks and all their `plan_workouts`
 *     survive; only `archived_iso` moves. Undoing an undo is the same two
 *     statements the other way round.
 *
 * What A does discard is any adaptation applied to the new block's FUTURE days
 * since the rebuild. That is what "put it back" means, and those rows are not
 * destroyed — they sit on the archived block exactly as the undone block's rows
 * did an hour earlier.
 *
 * ─── THE COMPLETION-POINTER HAZARD, RESOLVED ─────────────────────────────────
 *
 * The audit that recommended this feature named the hazard as "which
 * `plan_workout_id` a completed run points at after an un-archive". Established
 * by reading every writer:
 *
 *   THERE IS NO SUCH POINTER. `runs` has no `plan_workout_id` column. Neither
 *   does `day_actions`. The only `plan_workout_id` in the schema is on
 *   `plan_workout_proposals`, and it is a loose TEXT reference with no foreign
 *   key. A completed run is matched to a prescription BY CALENDAR DATE, at read
 *   time, every time — `lib/plan/owned-days.ts`, `lib/plan/seal.ts:isDaySealed`,
 *   `lib/execution/load.ts:loadKeySessionExecutions`. Every rebuild mints brand
 *   new `plan_workouts` ids for the same dates and nothing is re-pointed,
 *   because nothing points.
 *
 * So an un-archive cannot orphan a run, cannot double-count one, and cannot
 * break a pointer. What it CAN do is change which prescription a date resolves
 * to. That is the real hazard and it is sharper than the one that was named,
 * because it is silent: the run row is untouched and correct, and the sentence
 * the app says about it changes.
 *
 * Three things stand in front of it.
 *
 *   RULE 15 makes most of it moot. `snapshotSealedDays` copies the prior
 *   block's prescription for every completed day onto the new block's rows at
 *   rebuild time, so for any date the runner had already run, the two blocks
 *   agree BY CONSTRUCTION and restoring one over the other changes nothing.
 *
 *   THE COMPLETED-DAY GATE below does not assume that. It reads both blocks and
 *   compares them, day by day, on every date the runner has actually run. Rule
 *   15's own enforcement was broken from some point until 2026-08-24 (a `$1`
 *   typed as text against a uuid column made `isDaySealed` throw for every user
 *   and every date, and the catch answered "not sealed"), so a gate that
 *   trusted sealing would be trusting a guard that has demonstrably failed
 *   silently. This one checks.
 *
 *   `ownedDaysSql` was taught to prefer the ACTIVE plan before falling back to
 *   the most recently authored one. Without that, un-archiving would have left
 *   the week strip showing the restored block while execution scoring, the
 *   adapter and the goal projection kept grading him against the block he had
 *   just rejected — two surfaces, two answers, no error anywhere.
 *
 * ─── WHEN THIS REFUSES ───────────────────────────────────────────────────────
 *
 * A refusal is a correct answer, not an empty state. This returns 409 with a
 * coach-voice sentence, and the card renders it, when:
 *
 *   · a run exists on a date the two blocks prescribe differently. Restoring
 *     would change what he was asked to do on a day he already did. This is the
 *     one the whole design is built around: a wrong undo loses a run he did.
 *   · the block the rebuild authored is no longer the active one. Something has
 *     happened since; undoing into an unknown state is not undoing.
 *   · the block to restore has already run out of days. Handing back a block
 *     with nothing left in it is not a kindness.
 *
 * ─── NO DDL ──────────────────────────────────────────────────────────────────
 *
 * Nothing here needs a migration. `plan_proposals.status` is TEXT with no check
 * constraint, `archive_reason` already exists, and the fingerprint rides in the
 * `reasons` jsonb. The only index touched is `training_plans_active_uq`
 * (migration 142, UNIQUE on `user_uuid WHERE archived_iso IS NULL`) — which is
 * exactly why the two statements below run in that order, inside one
 * transaction: archive the new block FIRST, then un-archive the old one. The
 * other order raises a unique violation halfway through.
 */

import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { requireUserId } from '@/lib/auth/session';
import { outage } from '@/lib/route/failure';
import { snapshotPrescription } from '@/lib/plan/mutate';
import {
  dayFingerprint, prescriptionFingerprint, fingerprintDigest, type PrescribedDay,
} from '@/lib/plan/plan-delta';
import { runnerToday, runnerTimezoneOrPacific } from '@/lib/runtime/runner-tz';
import { runDaySql, runNotMergedSql } from '@/lib/runs/run-shape';

/** The reason a refusal gives, in the voice the card renders verbatim. */
type Refusal = { error: string; message: string; status: number };

export async function POST(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const body = await req.json().catch(() => null);
  const proposalId = Number(body?.id ?? body?.proposalId);
  if (!Number.isFinite(proposalId) || proposalId <= 0) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  const todayISO = await runnerToday(userId).catch(() => new Date().toISOString().slice(0, 10));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1 · the ledger row. `plan_id` is the block that was archived, `new_plan_id`
    //     the one that replaced it. This pairing is the ONLY record of which
    //     block succeeded which, so an undo is only offerable where it exists.
    const proposal = (await client.query<{
      id: number; plan_id: string | null; new_plan_id: string | null;
      proposal_kind: string; status: string; reasons: Record<string, unknown> | null;
    }>(
      `SELECT id, plan_id::text AS plan_id, new_plan_id::text AS new_plan_id,
              proposal_kind, status, reasons
         FROM plan_proposals
        WHERE id = $1 AND user_uuid = $2::uuid
        FOR UPDATE`,
      [proposalId, userId],
    )).rows[0];

    if (!proposal) return await refuse(client, {
      error: 'not_found', status: 404,
      message: 'That change is not on your record.',
    });

    if (proposal.status === 'undone') return await refuse(client, {
      error: 'already_undone', status: 409,
      message: 'That one is already back.',
    });

    if (proposal.status !== 'auto_applied' || !proposal.new_plan_id || !proposal.plan_id) {
      return await refuse(client, {
        error: 'not_undoable', status: 409,
        // A row with no `new_plan_id` recorded no replacement, which means
        // either nothing was replaced or the rebuild transaction committed and
        // the audit write after it did not. Either way there is no block to
        // hand back and saying so plainly beats guessing at one.
        message: 'There is no earlier block recorded for that change.',
      });
    }

    const restoreId = proposal.plan_id;   // the block to bring back
    const putAwayId = proposal.new_plan_id; // the block the engine authored

    // 2 · the runner's active plan must still BE the block this row authored.
    //     If another rebuild, a race result or a settings change has landed
    //     since, undoing this one would restore a block into a world that has
    //     moved past it.
    const actives = (await client.query<{ id: string }>(
      `SELECT id::text AS id FROM training_plans
        WHERE user_uuid = $1::uuid AND archived_iso IS NULL`,
      [userId],
    )).rows;
    if (actives.length !== 1 || actives[0].id !== putAwayId) {
      return await refuse(client, {
        error: 'superseded', status: 409,
        message: 'Your plan has changed again since then. There is nothing to put back.',
      });
    }

    // 3 · the block to restore has to exist, belong to this runner, and be the
    //     archived one. Belt and braces: `plan_id` came off a row already
    //     scoped to the user, but this is the statement that un-archives.
    const restoreRow = (await client.query<{ id: string; archived_iso: string | null }>(
      `SELECT id::text AS id, archived_iso::text AS archived_iso
         FROM training_plans WHERE id = $1 AND user_uuid = $2::uuid`,
      [restoreId, userId],
    )).rows[0];
    if (!restoreRow || restoreRow.archived_iso == null) {
      return await refuse(client, {
        error: 'restore_target_missing', status: 409,
        message: 'The earlier block is no longer on file.',
      });
    }

    // 4 · read both blocks.
    const [restore, putAway] = await Promise.all([
      snapshotPrescription(client, restoreId),
      snapshotPrescription(client, putAwayId),
    ]);

    // 5 · the restored block must still have days left in it. Restoring an
    //     elapsed block hands the runner a plan that ends yesterday, and the
    //     `plan_elapsed` path would rebuild over it on the next cron anyway.
    const lastRestoreDay = restore.days.reduce<string | null>(
      (m, d) => (m == null || d.dateISO > m ? d.dateISO : m), null,
    );
    if (lastRestoreDay == null || lastRestoreDay < todayISO) {
      return await refuse(client, {
        error: 'restore_target_elapsed', status: 409,
        message: 'The earlier block has already run out of days. Rebuilding is the only way forward from here.',
      });
    }

    // 6 · THE GATE. Every date the runner has actually run, on either block.
    //
    //     Rule 15 should make these agree — the rebuild copies the prior
    //     block's prescription onto the new block's row for every completed
    //     day. This does not take that on trust. `isDaySealed` was broken for
    //     months without anyone noticing, and the cost of trusting a guard that
    //     can fail silently is a run the runner did being re-described as
    //     something he did not.
    // runnerTimezoneOrPacific — this scan includes coach_intents
    // watch-completion rows, the exact case that helper is named for. A
    // runner with no stored timezone is legacy single-user-era data
    // stamped in Pacific wall time, never UTC.
    const tzForConflictScan = await runnerTimezoneOrPacific(userId).catch(() => 'America/Los_Angeles');
    const conflicts = await conflictingCompletedDays(client, userId, restore.days, putAway.days, tzForConflictScan);
    if (conflicts.length > 0) {
      const first = conflicts[0];
      const n = conflicts.length;
      return await refuse(client, {
        error: 'completed_day_conflict', status: 409,
        message: n === 1
          ? `You have already run ${shortDate(first)}, and the two blocks ask for different things that day. Putting the old one back would change what you did.`
          : `You have already run ${n} days that the two blocks treat differently, starting ${shortDate(first)}. Putting the old one back would change what you did.`,
      });
    }

    // 7 · THE SWAP. Archive first, un-archive second — `training_plans_active_uq`
    //     is a unique partial index on the active row and the other order
    //     collides mid-transaction.
    await client.query(
      `UPDATE training_plans
          SET archived_iso = NOW(), archive_reason = 'undone_by_runner'
        WHERE id = $1 AND user_uuid = $2::uuid`,
      [putAwayId, userId],
    );
    await client.query(
      // `archive_reason` is cleared with `archived_iso` so the row does not
      // read as "archived because long_drift" while being live. The reason it
      // WAS archived survives on the proposal row below, which is the record
      // built for exactly that question.
      `UPDATE training_plans
          SET archived_iso = NULL, archive_reason = NULL
        WHERE id = $1 AND user_uuid = $2::uuid`,
      [restoreId, userId],
    );

    // 8 · pending workout-level proposals point at `plan_workouts` rows on the
    //     block just put away, by a TEXT id with no foreign key. Accepting one
    //     after this would apply an adaptation to a workout on an archived
    //     plan — a write nothing would ever surface and nothing would catch.
    //     Superseded, not deleted.
    //
    // NOT caught. This runs on the undo's own transaction and a failure here
    // must take the whole undo down, not be reported as "zero rows superseded".
    // Those two are different states: one leaves the plan swap unapplied and
    // the runner able to try again, the other leaves the swap COMMITTED with
    // live proposals pointing into an archived block, which is precisely the
    // dangling write this statement exists to prevent. The outer catch rolls
    // back and answers with `outage`.
    const orphaned = await client.query(
      `UPDATE plan_workout_proposals
          SET status = 'superseded', resolved_at = NOW()
        WHERE user_uuid = $1::uuid
          AND status = 'pending'
          AND plan_workout_id IN (SELECT id::text FROM plan_workouts WHERE plan_id = $2)`,
      [userId, putAwayId],
    );

    // 9 · close the ledger row, and record the FINGERPRINT of the block that
    //     was rejected. That digest is what `generatePlan`'s commit gate reads:
    //     the next rebuild that would re-land this exact block rolls back
    //     instead. Scoped to the OUTPUT rather than to the signal, so the
    //     engine stays free to act on the same drift tomorrow as long as it
    //     wants a different week — which is what keeps an undo from becoming
    //     the fortnight of silence this whole design exists to avoid.
    const digest = fingerprintDigest(prescriptionFingerprint(putAway));
    await client.query(
      `UPDATE plan_proposals
          SET status = 'undone', resolved_at = NOW(),
              reasons = COALESCE(reasons, '{}'::jsonb) || $2::jsonb
        WHERE id = $1`,
      [proposalId, JSON.stringify({
        undone_at: new Date().toISOString(),
        undone_plan_id: putAwayId,
        restored_plan_id: restoreId,
        undone_fingerprint: digest,
        workout_proposals_superseded: orphaned.rowCount ?? 0,
      })],
    );

    await client.query('COMMIT');

    // Post-commit, best effort. The memoized plan lookup would otherwise serve
    // the block we just archived for the rest of its TTL.
    try {
      (await import('@/lib/plan/lookup')).bustPlanLookupCache(userId);
    } catch {/* non-blocking */}
    try {
      const { bustBriefingCacheForEvent } = await import('@/lib/coach/cache');
      await bustBriefingCacheForEvent(userId, 'plan_swap');
    } catch {/* non-blocking */}

    console.log(
      `[plan/undo] restored ${restoreId} · archived ${putAwayId} · `
      + `proposal=${proposalId} kind=${proposal.proposal_kind} user=${userId.slice(0, 8)}`,
    );

    return NextResponse.json({
      ok: true,
      restoredPlanId: restoreId,
      archivedPlanId: putAwayId,
    });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {/* the connection is going back either way */}
    return outage('api/plan/undo', e);
  } finally {
    client.release();
  }
}

/** Roll back the read transaction and answer. A refusal writes nothing. */
async function refuse(
  client: { query: (q: string) => Promise<unknown> },
  r: Refusal,
): Promise<NextResponse> {
  try { await client.query('ROLLBACK'); } catch {/* nothing was written */}
  return NextResponse.json({ ok: false, error: r.error, message: r.message }, { status: r.status });
}

/**
 * Dates the runner has run where the two blocks do not prescribe the same
 * thing. Sorted, earliest first.
 *
 * "Has run" uses the SAME definition `isDaySealed` uses — a `runs` row with no
 * `mergedIntoId`, or a `watch_completion` coach intent — because a day that is
 * sealed against the adapter is exactly a day that must not be re-described by
 * an undo. One definition, two callers.
 *
 * A date neither block prescribes is not a conflict: an unplanned run has no
 * prescription to lose. A date only ONE block prescribes IS a conflict, because
 * restoring would either attach a prescription to a run that had none or strip
 * one from a run that had it, and both change what the app says he did.
 */
async function conflictingCompletedDays(
  client: { query: typeof pool.query },
  userUuid: string,
  restoreDays: PrescribedDay[],
  putAwayDays: PrescribedDay[],
  tz: string,
): Promise<string[]> {
  const spanStart = [...restoreDays, ...putAwayDays]
    .reduce<string | null>((m, d) => (m == null || d.dateISO < m ? d.dateISO : m), null);
  const spanEnd = [...restoreDays, ...putAwayDays]
    .reduce<string | null>((m, d) => (m == null || d.dateISO > m ? d.dateISO : m), null);
  if (spanStart == null || spanEnd == null) return [];

  const completed = (await client.query<{ d: string }>(
    // The day key and the merge-loser filter come from `lib/runs/run-shape.ts`
    // rather than being spelled here. There is one correct answer to "which day
    // is this run on" and one to "is this row the real one", and a route that
    // re-spells either is a second definition that will drift.
    //
    // Both sides of `$1` are pinned to their column's type. A bare parameter
    // shared across a `uuid` column and a `text` one is what made `isDaySealed`
    // throw for every user and every date until 2026-08-24, and this query is
    // the same shape.
    `SELECT DISTINCT d::text AS d FROM (
       SELECT ${runDaySql('r')}::date AS d
         FROM runs r
        WHERE r.user_uuid = $1::uuid
          AND ${runNotMergedSql('r')}
       UNION
       SELECT (ci.ts AT TIME ZONE $4::text)::date AS d
         FROM coach_intents ci
        WHERE COALESCE(ci.user_uuid::text, ci.user_id::text) = $1::text
          AND ci.reason = 'watch_completion'
     ) x
      WHERE d >= $2::date AND d <= $3::date`,
    [userUuid, spanStart, spanEnd, tz],
  )).rows.map((r) => String(r.d).slice(0, 10));

  const fpRestore = new Map<string, string>();
  for (const d of restoreDays) fpRestore.set(d.dateISO, dayFingerprint(d));
  const fpPutAway = new Map<string, string>();
  for (const d of putAwayDays) fpPutAway.set(d.dateISO, dayFingerprint(d));

  const out: string[] = [];
  for (const d of completed) {
    const a = fpRestore.get(d);
    const b = fpPutAway.get(d);
    if (a === undefined && b === undefined) continue;
    if (a !== b) out.push(d);
  }
  return out.sort();
}

/** "Tuesday the 19th" reads worse than a date. Keep it short and unambiguous. */
function shortDate(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z');
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
  }).format(d);
}

export async function GET() {
  return NextResponse.json({
    endpoint: 'POST /api/plan/undo',
    body: '{ "id": <plan_proposals.id of an auto_applied rebuild> }',
    does: 'Archives the block the engine authored and un-archives the one it replaced. Nothing is deleted.',
    refuses: [
      'completed_day_conflict · a run exists on a date the two blocks prescribe differently',
      'superseded · the plan has changed again since that rebuild',
      'restore_target_elapsed · the earlier block has no days left',
      'not_undoable · no earlier block is recorded against that change',
    ],
    note:
      'A completed run carries no pointer to a prescription — the match is by calendar date at read '
      + 'time — so this cannot orphan or double-count one. What it can do is change which prescription '
      + 'a date resolves to, which is why the completed-day gate compares both blocks rather than '
      + 'trusting Rule 15 sealing to have made them agree.',
  });
}
