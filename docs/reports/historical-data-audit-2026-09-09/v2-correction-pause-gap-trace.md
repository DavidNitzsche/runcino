# Field-Lineage Trace: `pausedSec` / `droppedGapSec`, Capture to (Non-)Display

**Read-only correction/completion pass. No files edited, no writes issued, no branches merged.**
**Commits cited: `8559245496bf498d3d4b0479e1117ae416988c4a`** (v1's pin, "Pin-1") **and `ae91e30668df7e14b1279cb6e4d20db87de5250e`** (current `origin/main`, "Pin-2"). Every file in this specific `pausedSec`/`droppedGapSec` chain is byte-identical between the two pins **except** `web-v2/app/api/watch/workouts/complete/route.ts`, `web-v2/lib/postrun/load.ts`, `web-v2/lib/training/execution-semantics.ts`, `web-v2/lib/execution/verdict.ts` and `web-v2/lib/runs/run-shape.ts`, which all gained an unrelated feature (**WALKBACK-2**, 2026-09-09 — `recoveryEndedEarly`) between the pins; the `pausedSec`/`droppedGapSec` logic itself did not change a single character, only shifted by a few line numbers where noted. `[SOURCE]` — confirmed with `git diff <pin1> <pin2> -- <path>` on every file in this chain.

This section connects Domain A's finding (the storage-side false invariant) and Domain B's case 5.4 (the submission-time loss) into one hop-by-hop trace, per the assignment, and goes one step further than either: a direct database join across this account's **entire** `watch_completion` history shows the loss Domain B sampled in a 14-day window is not hypothetical or occasional — it is the **outcome on every single occurrence of this field, ever, in this account, at both commits, with no exception**. It also identifies a third sender neither Domain A nor Domain B examined, which turns out to be the primary one in practice.

---

## Hop 1 — Swift capture: THREE senders, not two

Domain A's reviewer found two. There are three, and the third is the one actually firing in production.

**1a. `native-v2/Faff/Faff/Views/TreadmillView.swift` (phone-side, legacy-generation treadmill console)**, identical at both pins:

```swift
// lines 1070-1076 (both pins)
if session.belt.droppedSec >= 1 {
    payload["droppedGapSec"] = Int(session.belt.droppedSec.rounded())
}
if session.belt.pausedSec >= 1 { payload["pausedSec"] = Int(session.belt.pausedSec.rounded()) }
```
`[SOURCE]`

**1b. `native-v2/Faff/Faff/ViewsV5/LiveRunTreadmillV5.swift` (phone-side, current V5-generation treadmill console)**, identical at both pins:

```swift
// lines 670-673 (both pins)
if session.belt.droppedSec >= 1 {
    payload["droppedGapSec"] = Int(session.belt.droppedSec.rounded())
}
if session.belt.pausedSec >= 1 { payload["pausedSec"] = Int(session.belt.pausedSec.rounded()) }
```
Both `session.belt.pausedSec`/`droppedSec` are internal accounting fields on `BeltTracker.swift` (`private(set) var pausedSec/droppedSec`, accumulated at `BeltTracker.swift:222` and `:259`) — used **only** to build this outbound payload; `[SOURCE]` a full grep of both view files for `pausedSec|droppedSec` (excluding these lines) returns nothing else — no `Text(...)`, no other read site. There is no on-screen pause readout during a treadmill session.

**1c. The actual live Watch app — `legacy/native/Faff/FaffWatch Watch App/WorkoutEngine.swift` — is the third sender, and Domain A's framing that "not legacy/dead code" applies only to the `native-v2` files understates this.** Directory name notwithstanding, this file **is** the currently-shipping watch companion app's source: `native-v2/Faff.xcodeproj/project.pbxproj` builds its `FaffWatch Watch App` target directly from these `legacy/native` `.swift` files (`path = WorkoutEngine.swift`, `path = WatchWorkoutModels.swift`, both wired into the `FaffWatch Watch App` PBX group and `Sources` build phase). `[SOURCE]` There is no separate, competing Watch source tree under `native-v2` itself — the native-v2 phone project reaches out to `legacy/native` for its watch target. This is not the "current-generation, not legacy" test Domain A applied to the treadmill views; it is the same test, applied correctly, and it passes for this file too.

`WorkoutEngine.swift` accumulates a genuine pause quantity from the watch's own Pause/Resume controls — nothing to do with the treadmill belt:

```swift
// line 318
private(set) var totalPausedSec: Int = 0
// resume(), lines 826-831
func resume() {
    guard state == .running, isPaused, let ps = pauseStart else { return }
    let delta = Date.now.timeIntervalSince(ps)
    phaseStart = phaseStart.addingTimeInterval(delta)
    totalPausedSec += Int(delta.rounded())
    ...
}
```
gated `guard !isRace else { return }` at the `pause()` call site (pause is blocked mid-race) — this is a deliberate, runner-driven action, not noise. It is written into the completion payload at:

```swift
// line 3463
out.pausedSec = totalPausedSec > 0 ? totalPausedSec : nil
```

with its own doc comment on the stored property, in `WatchWorkoutModels.swift:1543-1548`, that states the exact history of the gap Domain A rediscovered:

> *"Seconds the runner held the clock. The server declares `pausedSec` and only the treadmill ever sent it, so a watch run paused at a stoplight failed the clock audit... nil rather than 0 when nothing was paused."*

That comment is **historically accurate and currently obsolete in the direction that matters**: it documents that the watch-side gap has already been closed — this property now exists and now sends. `[SOURCE]` byte-identical at both pins. `WatchCompletion` is `Encodable` with **no `CodingKeys`** (documented explicitly at `WatchWorkoutModels.swift:1357-1358`, and enforced by `scripts/check-wire-keys.sh`, which parses this exact struct's braces for exactly this reason), so the Swift property name `pausedSec` **is** the wire key, verbatim, with no mapping step to get wrong. `[SOURCE]` A dedicated regression test exists for the underlying arithmetic: `legacy/native/Faff/FaffWatch Watch AppTests/_DisplayedNumberTests.swift:1010`, `pausedSecondsAreExcludedAndTheSumStillAgrees()`. This is tested, gated, and shipping — not a latent corner case.

`droppedGapSec` has **no equivalent watch-side sender** — `WatchCompletion` declares no such property; it is treadmill-belt-only vocabulary (a gap the belt integral declined to credit has no outdoor-GPS analogue). Confirmed empirically below: 0/68 payloads in this account's history ever carry it.

---

## Hop 2 — The completion payload leaving the device

No transformation happens between the Swift struct and the wire: `JSONSerialization.data(withJSONObject: payload)` for the two treadmill dictionaries, and Swift's synthesized `Encodable` (no `CodingKeys`, `encodeIfPresent` semantics on every `Int?`) for `WatchCompletion`. A representative outbound body, reconstructed from the treadmill payload-construction block (`TreadmillView.swift`) for a session with a real pause:

```json
{
  "workoutId": "trd_...",
  "totalDistanceMi": 4.71,
  "totalDurationSec": 2210,
  "source": "treadmill",
  "indoor": true,
  "phases": [ ... ],
  "pausedSec": 215,
  "distanceSource": "belt_corroborated",
  "clockDriftSec": 0.4
}
```
— `droppedGapSec` present only when `belt.droppedSec >= 1` (never observed in this account, see Hop 5 below). And, separately, for a genuine outdoor watch run:
```json
{
  "workoutId": "0645f40c-...-2026-08-30#0740",
  "totalDistanceMi": 13.49,
  "totalDurationSec": 6383,
  "pausedSec": 1619,
  "movingSec": 6383,
  ...
}
```
All three senders post to the **same** endpoint (`TreadmillView.swift:1132`, `LiveRunTreadmillV5.swift`'s equivalent, and `WorkoutEngine.swift`/`PhoneSync.swift`'s relay, all target `api/watch/workouts/complete`). `[SOURCE]`

---

## Hop 3 — The API route: `web-v2/app/api/watch/workouts/complete/route.ts`

Two, not one, drop-relevant things happen here, and this is where the assignment's premise ("resolve exactly where the value would currently be dropped") gets a sharper answer than either domain report gave: **the value is not dropped once, downstream — it is dropped here, at ingestion, before anything durable is ever written, in the overwhelming majority of real cases.**

**3a. `pausedSec`/`droppedGapSec` feed a diagnostic-only computation, `clockAudit`, that is stored ONLY when the clock still doesn't reconcile:**

Pin-2 line numbers (Pin-1 identical, shifted −3 lines from an unrelated earlier HR-zone addition):

```ts
// route.ts:603-630 (Pin-2); route.ts:570-596 (Pin-1) — identical body
const clockAudit = (() => {
  const startMs = Date.parse(startUtc ?? '');
  const endMs = Date.parse(toUtcIso(body.completedAt, source, tz) ?? '');
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  const wallSec = (endMs - startMs) / 1000;
  if (!(wallSec > 0)) return null;
  const accounted = totalSec + (Number(body.pausedSec) || 0) + (Number(body.droppedGapSec) || 0);
  const driftSec = Math.round(wallSec - accounted);
  if (Math.abs(driftSec) <= CLOCK_DRIFT_TOLERANCE_SEC) return null;   // ← 45s, line 47
  ...
  return {
    driftSec, wallSec: Math.round(wallSec), countedSec: totalSec,
    pausedSec: Number(body.pausedSec) || 0,
    declinedSec: Number(body.droppedGapSec) || 0,
    clientDriftSec: ...,
  };
})();
```

Read this precisely: `body.pausedSec` is used to **correctly explain away** wall-clock time that would otherwise look like an unaccounted gap. When the pause figure is accurate — which, per Hop 5 below, it always has been in this account — `accounted ≈ wallSec`, `driftSec` lands inside the ±45s tolerance, and **the entire `clockAudit` object, `pausedSec` and all, returns `null` and is never spread into `runs.data` at all.** `pausedSec` is consumed as a scratch input to a pass/fail check and then discarded, in the single case where the runner's pause was genuine and correctly measured — which is precisely the case where a coach-facing product would most want to record it. Only when the pause **fails** to explain the gap (a genuinely unaccounted discrepancy remains beyond 45s) does `clockAudit` — and the `pausedSec` figure nested inside it — get written down at all. This is an inversion of what you'd want from a data-integrity standpoint: the mechanism records the pause exactly when it *doesn't* trust it, and throws it away exactly when it does.

**3b. `droppedGapSec` gets a second, unconditional top-level write that `pausedSec` structurally never receives:**

```ts
// route.ts:915-916 (Pin-2); :880-881 (Pin-1)
...(Number(body.droppedGapSec) > 0
  ? { droppedGapSec: Math.round(Number(body.droppedGapSec)) }
  : {}),
```
This spreads directly into the `data` object written to `runs.data.droppedGapSec` — independent of the 45s drift gate. **There is no equivalent line for `pausedSec`.** `[SOURCE]` — confirmed with `git grep -n "pausedSec"` against the whole `web-v2` tree at Pin-2: `pausedSec` occurs in exactly four places, all inside the `clockAudit` closure (`route.ts:304, 609, 616, 623`) and nowhere else. `droppedGapSec` gets this one extra top-level write, but (per Hop 6) **no reader anywhere in `web-v2` ever consumes `runs.data.droppedGapSec`** — it is a write-only field, a second, independent dead end from the one Domain A/B examined.

Net effect of Hop 3: `pausedSec` has exactly **one** path into any persisted row, gated to fire only on the drift-check's failure branch; `droppedGapSec` has one unconditional persisted path and one gated one, but every persisted path for both fields dead-ends before any reader touches it (see Hop 6).

---

## Hop 4 — `clockAudit` storage into `runs.data`

The upsert is a shallow jsonb merge:
```sql
-- route.ts, near the INSERT INTO runs
SET data = runs.data || jsonb_strip_nulls(EXCLUDED.data)
```
`[SOURCE]` This is a single-key `||` merge: when `clockAudit` is present in `EXCLUDED.data` it replaces the prior `clockAudit` object wholesale (not a deep field merge); when absent (the normal case, per Hop 3a) the existing row's `clockAudit` — if any — survives untouched, which is the documented, deliberate "keys absent, not null" non-clobbering discipline the surrounding comments describe for other optional fields in this same route.

`[PROD-QUERY]` (`faff_readonly`, read-only, `runs.user_uuid = <RUNNER_UUID_REDACTED>`): the **entire canonical corpus** carries `clockAudit` on exactly 4 of 162 rows, matching Domain A's count, and on all 4 `pausedSec = 0`, `declinedSec = 0`:

| `runs.id` | `data.clockAudit` |
|---|---|
| `-220066891328078` | `{wallSec:2221, driftSec:156, pausedSec:0, countedSec:2065, declinedSec:0}` |
| `-216056293577712` | `{wallSec:5310, driftSec:710, pausedSec:0, countedSec:4600, declinedSec:0}` |
| `-145861381014809` | `{wallSec:4694, driftSec:1637, pausedSec:0, countedSec:3057, declinedSec:0}` |
| `-55341764239083` | `{wallSec:6852, driftSec:1554, pausedSec:0, countedSec:5298, declinedSec:0}` |

None carries `droppedGapSec` at the top level either — meaning `droppedGapSec` has never once been nonzero in this account's history, at any of the three senders, ever. But **all 4 rows show large drift** (156–1637 seconds) with `pausedSec:0` — i.e. these are the rows where the clock genuinely didn't reconcile and the runner had not paused; `clockAudit` is doing its job on exactly the population it was built for. This confirms the mechanism itself is sound; it is the treatment of a *real, accounted-for* pause that has the defect, and the 4-row sample Domain A examined structurally cannot show that defect, because a row only reaches this table when the pause did **not** fully explain the drift.

---

## Hop 5 — Canonical/absorbed merge logic: does it touch these fields?

Checked directly, per the assignment, rather than assumed.

`clockAudit` is written by exactly one route in the whole tree (`git grep -n "clockAudit" ae91e306... -- web-v2` returns only `route.ts`, its own tests, and the two `postrun` readers) — so it is **not** currently a Rule-6-style multi-writer jsonb column; there is one writer. `pausedSec`/`droppedGapSec` similarly have exactly one writer each (the same route). `[SOURCE]`

But `enhanceCanonicalFromAbsorbed` (`web-v2/lib/runs/canonical.ts:574`), the function that copies fields from a dedup-loser row into its canonical winner during absorption, is **field-name-generic**: it walks every key of the absorbed row's `data` and copies it into the canonical unless the key is in one of two explicit exclusion sets:

```ts
// canonical.ts:376-388
const NEVER_COPY = new Set(['id','activityId','source','ingestedAt','mergedIntoId','client_workout_id','absorbed_into_canonical_at']);
const SPECIAL_ROUTE = new Set(['gear','gear_id','perceived_exertion','rpe']);
```
Neither `clockAudit`, `pausedSec`, nor `droppedGapSec` appears in either set. `[SOURCE]` For an ordinary key not covered by the `splits` special case (`canonical.ts:625` onward), the generic branch is:
- canonical's own value missing → copy the absorbed row's value in (subject to `familyGuardedFill`/`clockFamilyContradiction` checks against the "clock family" of arithmetic fields), whole-object, not deep-merged;
- canonical's own value present and incoming tier ≤ existing tier → skipped;
- canonical's own value present and incoming tier > existing tier → **overwritten wholesale**.

This means: `clockAudit` is structurally exposed to the exact Rule-6 shape (a whole-object jsonb field decided by a single winner-take-all key-copy, not reconciled field-by-field) the moment a second row ever legitimately carries it — it is only accidental, not structural, that this has never manifested, because in practice only one route (`watch/workouts/complete`) has ever populated this key on any row, and this account's dual-submission cases (Domain B's 5.2, the 09-03 treadmill-vs-apple_watch tie-break) have so far always resolved with the treadmill side (the only side that could carry `clockAudit`) winning as canonical. `[SOURCE]` + `[INFERENCE]`: I did not find, and did not expect to find, a production instance of this actually clobbering a real `clockAudit`/`pausedSec` value, because zero canonical rows show any evidence of it (Hop 4's 4-row table above). This is a **latent structural exposure, not an observed loss** — worth naming for whoever eventually adds `clockAudit`/`pausedSec` to `NEVER_COPY` (or a field-level reconciliation) rather than leaving it to the generic tier-overwrite path, but it is not where today's real, empirically-confirmed loss happens. That loss is entirely upstream of any merge, at Hop 3.

---

## Hop 6 — Post-run readers: the false comments, corrected precisely

**Domain A cited only one instance of this comment.** There are actually **two, word-for-word similar but independently written**, in `web-v2/lib/postrun/experience.ts` — the second at a location Domain A did not cite:

- `experience.ts:467-468` (both pins, unchanged) — inside the `PostRunCapture` interface's `clockAudit` field doc:
  > *"...`pausedSec` and `declinedSec` are deliberately NOT read here: the route computes them as `Number(body.pausedSec) || 0`, no Swift file sends either field, and a zero that means 'nobody said' must not be spent as a zero that means 'nothing was paused'."*
- `experience.ts:1172-1173` (both pins, unchanged) — the one Domain A cited:
  > *"`pausedSec` and `declinedSec` are NOT: the route computes each as `Number(body.pausedSec) || 0`, and no Swift file in this repository sends either field, so both are structurally `0` on every row ever written."*
- `web-v2/lib/postrun/load.ts:708-709` at Pin-2 / `:705-706` at Pin-1 (content unchanged, line numbers shifted 3 by the unrelated WALKBACK-2 diff above this point in the file):
  > *"`pausedSec` and `declinedSec` are deliberately NOT carried. No Swift file sends either, so the route's `Number(body.pausedSec) || 0` makes both structurally zero on every row, and a zero meaning 'nobody said' must not travel beside three real measurements (Rule 11)."*

**The precise correction, stated exactly (not "false" in the abstract — false in three specific, separable ways):**

1. *"No Swift file sends either field"* is false as a claim about the codebase — confirmed at Hop 1, three files send `pausedSec` (two treadmill views, plus the live Watch app's `WorkoutEngine.swift`, which none of the three comments account for at all — even Domain A's contradiction only named the two treadmill files).
2. *"Both are structurally 0 on every row ever written"* is false as an empirical claim about this account, not just a theoretical possibility — `[PROD-QUERY]`: 8 of 68 `watch_completion` submissions in this account's full history (2026-05-27 through today) carry a nonzero `pausedSec` (values 2, 181, 215, 281, 309, 381, 860, 1619 seconds), the earliest dated 2026-08-26 — two weeks before this comment's own assertion was read by Domain A's reviewer at Pin-1's timestamp. The comment was already wrong about this account's actual data at the moment either pin was cut, not just wrong about a future hypothetical.
3. What **is** durably true — and this is the part neither comment states, and the part that actually matters for the fix — is that `runs.data.clockAudit.pausedSec` (the only place this reader could ever see the value) has never been anything but `0`, on all 4 rows that carry it. That is not because no Swift file sends a real value; it is because Hop 3's drift-tolerance gate discards the value before storage in every real case, and this reader (`load.ts`) additionally never reads it back even on the rare row where storage did occur (see below). The comment's factual premise about *why* the number is always zero is wrong; the *consequence* it draws (don't trust a `pausedSec` read off `clockAudit` as a real measurement) happens to still be operationally safe advice today, for the wrong reason, and will stop being safe the moment someone "fixes" the false premise without also fixing Hop 3's gate.

**The actual drop mechanics in `load.ts`, read precisely (`load.ts:703-712` Pin-2 / `:700-709` Pin-1, unchanged):**

```ts
clockAudit: (() => {
  const a = data.clockAudit;
  if (!a || typeof a !== 'object') return null;
  const r = a as Record<string, unknown>;
  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : null);
  // `pausedSec` and `declinedSec` are deliberately NOT carried. ...
  return { driftSec: n(r.driftSec), wallSec: n(r.wallSec), countedSec: n(r.countedSec) };
})(),
```
This is a **hard type-level drop**, not a conditional one: `r.pausedSec`/`r.declinedSec` are never referenced by this destructuring at all, regardless of their value. Even on the 1-in-68 hypothetical future row where Hop 3's gate *does* let a nonzero `pausedSec` through into `clockAudit`, this line throws it away unconditionally on the way into `PostRunInput`. The `PostRunCapture`/`clockAudit` **type itself** (`experience.ts:473`) is declared as `{ driftSec: number | null; wallSec: number | null; countedSec: number | null } | null` — `pausedSec`/`declinedSec` are not fields of the type at all, so nothing downstream of this point could read them even if a future edit tried, without first widening this type.

`readCapture` (`experience.ts:1198`) — the function that turns `input.clockAudit` into the one user-facing string this reader produces (`capture: string | null`, surfaced through `wire.ts`'s `PostRunWire.capture` field) — reads only `input.clockAudit?.driftSec` (`experience.ts:1276`). `[SOURCE]` So even the theoretical case above (a value surviving Hop 4 and somehow being read by `load.ts`) still would not reach the one sentence this domain renders — that sentence is entirely about `driftSec`/`wallSec`/`countedSec`, never pause or decline seconds.

---

## Hop 7 — Grading: `execution-semantics.ts` / `verdict.ts`

`[SOURCE]` `git grep -n "pausedSec\|droppedGapSec\|declinedSec\|clockAudit"` against `web-v2/lib/training/execution-semantics.ts` and `web-v2/lib/execution/verdict.ts` at Pin-2 returns **zero matches in either file.** The same is true at Pin-1 (the WALKBACK-2 diff added `recoveryEndedEarly` handling to both files, an unrelated field). A repo-wide grep of the entire `web-v2/lib` tree for these three field names returns matches in exactly two files: `postrun/experience.ts` and `postrun/load.ts` — nowhere else.

This settles the question precisely: **grading is not "blind because it strips the value" — it is blind because the value never flows anywhere near it.** There is no wiring from `runs.data.clockAudit`, `pausedSec`, or `droppedGapSec` into `sessionLadder`, `recoveriesHonestOf`, `lateCollapseOf`, or any function in `verdict.ts`. `RECOVERY_DURATION_TOLERANCE` (Domain A claim #12), `recoveriesHonestOf`, and the whole executed/graded/collapsed verdict machinery operate entirely off phase-level `actualDurationSec` vs `targetDurationSec` comparisons and (as of WALKBACK-2) the separate, unrelated `recoveryEndedEarly` record — never off a whole-run pause/drop figure. A pause during a *tempo* or *long-run* segment (as opposed to a recovery walk-back) has **no grading-layer representation at all**, gated or otherwise; it simply isn't a question the grading layer's inputs can express.

---

## Hop 8 — UI: does the pipeline ever reach a screen?

No, at either endpoint, live or after the fact.

**Live, on the watch:** `git grep -n "totalPausedSec\|pausedSec"` against every `.swift` file under `legacy/native/Faff/FaffWatch Watch App` (the actual shipping watch-app source) outside `WorkoutEngine.swift`/`WatchWorkoutModels.swift` themselves returns **nothing** — no face, no controls board, no finish screen (`FacesFinishV5.swift`, `ContentView.swift`, `WorkoutRootView.swift`, etc.) reads `totalPausedSec` for display. `[SOURCE]`

**Live, on the phone treadmill console:** confirmed at Hop 1 — the only two occurrences of `belt.pausedSec`/`belt.droppedSec` in either `TreadmillView.swift` or `LiveRunTreadmillV5.swift` are the outbound payload-construction lines themselves; no `Text(...)` or equivalent SwiftUI rendering call references either property anywhere in either file.

**Post-run, server-rendered:** confirmed at Hop 6 — the sole UI-facing string this whole subsystem produces (`PostRunWire.capture`) is built from `driftSec` alone; `pausedSec`/`declinedSec` never enter its construction, at the type level, regardless of what's in storage.

**Verdict on the full chain:** the pipeline dead-ends **before** reaching any UI code at all — not at the UI layer, but three hops earlier, at the Hop 3 ingestion gate (primary loss point) and again at the Hop 6 type-level destructuring (secondary, redundant loss point for the rare row that gets past Hop 3). No `[RENDER]`/`[DEVICE]` observation was needed or attempted for this specific question, because the trace shows there is nothing to render — the value is provably absent from every object any renderer could read, at both the live and the post-run surface, for every historical occurrence. This is stated as a structural `[SOURCE]` fact about the code, not a claim that a screen was checked and found blank.

---

## Where exactly the value is dropped, and the runner-facing consequence

There are **two** drop points in series, and the empirical data show the first one alone already accounts for 100% of this account's real history:

**Primary, and the one actually firing:** `web-v2/app/api/watch/workouts/complete/route.ts`'s `clockAudit` closure (Hop 3a). `pausedSec` is used only as an input to a pass/fail arithmetic check and is discarded, unwritten, the moment the pause correctly explains the wall-clock gap — which is the *normal, correct* outcome of a real pause, not an edge case. `[PROD-QUERY]`, exhaustive over this account's full 68-row `watch_completion` history, joined against the resulting `runs` rows: **every one of the 8 submissions carrying a nonzero `pausedSec` (2 through 1619 seconds, 2026-08-26 through 2026-09-09, spanning both the Watch app's outdoor pause and the treadmill console) resulted in a matched `runs` row with `clockAudit` entirely absent.** Zero exceptions. This is not "would be dropped if David pauses tomorrow" — it has been the outcome on every real pause this account has ever recorded, at both pinned commits, and specifically including **today's own run** (`2026-09-09#0622`, `pausedSec:281`, the same run both Domain A and Domain B built their §6/case-14-phase analysis around) and the account's longest single pause on record (**1619 seconds — 27 minutes** — on 2026-08-30, on a 13.49-mile, 106-minute outdoor run).

**Secondary, redundant, and independently sufficient on its own:** `web-v2/lib/postrun/load.ts`'s `clockAudit` reconstruction (Hop 6) drops `pausedSec`/`declinedSec` by construction — a type-level omission, not a conditional — so even the rare row that *does* survive Hop 3 (the four rows in Hop 4's table, all of which happen to carry `pausedSec:0` because none of them were caused by a real pause) is guaranteed to lose the field a second time on the way into `PostRunInput`.

**Runner-facing consequence, precisely:** none of the three things one might expect — no wrong elapsed/moving-time computation, no wrong grading, and no misleading pause disclosure — because *nothing downstream ever looks at this figure at all* (Hop 7). The actual consequence is a narrower, quieter one: **there is no product surface, anywhere, at any layer, that has ever told RUNNER_DAVID how long he paused on a run where he genuinely paused** — not live on the watch, not live on the treadmill console, not on the post-run recap, not in the coach's grading of the session. The data exists, correctly measured, at the point of capture (Hop 1's `totalPausedSec`/`belt.pausedSec` are real, tested, gated numbers); it is spent correctly and silently at Hop 3 to keep the clock-drift alarm from firing on runs that don't deserve one; and it is never recorded as a fact in its own right anywhere a person or a grading routine could read it. This is not a *distortion* of any existing coaching decision (nothing currently reads the field, so nothing is currently *wrong* because of this) — it is an absence of a fact that both domain reports independently flagged as worth having (Domain B: "the pause/early-end is a second-order arithmetic inference, never a first-class recorded fact") and that this trace now shows has been silently discarded, correctly-measured and nonzero, on a two-week cadence, including as recently as this morning's run.

---

## What a later engineering pass should do (described, not implemented — out of scope for this pass)

1. **Correct the false premise in the three comments** (`experience.ts:467-468`, `experience.ts:1172-1173`, `load.ts:708-709` at Pin-2 / `:705-706` at Pin-1) to state the actual mechanism: three Swift senders exist and have sent real nonzero values since 2026-08-26; the reason `clockAudit.pausedSec` has still always been observed as `0` is that `route.ts`'s drift-tolerance gate (Hop 3a) only persists `clockAudit` on the failure branch, and a correctly-measured pause is by definition the success branch. Per Rule 20, either gate this claim or delete it — a comment that was already falsified before either pin was cut should not stand as settled doctrine a third time.
2. **Give `pausedSec` an unconditional persisted path, the way `droppedGapSec` already has one** (Hop 3b) — e.g. `runs.data.pausedSec` written whenever `body.pausedSec > 0`, independent of the drift-tolerance branch — so a real pause is a first-class recorded fact rather than a value only visible when the clock accounting fails.
3. **Widen the `PostRunCapture`/`clockAudit` type** (`experience.ts:473`) to actually carry `pausedSec`/`declinedSec` once step 2 lands, and decide — per Rule 10 — whether `readCapture`'s one rendered sentence should ever mention pause time, or whether that's a distinct sentence/surface entirely (per Rule 16, one quantity should resolve in one place; "the clock drifted" and "the runner paused" are different facts and probably deserve different sentences rather than one widened one).
4. **Add `clockAudit`, `pausedSec`, and `droppedGapSec` to `canonical.ts`'s `NEVER_COPY`** (or give `clockAudit` a purpose-built field-level reconciliation), closing the Hop 5 structural exposure before a future dual-submission scenario turns it into a real Rule-6 loss instead of a latent one.
5. **Decide, as a product/doctrine question and not an engineering default, whether pause time should ever reach grading** (Hop 7) — today it structurally cannot, for any run type, not just recoveries; WALKBACK-2 solved the adjacent "chosen early end" question for recovery phases specifically, but a mid-tempo or mid-long-run pause remains entirely unrepresentable to `verdict.ts` regardless of how steps 1-3 land.

None of the above was implemented, tested, or written to any file as part of this pass, consistent with the read-only mandate.