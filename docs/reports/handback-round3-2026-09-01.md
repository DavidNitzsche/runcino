# Handback round 3 — moving the canonical brain into daily use safely

Response to the "Execution brief — move the canonical brain into daily use
safely." All 7 dispatched work-streams landed. Structured exactly against
the brief's 14-point required handback.

---

## 1 · GitHub Actions recovery evidence

**Green, watched to completion, not inferred.** Final state: `origin/main`
at `6a751e93`, `build-check` run [33454240414](https://github.com/DavidNitzsche/runcino/actions/runs/33454240414),
`conclusion: success`.

Two separate red windows, both real:

- **Round 1** (the two originally-named causes — a Rule-11 zero-erasure site
  in `progression-spec.ts`, an orphaned `coaching-thesis.ts` module): already
  fixed by other concurrent sessions before the CI-recovery pass started.
  Confirmed green at `d39871b9`, run [33450609173](https://github.com/DavidNitzsche/runcino/actions/runs/33450609173).
- **Round 2** (two new breaks that landed in the ~40 minutes after that
  confirmation, a direct consequence of how many agents were pushing to
  `main` simultaneously tonight): a hand-drawn `~` character in two
  `RangeScale(.reference)` HR captions tripping the modeled-mark guard
  (`d390ae98`), and an unregistered orphan module,
  `_season_sweep_absorption_duration.script.ts` (from tonight's dual-logging
  work), tripping the generated-content gate (`364af4b9`).

Full retrospective with exact error text and commit lists:
`docs/reports/ci-recovery-2026-09-01.md`.

---

## 2 · Migration 160 application and schema verification

**Applied to production.** `web-v2/db/migrations/160_adaptation_shadow_log.sql`
was reviewed against all seven required criteria before applying:

| Criterion | Result |
|---|---|
| No changes to live plan behavior | Pass, as drafted |
| No triggers/consumers that can mutate plans | Pass, as drafted |
| Bounded growth + retention policy | **Missing as drafted — added before applying**: `lib/adaptation/shadow-log-retention.ts`, 180-day age bound + 400-row-per-user cap, a real pruning cron, `DELETE`-only |
| Idempotent deployment | Verified — re-run produces `NOTICE...skipping` for every statement |
| Access controls | Verified empirically — read-only role can `SELECT`, gets `permission denied` on `INSERT` |
| Safe rollback/disablement | Pass, as drafted (new table, no existing-table alteration) |
| No interference with proposal/measurement tables | Pass — confirmed by the same review that rejected those three tables as unsafe additive homes earlier tonight |

Full account: `docs/reports/shadow-log-production-2026-09-01.md`.

---

## 3 · Production shadow-log examples with zero-mutation proof

**Live in production.** A real cycle was triggered against the write role; a
real row landed and was read back in full over the read-only role. The
record now carries every field the audit-required shape names: user/plan
identifiers, evaluation date + engine/model version, plan-authored timestamp
+ last canonical reanchor timestamp, contamination/convergence status,
phase and workout family, current/proposed target, capacity belief +
evidence mode + confidence + evidence dates, representative/excluded
observations, pace/HR compatibility result, decision/refusal reasons,
contradictions, and a per-cycle zero-mutation checksum carried in the row
itself.

Zero-mutation re-confirmed after the full schema expansion (four real-account
audit tests, all green) — not assumed to have survived the change.

---

## 4 · Authoring/reanchor convergence guard behavior

**Real, built, and correctly classifies the owner's account.**
`web-v2/lib/adaptation/authoring-convergence.ts` — four states exactly as
specified (canonically authored / legacy-authored-then-canonically-
reanchored / too young to have been reanchored / reanchor failed or
unknown), built on `reanchorActivePlan`'s own stamps plus the existing
cron-ledger heartbeat. The owner's real plan classifies as
`REANCHORED_CANONICALLY` — meaning tonight's PACE shadow evidence is not
contaminated by the authoring/recompute gap. A young or unreanchored plan
would now be marked contaminated/unready and excluded from any future
authority-readiness aggregate, rather than silently trusted.

---

## 5 · Canonical initial-authoring migration status and block diffs

**Begun, deliberately not merged.** Left on its own reviewable branch —
`canonical-authoring-migration-20260901` — per the agent's own explicit
risk judgment, not merged into `main`. PR ready:
https://github.com/DavidNitzsche/runcino/pull/new/canonical-authoring-migration-20260901

- **Inventory:** 22 real legacy-VDOT call expressions across 9 functions
  (re-counted fresh, differs from the brief's 32 — a counting-method
  difference, not drift; same underlying finding). Classified into
  legitimate-to-keep (goal-sanity validation — capacity-resolver is
  compile-time sealed against goal data), direct duplicate authority, and
  Race Prediction's own VDOT consumption (needs input-source migration, not
  a function swap — a naive swap would reintroduce the already-fixed COLD-1
  bug).
- **Shadow mechanism:** a brand-new, additive file
  (`authoring-shadow-compare.ts`) calling the real legacy composer and the
  real canonical resolver side by side. Zero lines of `generate.ts`/
  `spec-builder.ts` changed; nothing persisted differently for any real user.
- **Real diffs, owner's account:** the two paths agree closely — largest
  divergence 23 s/mi, zero structural diffs, across a real 98-day CIM
  marathon block.
- **The real finding, and the actual blocker before this can ever switch
  over:** cold-start/zero-run accounts diverge by ~35% (7:4x/mi legacy vs.
  10:42/mi canonical). Root cause: the canonical resolver's population-prior
  rung never wires in the self-reported onboarding mileage the legacy
  cascade explicitly relies on for brand-new runners. Switching authoring
  over today, unfixed, would give a new signup a dramatically-too-slow
  prescription.
- 11 new pure tests (continuity, monotonicity, goal-isolation, extreme
  inputs) + 2 real-account audit tests, one falsified on purpose per Rule 18
  to prove the gate can fail. Full gate suite green.

Full detail: `docs/reports/canonical-authoring-migration-2026-09-01.md` (on
the migration branch).

---

## 6 · Pace replay corpus results

**Landed** (`8081361c`, deployed, Railway `SUCCESS`). 13 named fixtures, 18
tests, all run through the real unmodified `composeAdaptation` and
`checkPaceHrCompatibility` — no mocks. Covers: improving capacity with
corroboration, apparent-improvement-during-taper, staleness-boundary
crossing, insufficient evidence, conflicting pace/HR evidence,
heat-explained HR, stale HR guidance, a phase already ahead of capacity, a
deliberately-slower taper phase, a young unreanchored plan, a stable HOLD,
downward/restructure pressure, and an extreme goal-swap proving zero effect
on capacity. Two fixtures include adjacent-synthetic-date boundary walks
(the staleness half-life crossing day 28; a taper-start boundary) — labeled
explicitly as boundary-behavior testing, not a substitute for real
elapsed-time stability.

Independently confirmed the convergence guard didn't exist yet at the time
it was built (fixture 10 documents the exact contaminated shape it expected)
— consistent with §4 above, which has since closed that gap.

---

## 7 · Multi-date shadow proposal stability

**Partially met, honestly scoped.** True multi-day production stability
still needs real elapsed days the cron hasn't run for yet — not fabricated.
What exists: determinism (same account, same day, 3 runs, byte-identical
output) from tonight's earlier PACE shadow-compare work, plus the replay
corpus's adjacent-synthetic-date boundary walks (§6). Production shadow
observation is now live (§3) and will accumulate real multi-day evidence
going forward — that evidence does not exist yet as of this handback.

---

## 8 · Actual-load versus representative-execution comparison

**Landed** (`fd13f09b`). Extended to real ongoing logging, not a one-time
report — run across **90 real dates spanning the entire 2026 season**, not
just the original 7, plus synthetic fixtures, all persisted to a git-tracked
log.

- Disagreement is rare and concentrated in one real 8-day episode (the AFC
  half's post-race recovery window), not scattered.
- On every real disagreement found, `representative_execution` is **more
  conservative**, never more permissive.
- A **synthetic edge case exists where filtering could be more permissive**
  (total-evidence-masking) — never fired on real history, flagged as a real
  risk worth fixing before any promotion, not swept aside.
- Confirmed: DURATION is the affected lever, no VOLUME exception found —
  consistent with the earlier finding that VOLUME's hold is a wholly
  separate, already-filtered mechanism.
- Honest, two-sided read on the one real episode: the *decision* (hold
  after the race) looks defensible; the *stated reason* (citing 6-7-week-old
  missed sessions) doesn't actually credit what was true that week — argued
  both ways, not asserted as an improvement.

`representative_execution` remains **not promoted** into the live
progression path, as instructed.

---

## 9 · Pace/HR compatibility outcomes

**Wired into the real production pipeline** (part of `0fce624f`, §2/§3
above). Every PACE shadow record now carries a real compatibility verdict —
`COMPATIBLE` retains independent HR guidance unchanged;
`ENVIRONMENT_EXPLAINED` doesn't rewrite the capacity belief;
`STALE_CEILING_ADVISORY` withholds automatic coupling and flags HR evidence
for review; `MATERIAL_INCOMPATIBILITY` genuinely refuses the pace proposal
via a new `REFUSED_HR_INCOMPATIBLE` decision path — not a silent
pass-through. HR evidence itself was upgraded during this wiring: sourced
from the Evidence Engine's real work-segment classification, replacing the
earlier pace-based proxy.

---

## 10 · Phone/Watch/spoken/grading HR-semantic consistency

**Landed** (`7800d72b`), with a real live-surface bug found and fixed.

Four structurally distinct HR quantities were named explicitly for the
first time: an informational expected-response zone, the real aerobic
ceiling (easy/long/shakeout days), the pass/bail contingency pair, and the
quality-phase expected reference. The real bug: on the phone's **live-run
screen**, the quality-phase reference (mechanism 4) and the real aerobic
ceiling (mechanism 2) were collapsed into one function — so a threshold rep
sitting at 174 bpm against LTHR 168 (normal, expected behavior for
threshold work) triggered the exact same amber alarm and "above the
ceiling" VoiceOver announcement an easy-day runner gets for genuinely
blowing their aerobic cap. Fixed with a new, non-alarming `.reference` gauge
mode — same value, no shaded zone, no amber marker, spoken as "informational
only, not a target." The real aerobic ceiling gauge is completely unchanged.

**Verified for real**, avoiding the exact rendering trap an earlier agent
hit tonight: built via the supported `xcodebuild`-via-scheme path (not an ad
hoc `simctl install`), launched through the app's own QA gallery entry
point, and **screenshotted the fix rendered side by side** with the
unchanged real ceiling gauge — same underlying value (174), visibly
different treatment. **Disclosed, not glossed over:** the specific
live-run-screen composition (as opposed to the Gallery's identical
component instance) wasn't independently screenshotted — simulator touch
navigation proved unreliable in the time available. The fix itself is
confirmed correct via the identical rendered component; only that one
screen's exact layout is unconfirmed.

One thing flagged, not fixed: mechanisms 1 and 4 are two independent
formulas answering the same question (what should HR look like on quality
work) that happen to roughly agree today — unifying them touches a larger,
riskier live-wire surface and was correctly left out of this pass's scope.

---

## 11 · Wrong-plan-version downstream audit

**Landed** (`cc1f83d5`). Rendered real before/after execution reads, not
assumptions, for every named consumer:

- Three of four named consumers (`fitness-evidence.ts`, `threshold-pattern.ts`,
  `race-replacement.ts`) never touched the corrupted dates at all —
  confirmed by both window arithmetic and direct DB query.
- The 42-day adaptation reader DID change: the owner's 07-23 session flipped
  a real progression-earning flag (over-credited before), and 07-30 lost a
  false "missed quality session" entry. But **zero persisted adaptation
  mutations exist historically** for the exposure window, so nothing needs
  backfilling — every future read is already correct.
- The second account's misattributed week had zero runs in it — byte-
  identical output either way, confirmed by direct computation.
- Found one extra contaminated consumer beyond the four named
  (`capacity-resolver.ts`'s threshold reexamination — 07-23 misclassified),
  but the owner's VDOT snapshot stayed flat through the exposure window, so
  no measured consequence.

---

## 12 · Current live-plan row audit and safe corrections made

**Landed** (part of `cc1f83d5`). **No corrections were needed or made** — a
concurrent session had already fully and correctly recomputed the owner's
active plan (`pln_9a57561debb776e5`) roughly 2 hours before this audit ran.
All 77 unsealed rows verified against the full checklist: canonical
anchors present, no legacy midpoint easy pace, no recovery-jog rows, HR/
grading bands consistent, sealed/historical rows correctly immutable. Zero
database writes made by this pass — confirmed rather than duplicated.

---

## 13 · Exact commits, checks, pushes, deployments, unverified claims

All on `origin/main` unless noted as the separate migration branch:

| Stream | Key commits | Deploy/CI |
|---|---|---|
| CI recovery | `d390ae98`, `364af4b9` | `6a751e93` green, watched to completion |
| Migration 160 + shadow pipeline | `0fce624f` | Railway SUCCESS, live health check confirmed |
| Canonical authoring (unmerged) | branch `canonical-authoring-migration-20260901` | full local gate suite green; not deployed, intentionally |
| Pace replay corpus | `8081361c` | Railway SUCCESS (`4a4aa03c...`) |
| 42-day dual logging | `7445f117`, `24bf6310`, `fd13f09b` | GH Actions confirmed green on the shared `main` tip |
| HR semantics | `7800d72b` | build succeeded (Xcode), web-side `tsc`/tests clean |
| Wrong-plan audit + live check | `cc1f83d5` | no code deploy needed (zero writes) |

**Explicitly disclosed as not independently verified:**
- The `LiveRunOutdoorV5` live-run screen's exact layout (§10) — the
  underlying fix is proven via an identical rendered component, the specific
  screen composition is not.
- Whether `representative_execution`'s synthetic more-permissive edge case
  (§8) can ever actually occur on real data beyond the one constructed
  case — flagged as an open risk, not resolved.
- The canonical-authoring migration branch's diffs against the archetype
  corpus were limited by the corpus being structurally unreachable for
  canonical resolvers (no backing DB user) — real-account coverage is solid,
  synthetic-archetype coverage is not.

---

## 14 · Remaining blockers to Pace live authority

Unchanged in kind from round 2, updated with tonight's real progress:

| Requirement | Status |
|---|---|
| Phase-aware mutation targets | **Done** |
| Pace/HR compatibility validator, wired live | **Done** (§9) |
| Convergence guard excluding contaminated evidence | **Done** (§4) |
| Replay across multiple runner archetypes | **Still not met** — one real account has history; the canonical-authoring work independently confirms the archetype corpus can't be reached for this class of check either |
| Multi-day proposal stability | **Still partial** — determinism proven, real elapsed-day evidence now accumulating in production (§3, §7) but doesn't exist yet |
| Rollback/audit trail | **Done and operative in production** (§2, §3) |
| Authoring/recomputation convergence, explicit decision | **Guard built (§4); the underlying migration itself is begun, not complete** — and now has a concrete, real blocker of its own (the cold-start divergence, §5) that must close before authoring can ever switch over |

One new blocker worth naming plainly, surfaced only tonight: even once
PACE shadow-compare has run long enough to justify live authority, the
**separate** canonical-authoring migration has its own real gate — the
cold-start onboarding-mileage gap — that has nothing to do with PACE
adaptation directly but does gate whether "authoring and recomputation use
the same brain" can ever be answered yes.
