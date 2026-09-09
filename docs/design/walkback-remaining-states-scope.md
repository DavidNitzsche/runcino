# Walk-back vocabulary: the remaining 5 states — scoping only

Status: **SCOPING DOCUMENT. NO PRODUCT CODE HAS BEEN WRITTEN FOR THIS.**
Written 2026-09-09, in the same session that shipped WALKBACK-2
(`feat/recovery-ended-early-record`, `e80524809`) and its `goal-projection.ts`
follow-up (`fix/goal-projection-recovery-ended-early`). Per David's explicit
instruction this round: **"Keep open and scope: genuinely skipped;
interrupted; automatically advanced; session ended; unknown evidence."** This
document is that scope. It is written so a future implementation session can
pick it up directly — concrete files, concrete structs, concrete predicates —
not so it reads well.

---

## 1 · Where this sits

David's required distinction for **what advanced a workout phase** — seven
states, two done:

| # | State | Status |
|---|---|---|
| 1 | completed-as-prescribed | **DONE** (implicit — the ordinary case, no record needed) |
| 2 | advanced-early-intentionally | **DONE** this session (WALKBACK-2) |
| 3 | genuinely-skipped | OPEN — this document |
| 4 | interrupted | OPEN — this document |
| 5 | automatically-advanced | OPEN — this document |
| 6 | session-ended | OPEN — this document, David called this out specifically |
| 7 | unknown-evidence | OPEN — this document |

**State 2 is not one struct, it is one MEANING carried by two phase-type-
specific structs**, and that matters for how 3–7 should be designed:
`WorkoutEngine.RepSkipRecord` (work reps, shipped pre-WALKBACK-2 with the
0821 boards) and `WorkoutEngine.RecoveryEndedEarlyRecord` (recoveries,
WALKBACK-2) are the SAME fact — "the runner experienced some or none of this
phase and chose to end it" — recorded once per phase TYPE because each phase
type surfaces the choice through a different board (`FaceSkipConfirmV5` for
work, `FaceExtendRecoveryV5`'s "Go now" for recovery). Doctrine's own
ownership principle applies here too (`docs/BRAIN_CONSTITUTION.md`): one
question, recorded once per reachable surface, never a generic
"phase-ended-early" blob that then has to be reverse-engineered into which of
the seven states actually happened. States 3–7 below follow the same
discipline: each is its own struct, matched onto a phase the same way
(`phaseIndex`), because a future reader (`execution-semantics.ts`) needs to
ask "was THIS specific fact true of THIS specific phase" without parsing free
text or reverse-inferring intent from a duration comparison (Rule 11 again —
this whole feature exists because that inference was already tried once and
was wrong).

## 2 · The architecture being extended

`legacy/native/Faff/FaffWatch Watch App/WorkoutEngine.swift`'s **"four wrist
decisions"** pattern (`// MARK: The four record… calls`, ~line 2435) is now
five (bail, ceiling-lift, rep-skip, recovery-extension, recovery-ended-early).
Every one of them follows the same five-step shape, and states 3–7 should too:

1. **An engine-side `Codable` struct** (`RepSkipRecord`, `CeilingLiftRecord`,
   `RecoveryEndedEarlyRecord`, ...) — private storage, survives the crash
   snapshot (`RunSnapshot.Decisions`).
2. **A `record*()` method**, guarded on `state == .running` (and whatever
   phase-type/phase-state precondition applies), called from exactly one
   board action. `endCurrentPhase()`'s own comment states the discipline
   directly: *"a caller that forgets to also call a second method cannot
   lose the decision, because there is no second method to forget."* Fold
   the new record into an EXISTING call site where the transition already
   funnels through one place, rather than adding a parallel path a board
   could bypass.
3. **A private array** (`recoveryEndedEarlyRecords: [RecoveryEndedEarlyRecord]
   = []`), cleared in `clearDecisions()`, carried in
   `decisionsForSnapshot`/`restoreDecisions` so a crash mid-run does not lose
   the decision (WALKBACK-2's own header: *"the watch does not quietly
   forget it... has to survive the watch dying"*).
4. **A wire-side `Encodable` twin** in `WatchWorkoutModels.swift`
   (`WatchCompletion.RecoveryEndedEarly`), `nil` unless populated, **never
   `[]`** — the file's own comment on every one of these fields: *"Assigning
   `[]` by hand would clobber a sibling payload's value on the server's
   jsonb merge"* (this project's Rule 6, restated at the wire layer).
5. **`applyDecisions(to:...)`** folds the array onto the completion at both
   the live-finish path and the crash-recovery path, from the SAME function,
   so the two "can never drift apart" (its own doc comment).

Server side, the same five-step shape continues:

6. **A normalizer** in `web-v2/app/api/watch/workouts/complete/route.ts`
   (`normalizeRecoveryEndedEarly`) — drops an entry that can't say anything
   the phone could render, rounds/validates every numeric field, never trusts
   the wire's shape directly.
7. **A `RunData` field** in `web-v2/lib/runs/run-shape.ts` — documented as
   absent on every row before the field shipped (Rule 11: absence ≠ "nothing
   happened", it can also mean "this row predates the field").
8. **A `GradeOptions`/`ResolveWorkoutVerdictArgs` field** in
   `web-v2/lib/execution/verdict.ts`, matched onto a `GradedPhase` by
   `phaseIndex` inside `gradeStoredPhases` — the exact mechanism
   `earlyEndPhaseIndices` uses today (a `Set<number>` built from the record
   array, checked with `.has(p.index)`).
9. **A reader change** in `web-v2/lib/training/execution-semantics.ts`
   (`recoveriesHonestOf` gained `endedEarlyByChoice`) — new fact, existing
   function signature extended, never a second competing function.
10. **Every OTHER consumer of `resolveWorkoutVerdict`** gets audited for the
    same gap this session's `goal-projection.ts` fix closed — WALKBACK-2's
    own audit trail (`docs/audit-2026-09-09-canonical-handback.md`) is the
    reference for what "every consumer" means in practice; a future session
    adding states 3–7 must re-run that same trace, not assume it still holds.

Every one of the five states below is scoped through this same ten-step
shape. Nothing here proposes a different pattern for a different state — the
value of the four/five-decisions architecture is that it is now boring to
extend, and staying boring is the point.

## 3 · What the engine can actually observe, at every phase-end

Before defining the five states, here is the complete inventory of signals
`WorkoutEngine` has access to AT THE MOMENT a phase ends, because the design
of every state below is constrained to what can actually be read at that
instant — not what would be nice to know.

| Signal | Where it lives today | What it tells you |
|---|---|---|
| `phaseElapsedSec` vs `phase.durationSec + phaseAddedSec` | live engine state | how much of the phase's modelled time actually ran |
| `phaseCoveredMi` vs `phase.distanceMi` | live engine state | how much of the phase's modelled distance actually ran (distance-repped phases only) |
| `currentIndex + 1 >= workout.phases.count` | computed in `advance()`, NOT currently computed at the point `endCurrentPhase()` records anything | **whether this transition is the LAST one in the plan** — the exact predicate `advance()` already uses to decide `planComplete = true` vs incrementing `currentIndex`. This is the missing signal for state 6 (session-ended) — see §4.6. |
| `isPaused` | live engine state | whether the clock was frozen when the transition happened |
| `tracker?.distanceSourceUnavailable` | `WorkoutTracker`, read in `tick()`'s `noDistanceSource` calc (~line 1543) | GPS/HK distance signal has gone dead for ≥6 min (`stallWatchSec` rolling window) |
| the HR staleness watchdog (`lastHrSampleAt`, `tick()` ~line 1063) | live engine state | heart-rate signal has gone stale |
| `RunSnapshot.savedAtEpoch` vs `Date.now` at relaunch | `resumeFromSnapshot`/`completionFromRecovery` | **the dead-window length** — how long the process was actually gone, which bounds how much of the "missing" phase time is unaccounted for. Computed nowhere today; trivially `Date.now.timeIntervalSince1970 - snapshot.savedAtEpoch`. |
| `snapshot.currentIndex` vs the phase the completion eventually reports | `completionFromRecovery` | whether the crash happened mid-phase (append a best-effort in-flight phase) or between phases (nothing to append) |
| `HKWorkoutSessionDelegate` state transitions not initiated by `pause()`/`resume()` | **not currently observed by name anywhere in `WorkoutEngine.swift`** — `WorkoutTracker` owns the HK session and the engine only ever sees `pause()`/`resume()` calls it made itself | a real gap: the engine cannot currently tell "the OS suspended the HK session for a phone call" from "GPS just went quiet" from "the app was killed." All three currently look identical: `completed: false`, no record. |

The last two rows are the actual gap behind states 4/5/7. States 3 and 6 are
gaps in what the LIVE, running engine records at an explicit user action; 4/5/7
are gaps in what a DISCONNECTED or dying process can tell you after the fact.
Design them differently — a live decision is recorded eagerly with certainty;
a post-hoc reconstruction is recorded with an honest confidence, per Rule 11.

## 4 · The five states

### 4.1 · genuinely-skipped

**Definition (recommended, see the open question below):** the runner chose
to end a phase having experienced **essentially none of it** — as opposed to
"advanced-early-intentionally," which is the SAME choice made partway through
a phase they had already started living. The distinction the recap sentence
actually needs: *"cut the rep to 0:08 of 1:00"* (a real partial dose, worth
grading as evidence per `docs/ADAPTATION_PROGRESSION_DOCTRINE.md`'s "compare
actual execution, not just completion") is a different fact from *"skipped
the rep outright"* (zero dose, nothing for the Evidence Engine to read as a
demonstrated capacity signal either way).

**Why this is its own state and not folded into advanced-early-intentionally:**
`RepSkipRecord` and `RecoveryEndedEarlyRecord` currently record ONE bit
("ended early, by choice") when the underlying `actualSec`/`phaseElapsedSec`
already carries a continuous signal for how much of the phase happened. A
reader asking "did the runner get ANY signal out of this rep" (Evidence
Engine, `docs/PRODUCT_COACHING_DOCTRINE_BRIEFS.md`'s workout-library brief)
needs this distinction and currently cannot make it without an arbitrary
threshold on `actualSec` — which is exactly the kind of local, unshared
heuristic Rule 16 forbids for a canonical fact.

**Current trigger surface:** `RepSkipRecord`'s only live UI entry
(`FaceControlsV5`'s "Skip rep" lead verb, `.structured` mode) is reachable at
ANY point during a work rep — `router.confirm = .skipRep` has no minimum
elapsed-time gate. So the DATA to make this distinction already exists
(`phaseElapsedSec` at the moment `recordRepSkip()` fires); nothing new needs
to be built at the UI layer.

**Proposed design — do NOT add a new struct; extend the existing one.**
This is the one state of the five that does NOT need a sixth wrist-decision
struct. Add a field to `RepSkipRecord` (and its wire twin `RepSkip`):

```swift
struct RepSkipRecord: Codable {
    let repIndex: Int
    let repCount: Int
    let phaseIndex: Int?
    let phaseLabel: String?
    let atMi: Double?
    let atSec: Int?
    /// NEW · how much of the rep's own modelled duration/distance had
    /// actually elapsed at the moment "Skip anyway" was pressed. Seconds,
    /// matching `RecoveryEndedEarlyRecord.actualSec`'s posture — an
    /// absolute figure, never a percentage, so the phone/server decide
    /// their own "essentially none" threshold rather than the wrist
    /// pre-deciding it.
    let elapsedSecAtSkip: Int?
}
```

`recordRepSkip()` already has `phaseElapsedSec` in scope at its call site —
this is a one-line addition to the struct literal, not a new code path.

**execution-semantics.ts reader change:** a new exported predicate,
`repSkippedBeforeMeaningfulEffort(elapsedSecAtSkip, prescribedSec)` —
NOT a hardcoded threshold buried in a call site (Rule 18's own case study:
"a check that hardcodes both sides only proves the test agrees with itself").
Whatever the actual research-cited threshold is (a candidate: `Research/04`'s
own definition of a countable rep attempt, if one exists — **audit this
before implementing**, do not invent a number), it belongs in
`execution-semantics.ts` next to `RECOVERY_DURATION_TOLERANCE`, with a
doctrine registry claim per Rule 7 if the threshold is physiological rather
than a display convenience.

**Open question for whoever implements this:** is "genuinely-skipped" instead
meant to describe a phase the runner never reached a live board for at all —
i.e., a true skip-ahead gesture that does not exist in the current UI (there
is no "Skip warmup" or "Skip cooldown" control; `FaceControlsV5`'s lead verb
is `.structured`-mode-only, meaning warm-up/cooldown/steady running has NO
skip affordance today at all — the only way to end one early is `onEnd` →
`abandon()`, which ends the WHOLE RUN, not just that phase)? If THAT is the
intended meaning, this state requires a new UI affordance before it can
record anything, which is scope beyond "thread a field through" and should
be flagged back to David as a product decision (new control), not assumed.
This document recommends the zero-dose-vs-partial-dose reading above because
it needs no new UI and closes a real, already-reachable gap — but say so
explicitly rather than silently picking one.

---

### 4.2 · interrupted

**Definition:** the phase ended because something OUTSIDE the runner's and
the plan's control broke the live loop — not a choice, not the plan's
schedule. Three sub-causes, all currently invisible to the wire because they
all collapse to the same `completed: false` with no record:

1. **The watch app died and relaunched mid-phase** (crash, forced-quit,
   battery death) — detected today only by `RunSnapshot`'s mere presence at
   launch (`WorkoutEngine.swift`'s own header comment: *"Its presence at
   launch therefore means exactly one thing: a run died mid-flight"*), but
   the DEAD-WINDOW LENGTH is never computed or carried forward.
2. **The OS suspended the `HKWorkoutSession`** for a reason outside the app's
   own control (an incoming call intercepting the audio session, a
   Digital-Crown-triggered system UI, watchOS memory pressure) — currently
   **not observed at all** by name in `WorkoutEngine.swift`. `WorkoutTracker`
   owns the `HKWorkoutSessionDelegate`; audit whether it already logs
   `workoutSession(_:didChangeTo:from:date:)` transitions the app itself did
   not request, because if it does not, this sub-cause has no signal to build
   on and needs its own investigation before a record can exist for it.
3. **GPS/HR signal loss forced an early phase end** that is NOT the
   `noDistanceSource` time-fallback (state 5, below) — e.g., the runner
   entered a tunnel/parking garage and the phase never resolved a
   `finished` condition at all, so a human ended the run manually
   (`abandon()`) rather than the plan or the runner choosing to stop.

**Proposed struct** — new, in `WorkoutEngine.swift` alongside the other four:

```swift
/// Engine-side record that a phase ended for a reason OUTSIDE the runner's
/// or the plan's control — a crash, a suspended HK session, or a signal
/// dropout that forced a manual end. Never inferred from a duration
/// comparison downstream (Rule 11): this is written at the moment the
/// interruption is DETECTED, with whatever the engine actually observed,
/// not reconstructed later from "this phase looks short."
struct PhaseInterruptedRecord: Codable {
    enum Cause: String, Codable {
        case crashRecovery      // detected via RunSnapshot presence at launch
        case sessionSuspended   // HKWorkoutSessionDelegate transition not requested by the app
        case signalLoss         // distanceSourceUnavailable / HR staleness watchdog fired
    }
    let cause: Cause
    /// Seconds the process/session was actually gone for, when known —
    /// `Date.now - snapshot.savedAtEpoch` at relaunch. Nil for a live
    /// (non-crash) interruption, where there is no dead window to report.
    let deadWindowSec: Int?
    let phaseIndex: Int?
    let phaseLabel: String?
    let atSec: Int?
}
```

**Where it gets recorded:**

- `cause: .crashRecovery` — written inside `completionFromRecovery` (or a
  sibling function it calls), NOT inside the live engine, because this fact
  is only knowable once the recovery path runs. `deadWindowSec` is
  `Date.now.timeIntervalSince1970 - snapshot.savedAtEpoch` — already
  computable, currently discarded.
- `cause: .sessionSuspended` — requires the `WorkoutTracker` audit named
  above. If the delegate already surfaces this, wire a
  `recordPhaseInterrupted(cause: .sessionSuspended)` call from wherever that
  transition is handled, following the SAME guard discipline as
  `recordCeilingLift`/`recordRepSkip` (`guard state == .running`).
- `cause: .signalLoss` — fires from `abandon()` when `tracker?.distanceSourceUnavailable == true`
  at the moment of the call, distinguishing "the runner tapped End because
  their phone died" from "the runner tapped End because the plan/rep was
  just over and they meant it" (see the corollary to state 6, §4.6).

**execution-semantics.ts reader change:** `recoveriesHonestOf`'s own doc
comment already states the discipline this state must not violate: *"a
genuinely dropped recovery — GPS loss, a crash — must still read as
unrecorded, not as 'chosen'."* A `PhaseInterruptedRecord` on a recovery phase
must NEVER cause `recoveriesHonestOf` to treat it as `endedEarlyByChoice` —
it is the opposite fact. If anything, it should be a THIRD read the honesty
check can report (not `true`, not `false` folded into "lapse," but an
explicit "we know why this one looks short and it was not the runner's
doing" — which may still count as "not honest" for the injury-tissue-load
question Rule 8's corollary protects, since the connective tissue got
whatever recovery it got regardless of WHY it was short, but should NOT be
silently blamed on the runner in a coaching sentence).

---

### 4.3 · automatically-advanced

**Definition:** the SYSTEM — not the runner, not a crash — decided a phase
was "done enough" and moved on, even though the phase's actual prescribed
target (distance, in practice) was never CONFIRMED reached. This is not
hypothetical; it is a live, dated mechanism:

`tick()`, ~line 1543-1560:

```swift
let sourceDead = tracker?.distanceSourceUnavailable == true
let pastTimeEstimate = phaseElapsedSec >= Int(Double(max(phase.durationSec, 60)) * 1.5)
let noDistanceSource = !extended
    && (phaseCoveredMi < 0.05 || sourceDead)
    && pastTimeEstimate
if noDistanceSource { tracker?.markDistanceSourceUnavailable() }
let finished: Bool
if isSinglePhaseDistanceRun, let total = workout.distanceMi {
    finished = coveredMi >= total || noDistanceSource
} else if phase.repUnit == .distance, let d = phase.distanceMi {
    finished = phaseCoveredMi >= d || noDistanceSource
} ...
if finished { advance(completedCurrent: true) }
```

When `noDistanceSource` is the reason `finished` became true, the phase is
marked **`completed: true`** — identical, on the wire, to a phase whose
distance target was genuinely confirmed. This is a real conflation:
`workAveragesFromPhases`/`resolveWorkoutVerdict` on the server side will
credit a distance rep as landed when the wrist actually gave up waiting for
GPS/HR to confirm it, because the two cases are byte-identical downstream.
This is the SAME shape as every Rule 11 defect already logged in
`CLAUDE.md` — a coerced `true` standing in for "we don't actually know."

**Proposed struct:**

```swift
/// Engine-side record that a phase's `finished` condition was satisfied by
/// the 1.5x-time-estimate fallback (`tick()`'s `noDistanceSource` branch),
/// not by the phase's own prescribed distance/duration target being
/// confirmed. `completed` stays `true` on the phase itself — the runner
/// did not fall short of anything the PLAN can see — but a reader asking
/// "was the distance/pace actually verified" needs this fact, because the
/// answer is no.
struct AutoAdvancedRecord: Codable {
    let phaseIndex: Int?
    let phaseLabel: String?
    /// Which signal was dead: distance-only, or distance AND the 6-minute
    /// stall watchdog (`markDistanceSourceUnavailable`) had already fired.
    let sourceDeadAtAdvance: Bool
    let atSec: Int?
}
```

**Where it gets recorded:** inline in `tick()`'s existing `if finished {
advance(completedCurrent: true) }` branch — append to a new
`autoAdvancedRecords` array when `noDistanceSource` (not `coveredMi >= total`
/ `phaseCoveredMi >= d`) is what made `finished` true. This is a ONE-LINE
addition at an EXISTING branch point, following the same "fold into a call
site that already exists" discipline as `endCurrentPhase()`'s comment
prescribes — no new board, no new user action, because none is involved.

**execution-semantics.ts reader change:** `GradedPhase.completed` stays
`true` (the phase is not "incomplete" from the plan's point of view — Rule
11 again: this is a THIRD fact, not a demotion of the existing one). But
`resolveWorkoutVerdict`'s pace-grading rungs (`gradeWorkPhase`) should refuse
to grade PACE against a phase carrying this record, the same way a `.effort`
shape already refuses — the distance was never confirmed, so `avgSecPerMi`
for this phase is arithmetic over an unverified denominator. Proposed:
`GradeOptions.autoAdvanced?: readonly { phaseIndex?: number | null }[]`,
matched the identical way `recoveryEndedEarly` is, and inside
`gradeStoredPhases` force `shape = 'none'` (never `'window'`/`'ceiling'`)
for a matched phase regardless of what `paceShapeFor` would otherwise return
— the SAME override precedence `wireShape`/`looksLikeMP` already establish
in that function, just one more rung.

---

### 4.4 · unknown-evidence

**Definition:** no record exists, AND the signals available do not resolve
to any of states 1–6 with enough confidence to say which one happened. This
is the explicit REFUSAL state Rule 11 demands — *"a missing input must never
silently disable a safety mechanism... if a guard cannot run, that is a
refusal worth surfacing, not a default worth assuming."* Today, EVERY phase
that ends without a matching record in `repSkips`/`recoveryExtensions`/
`recoveryEndedEarly`/`ceilingLift` and carries `completed: false` is silently
read as "the runner just didn't finish it" — which is `genuinely-skipped`,
`interrupted`, AND `unknown-evidence` all folded into one undifferentiated
`false`. That collapse is the exact bug shape Rule 8's corollary and Rule 11
both already name, generalized to a fifth axis.

**This state needs NO new struct.** It is not a fact to record — it is the
absence of every other fact, DECLARED rather than assumed. The work is
entirely on the READ side:

**execution-semantics.ts reader change:** a new exported function,
`classifyPhaseNonCompletion(phase, decisions)`, called wherever a reader
currently asks "why didn't this phase finish" (today: nowhere asks this
explicitly; readers just see `completed: false` and stop). It returns a
discriminated union:

```typescript
type PhaseEndReason =
  | { kind: 'completed-as-prescribed' }
  | { kind: 'advanced-early-intentionally'; record: RepSkipRecord | RecoveryEndedEarlyRecord }
  | { kind: 'genuinely-skipped'; record: RepSkipRecord }   // pending §4.1's open question
  | { kind: 'interrupted'; record: PhaseInterruptedRecord }
  | { kind: 'automatically-advanced'; record: AutoAdvancedRecord }
  | { kind: 'session-ended'; record: SessionEndedRecord }  // see §4.6
  | { kind: 'unknown-evidence' };  // NO value field — Rule 8's NormalReading<T>
                                    // pattern is the model: a refusal branch
                                    // that cannot be read as a value by accident.
```

The `'unknown-evidence'` branch carries no data on purpose, mirroring
`lib/training/normal-window.ts`'s `NormalReading<T>` refusal contract (a
type-level enforcement of Rule 11, not just a convention) — a caller that
tries to read a record off this branch should not compile.

**Why this matters beyond honesty:** every coaching sentence that currently
says something like "you cut that short" over a phase that `completed:
false` needs to STOP saying it once this classifier exists and returns
`'unknown-evidence'` — an interruption or a genuine skip earns a different
sentence than a shrug, and a shrug is better than a wrong accusation (this
project's whole `docs/PRODUCT_COACHING_DOCTRINE.md` posture on "noted, not
judged" for a missed run applies identically here, one level down at the
phase).

---

### 4.5 · session-ended — the general case

**Definition:** the phase ended not because the PLAN moved to what's next,
but because the RUNNER ended the entire session right there — "End Run"
(`abandon()`), independent of which phase they happened to be sitting in
when they pressed it.

**The current gap:** `abandon()` (line ~766) does exactly this:

```swift
func abandon() {
    guard state == .running else { return }
    if isPaused { resume() }
    if planComplete { finish(status: "completed"); return }
    if workout.isOpenEnded {
        recordCurrentPhase(completed: true)
        finish(status: "completed")
        return
    }
    recordCurrentPhase(completed: false)
    finish(status: "abandoned")
}
```

It records **nothing** distinguishing itself from `interrupted`
(§4.2) or `genuinely-skipped` (§4.1) on the phase it was sitting in. The
run-level `status: "abandoned"` DOES exist and does travel — but that is a
RUN fact, not a PHASE fact, and every state in this document is about the
phase. A reader looking at the specific phase the runner was in when they
ended the run cannot currently tell "the runner deliberately stopped here"
from "the watch died here."

**Proposed struct:**

```swift
/// Engine-side record that THIS phase ended because the runner ended the
/// WHOLE SESSION from here — "End Run" — not because the plan advanced to
/// what's next. At most one per run, by construction (a session ends once).
struct SessionEndedRecord: Codable {
    let phaseIndex: Int?
    let phaseLabel: String?
    let phaseType: String?       // "work" / "recovery" / "warmup" / "cooldown"
    let elapsedSecInPhase: Int?
    let prescribedSecInPhase: Int?
    let atSec: Int?
    /// Whether this session-end ALSO happens to be the plan's own last
    /// phase — see §4.6. When true, this record and the "last-phase"
    /// detection at that other call site describe THE SAME instant from two
    /// different triggers (abandon() vs endCurrentPhase()), and a reader
    /// must not double-count them as two separate facts about one phase-end.
    let wasLastPrescribedPhase: Bool
}
```

**Where it gets recorded:** inside `abandon()`, before `recordCurrentPhase`,
following the SAME "record before banking" ordering `endCurrentPhase()`
already uses:

```swift
func abandon() {
    guard state == .running else { return }
    if isPaused { resume() }
    if planComplete { finish(status: "completed"); return }
    if workout.isOpenEnded {
        recordCurrentPhase(completed: true)
        finish(status: "completed")
        return
    }
    recordSessionEndedHere()   // NEW — records the CURRENT phase as the one the
                               // runner chose to stop the whole run at
    recordCurrentPhase(completed: false)
    finish(status: "abandoned")
}
```

`recordSessionEndedHere()` needs no new signal beyond what `endCurrentPhase()`
already reaches for — `currentPhase`, `phaseElapsedSec`,
`currentPhase.durationSec + phaseAddedSec`, `totalElapsedSec`, and
`currentIndex + 1 >= workout.phases.count`.

---

### 4.6 · session-ended — the specific case David called out

> **"Specifically test the final recovery after the last stride. It must not
> be falsely described as a normal mid-session advance if the runner simply
> ended the completed workout."**

This is a DIFFERENT trigger than §4.5's `abandon()` path, and it is a REAL,
LIVE defect in the code shipped this session — not a hypothetical:

**The defect, precisely.** A strides/interval session's phase list often ends
`[..., work(last stride), recovery(last walk-back), cooldown]` or, if there is
no cooldown, `[..., work(last stride), recovery(last walk-back)]` — the last
walk-back IS the plan's final phase. `endCurrentPhase()` — the ONLY call site
"Go now"/"End interval" reaches — is:

```swift
func endCurrentPhase() {
    guard !isPaused else { return }
    guard state == .running, !planComplete else { return }
    recordRecoveryEndedEarlyIfApplicable()   // ← fires unconditionally for ANY
                                              //   recovery ended early, with NO
                                              //   check for whether this is the
                                              //   LAST phase
    advance(completedCurrent: false)          // ← THIS is where
                                              //   currentIndex + 1 >= phases.count
                                              //   gets checked, one call later
}
```

`advance()` — called AFTER the record already exists — is where
`currentIndex + 1 >= workout.phases.count` is actually evaluated, to decide
`planComplete = true` (enter overtime) vs incrementing to the next phase.
**By the time that check runs, `RecoveryEndedEarlyRecord` has already been
written**, with `beforeRepIndex` computed from `nextWorkRepOrdinal` — which
is `nil` when there is no next rep (the exact case here), but the record is
appended regardless, and nothing about it says "this was the last one."

**What the phone currently does with it** —
`native-v2/Faff/Faff/ViewsV5/TodayAfterV5.swift`'s `completionNote`:

```swift
static func completionNote(
    type: String?, completed: Bool?, endedEarly: V5RecoveryEndedEarly? = nil
) -> String? {
    if type == "recovery", let e = endedEarly, e.prescribedSec > 0, e.actualSec >= 0 {
        let actual = FaffFmt.clock(sec: Double(e.actualSec)) ?? "0:00"
        let prescribed = FaffFmt.clock(sec: Double(e.prescribedSec)) ?? "0:00"
        return "\(actual) of \(prescribed) · advanced early"
    }
    ...
}
```

This is UNCONDITIONAL — every `RecoveryEndedEarly` record prints "advanced
early" with zero check for whether there was anything left to advance TO.
On the last walk-back of a session, "0:43 of 1:00 · advanced early" reads to
the runner as "I cut it short to get to the next thing" when what actually
happened is "I finished my workout and didn't feel like standing around for
the last seventeen seconds of a walk-back that leads to nothing." Those are
different facts, and doctrine's own coaching-voice posture ("noted, not
judged," `docs/PRODUCT_COACHING_DOCTRINE.md`) cares about this distinction —
"advanced early" mid-session is neutral-to-positive (eager, not skipping);
misapplied to the last recovery, it is nonsensical, and depending on
copy could even read as if it happened MORE than once ("early" implies
"early relative to something coming next").

**The fix, scoped (not implemented):**

1. In `endCurrentPhase()`, compute the SAME predicate `advance()` computes,
   BEFORE calling `recordRecoveryEndedEarlyIfApplicable()`:

   ```swift
   let endsSession = currentIndex + 1 >= workout.phases.count
   ```

2. Pass it into `recordRecoveryEndedEarlyIfApplicable(endsSession:)`
   (or have that function read a stored property set one line earlier — the
   exact wiring is an implementation call, not a scoping one). When
   `endsSession` is true, do NOT append a `RecoveryEndedEarlyRecord` at all
   — append a `SessionEndedRecord` (§4.5) instead, with
   `wasLastPrescribedPhase: true`, and `phaseType: "recovery"`.
   `RecoveryEndedEarlyRecord` should ONLY ever describe a recovery that
   really did advance to something else — the name says "ended early," and
   "early" is meaningless with nothing after it.

3. **Symmetric case: `abandon()` on the last recovery.** If the runner
   presses "End Run" (not "Go now") while sitting on that same last
   walk-back, `abandon()`'s new `recordSessionEndedHere()` (§4.5) should ALSO
   set `wasLastPrescribedPhase: true` when `currentIndex + 1 >=
   workout.phases.count` — same predicate, same fact, reached from the OTHER
   trigger. A reader should not have to know which BUTTON the runner pressed
   to get the same true fact about the phase.

4. **`completionNote` (phone) changes its branch on `SessionEndedRecord`
   rather than `RecoveryEndedEarly`** for this specific phase: something
   like *"0:43 of 1:00 · workout complete"* rather than "advanced early" —
   exact copy is a coaching-voice call, not this document's to make, but the
   STRUCTURAL point is that the phone must be able to tell these two records
   apart, which requires the wire to carry two distinct fields
   (`recoveryEndedEarly` and `sessionEnded`, both optional arrays/objects,
   never one field doing both jobs — Rule 16, one quantity one name, applies
   to "why did this recovery come up short" exactly as much as to a VDOT
   number).

5. **`execution-semantics.ts`'s `recoveriesHonestOf` must also not penalize
   this case as a lapse OR require it to be `endedEarlyByChoice` to be
   excused.** A recovery cut short because the whole session ended there is
   not a "chosen early end to get to the next thing" (WALKBACK-2's own
   category) and is not a lapse either — it is its own excluded reason. The
   cleanest implementation: extend the SAME exclusion `endedEarlyByChoice`
   already provides, i.e. a recovery carrying either a `RecoveryEndedEarly`
   OR a `SessionEnded(wasLastPrescribedPhase: true)` record is excluded from
   the honesty vote the same way. Whether that is one boolean
   (`excludedFromHonesty`) computed upstream of `recoveriesHonestOf`, or the
   function itself checking two optional fields, is an implementation
   choice — but the TEST that must exist either way is explicit:

**The test David asked for, restated as a concrete spec:**

> A synthetic session whose phase list ends `[..., work(rep N), recovery(walk-
> back N, cut to 8s of a 60s model via "Go now")]` — no phase after the
> recovery — must:
> - carry a `SessionEndedRecord` for that recovery phase, `wasLastPrescribedPhase: true`, and
> - carry NO `RecoveryEndedEarlyRecord` for it, and
> - grade `recoveriesHonest !== false` for the session (excluded, not penalized), and
> - render on the phone as something that does NOT say "advanced early".
>
> A second synthetic session, identical EXCEPT the walk-back is followed by
> one more work rep, cut the SAME way (8s of a 60s model, "Go now") — must:
> - carry a `RecoveryEndedEarlyRecord` (the existing WALKBACK-2 behavior,
>   unchanged), and
> - carry NO `SessionEndedRecord`.
>
> Fail-before/pass-after per Rule 18: run both against today's shipped code
> and confirm the FIRST case currently produces a `RecoveryEndedEarlyRecord`
> (the defect), before implementing the fix that makes it produce a
> `SessionEndedRecord` instead.

## 5 · Combined wire schema (sketch)

All five new/changed fields, following the existing `nil`-unless-populated,
never-`[]` convention:

```swift
// WatchCompletion (WatchWorkoutModels.swift)
var repSkips: [RepSkip]? = nil                    // existing — gains elapsedSecAtSkip (§4.1)
var recoveryExtensions: [RecoveryExtension]? = nil // existing, unchanged
var recoveryEndedEarly: [RecoveryEndedEarly]? = nil // existing (WALKBACK-2) — gains
                                                     // nothing; the last-phase case
                                                     // moves OUT of this array (§4.6)
var phaseInterruptions: [PhaseInterrupted]? = nil   // NEW (§4.2)
var autoAdvanced: [AutoAdvanced]? = nil             // NEW (§4.3)
var sessionEnded: SessionEnded? = nil               // NEW (§4.5/4.6) — singular, not an
                                                     // array: a session ends exactly once
```

```typescript
// RunData (web-v2/lib/runs/run-shape.ts)
recoveryEndedEarly?: Array<{...}>;   // existing
phaseInterruptions?: Array<{
  cause: 'crashRecovery' | 'sessionSuspended' | 'signalLoss';
  deadWindowSec?: number;
  phaseIndex?: number; phaseLabel?: string; atSec?: number;
}>;
autoAdvanced?: Array<{
  phaseIndex?: number; phaseLabel?: string;
  sourceDeadAtAdvance: boolean; atSec?: number;
}>;
sessionEnded?: {
  phaseIndex?: number; phaseLabel?: string; phaseType?: string;
  elapsedSecInPhase?: number; prescribedSecInPhase?: number; atSec?: number;
  wasLastPrescribedPhase: boolean;
};
```

## 6 · execution-semantics.ts / verdict.ts changes, summarized

- `GradeOptions` gains `phaseInterruptions?`, `autoAdvanced?`, `sessionEnded?`
  — matched onto phases by `phaseIndex`, the identical mechanism
  `recoveryEndedEarly` already established. No new matching primitive needed.
- `recoveriesHonestOf` gains a second exclusion reason alongside
  `endedEarlyByChoice` for a recovery whose short duration is explained by
  `sessionEnded` or `phaseInterruptions` — excluded from the vote, never
  forced to `true` (§4.5/4.6's point, restated).
- `gradeWorkPhase`/`paceShapeFor` gain an override rung for `autoAdvanced`
  (§4.3) — force `shape: 'none'`, same precedence tier as `wireShape`.
- A new exported `classifyPhaseNonCompletion` (§4.4) — the one new READ
  surface, not a grading change, used by coaching-sentence composers so
  "you cut that short" is never said over `interrupted` or `unknown-evidence`.
- **Every existing consumer of `resolveWorkoutVerdict` needs the SAME audit
  WALKBACK-2's independent reviewer already ran for `recoveryEndedEarly`** —
  re-trace `CONSUMERS` in `web-v2/lib/execution/_workout_verdict_owner.test.ts`
  for each new field as it's threaded through, rather than assuming the
  audit still holds. That test file's scanner should be extended to name the
  new field(s) it checks for, the same way it already names
  `recoveryEndedEarly` implicitly through the `GradeOptions` type it imports.

## 7 · Open decisions to flag back to David before implementing

Per this project's decision/operational boundary (`CLAUDE.md`, "Operational
vs decision vs external"), these are genuine two-defensible-answers forks,
not implementation details:

1. **§4.1** — is "genuinely-skipped" the zero-dose-vs-partial-dose
   distinction on an EXISTING trigger (this doc's recommendation, needs no
   new UI), or a true skip-ahead gesture that does not exist in the app
   today (needs a new control — bigger scope)?
2. **§4.2.2** — does `WorkoutTracker` already observe
   `HKWorkoutSessionDelegate` state changes the app did not request? If not,
   `sessionSuspended` cannot be built until that instrumentation exists, and
   that is its own audit.
3. **Precedence when two facts could both apply to one phase-end** — e.g., a
   recovery is both the LAST phase (§4.6) AND the distance/HR source went
   dead moments before (§4.2.3/§4.3). This document has not resolved which
   record wins, or whether more than one may coexist on the same phase. The
   `SessionEndedRecord.wasLastPrescribedPhase` field is a partial answer (it
   lets `sessionEnded` and `interrupted` both exist for one phase without
   contradiction) but a full precedence order across all five states needs
   a decision, not an assumption, before the matching logic in
   `gradeStoredPhases` is written.
4. **Coaching copy** for each new state's phone-facing sentence — this
   document names the STRUCTURAL requirement (the wire must be able to tell
   these apart) and deliberately does not write the copy itself.

## 8 · What this document does NOT do

No Swift, TypeScript, or SQL in this repo has been changed for Task 2. Every
code block above is illustrative — a concrete enough sketch that an
implementation session does not have to re-derive the architecture, not a
diff to apply. The one exception already shipped is WALKBACK-2 itself
(states 1–2), referenced throughout as the pattern to extend.
