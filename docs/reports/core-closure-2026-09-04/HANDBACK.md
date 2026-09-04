# Core-product closure — HANDBACK

Programme lead session, 2026-09-04. Branch `core/closure-2026-09-04`, based on
`origin/main` @ `72f2f84c`.

**Scope, as corrected mid-session:** the products are the **native iPhone app**,
the **Apple Watch app**, and the shared backend / database / APIs / coaching,
plan and adaptation engines / synchronisation / deployment those two require.
Browser-facing pages are out of scope and are excluded from the verdict below.
Code living under `web-v2` is not web-only — it is overwhelmingly the native
apps' server.

**Scope audit result: nothing in this session was web-only. Nothing was removed
or deferred.** The one item that looked web-shaped is not — `/api/plan/undo`
(SEALDATE-1) is called by the iPhone at `API+Toolkit.swift:422`.

---

## Executive verdict

**Not complete, and the most valuable thing this session produced is an accurate
picture of why.**

Main was RED when this session opened — `test-full` had failed on three
consecutive commits, each of which merged and deployed anyway. It is green now.

More seriously: **three live audit tests had been failing against production all
day while every automated signal reported green**, because the 16
`*.audit.test.ts` files skip silently without `DATABASE_URL_RO` and neither CI
nor Railway carries it. One of them is the Rule 16 enforcement for every race
number the **iPhone** renders. That is Rule 18's central case — a gate that
cannot fail anywhere it runs — and it is the single most important finding here.

Eleven items closed, each with a falsified gate. Two stages completed as audits
with explicit verdicts. **Everything that can be verified without a device has
been verified. Nothing has been verified on a device.**

Three of the brief's premises were contradicted by production and are corrected
below.

---

## State, stated separately

| | |
|---|---|
| **Implemented** | FORMATLINT-1, SEALDATE-1, EXECID-SCAN-1, RACENUM-1, SNAPSHOTQUANTITY-1, LIVEDATES-1, LEXICONWORD-1, LABELTRUTH-3, TUNEUPTYPE-1 ratchet, WATCHFALLBACK re-measurement, WATCHGATE-1 |
| **Merged to main** | all of it — `5104342f`, `28c882ec`, `94a207bb` |
| **Deployed to Railway** | all three, each confirmed by deployment STATUS |
| **Shipped to TestFlight** | `5104342f` and `28c882ec` are in **build 275**. `94a207bb` is not — and does not need to be (see below) |
| **Physically verified — iPhone** | **NOTHING.** Zero items. |
| **Physically verified — Watch** | **NOTHING.** Zero items. |
| **Live adaptation promoted** | **NO — explicit HOLD**, see ADAPTATION-VERDICT.md |

---

## Source commit → TestFlight build mapping

Established with `git merge-base --is-ancestor` against each ship commit — never
read off a commit message, for the reason TFCLAIM-1 gives.

| Build | Ship commit | Contains |
|---|---|---|
| 269–274 | `cae09863` … `5f5c5f83` | all treadmill runtime through `cd754fd3` |
| **275** | **`89f602df`** | treadmill runtime, WORKOUTPHASES-1 (`645d540e`), WORKOUTPHASES-2 (`ea901bea`), **`5104342f`**, **`28c882ec`** |

**The Watch ships inside the iPhone build.** `project.yml` embeds
`FaffWatch Watch App` in the `Faff` target (`embed: true, codeSign: true`), so
there is no separate Watch artifact and the build number is the same for both.
Verified in the built product: `Faff.app/Watch/FaffWatch Watch App.app`.

### No new build is needed, and that is a measured claim

Three commits sit after build 275's ship commit — `0e80296d` (HRPHASE-1/
HRGRADE-1, another session), `0dba47be` (docs), and this session's `94a207bb`.

```
git diff --name-only 89f602df origin/main -- native-v2/   →   (empty)
```

**No native file has changed since build 275.** A build 276 would produce a
byte-identical app. The three commits are server-side or documentation, and the
server changes are already live on Railway, which both the phone and the watch
consume at runtime. Shipping for the sake of a number would burn a build and
prove nothing.

**Build 275 is therefore the integrated validation build.**

---

## Physical-verification status — explicit, per product

### iPhone · NOT VERIFIED

No item in `PHYSICAL-TESTS.md` has been confirmed on a device. Everything I can
assert is code-level. Sections A (treadmill runtime, 8 min), B (pre-run/Run, 3
min) and C (post-run, 3 min) are all outstanding, against **build 275**.

### Watch · NOT VERIFIED on a device, but the gate is now fully executed

`scripts/check-watch.sh` had been reporting **PARTIAL** — guard 3, board
geometry, was silently skipped because no watch simulator was booted, and the
script is explicit that "this line is deliberately not the word OK". I booted
Apple Watch Series 11 (46mm) and re-ran it:

```
WATCH-GATE: OK · all guards executed — 223 test cases (223 @Test declarations);
22 boards inside Apple's content box; run endable (2017 router lines read)
```

That is a real improvement in what is known about the Watch, and it is still not
a device. Outstanding on the wrist: that the workout the watch resolves is the
same one the phone and treadmill resolve, that a normal End clears the recording
lock, and that a mirrored watch+phone treadmill pair reads as one execution.

---

## Exact commits and deployments

- **Base:** `origin/main` @ `72f2f84c`
- **Final commit:** `94a207bb`

| Commit | Railway deployment | Status |
|---|---|---|
| `5104342f` | (superseded) | reached SUCCESS |
| `28c882ec` | (superseded) | reached SUCCESS |
| **`94a207bb`** | **`962c0258-3d3d-4510-a04d-169d30e9d4c0`** | **SUCCESS** |

---

## Test and gate counts

| Suite | Surface | Result |
|---|---|---|
| **native iPhone (signed)** | iPhone | **346 tests, 0 failures** |
| **Watch (Swift Testing)** | Watch | **223 tests / 16 suites, 0 failures** |
| **`check-watch.sh`** | Watch | **OK — all guards executed** (was PARTIAL) |
| web/server suite, with production credentials | shared | **510 files / 10,067 tests, 0 failures** |
| prebuild chain | shared | **22/22 gates** |
| `lib/plan` corpus | shared | 171 files / 2,727 tests, 0 failures |
| adaptation replay | shared | 3 files / 30 tests, 0 failures |

**A trap worth recording:** built UNSIGNED, four `SignInFlowTests` fail on
Keychain unavailability. They are an artefact of the build, not a defect. I
nearly reported a false red; re-running signed cleared all four.

---

## Corrections to prior claims

**1 · "Fix the known whole-mile label-deduplication mismatch."** The defect is
**latent, not live.** Probed 6 / 6.5 / 15 / 15.5 / 20 / 3 mi through the real
card builder — every case dedups correctly — and a read-only query over all
seven active plans found zero segment labels beginning with a distance. It works
only because two modules independently picked the same spelling. Fixed anyway;
the coincidence is load-bearing and unguarded, and it feeds both the phone card
and the watch.

**2 · "Investigate the September 13 plan race that reportedly lacks a canonical
`races` row."** **The row exists.** `santa-monica-10k-2026-09-13`, priority B,
7:00 AM start, GPX-derived course profile, full logistics. It correctly carries
no goal time. Nothing to insert, and nothing was invented.

**3 · "Revisit the adaptation regression test that treats a partial run as
better than a plain miss."** **Already done** on 2026-09-04 under RULE8CLOSE-1,
to exactly the invariant asked for: a miss and a telemetry-compromised session
are BOTH excluded, so swapping one for the other leaves the score unchanged
rather than merely "no worse".

**4 · TFCLAIM-1 — TestFlight 272's recorded contents are wrong.** The ship
script reserves the build number first and commits the counter after upload, so
a ship commit always post-dates its upload — by 26–48 min for 269/270/271. Build
272 uploaded 2026-09-03 23:57:40; HEROPANEL-1 (`57ec2840`), which its message
credits, was authored **5h38m later**. Either 272 was built from uncommitted
working-tree code or the message is false. Today-lane; flagged, not touched. It
is why every mapping above uses ancestry rather than prose.

---

## Canonical ownership map (verified, not documented)

| Question | Owner | Consumed by | Verified |
|---|---|---|---|
| did this run execute this prescription | `lib/execution/day-resolver.ts` | iPhone + Watch | yes, now scanner-enforced |
| may this prescription be sealed | `lib/plan/seal.ts` → the resolver | iPhone | yes; a 4th bypass found and closed |
| what state was this execution in | `lib/execution/interpret.ts` | iPhone | yes — 7 states + `telemetryCompromised` |
| does this evidence move a belief | `lib/adaptation/adaptation-model.ts` | shared | yes; MISSED and compromised both excluded |
| may training change | canonical Adaptation Engine, **shadow only** | shared | yes, gated by `_promotion_contract.test.ts` |
| what is the projected finish | `lib/training/race-projection.ts` | iPhone + Watch | yes — 8 paths agree |
| how is a distance written down | `lib/format/run.ts` | iPhone + Watch | mostly; `expand-spec.ts` deliberately exempt |
| the coaching sentence | `lib/faff/why-voice.ts` | iPhone | yes |
| the workout the wrist runs | `lib/watch/build-workout.ts` | Watch | yes — 97 wire keys check out |
| Today / week strip / PlanSnapshot | **the other agent** | iPhone | not touched |

---

## Open items, each with one owner

| Item | Surface | Owner |
|---|---|---|
| Physical device pass, PHYSICAL-TESTS.md on build 275 | iPhone + Watch | **David** |
| S4-1 · the long run stops developing six weeks out | shared | **David** (a coaching decision) |
| TUNEUPTYPE-1 consumer-side fix, 5 sites | shared | next session, scoped |
| Threshold-gate readability before adaptation promotion | shared | next session |
| VACUOUS-AUDITS · credential for the audit suite | shared | next session |
| NOCI-NATIVE · no CI runs iPhone or Watch | iPhone + Watch | next session |
| Post-run reconciliation | iPhone | **blocked** — live collision |
| Today integration | iPhone | **blocked** — their handback |
| TFCLAIM-1 | iPhone | Today agent |
| MOVE-A-RUN not built | iPhone | parked, product decision |

---

## Documents

- `STATUS.md` — Stage 0, measured reality with provenance for every number
- `TASKS.md` — the ledger, every row labelled by surface
- `BASELINE-PLAN-AUDIT.md` — the live CIM block, week by week, read as a coach
- `ADAPTATION-VERDICT.md` — explicit HOLD, with the reason
- `RACE-NUMBER-INVENTORY.md` — nine quantities, one name each
- `PHYSICAL-TESTS.md` — what only David can confirm, on build 275

**Nothing wrote to production.** Every query ran over `DATABASE_URL_RO`; the one
write attempt (the shadow-log path, under test) was refused by the write barrier
and reported as skipped with its reason. No live plan was rebuilt. No race data
was invented. No historical activity was corrected.
