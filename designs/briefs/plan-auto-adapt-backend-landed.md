# Plan auto-adapt · backend landed

**Companion to** `designs/briefs/readiness-brief-backend-landed.md` and
`designs/briefs/targets-gap-panel-backend-landed.md` — same pattern.
**Surface** · accept/dismiss cards on Today view + audit notifications
on Today view + the iPhone equivalent.

David's ask (verbatim, 2026-06-01): "100% plans need to auto adapt.
Thats literally the biggest feature I want in this app."

This is the autonomous plan-adaptation system. Plans get re-fit when
the runner's reality drifts from what the plan was authored for · no
manual button-click needed. No chat surface to ask for help. The
system catches drift, the runner sees a card, the rebuild happens.

---

## What shipped · 4 pieces

| Piece | File | What it does |
|---|---|---|
| Snapshot table | `db/migrations/132_plan_proposals.sql` | Persists drift detections + auto-rebuild audit rows |
| Drift monitor | `lib/plan/drift-monitor.ts` | Pure function · scores 3 soft-drift signals per active plan |
| Auto-rebuild | `lib/plan/auto-rebuild.ts` | Hard-drift handler · auto-applies on race/goal edits |
| Cron route | `app/api/cron/plan-drift/route.ts` | Nightly scan · writes pending proposals |
| Cron workflow | `.github/workflows/plan-drift.yml` | Daily 09:00 UTC |
| Accept/dismiss API | `app/api/plan/proposal/route.ts` | Runner-facing terminal for pending proposals |
| Hooks | `app/api/race/route.ts` (PATCH + DELETE) | Immediate-fire on race edits |
| Seed wiring | `components/faff-app/types.ts` + `seed.ts` | `FaffSeed.planProposals: PlanProposalSeed[]` |
| Loader | `lib/plan/proposals-state.ts` | Pulls + ranks + synthesizes copy |

---

## Two modes of drift

### Hard drift · auto-applied, no accept gate

Runner-initiated changes where the rebuild is OBJECTIVELY correct. We
write `status='auto_applied'` and execute the rebuild atomically:

| Trigger | What fires | Source hook |
|---|---|---|
| Race date moved | `race_date_changed` | `PATCH /api/race` |
| Goal time edited | `goal_time_changed` | `PATCH /api/race` |
| Race promoted to A | `a_race_added` | `PATCH /api/race` (priority field) |
| A-race demoted | `a_race_removed` | `PATCH /api/race` (priority field) |
| A-race deleted | `a_race_removed` (orphan) | `DELETE /api/race` |

The runner already made the underlying change. Asking "want to rebuild?"
would be chat-shaped. We just do it, log it, surface a notification:
"Race date changed · plan timeline rebuilt automatically."

Deduplication: same kind + same race within 60s → skipped (protects
against double-fire from PATCH + revalidate).

### Soft drift · pending proposal, runner decides

Detected by the nightly drift cron. Tradeoffs are real; runner picks:

| Trigger | Threshold | Doctrine |
|---|---|---|
| `volume_drift` | 28d avg differs >40% from authored 4-wk baseline | Research/04 §progression |
| `vdot_drift` | Current VDOT differs >2 from plan anchor (inferred from T-pace) | Daniels VDOT tables |
| `staleness` | Plan authored >8 weeks ago | Research/00a §plan-adaptation |

Pending proposals carry plain-language `message` strings + a
`severity` 0-1. Today view renders 0-3 cards sorted by status (pending
first) then severity desc.

---

## The contract design renders · `PlanProposalSeed`

```ts
type PlanProposalSeed = {
  id: number;
  planId: string | null;
  newPlanId: string | null;        // populated on auto_applied + accepted

  kind: 'volume_drift' | 'vdot_drift' | 'staleness'
      | 'race_date_changed' | 'goal_time_changed'
      | 'a_race_added' | 'a_race_removed';

  status: 'pending'        // awaiting runner accept/dismiss
        | 'auto_applied'    // immediate-fire kinds · already rebuilt
        | 'accepted'        // runner accepted via /api/plan/proposal
        | 'dismissed'       // runner dismissed · 14-day suppression
        | 'superseded';     // newer proposal of same kind exists

  source: string;          // 'drift_cron' | 'race_patch_hook' | etc.
  reasons: Record<string, unknown>;

  /** Plain-language one-liner for the card · always populated. */
  message: string;

  /** 0-1 · null for hard-drift kinds (they're inherently 1.0). */
  severity: number | null;

  createdAt: string;       // ISO
  resolvedAt: string | null;
};
```

---

## Card states design should handle

| Status | Card behavior | Action |
|---|---|---|
| `pending` (soft drift) | Show message + Accept + Dismiss buttons | POST `/api/plan/proposal` with `{id, action: 'accept' \| 'dismiss'}` |
| `auto_applied` (hard drift) | Show "we rebuilt your plan because X" notification · no buttons (it's already done) | Tap → optional "see what changed" link to the new plan |
| `accepted` | Brief success toast after the action lands | Auto-dismiss after a few seconds OR don't render at all |
| `dismissed` | Don't render | — |
| `superseded` | Don't render | — |

Empty array → no cards. That's the steady state most days.

---

## Doctrine guardrails

1. **No accept gate on hard-drift.** The runner already made the
   change. Asking again is chat-shaped friction.
2. **Severity-ranked rendering.** Volume drift +120% beats staleness
   8 weeks. Today view shows the most-important card first.
3. **14-day dismissal respect.** If the runner dismisses a soft-drift
   proposal, the cron won't re-propose the same kind for 14 days.
   They said no; honor it.
4. **Idempotent at every layer.**
   · Same-kind pending row → cron skips writing another
   · Same hook fires twice in 60s → de-duped at the rebuild layer
   · Same drift detected nightly → only one pending row at a time
5. **Audit-only on failure.** When the auto-rebuild fails (generator
   error, race deleted, etc.), the row still writes with
   `status='pending'` so a human surface can surface the failure.

---

## Open questions for design

1. **Card placement.** Above the workout hero · below the readiness
   brief · as a banner across the top? They're action-priority items;
   probably above the workout but below readiness (since readiness is
   the day's "how am I" and the proposal is "what happened to the plan").

2. **Auto-applied notification persistence.** Should "race date changed
   · plan rebuilt" stay visible for 24 hours? 7 days? Or dismiss on
   first view?

3. **"See what changed" affordance.** When an auto-rebuild lands, the
   new plan is materially different. Show a diff-style link ("3 weeks
   added · long runs bumped 2mi each")? Or just "open updated plan"?

4. **Concurrent proposals.** If volume_drift + staleness fire on the
   same plan, the card should probably synthesize ("plan is 12 weeks
   old AND your volume has drifted 60% · refit"). Currently they
   render as two separate cards. Design call.

5. **iPhone surface.** Same card pattern? Or a Settings notification?
   The data envelope is the same; design picks the surface.

6. **Accept button copy.** "Rebuild plan" · "Update plan" · "Refit"?
   Current default in `message` strings: "refit." Worth a vote.

7. **Failure UX.** When accept fails (generator error), card stays
   pending with a `accept_attempt_failed` reason in the JSONB. Should
   the runner see "we tried but couldn't rebuild, here's why" or
   should the card silently retry on next page load?

---

## What CAN'T be fixed yet · generator gaps that block full automation

From the dry-run audit on David's plan (2026-06-01), `generatePlan`
has two known gaps that affect the rebuild quality:

1. **Mid-block awareness missing.** The generator treats every rebuild
   as a fresh "base" phase. For a runner who's been doing quality work
   for weeks, the rebuild strips quality from Wks 1-3 of the new plan
   and treats them as pure aerobic base. That's a step backward.

2. **Pace targets sometimes null.** The current generator's workout-
   library resolver doesn't always populate `pace_target_s_per_mi`.
   Existing plans authored under builderVersion 20 have paces;
   rebuilds via the current code path produce null paces on some
   workouts. (See `db/migrations/132_*.sql` comment and the audit doc.)

**Implication:** auto-rebuild WILL fire on hard-drift today, but the
rebuilt plan may be subtly worse than the prior plan for mid-block
runners. We accept this tradeoff because the alternative (silently
training against a stale race date) is strictly worse. The generator
gaps are tracked as a follow-up — see Task #93 in the active list.

When the generator is fixed, the system auto-improves · no change
needed in this layer.

---

## File map · what design opens first

```
designs/briefs/
└── plan-auto-adapt-backend-landed.md           ← this file

web-v2/
├── components/faff-app/
│   ├── types.ts                                ⭐ PlanProposalSeed contract
│   └── seed.ts                                 ⭐ seed.planProposals wiring
├── lib/plan/
│   ├── drift-monitor.ts                        ⭐ soft-drift detector
│   ├── auto-rebuild.ts                         ⭐ hard-drift handler
│   └── proposals-state.ts                      loader + copy synth
├── app/api/
│   ├── cron/plan-drift/route.ts                nightly drift cron
│   ├── plan/proposal/route.ts                  ⭐ accept/dismiss endpoint
│   └── race/route.ts                           PATCH + DELETE hooks
└── db/migrations/
    └── 132_plan_proposals.sql                  table

.github/workflows/plan-drift.yml                daily 09:00 UTC
```

⭐ = first files to read for design.

---

## TL;DR

Open `lib/plan/drift-monitor.ts` to see the soft-drift thresholds.
Open `lib/plan/auto-rebuild.ts` to see the hard-drift triggers.
Render `FaffSeed.planProposals` as cards on Today view · status
controls whether to show buttons (pending) or just a notification
(auto_applied). Empty array is the happy default · don't render
anything when there's no drift.

No chat. No "manually click regenerate." The runner edits a race or
goal, the plan follows. The runner trains more or less than authored,
the plan asks if it should adapt. The runner says yes → rebuild. The
runner says no → quiet for 14 days.
