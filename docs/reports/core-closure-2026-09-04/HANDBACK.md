# Core-product closure — HANDBACK

Programme lead session, 2026-09-04. Branch `core/closure-2026-09-04`, worktree
`/private/tmp/core-closure-0904`, based on `origin/main` @ `72f2f84c`.

---

## Executive verdict

**The programme is not complete, and the most useful thing this session
produced is an accurate picture of why.**

Main was RED when this session opened — `test-full` had failed on three
consecutive commits, each of which merged and deployed anyway. It is green now.
More seriously, **three live audit tests had been failing against production all
day while every automated signal reported green**, because the 16
`*.audit.test.ts` files are `describe.skipIf(!DATABASE_URL_RO)` and neither CI
nor Railway carries that credential. One of the three is the Rule 16 enforcement
for every race number the runner sees. That is Rule 18's central case — a gate
that cannot fail anywhere it runs — and it is the single most important finding
here.

Nine defects closed, all with falsified gates. Two stages (4, 5) completed as
audits with explicit verdicts. Two stages (9, 10) remain blocked on the Today
agent and on the work above them.

**Three of the brief's own premises were contradicted by production**, and are
corrected below. Prior completion language was not carried forward.

---

## State, stated separately

| | |
|---|---|
| **Implemented** | FORMATLINT-1, SEALDATE-1, EXECID-SCAN-1, RACENUM-1, SNAPSHOTQUANTITY-1, LIVEDATES-1, LEXICONWORD-1, LABELTRUTH-3, and a ratchet + closed known-defect for TUNEUPTYPE-1 |
| **Merged to main** | first seven, as `5104342f` and `28c882ec` |
| **Deployed** | `5104342f` and `28c882ec` both reached Railway SUCCESS |
| **Shipped to TestFlight** | none of this session's work — it is all server/engine and gates |
| **Physically verified** | nothing. See PHYSICAL-TESTS.md |
| **Live adaptation promoted** | **NO — explicit HOLD.** See ADAPTATION-VERDICT.md |

---

## Exact commits

- **Base:** `origin/main` @ `72f2f84c`
- **Branch:** `core/closure-2026-09-04`
- **Merged:** `5104342f` (FORMATLINT-1, SEALDATE-1, EXECID-SCAN-1),
  `28c882ec` (RACENUM-1, SNAPSHOTQUANTITY-1, LIVEDATES-1, LEXICONWORD-1)
- **Uncommitted at time of writing:** LABELTRUTH-3, the TUNEUPTYPE-1 ratchet,
  the retired `WATCH_FALLBACK_HAS_NO_SESSION_IN_IT` known-defect entry, and the
  five report documents

### Railway

| Commit | Deployment | Status |
|---|---|---|
| `72f2f84c` (session open) | `8ca0e995-1be0-48ef-8941-3ab13f33db64` | SUCCESS |
| `5104342f` | superseded by later deploys | reached SUCCESS |
| `28c882ec` | building at time of writing | — |

Checked with `railway deployment list --json` against `meta.commitHash` — the
deployment STATUS, never the push result (Rule 19).

### TestFlight

Newest build **275** (`89f602df`), shipped by another session while this one
was running. Verified with `git merge-base --is-ancestor` per ship commit — not
read off a commit message, given TFCLAIM-1 below.

Build 275 contains: `cd754fd3` (TREADMILL-SKIP-1, all treadmill runtime),
`645d540e` + `ea901bea` (WORKOUTPHASES-1/2, the treadmill's own
warmup/hills/cooldown post-run breakdown), and **both of this session's merged
commits** `5104342f` and `28c882ec`.

Not in 275: `0e80296d` (HRPHASE-1/HRGRADE-1) and `0dba47be`, both landed after
it.

---

## Test and gate counts

| Suite | Result | Note |
|---|---|---|
| web, full, **with production credentials** | **510 files / 10,066 tests, 0 failures** | stronger than CI can run |
| web `lib/plan` after TUNEUPTYPE-1 | 171 files / 2,727 tests, 0 failures | includes `_sweep_allusers`, `_maint_invariants`, `_dosing_sweep_gate` |
| prebuild chain | all 22 gates pass | |
| native iPhone (signed) | **346 tests, 0 failures** | |
| Watch (Swift Testing) | **223 tests / 16 suites, 0 failures** | |
| adaptation replay | 3 files / 30 tests, 0 failures | |

**A trap worth recording:** built UNSIGNED, four `SignInFlowTests` fail on
Keychain unavailability. They are an artefact of the build, not a defect. I
nearly reported a false red; re-running signed cleared all four.

---

## Corrections to prior claims

**1 · "Fix the known whole-mile label-deduplication mismatch."** The defect is
**latent, not live.** Probed 6 / 6.5 / 15 / 15.5 / 20 / 3 mi through the real
card builder — every case dedups correctly — and a read-only query over all
seven active plans found zero segment labels beginning with a distance. It works
only because two modules independently picked the same spelling. Fixed anyway,
because the coincidence is load-bearing and unguarded.

**2 · "Investigate the September 13 plan race that reportedly lacks a canonical
`races` row."** **The row exists.** `santa-monica-10k-2026-09-13`, priority B,
7:00 AM start, full logistics, GPX-derived course profile. It correctly carries
no goal time — `race_execution` reads `feasibility: "no_goal"` and races it off
current evidence (43:00 target, 42:07–43:51 likely). Nothing to insert.

**3 · "Revisit the existing adaptation regression test that treats a partial run
as better than a plain miss."** **Already done**, on 2026-09-04 under
RULE8CLOSE-1, and the corrected invariant is exactly the one the brief asks for:
a miss and a telemetry-compromised session are BOTH excluded, so replacing one
with the other leaves the score exactly unchanged rather than merely "no worse".

**4 · TFCLAIM-1 — TestFlight 272's recorded contents are wrong.** The ship
script reserves the build number first and commits the counter after upload, so
a ship commit always post-dates its upload — by 26–48 min for builds 269/270/271.
Build 272 uploaded 2026-09-03 23:57:40; HEROPANEL-1 (`57ec2840`), which its
commit message credits, was authored **5h38m later**. Either 272 was built from
uncommitted working-tree code or the message is false. Today-lane — flagged, not
touched.

---

## Canonical ownership map (as verified, not as documented)

| Question | Owner | Verified |
|---|---|---|
| did this run execute this prescription | `lib/execution/day-resolver.ts` | yes — and now scanner-enforced (EXECID-SCAN-1) |
| may this prescription be sealed | `lib/plan/seal.ts` → the resolver | yes; a 4th bypass found and closed |
| what state was this execution in | `lib/execution/interpret.ts` — 7 states + `telemetryCompromised` | yes |
| does this evidence move a belief | `lib/adaptation/adaptation-model.ts` | yes; MISSED and telemetry-compromised both excluded |
| may training change | canonical Adaptation Engine, **shadow only** | yes, gated by `_promotion_contract.test.ts` |
| what is the projected finish | `lib/training/race-projection.ts` | yes — 8 paths agree |
| how is a distance written down | `lib/format/run.ts` | mostly; `expand-spec.ts` deliberately exempt |
| the coaching sentence | `lib/faff/why-voice.ts` | yes |
| Today / week strip / PlanSnapshot | **the other agent** | not touched |

---

## Findings raised, not owned or not actioned

**VACUOUS-AUDITS · the highest-value open item.** The 16 `*.audit.test.ts`
files skip silently without `DATABASE_URL_RO`. Three were red against production
today while everything reported green. **Recommendation:** give the `test-full`
workflow the read-only credential, or add a separate scheduled workflow that
runs only the audit files with it. Until then, every claim those files make is
unverified in CI, and the repo's Rule 16 enforcement for race numbers is
effectively off.

**NOCI-NATIVE · no workflow runs the native or Watch suites.** Both green today,
measured by hand. Nothing would have said otherwise.

**TFCLAIM-1** — above.

**S4-1 · the long run stops developing six weeks out.** Longest run 21.5 mi on
2026-10-25, 42 days before CIM; only two runs ≥ 20 mi in the whole block, both
in October. Largely a consequence of four races inside a fifteen-week build.
**A coaching decision, raised not taken** — see BASELINE-PLAN-AUDIT.md.

**S4-2 · TUNEUPTYPE-1, attempted and reverted — and the revert is the finding.**
`race_week_tuneup` is authored on 2026-11-17, nineteen days before CIM, and that
name grants four exemptions (adapter-protected, pace-recompute-exempt, priced
off the STATED GOAL rather than the fitness anchor, not effort-cued) which are
correct only in race week. Substituting the type does not work: `intervals`
produced "a VO2max session was cut to 2 rep(s)" on David's own block, and
`tempo` produced a 1.8 mi block under a "3mi continuous tempo" label plus 8,893
sessions past an 8,114 ratchet. A taper week's quality budget is small by
construction and `race_week_tuneup` is the only shape that scales into it. **The
fix belongs on the consumer side** — four sites should ask whether the row is in
a race week instead of inferring it from a type name. Named, scoped, and held
meanwhile by a ratchet at 3,475 that may shrink and never grow. It also surfaced a
FIFTH consequence: `lib/onboarding/_onboarding_e2e.test.ts` reports 127
instances of the watch having no session for such a row ("No workout
scheduled"), and every reachable one is the type on a non-race week. That entry
was briefly deleted while the substitution was in flight and has been restored,
with the new measurement, now that the substitution is reverted — a known-open
defect must not be left marked closed because an experiment made it
temporarily unreachable.

**S4-3 · the B-priority 10K is tapered harder than the B-priority half.** −47%
versus no taper at all. Driven by whole-week rounding in
`POST_RACE_RECOVERY_WEEKS` / `BLOCK_SHAPE.taperWeeks`, which are doctrine-bound
engine constants. For their owner.

**MOVE-A-RUN · not built.** The owner moved his own week by hand in the backend
on 2026-09-03, around travel, because the in-app feature does not exist.
Explicit runner-requested rescheduling is in-scope doctrine; the surface is not
built. A product gap, not a defect — and the direct cause of LIVEDATES-1.

---

## Remaining work

| Stage | Item | Blocker |
|---|---|---|
| 6 | post-run reconciliation | **collision** — the other agent is actively in `TodayAfterV5`/`v5-today.ts`/the today route |
| 7 | remaining race-number inventory | none |
| 8 | remaining voice closure outside Today | none |
| 9 | Today integration | **their handback** |
| 10 | integrated ship | after the above |

**On Stage 6:** the treadmill runtime is verified as far as code can verify it
(42 tests, all green; the state machine is canonical and covered for
auto-advance, skip, override propagation, pause-at-boundary, background-gap
catch-up and resume). Its own test file names the three things it cannot cover,
and those are in PHYSICAL-TESTS.md. The post-run half was NOT reconciled,
deliberately: three commits in the last hour from another session are in exactly
those files, and editing into that is how two owners produce one
irreconcilable surface.

---

## Documents

- `STATUS.md` — Stage 0, measured reality with provenance for every number
- `TASKS.md` — the task ledger
- `BASELINE-PLAN-AUDIT.md` — Stage 4, week by week, read as a coach
- `ADAPTATION-VERDICT.md` — Stage 5, explicit HOLD with the reason
- `PHYSICAL-TESTS.md` — what only David can confirm, and on which build

**Nothing in this session wrote to production.** Every query ran over
`DATABASE_URL_RO`; the one write attempt (the shadow-log path, under test) was
refused by the write barrier and reported as skipped with its reason.
