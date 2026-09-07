# Handback · round 12 · 2026-09-06/07 (supersedes every earlier draft in this file)

`main` at `3127f3c28`. Railway confirmed `SUCCESS` for every commit below,
independently, for its own exact SHA, before the next commit started.
TestFlight **286** shipped and live (build 287 is next, unused).
`AUTOMATIC_ADAPTATION_AUTHORITY` still the literal `false`. **No production
DDL applied. Your plan has not been written to, anywhere in this round.**

Two agents are still running as this is written (the primary uninterrupted-
PUSH objective, and the duplicate-request-flood investigation you just
reported live). The reassessment-evaluator matrix has landed and is
integrated (§ new, below §4) — one real bug found (a deferral-queue failure
that sat in an unread return value, never surfacing anywhere) and fixed,
deployed, Railway-confirmed. This handback states plainly, per item, whether
something is closed, open, or still in flight — nothing below is rounded up.

---

## The ten answers, first, unambiguous

1. **Is orchestration genuinely 16/16? No. It is 14/16, re-derived from the
   real import graph, not trusted from either of two earlier conflicting
   claims (12/16, 16/16).** Steps 3 (classify evidence) and 7 (generate
   options) are the two real gaps — see §4. Closing both is the primary
   deliverable currently in flight (§3); not complete as of this writing.
2. **Did one organic, non-seeded decision complete the entire loop? Not yet,
   confirmed as still open, not claimed as done.** Two real but SEPARATE
   halves were proven in the previous round (a real rolling-boundary PROCEED
   that dead-ends at `reassessment_schedule`, and a constructed
   `RampOpportunity` that walked proposal→acceptance→mutation→ledger). You
   correctly rejected calling that one path. An agent is currently working
   specifically to make those the same decision (§3). This handback does not
   claim success until that agent reports it, verified by me.
3. **Can that decision survive restart and plan rebuild?** Partially answered
   from prior work (idempotency and restart were proven for the constructed-
   proposal half); not yet answered for a genuinely organic verdict, because
   no organic verdict has reached a proposal yet.
4. **Can the runner accept or decline it on the shipped V5 surface?** Yes, for
   proposals in general (accept/decline both fire real requests, verified
   this session) — but not yet for an ORGANIC rolling-boundary verdict
   specifically, because that verdict cannot become a card yet (§4, Step 7).
5. **Are mutation and ledger atomic in production, or still blocked on DDL?
   Still blocked on DDL.** `plan_decision_ledger` (migration 166) does not
   exist in production. Every real mutation attempt through the ledger-
   required paths currently refuses in production, correctly and visibly,
   rather than proceeding unaudited (LEDGERREQUIRED-1). This includes
   Move-a-Run: confirmed this session that the LIVE Move button (not just an
   older screen) now goes through the correct, doctrine-adjudicated route,
   and that route also refuses in production for the same reason. **State
   plainly: proposal acceptance and Move-a-Run are deliberately unavailable
   in production right now, because unaudited mutation refuses without
   migration 166. Neither is operational until you approve it.**
6. **Which reassessment kinds genuinely re-evaluate? All six, verified this
   round against real local databases, full 9-point matrix in §4a.** EARNING_
   GATE, CONDITIONAL_DOSE, POST_RACE_RECOVERY_CHECK, RETURN_TO_TRAINING_STAGE
   and DEFERRAL are each fully proven on all 9 points except three narrow,
   named, gracefully-degrading gaps (§4a). PROPOSAL_EXPIRATION is proven on
   8 of 9 (no plan-lineage tie, uses a slower but real 14+3 day auto-expiry
   instead — not silent, just a different mechanism). One real bug was found
   and is now fixed: a deferral-queue carry failure computed an honest error
   sentence that nothing ever read — now raises a real, visible alert.
   FAILED_EVALUATION remains correctly NOT built as a seventh coaching kind —
   operational failure state on the row's own `attempts`/`last_error`
   columns, not a coaching trigger, per your own instruction.
7. **How many generators and facets are complete?** Not re-counted this
   round — the last trusted count is 13/21 generators (your own stated
   baseline) — I have not re-derived this number against the real call graph
   the way I did for orchestration, and I do not trust the 13/21 or 265/294
   figures without doing that first. This is flagged as NOT YET DONE, not
   assumed correct.
8. **Which belief quantities still have multiple live owners?** Not re-
   audited this round beyond what a prior session's census already found
   (11 of 12 belief quantities carried more than one production-reachable
   owner, each with a measured delta and a named migration, per the stale
   draft this file replaces). That census itself was a census, not consumer
   migration, and you explicitly said not to stop at a census. This is a
   real, named, NOT YET STARTED piece of this round's work.
9. **What was physically verified?** By me, directly, via the simulator
   against a real local copy of your production data (walk-substrate), with
   screenshots and server-log confirmation, not claimed from reading code:
   the Skip/Put-it-back round trip (both directions, DB-row-confirmed), and
   the Move flow now hitting `/api/plan/move` with the engine's exact
   refusal text rendering verbatim. By an agent, reported and independently
   spot-checked by me on the load-bearing claims: the reassessment-evaluator
   and Move-a-Run audits from the previous round, the orchestration count
   (I personally re-ran the falsification), the uuid/text bug (I personally
   confirmed the column type against the schema before applying the fix),
   and the supplemental-run grading fix (I personally re-ran the full
   adjacent test suite after applying). Native/Watch verification against
   the FULL specific checklist you gave tonight (Decisions loading, stale-
   proposal refusal, accepted-change consistency across Today/Block/Watch,
   Watch explanation accuracy, a clean Watch test suite) has **not** been run
   this round — flagged as open, not assumed passing.
10. **What still requires my approval?** Migrations 166/167/168/169 and the
    `plan_weeks`/`plan_phases` backfill (literal SQL below, §6); the pace-
    drift correction mechanism (§7 — two candidate fixes, your call which, or
    neither); the stale `evidence-classifier` branch is already resolved
    (deleted, no unique work — done, not pending); everything in §3/§4 that
    the in-flight agents have not yet reported.

---

## 1 · Tonight's live findings, found on your own phone, fixed and shipped

**The "Holding the plan as it is" HOLD card, dated Sept 13.** Real bug, not a
timezone issue. A new evidence reader integrated earlier tonight
(`long-run-structure.ts`) selects "the runner's next long run" by
`plan_workouts.is_long = true` alone. Your Sept 13 Santa Monica 10K carries
`is_long=true, type='race'` — a legitimate convention (a race replaces the
week's long run for volume-counting) — so the reader asked "has this session
earned a race-pace finish segment" about your actual race. Harmless verdict
(a race trivially reads as "no segment," so it correctly held), nonsensical
card. Fixed by excluding `type = 'race'` from both of that reader's queries;
confirmed live against production (read-only) that the fixed query now finds
your real next long run (Sept 20, 16.5mi, already carrying a race-pace
segment). Commit `2791821f7`, deployed, Railway `SUCCESS` confirmed.

**The timezone question.** Checked directly: your stored timezone is
`America/Los_Angeles`, and the server's `runnerToday()` for your account
computed `2026-09-06` at the moment you reported "11pm Sunday" — correct,
matching your wall clock exactly. No date-computation bug found. If a
specific date printed somewhere still looks wrong, point me at it directly.

**The duplicate-request flood + flapping "Can't reach faff" banner.** You
sent the app's own Request Log showing the same ~5 surface fetches (today,
block, races, plan-snapshot, ingest) firing in two back-to-back waves,
98 requests in one session, with a transient outage banner that cleared
itself. This matches a concern already named in your own checklist tonight
and an unresolved finding from an earlier round. **An agent is investigating
this live right now** — leading hypothesis is `.faffForegroundRefresh` firing
twice per real foreground event, which every `V5Surface` (Today, Block,
Races, …) independently reacts to, explaining the exact paired-duplicate
shape; being confirmed or refuted against a live reproduction before any fix
lands, not assumed. **Open, in flight, not yet closed.**

## 2 · Skip and Move — closed this session, shipped, verified live

- **Skip** (`SKIPCONFIRM-1`): the write always worked; nothing read it back,
  so the row never confirmed anything happened. Fixed both ends, verified
  live both directions against a real copy of your data (skip → row updates
  → real DB row appears; put it back → row reverts → DB row gone). TestFlight
  285.
- **Move** (`MOVEREADJUDICATE-TODAY-1`): the actual Move button in Today was
  calling the old, non-adjudicating, non-undoable route despite an earlier
  claim that Move-a-Run had reached every iPhone path. It had not, for this
  specific screen. Repointed to the canonical route, reusing the existing
  correct implementation rather than inventing a second one. Verified live:
  the request now hits `/api/plan/move`, and the engine's real refusal
  ("That day has already been…") renders verbatim. TestFlight 286.
- Both together directly answer your Monday question from earlier tonight:
  the engine refuses to move any day `<=` today, by design (Q36), and the
  fix makes the app finally enforce the rule it was always supposed to.

## 3 · The primary deliverable — IN FLIGHT, not claimed complete

Dispatched with your exact standard: no constructed intermediates after
execution load, no seeded verdict/belief/option/proposal, one decision ID
and one plan lineage/version preserved end to end, all ten proofs against
the SAME connected pipeline. Explicitly briefed to build the missing Step-7
production caller (reusing the existing ranker, the existing phase-aware
arbitrator, the existing authority boundary — never a second generator) and
wire the rolling-boundary evaluator's real PROCEED into it, rather than
leaving it dead-ending at `reassessment_schedule`. **Not yet reported.**
Will not be described as done in the next update unless the agent's own
first line says so unambiguously and I have independently re-verified the
central claim against the merged tree, per your explicit instruction.

## 4 · Orchestration — corrected to 14/16, re-verification of steps 3 and 7 in flight

Re-derived by hand against the real import graph rather than trusting either
stale number. **Steps 4 and 12 were already reachable from real routes/crons
and the map had gone stale** — promoted with the full call chain cited
inline, pin raised 12→14 as a correction. Closed a real blind spot in the
gate itself (it only ever checked UNWIRED steps for a quietly-grown caller,
never SHADOW steps — exactly how 4 and 12 went stale undetected); I
personally falsified the new check by hand (reverted step 4, confirmed the
gate correctly failed and named the real caller; restored, confirmed clean).
Commit `2aaafe3b6`, deployed.

**Genuinely still open, both now inside the in-flight primary-deliverable
work (§3):**
- **Step 3 (classify evidence).** The full 19-tag `classifyEvidence` record is
  real and correct (all 19 tags genuinely classified, all three-state
  correct — verified this session) but has ZERO production consumers. Only a
  6-tag slice feeds a pipeline proven incapable of mutating anything. `partial`
  and `overrun` reach nothing anywhere; `overrun`'s tolerance constant has no
  doctrine citation. All of this is now the explicit brief of the in-flight
  agent — full wiring or explicit removal of the two dead tags, a citation or
  an honest refusal for `overrun`.
- **Step 7 (generate options).** Real ranking code, zero production callers.
  Also explicit brief of the in-flight agent — one production caller, reusing
  the existing arbitrator and authority boundary, never a second generator.

## 4a · Reassessment evaluators — all 6 kinds verified, one real bug fixed

Verified against real local databases (including a walk-substrate copy
holding genuine prior evaluation data, plus a due-selection→evaluation→
resolve cycle driven live by hand, not just read from a test file), all 9
required properties per kind (scheduling, restart-persistence, due-selection,
fresh-evidence-reload, stale-plan supersession, evaluation, resulting-
decision, terminal-state, retry/visible-failure):

| Kind | Result |
|---|---|
| EARNING_GATE | 8/9 clean; evaluator throws bypass the formal retry counter but still surface via next-day overdue alerts — visible-eventually, not silent |
| CONDITIONAL_DOSE | 7/9 clean; same retry-counter gap, plus one boundary (`weekend_after_quality`) can only ever REFUSE today because its upstream work-duration parser doesn't exist yet anywhere in the app — honest, self-documented, not silent |
| POST_RACE_RECOVERY_CHECK | 9/9 |
| RETURN_TO_TRAINING_STAGE | 9/9 |
| PROPOSAL_EXPIRATION | 8/9; no plan-lineage tie, so a full plan rebuild doesn't retire it via the generic path — instead resolved by a real, separate 14+3 day auto-expiry, slower but not silent |
| DEFERRAL | 9/9 after this round's fix (was 8/9 — see below) |

**The one real bug, found by tracing source to a confirmed dead end, not
hypothesized:** the deferral queue's own carry outcome — did it actually
persist across this boundary — was computed as an honest sentence and never
read by anything, the exact "log buffer nothing can see" shape a sibling
mechanism (`canonical_shadow_exit`) already exists to prevent, one line
above it in the same cron. Fixed: a `deferralsHealth` verdict now
accompanies that sentence, and a new `deferral_queue_carry` ops alert fires
per pass — `EXPECTED` while migration 167 is unapplied, a real `DEFECT` the
moment a queue can't be read or a persist genuinely throws. Deployed,
Railway-confirmed.

## 5 · Belief-owner consolidation and Pa:HR proof matrix — NOT YET STARTED this round

Both explicitly requested and both genuinely not begun in this round, stated
plainly rather than folded into "in flight." Queued next once the primary-
deliverable and reassessment agents return, so they don't compete for the
same evidence-classifier/rolling-boundary files those agents are actively
editing.

## 6 · Migrations — literal SQL, not a filename, for every item

**None of this has been applied. All six items below remain pending your
explicit, statement-by-statement go**, per this repo's own deployment
doctrine (DDL always separate from code approval). Full statement-by-
statement locking/verification/rollback detail beyond what's summarized here
lives in `docs/reports/brain-2026-09-05/MIGRATION-PACKET.md` (1460 lines,
already committed, already reviewed in a prior round) — this section
inlines every actual SQL statement so nothing requires opening a second file
to approve.

### 166 · `plan_decision_ledger` — the durable decision ledger

Additive only: one new table, five indexes, one comment. No ALTER, no rename,
no drop, no NOT NULL against existing data (the table has no existing rows).
Reversed by `DROP TABLE IF EXISTS plan_decision_ledger;`. Locking: none
beyond the DDL's own brief lock on a brand-new, empty table — sub-second.
Pre-state: table does not exist. Post-state: table exists, 0 rows. Verify:
`SELECT count(*) FROM plan_decision_ledger;` → expect `0`, no error.

```sql
CREATE TABLE IF NOT EXISTS plan_decision_ledger (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_uuid             uuid NOT NULL,
  plan_id               text,
  plan_lineage_id       text NOT NULL,
  replaced_plan_id      text,
  plan_version          text,
  scope                 text NOT NULL
                          CHECK (scope IN ('PLAN', 'WEEK', 'WORKOUT', 'NONE')),
  workout_ids           jsonb NOT NULL DEFAULT '[]'::jsonb,
  scope_from_iso        date,
  scope_to_iso          date,
  lever                 text NOT NULL
                          CHECK (lever IN (
                            'PACE', 'VOLUME', 'LONG_RUN', 'SESSION_SHAPE',
                            'SCHEDULE', 'PLAN_STRUCTURE', 'RECORD_ONLY')),
  direction             text NOT NULL
                          CHECK (direction IN ('UP', 'DOWN', 'NEUTRAL', 'UNKNOWN')),
  evidence              jsonb NOT NULL DEFAULT '[]'::jsonb,
  provenance            text NOT NULL,
  source_mode           text,
  before_state          jsonb,
  after_state           jsonb,
  authority             text NOT NULL
                          CHECK (authority IN (
                            'RUNNER_INITIATED', 'RUNNER_ACCEPTED', 'LIFECYCLE',
                            'COACHING_ADAPTATION', 'AUTHORSHIP')),
  authority_verdict     text NOT NULL
                          CHECK (authority_verdict IN ('PERMITTED', 'REFUSED', 'HELD')),
  hold                  jsonb,
  decision              text NOT NULL
                          CHECK (decision IN (
                            'PROGRESS', 'HOLD', 'REGRESS', 'REFUSE',
                            'APPLY', 'DEFER', 'EXPIRE', 'UNDO')),
  proposal_id           text,
  proposal              jsonb,
  runner_response       text
                          CHECK (runner_response IS NULL OR runner_response IN (
                            'PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED')),
  responded_at          timestamptz,
  mutation_outcome      text
                          CHECK (mutation_outcome IS NULL OR mutation_outcome IN (
                            'applied', 'rejected', 'undeclared_structural', 'bypassed',
                            'authorship_drift', 'no_plan', 'not_attempted',
                            'ledger_unwritten', 'duplicate')),
  mutation_violations   jsonb NOT NULL DEFAULT '[]'::jsonb,
  explanation           text NOT NULL,
  model_version         text NOT NULL,
  at                    timestamptz NOT NULL DEFAULT now(),
  superseded_by         uuid,
  superseded_at         timestamptz,
  undone_at             timestamptz,
  undo_reason           text,
  idempotency_key       text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plan_decision_ledger_explanation_is_present
    CHECK (length(explanation) > 0),
  CONSTRAINT plan_decision_ledger_supersession_is_explained
    CHECK ((superseded_at IS NULL AND superseded_by IS NULL)
        OR (superseded_at IS NOT NULL AND superseded_by IS NOT NULL)),
  CONSTRAINT plan_decision_ledger_undo_is_explained
    CHECK ((undone_at IS NULL AND undo_reason IS NULL)
        OR (undone_at IS NOT NULL AND undo_reason IS NOT NULL AND length(undo_reason) > 0)),
  CONSTRAINT plan_decision_ledger_response_is_timed
    CHECK ((COALESCE(runner_response, 'PENDING') IN ('ACCEPTED', 'DECLINED', 'EXPIRED'))
           = (responded_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS plan_decision_ledger_user_at
  ON plan_decision_ledger (user_uuid, at DESC);
CREATE INDEX IF NOT EXISTS plan_decision_ledger_direction
  ON plan_decision_ledger (user_uuid, direction, at DESC);
CREATE INDEX IF NOT EXISTS plan_decision_ledger_lineage
  ON plan_decision_ledger (plan_lineage_id, at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS plan_decision_ledger_idempotency
  ON plan_decision_ledger (user_uuid, provenance, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS plan_decision_ledger_pending_proposals
  ON plan_decision_ledger (user_uuid, at DESC)
  WHERE runner_response = 'PENDING';

COMMENT ON TABLE plan_decision_ledger IS
  'THE durable decision ledger. One row per coaching decision or plan mutation, written by '
  'lib/plan/mutate.ts (the one door in front of plan_workouts) and by the proposal surface. '
  'Survives a plan rebuild: plan_lineage_id is stable across the chain and there are no '
  'foreign keys, deliberately. Rows are never deleted; a decision that stops being current is '
  'superseded or undone, with its reason. Replaces training_plans.adaptation_log as the record '
  'of truth (that column is untouched and keeps its max(ts) consumers).';
```

**Idempotency:** `CREATE TABLE IF NOT EXISTS` — a second run is a no-op.
**Pre-use rollback (table still empty):** the `DROP TABLE` above, clean, no
data loss possible. **Code rollback keeping accumulated data:** revert the
application code that writes to this table; the table and its rows are
untouched and simply stop receiving new writes. **Post-use archival before
any destructive step:** `COPY plan_decision_ledger TO '<path>' WITH CSV
HEADER;` (or `pg_dump -t plan_decision_ledger`) before any `DROP`.
**Destructive rollback, clearly marked as data loss:** `DROP TABLE
plan_decision_ledger;` once it holds real rows — this permanently deletes
every recorded coaching decision and is never proposed as a normal rollback
path above; only listed here because you asked for it named explicitly.
**Failure recovery:** a single `CREATE TABLE` statement is atomic — it either
fully succeeds or leaves nothing behind; there is no partial-apply state to
recover from.

### 167 · `reassessment_schedule` — supersedes the never-applied migration 165

Additive only: one new table, four indexes, one comment. Same locking/
idempotency/rollback posture as 166 (new empty table, `CREATE TABLE IF NOT
EXISTS`, `DROP TABLE IF EXISTS reassessment_schedule;` to reverse pre-use).

```sql
CREATE TABLE IF NOT EXISTS reassessment_schedule (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_uuid              uuid NOT NULL,
  kind                   text NOT NULL
                           CHECK (kind IN (
                             'DEFERRAL',
                             'EARNING_GATE',
                             'CONDITIONAL_DOSE',
                             'POST_RACE_RECOVERY_CHECK',
                             'RETURN_TO_TRAINING_STAGE',
                             'PROPOSAL_EXPIRATION',
                             'FAILED_EVALUATION')),
  reason_code            text NOT NULL,
  reason_detail          text NOT NULL,
  assess_on_iso          date NOT NULL,
  overdue_after_iso      date,
  required_evidence      jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence               jsonb NOT NULL DEFAULT '[]'::jsonb,
  newest_evidence_iso    date,
  plan_id                text,
  plan_lineage_id        text,
  plan_version           text NOT NULL,
  evidence_version       text,
  model_version          text,
  lever                  text,
  before_value           double precision,
  proposed_after_value   double precision,
  magnitude              jsonb,
  payload                jsonb NOT NULL DEFAULT '{}'::jsonb,
  status                 text NOT NULL DEFAULT 'PENDING'
                           CHECK (status IN (
                             'PENDING', 'DUE', 'RESOLVED', 'EXPIRED', 'FAILED', 'ABANDONED')),
  attempts               integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error             text,
  last_attempt_at        timestamptz,
  next_retry_at          timestamptz,
  resulting_decision     text,
  resulting_decision_detail text,
  resulting_ledger_id    uuid,
  resolved_at            timestamptz,
  origin_ledger_id       uuid,
  idempotency_key        text NOT NULL,
  queued_at_iso          date NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reassessment_schedule_terminal_is_explained
    CHECK (
      (status IN ('PENDING', 'DUE')
        AND resolved_at IS NULL AND resulting_decision IS NULL)
      OR
      (status IN ('RESOLVED', 'EXPIRED', 'FAILED', 'ABANDONED')
        AND resolved_at IS NOT NULL
        AND resulting_decision IS NOT NULL
        AND resulting_decision_detail IS NOT NULL
        AND length(resulting_decision_detail) > 0)
    ),
  CONSTRAINT reassessment_schedule_failure_names_its_error
    CHECK (status <> 'FAILED' OR (last_error IS NOT NULL AND length(last_error) > 0)),
  CONSTRAINT reassessment_schedule_attempts_are_timed
    CHECK ((attempts = 0) = (last_attempt_at IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS reassessment_schedule_live_identity
  ON reassessment_schedule (user_uuid, kind, idempotency_key)
  WHERE status IN ('PENDING', 'DUE');
CREATE INDEX IF NOT EXISTS reassessment_schedule_due
  ON reassessment_schedule (assess_on_iso, user_uuid)
  WHERE status IN ('PENDING', 'DUE');
CREATE INDEX IF NOT EXISTS reassessment_schedule_user_live
  ON reassessment_schedule (user_uuid, assess_on_iso)
  WHERE status IN ('PENDING', 'DUE');
CREATE INDEX IF NOT EXISTS reassessment_schedule_retry
  ON reassessment_schedule (next_retry_at)
  WHERE next_retry_at IS NOT NULL AND status IN ('PENDING', 'DUE');

COMMENT ON TABLE reassessment_schedule IS
  'THE durable reassessment scheduler. One row per promise the engine made to look at '
  'something again: deferrals, earning gates, conditional doses, post-race recovery checks, '
  'return-to-training stages, proposal expirations and failed evaluations. Due-ness is a DATE, '
  'so lateness is harmless (CLAUDE.md Rule 23). Rows are never deleted: an item leaving the '
  'live queue is stamped with a terminal status, a resulting decision and a sentence. '
  'Supersedes the unapplied migration 165 (canonical_adaptation_deferrals), which covered one '
  'of these seven kinds.';
```

Pre/post row counts, rollback, failure recovery: identical shape to 166
(new empty table). **Destructive rollback, marked as data loss:** `DROP
TABLE reassessment_schedule;` once populated — deletes every scheduled
reassessment and its resolution history.

### 168 · `plan_decision_outcome` — Step 16, did the decision work

Additive only, no dependency on 166/167 being applied first (no FK to
either). Same locking/idempotency posture.

```sql
CREATE TABLE IF NOT EXISTS plan_decision_outcome (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id           uuid NOT NULL,
  user_uuid             uuid NOT NULL,
  plan_lineage_id       text NOT NULL,
  lever                 text NOT NULL,
  chosen_option         text NOT NULL,
  rejected_options      jsonb NOT NULL DEFAULT '[]'::jsonb,
  expected_direction    text NOT NULL
                          CHECK (expected_direction IN ('UP', 'DOWN', 'NEUTRAL', 'UNKNOWN')),
  prediction            jsonb NOT NULL DEFAULT '{}'::jsonb,
  observed_from_iso     date NOT NULL,
  observed_to_iso       date NOT NULL,
  subsequent_execution  jsonb NOT NULL DEFAULT '{}'::jsonb,
  recovery              jsonb NOT NULL DEFAULT '{}'::jsonb,
  later_performance     jsonb NOT NULL DEFAULT '{}'::jsonb,
  pain_or_injury        jsonb NOT NULL DEFAULT '{}'::jsonb,
  verdict               text NOT NULL
                          CHECK (verdict IN (
                            'PRODUCTIVE', 'EXCESSIVE', 'UNDERDOSED', 'UNRESOLVED')),
  verdict_because       text NOT NULL,
  unresolved_reason     text,
  confidence            numeric(4,3),
  model_version         text,
  evaluated_at          timestamptz NOT NULL DEFAULT now(),
  idempotency_key       text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plan_decision_outcome_window_ordered
    CHECK (observed_to_iso >= observed_from_iso),
  CONSTRAINT plan_decision_outcome_unresolved_is_explained
    CHECK ((verdict = 'UNRESOLVED') = (unresolved_reason IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS plan_decision_outcome_idem
  ON plan_decision_outcome (decision_id, idempotency_key);
CREATE INDEX IF NOT EXISTS plan_decision_outcome_by_runner
  ON plan_decision_outcome (user_uuid, evaluated_at DESC);
CREATE INDEX IF NOT EXISTS plan_decision_outcome_by_lineage
  ON plan_decision_outcome (plan_lineage_id, evaluated_at DESC);
CREATE INDEX IF NOT EXISTS plan_decision_outcome_by_verdict
  ON plan_decision_outcome (user_uuid, lever, verdict);

COMMENT ON TABLE plan_decision_outcome IS
  'Step 16 · whether a coaching decision turned out to be right. Written by a '
  'later sweep, never by the decision itself. UNRESOLVED is a real answer.';
```

Pre/post row counts, rollback, failure recovery: identical shape to 166/167.
**Destructive rollback:** `DROP TABLE plan_decision_outcome;` once
populated — deletes every recorded outcome judgment.

### 169 · `runner_beliefs` — steps 1/5, the durable belief store

Additive only. This is a byte-for-byte transcription of
`lib/runner-state/store/schema.ts#ensureBeliefStoreSchema`'s own CREATE
statement, run through `assertScratchDatabase` on every scratch invocation so
the migration file and the code can never drift silently.

```sql
CREATE TABLE IF NOT EXISTS runner_beliefs (
  id                 bigserial PRIMARY KEY,
  user_uuid          uuid NOT NULL,
  registry           text NOT NULL CHECK (registry IN ('BELIEF', 'QUANTITY')),
  belief_key         text NOT NULL,
  plan_lineage_id    text NOT NULL,
  reading_ok         boolean NOT NULL,
  reading_value      jsonb,
  reading_absent_reason jsonb,
  CHECK (
    (reading_ok = true  AND reading_value IS NOT NULL AND reading_absent_reason IS NULL) OR
    (reading_ok = false AND reading_value IS NULL AND reading_absent_reason IS NOT NULL)
  ),
  confidence         double precision CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  source_mode        text,
  supporting         jsonb NOT NULL DEFAULT '[]'::jsonb,
  contradicting      jsonb NOT NULL DEFAULT '[]'::jsonb,
  tension            jsonb,
  recency            jsonb,
  rule8_side         text NOT NULL CHECK (rule8_side IN ('HABIT', 'ABSORBED_LOAD', 'NEITHER')),
  moves_up_on        jsonb NOT NULL DEFAULT '[]'::jsonb,
  moves_down_on      jsonb NOT NULL DEFAULT '[]'::jsonb,
  never_moves_on     jsonb NOT NULL DEFAULT '[]'::jsonb,
  owner_module       text NOT NULL,
  owner_symbol       text NOT NULL,
  owner_answers      text NOT NULL,
  computed_at        timestamptz NOT NULL,
  model_version      text NOT NULL,
  stored_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS runner_beliefs_latest_idx
  ON runner_beliefs (user_uuid, registry, belief_key, stored_at DESC);
CREATE INDEX IF NOT EXISTS runner_beliefs_lineage_idx
  ON runner_beliefs (user_uuid, plan_lineage_id);

COMMENT ON TABLE runner_beliefs IS
  'Steps 1/5 · the durable belief store. Append-only; the current belief is '
  'the newest row per (user_uuid, registry, belief_key). A reading_ok=false '
  'row is an honest refusal, never a coerced zero.';
```

**Runtime behaviour before this applies, already shipped and safe:** the
code already probes for this table before every read/write
(`beliefsTableExistsCheck`) and answers an honest `absent` refusal, reported
via an `ops_alerts` entry, never a raw SQL error. `run-adaptations` already
calls `updateRunnerBeliefs` every night, for every runner, right now — it is
just refusing correctly, every time, until this lands. **The moment 169
applies, the very next cron pass starts writing, with no further code
change and no restart required.** Destructive rollback: `DROP TABLE
runner_beliefs;` once populated — deletes every recorded belief history.

### `plan_weeks` / `plan_phases` · `user_uuid` backfill — data only, no schema change

**The code-side root cause is already fixed and shipped**, needs no
approval: all six INSERT call sites across `generate.ts`, `injury-builder.ts`
and `seed-from-onboarding.ts` now stamp `user_uuid` on `plan_weeks`/
`plan_phases` the same way they already did on `plan_workouts`, gated by a
new source-scan test that fails if this ever regresses. Only the DATA
backfill for existing rows needs your go.

**Measured against production, read-only:** `plan_weeks` 88 of 672 rows NULL
(13.1%); `plan_phases` 25 of 222 rows NULL (11.3%); `plan_workouts` and
`plan_mutations` already fully populated (0 NULL) because their writers
already stamped this on every INSERT.

```sql
BEGIN;

UPDATE plan_weeks w
   SET user_uuid = t.user_uuid
  FROM training_plans t
 WHERE w.plan_id = t.id AND w.user_uuid IS NULL;

UPDATE plan_phases p
   SET user_uuid = t.user_uuid
  FROM training_plans t
 WHERE p.plan_id = t.id AND p.user_uuid IS NULL;

COMMIT;
```

**Locking:** row-level only, on the ~113 rows actually changed across both
tables combined; no table lock, sub-second at this size. **Idempotency:**
proven on a scratch rig matching the production shape — first run updates
exactly the NULL rows; an immediate re-run returns `UPDATE 0` on both
statements (a safe no-op, not a re-write). **Verification, read-only,
immediately after:**
```sql
SELECT count(*) FILTER (WHERE user_uuid IS NULL) FROM plan_weeks;   -- expect 0
SELECT count(*) FILTER (WHERE user_uuid IS NULL) FROM plan_phases;  -- expect 0
SELECT count(*) FROM plan_weeks w JOIN training_plans t ON w.plan_id = t.id
  WHERE w.user_uuid IS DISTINCT FROM t.user_uuid;                   -- expect 0
```
**Failure recovery:** both UPDATEs are in one transaction; a failure on
either rolls back both, so this can never leave one table fixed and the
other still broken. **Rollback:** this is a data write with no destructive
counterpart — the column was already nullable, already denormalized-with-
slack, and every read already joins through `plan_id` as the source of
truth (Rule 14) rather than trusting this column alone. Re-nulling the 113
rows would only reintroduce the gap, not protect anything. Per-row escape
hatch if a specific value is ever found wrong (it cannot be — the value is
that exact row's own `training_plans.user_uuid`, never invented):
`UPDATE plan_weeks SET user_uuid = NULL WHERE id = '<id>';`, no cascade.

**Apply order, all six items, if you approve some or all:** DDL before code
is the safer direction and already the recommended posture from the prior
packet (Section D): 166 → 167 → 168 → 169 → `plan_weeks` backfill →
`plan_phases` backfill. None of the six depends on another having landed
first (no foreign keys between them); this order is a convenience grouping
(ledger, then scheduler, then outcome, then beliefs, then the two data
writes), not a hard requirement.

## 7 · Pace drift — read-only diagnosis complete, needs your call

Investigated read-only, as instructed; nothing written anywhere. **Not a
rounding bug, not two competing implementations** — both the live resolver
and the value stamped into your plan go through the exact same function,
confirmed by reading the code on both sides. The real cause: a change locked
September 5th turned an automatic nightly self-heal into a propose-then-
accept flow, and the propose trigger's threshold (1.0–2.0 VDOT) is far
coarser than the drift this produces (roughly 0.1–0.2 VDOT, i.e. this exact
1 s/mi). Before that change, a nightly job would have silently closed a gap
this small within about a day; now nothing does. The new pace-drift-monitor
cron (built earlier tonight) already caught this independently and
correctly — it alerted on your account by name, an hour after I first found
it, for the exact reason: no pending reprice proposal exists to explain the
gap.

**Your call, not mine:** (a) have the drift-monitor create the missing
re-anchor proposal itself when it finds an uncovered mismatch — closes the
loop automatically, though you would still accept it like any other
proposal — or (b) leave it alert-only for now. I have not implemented
either; both require touching the plan-mutation/proposal system for a real
account, which needs your go regardless of which direction.

## 8 · Branch hygiene — done

`evidence-classifier` (both commits) verified to contain zero unique work —
both fully superseded by later, different, already-integrated work on
`main` (confirmed the specific prebuild allowlist entry it added is
redundant; main already has its own newer, different entry for the same
file). Deleted from `origin`. A local ref survives only because a stale
worktree from an earlier agent still has it checked out — harmless, no
shared risk.

## 9 · What is explicitly NOT done this round — stated plainly, not buried

- Generator/facet re-count against the real call graph (§10, not started).
- Belief-owner consumer migration beyond the existing census (not started).
- Pa:HR proof matrix against the eight named scenarios (not started).
- Rolling-boundary three-point proof (before week / after midweek quality /
  after race before long run) — not re-verified this round.
- Native/Watch verification against tonight's full specific checklist,
  including a clean Watch test suite run (not done this round).
- Calorie-repair native dry-run flow (not started).
- Competing-proposals explicit arbitration (durable winner/loser/reason/
  reassessment date, replacing the current silent dedup skip) — folded into
  the in-flight primary-deliverable brief (§3), not separately confirmed.

## 10 · Exact commits this round, in order, each independently confirmed on Railway before the next started

`c7e197f82` → `57e09407d` (SKIPCONFIRM-1 + follow-up) → `ce883f4ab` (TF 285)
→ `2aaafe3b6` (orchestration 12→14) → `47febb3e7` (uuid/text fix) →
`9ecf0beaa` (SUPPLEMENTALGRADE-1) → `fbf6a3eba` (prior handback) →
`8d2df7454`+`3f788a88d` (MOVEREADJUDICATE-TODAY-1, native) → `f16dfb440`
(TF 286) → `2791821f7` (RACEDAYSTRUCTURE-1) → `3127f3c28`
(DEFERRALCARRYALERT-1). Current HEAD `3127f3c28`. Every commit that touched
`web-v2` was confirmed `SUCCESS` on Railway for its own exact SHA before the
next commit began; every commit that touched `native-v2` compiled and was
verified live in the simulator against a real copy of production data
before being shipped.

---

**Continuing through the night on the open items in §9 and integrating the
four in-flight agents as they report, per your instruction. Nothing above is
claimed done that is not independently verified; §3's primary objective is
the one item this handback most wants to be able to call closed and
deliberately does not.**
