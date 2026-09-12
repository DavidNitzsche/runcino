# Lane A — Literal Runner-Facing Evidence

**Branch under evaluation:** `fix/recovery-honesty-strides-grading` @ `b13c2c59a` (HELD, not merged).
**Real workout:** `runs.id = -218380344929823`, matched to `plan_workouts.id = wko_d19936ca5659c63b` (6×20s strides, `strides_recovery_s: 60`), user `0645f40c-951d-4ccc-b86e-9979cd26c795` (dnitch85@me.com), real walk-backs of 30/43/61/24/38/8 seconds. No `recoveryEndedEarly` or `sessionEnded` record on any phase.
**Method:** rendered live against the real production functions and the real DB row (`DATABASE_URL_RO`), not reasoned about, not a fixture. No code was changed to produce this — everything below is what the branch as currently written actually outputs.

---

## 1. Each recovery phase's displayed state — literal, per phase

`phase_breakdown` (the array the phone actually decodes), all 6 recoveries:

| idx | `label` | `type` | `actual_duration_sec` | `completed` | `status_label` | `status` | `verdict` |
|---|---|---|---|---|---|---|---|
| 2 | `"Walk back"` | `recovery` | 30 | `false` | `null` | `null` | `null` |
| 4 | `"Walk back"` | `recovery` | 43 | `false` | `null` | `null` | `null` |
| 6 | `"Walk back"` | `recovery` | 61 | `false` | `null` | `null` | `null` |
| 8 | `"Walk back"` | `recovery` | 24 | `false` | `null` | `null` | `null` |
| 10 | `"Walk back"` | `recovery` | 38 | `false` | `null` | `null` | `null` |
| 12 | `"Walk back"` | `recovery` | 8 | `false` | `null` | `null` | `null` |

**None of the 6 recoveries carries any individual displayed status at all.** Not shown as neutral — shown as nothing. The wire sent to the phone carries no per-recovery verdict array, only an aggregate `"recoveryCount": 6, "recoveryDistanceMi": 0.27`. The only place a runner could see an individual walk-back's duration is the raw phase table, with no verdict word next to it.

(`completed: false` on all 6 is the watch's own recorded tri-state for the phase — not produced or read by this branch's fix.)

## 2. The visible workout verdict — the actual on-screen card

Rendered via `PostRunVerdictV5.swift` (the only view that renders this card, confirmed by grep — used by both `RunDetailV5.swift` and `TodayAfterV5.swift`):

```
COACH'S READ
Walk-backs ran short
The work block stayed under the ceiling. Walk-backs came in short of
what was modelled: recorded, not graded. Six strides completed.

✓ Plan unchanged.
Why ▸
```

Tapping "Why" expands to:
```
This supports your current ability to hold pace late. One session is
not enough to move it.
The session set no heart-rate ceiling, so the reading is reported
without a verdict.
This is one session, so treat it as a lead rather than a conclusion.
```

## 3. The exact Coach's Read — composed live, real data

```json
{
  "status": "PARTIAL_PRODUCTIVE",
  "headline": "Walk-backs ran short",
  "summary": "The work block stayed under the ceiling. Walk-backs came in short of what was modelled: recorded, not graded. Six strides completed.",
  "confidence": "MODERATE",
  "reasons": ["WORK_PIECES_DISAGREE", "RECOVERY_DURATION_OFF_MODEL_WORK_LANDED"]
}
```

No em dash present. This is `experience.ts`'s post-review-fix template, filled for this exact workout.

## 4. Plan-impact text — traced to a real, confirmed-zero effect

```json
{ "status": "UNCHANGED", "runnerSummary": "The plan is unchanged.", "changes": [] }
```

Displayed: **"Plan unchanged."** with a checkmark icon. This is a real "checked and found none," not a masked failure — `coach_intents` was queried directly for this user from 2026-09-09 forward and contains exactly one row, a `watch_completion` ingest record, not a `plan_adapt_*` reason. `readPlan` only recognizes `plan_adapt_*`/`vdot_auto_recalc` reasons as plan changes, so the empty adaptations list is a legitimate absence, not a swallowed one.

## 5. Evidence/adaptation classification — the precise fact, not the shorthand

DB confirms `plan_workouts.type = 'easy'`, `is_quality = false`, `is_long = false`. **This does NOT mean the run is excluded from the Evidence Engine generally.** The real classifier output:

```json
{
  "role": "CORROBORATES",
  "domains": ["DURABILITY"],
  "runnerSummary": "This supports your current ability to hold pace late. One session is not enough to move it.",
  "beliefChanged": false,
  "planAuthorityEligible": false,
  "reasons": [
    "DURABILITY:STABLE_OUTPUT_WITH_RISING_INTERNAL_COST",
    "DURABILITY:DURATION_BELOW_PROTOCOL",
    "DURABILITY:ENVIRONMENTALLY_AFFECTED",
    "DURABILITY:ACTIVITY_INTERRUPTED",
    "DURABILITY:SINGLE_ACTIVITY_BELOW_ANCHOR_MOVE_TIER"
  ]
}
```

The precise fact: `is_quality`/`is_long` gate only whether this run's `PlannedIntent` is **anchor-capable** (`planAuthorityEligible: false` — this run can never move a fitness anchor). The DURABILITY capacity classifier runs on the activity's own splits regardless of plan intent, and it DID find corroborating evidence here — the sentence quoted is literally what appears under "Why" on the card in §2. Excluded from anchor-moving evidence; included in durability corroboration. Separately, `goal-projection.ts`'s test-point loaders filter to `tempo/threshold/intervals/long/race/race_week_tuneup` — `'easy'` never enters the race-prediction trajectory either way.

## 6. Every location where "uneven" remains visible or operative

- Grepped `native-v2/` and `web-v2/components|app/` for the literal string: **zero real matches** (the only hits are "uneventful"/"uneven band rhythm," unrelated substrings).
- The internal `decisionVersion` field genuinely contains it (`"...grade:easy/uneven..."`) and this string is present in the raw JSON `/api/runs/[id]` sends to the phone. But `PostRunV5.swift` decodes it into a property that is **never read anywhere else in the codebase** (grepped every reference) — it reaches device memory, never a `Text()` view. **It does not reach the runner's eyes.**
- The other two JSON blocks the endpoint returns (`analysis`, `matched`) strip verdicts entirely before serialization.
- Forward-looking: `SessionVerdict`/`gradeSession`/`sessionLadder` are used only in `verdict.ts`/`experience.ts`/`execution-semantics.ts` — not imported by `lib/plan`, `lib/adaptation`, or `glance-state.ts`'s progression logic. `glance-state.ts` calls `resolveWorkoutVerdict` for the day-strip icon but derives its own state from `work.incomplete`/`fellShortShare`, never from the `'uneven'` string — and for this run (all work phases landed) that icon resolves independently of the recovery-honesty branch entirely.

**Conclusion: "uneven" never reaches the runner's eyes for this workout, and has zero effect on any future training decision — confirmed by tracing every consumer, not by an absence-only grep.**

---

No code was changed to produce this evidence. Everything above matches what the branch (`b13c2c59a`) currently outputs, rendered against real data.
