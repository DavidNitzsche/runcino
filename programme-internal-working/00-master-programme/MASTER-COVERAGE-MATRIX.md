# Master Coverage Matrix — CURRENT STATE ONLY

**Rewritten 2026-09-13 per explicit instruction: this is an operational dashboard, not an
archaeological record.** Every area below shows CURRENT truth only — the investigation history,
review rounds, disputes-and-adjudications, and superseded claims that produced these current
states live in `02-master-status-ledger.md` (the running ledger) and the individual reports it
cites. If this document and the ledger ever appear to disagree, the ledger is more granular and
more recently touched per-item; treat this document as the summary and the ledger as the source.

Evidence grammar: [SRC] read from source. [TEST] automated test run. [SIM] simulator render
against real/mirrored data. [DEVICE] real physical-device evidence. [PROD] live production
query. [REVIEW] independently verified against an exact SHA. Status grammar: NOT STARTED →
INVESTIGATING → IMPLEMENTING → REVIEWING → INTEGRATED → DEVICE-VERIFIED → CLOSED, or BLOCKED.
**CLOSED is used only when the area's own stated acceptance criteria are fully met — a fix inside
an area does not close the area.**

---

## Summary table

| # | Area | Current status | Evidence | Owner/lane | Branch @ SHA | Blocks candidate? | Blocks TestFlight? | Blocks autonomous-loop verdict? |
|---|---|---|---|---|---|---|---|---|
| 1 | Today | INVESTIGATED (device evidence only, unreconciled) | [DEVICE] | none active | — | No | No | No |
| 2 | Pre-run | INVESTIGATED (device evidence only, unreconciled) | [DEVICE] | none active | — | No | No | No |
| 3 | Run execution | REVIEWED, MERGE-READY — U2 confirmed (2 rounds), U6 confirmed clean | [SRC][TEST][DEVICE][REVIEW] | Lane A (Wave 1); U2; U6 | `fix/lane-a-duration-regression@d03dbbc37` (Wave 1); `fix/santa-monica-run-control-dedup-v2@0fc76304e` (U2 r2, CONFIRMED); `u6-race-morning-coherence@6011e04c9` (CONFIRMED clean) | Pending push authorization decision | No | U2/U6 close the RUN-control + race-morning findings; one disclosed follow-up (server-side completion locking for a residual concurrent-completion race) |
| 4 | Post-run | REVIEWED, MERGE-READY — original defect CLOSED (Wave 1); U1 confirmed; U4 confirmed | [SRC][TEST][PROD][SIM][REVIEW] | Lane A (Wave 1); U1; U4; post-run audit lane (separate, confirmed absent from Wave 1) | `fix/lane-a-duration-regression@d03dbbc37` (Wave 1); `fix/splits-pick-canonical-race-week@f02f29d32` (U1, CONFIRMED); `u4-postrace-truth@028e29ed8` (CONFIRMED — all 7 fixes + goal-outcome resolver); `fix/postrun-week-loader-swallow-round2@08ecbb7da`+`fix/weekstrip-actual-unknown@18865f66a` (separate candidate, CONFIRMED, merge-ready on its own) | Pending push authorization decision | No | U1+U4 close the wrong-split-array and false/contradictory-copy findings; one important open question (not a defect in U4 itself): Santa Monica's live goal-outcome classification sits on a genuine evidence cliff — see #10 |
| 5 | Activity/history | REVIEWED — shares U1's fix, confirmed | [PROD][SIM][REVIEW] | U1 | see #4 | see #4 | No | Possibly |
| 6 | Block/plan experience | REVIEWED (Phase 1+2, Wave 1) + Phase 3 hill-strength HR-cap corrected and confirmed (2 review rounds) | [REVIEW][TEST][PROD] | Marathon Plan lane; Phase 3 | `db9db751e` + `1506981b5` (Wave 1); `fix/track6-hillstrength-threshold-cap@776343793` (CONFIRMED WITH NOTES, functionally clean) | Pending push authorization decision | No | Phase 3 does NOT yet fully close the core Santa Monica preparation failure — see #10/#13; the shoulder-rung/taper/hill-strength fixes are real but address plan STRUCTURE, not the specific-preparation gap itself |
| 7 | Adaptation experience | REVIEWED (Milestone 1, Wave 1) + U3 CONFIRMED merge-ready after 4 review rounds | [REVIEW][TEST][PROD] | Adaptation lane; U3 | `lane-c/adaptation-vertical-slice-round3-fix@58de21f53` (Wave 1); `fix/rule23-race-adaptation-precondition-v2@be6da478b` (U3, 4 rounds, CONFIRMED merge-ready) | Pending push authorization decision | No | This IS the loop substrate, RECORD_ONLY only; U3 fixes the cron-order bug, confirmed. **The separate "11+ hour cron outage" is RESOLVED as a false alarm** — normal nightly gap, scheduler's own tolerance window, confirmed via GH Actions logs and a live heartbeat proving Railway was never down |
| 8 | Move a Run / schedule mgmt | NOT STARTED (dedicated review) | [TEST] (incidental only) | none dedicated | — | No | No | No |
| 9 | Coaching voice | REVIEWED (Natural Coaching + shadow-pin fix, Wave 1) + U4's post-race copy fixes CONFIRMED | [REVIEW][TEST][DEVICE] | Natural Coaching lane; U4 | `claude/natural-coaching-programme-lead@a9006599c` + `fix/natural-coaching-shadow-pin@fb63182e7`; `u4-postrace-truth@028e29ed8` | Pending push authorization decision | No | Santa Monica's false + contradictory post-race sentences are now fixed and confirmed (U4) |
| 10 | Progress and fitness | INVESTIGATING — design ruling given, NOT adopted; Wave 2 built and CONFIRMED (fixes the race-as-LONG_RUN misclassification for real, not just a tripwire); a genuine evidence-cliff found feeding Santa Monica's live goal-outcome classification | [SRC][TEST][PROD][DEVICE][REVIEW] | Wave 2 lane; U4 | `wave2-fitness-authority` (7 commits, CONFIRMED WITH NOTES) | No | No | Yes — feeds the belief-update step directly. **Two real findings needing attention, neither blocking tonight's work**: (1) a durability weight 0.0041 below its own 0.5 floor and a corroboration count exactly at its own floor — two independent quantities each one hair from flipping Santa Monica's classification between "missed" and "target_invalidated," and corroboration is a hard AND-gate not a continuous discount; (2) `resolveRaceExponent()` ignores its date argument entirely (currently harmless, verified byte-identical, but latent) |
| 11 | Race page | REVIEWED — U5 (elevation-cost reconciliation) CONFIRMED; U7 (canonical target + number labeling) built and CONFIRMED, verified beyond the implementer's own render | [SRC][TEST][PROD][DEVICE][REVIEW] | Santa Monica forensic debrief; U5; U7 | `audit/course-elevation-target-setting@438355a49`+`011e462a1` (U5, CONFIRMED); `audit/u7-canonical-race-target@f0a51f7fd` (CONFIRMED, rendered live on Dodgers) | No | No | U5+U7 close the elevation-model divergence and the 5-conflicting-numbers finding structurally, not just for Santa Monica — reviewer independently rendered the real Dodgers race-detail screen showing the seam caveat live |
| 12 | Race morning | REVIEWED — U6 (Move/Skip + fueling coherence) CONFIRMED clean, the strongest verdict of the night | [SRC][PROD][DEVICE][REVIEW] | Santa Monica forensic debrief; U6 | `u6-race-morning-coherence@6011e04c9` (CONFIRMED, zero notes) | No | No | U6 closes the race-day Move/Skip and marathon-sized-fueling findings, device-rendered on the literal real Santa Monica scenario |
| 13 | Post-race | REVIEWED — U4 CONFIRMED, all 7 required fixes verified; recovery-week coherence (Sep 14-20) CONFIRMED | [SRC][TEST][PROD][REVIEW] | Santa Monica forensic debrief; U4; recovery-week fix | `u4-postrace-truth@028e29ed8`; `fix/recovery-week-coherence@35d8f154d` (CONFIRMED, one follow-up: `isLongestEasyOfWeek` never itself hardened, currently correct only incidentally) | No | No | "Under review" now resolves through a real added reason code + honest fallback (U4); the Sep 14-20 incoherent-recovery-week finding is fixed and confirmed |
| 14 | Shoes | **CORRECTED 2026-09-14 — WORKING END-TO-END**, not started label was wrong (F070) | [SRC][DEVICE] | Independent product review | — | No | No | No |
| 15 | Health and runner metrics | IMPLEMENTING (one data point only) | [PROD] | This lead, directly | data write, no branch | No | No | No |
| 16 | Profile and settings | NOT STARTED | — | none | — | No | No | No |
| 17 | Notifications | **CORRECTED 2026-09-14 — REAL APNs STACK BUILT, WIRED, CONFIRMED DELIVERED** at least once (F091); 3 of ~9 categories confirmed violating Roadmap Priority 4's consequential-change rule, needs a decision (F092) | [SRC][PROD] | Independent product review | — | No | No | No |
| 18 | Reliability and synchronization | REVIEWED — archived-plan-guard chain CLOSED (8 rounds + F9, Wave 1); U2 CONFIRMED (2 rounds); U3 CONFIRMED merge-ready (4 rounds); a real stale pace-anchor monitoring gap found and fixed separately, CONFIRMED | [REVIEW][TEST][PROD] | Archived-plan-guard lane; U2; U3; pace-anchor lane | `fix/archived-plan-guard-undo-twin-final-f9@a00fc9552` (Wave 1); `fix/santa-monica-run-control-dedup-v2@0fc76304e`; `fix/rule23-race-adaptation-precondition-v2@be6da478b`; `audit/pace-anchor-staleness-2026-09-13@ba17ba5f9` (CONFIRMED) | Pending push authorization decision | No | U2/U3 close the two Santa Monica reliability findings, confirmed. **The separate "cron pipeline outage" is RESOLVED as a false alarm** — see #7. The pace-drift-monitor cron previously checked only 2 of 6 real anchor keys; now checks all 6, confirmed safe and non-disruptive |
| 19 | Onboarding and first-plan experience | **CORRECTED 2026-09-14 — A REAL 5-STEP FLOW IS LIVE**, current (`3f12aa6c4`, 2026-08-25), and is the app's actual front door for every launch; NOT STARTED label was wrong. Real, substantial gap found: 3 of 5 fitness-step answers are discarded before the plan is generated and a 4th is deliberately unread (F074, fixes implemented, pending review); the goal-distance picker also still omits the `coached` option (F090, a ~3-week-old known gap, still unfixed) | [SRC] | Independent product review | `fix/f074-onboarding-evidence-2026-09-14` (pending review) | No | No | No |
| 20 | Readiness, illness, injury flows | IMPLEMENTING (one data point only) — **explicitly does NOT close the flow** | [PROD] | This lead, directly | data write only | No | No | No |
| 21 | Travel and missed-training automation | NOT STARTED | — | none | — | No | No | No |
| 22 | Cold-start and returning runners | NOT STARTED | — | none | — | No | No | No |
| 23 | Additional runner types and goals | NOT STARTED | — | none | — | No | No | No |
| 24 | Generalize David-proven rules | NOT STARTED | — | none | — | No | No | No |
| 25 | App Store readiness/privacy/auth/commercial | NOT STARTED | — | none | — | No | Yes, eventually | No |
| 26 | Accessibility and device/layout coverage | NOT STARTED | — | none | — | No | No | No |
| 27 | Remove dead code and obsolete paths | PARTIAL (worktree hygiene only) | [SRC] | Worktree hygiene | N/A | No | No | No |

**Cross-cutting overlays** (not one of the 27 numbered areas):
- **UX/IA acceptance** — no dedicated owner. Santa Monica added 2 new data points (RUN-control
  visibility on a completed day; repeated near-identical sentences across surfaces).
- **Physical verification** — two real device-evidence data points now exist this cycle: the
  pre-race Santa Monica intake and the full post-race forensic debrief. The strongest evidence
  this programme has for keeping physical verification in the release gate.
- **Final autonomous runner-loop verdict** — the Santa Monica debrief is the first real, organic
  (non-fixture) race outcome traced end-to-end. Current verdict: the loop weighs race evidence
  asymmetrically against training-session evidence, and its own "Under review" promise cannot
  currently resolve the way its copy implies. Not fixed. Directly informs Decision 3's ruling.

---

## Per-area detail — current state only

### 1 · Today
- **Original acceptance criteria**: surface only what changes what the runner should understand
  or do next (UX Simplification Doctrine); no repeated content; correct weekly-mileage reporting.
- **Current state**: two device-evidence observations only (weekly-mileage reconciliation
  question; cross-surface repetition) — not yet root-caused, not yet reconciled against source.
- **Evidence**: [DEVICE], raw observation only.
- **Owner**: none active.
- **Remaining gap**: everything — this is intake, not investigation.
- **Next action**: reconcile against source once the Wave 1 candidate is pushed.

### 2 · Pre-run
- **Original acceptance criteria**: race-aware actions must not appear where they don't apply
  (e.g., Move/Skip on race morning); no logical contradiction in displayed conditional ranges.
- **Current state**: one device-evidence observation (race-aware Move/Skip actions appearing on
  race morning) — not yet root-caused.
- **Evidence**: [DEVICE], raw observation only.
- **Owner**: none active.
- **Remaining gap**: everything — this is intake, not investigation.
- **Next action**: reconcile against source once the Wave 1 candidate is pushed.

### 3 · Run execution
- **Original acceptance criteria**: a completed workout's honest completion state (advanced-early
  vs. session-ended vs. incomplete) reaches every consumer; no duplicate or overwritten recordings.
- **Current state**: Lane A's server-side `completionReason` fix is independently reviewed clean
  (twice, cross-corroborated), included in the pending Wave 1 push-authorization request. Native
  (Watch/phone) consumption of the new field is explicitly deferred — needs a new build. Santa
  Monica separately found and left unfixed: the RUN control can start a fresh recording under an
  already-completed race's own canonical workout ID (live risk, currently reachable); a same-day
  phone-only double-recording would silently overwrite the first (the watch app's own
  disambiguation fix for this exact class was never ported to the phone).
- **Evidence**: [SRC][TEST][REVIEW] for Lane A; [SRC][PROD] for the Santa Monica findings.
- **Owner**: Lane A lane (web fix); Santa Monica debrief (RUN-control + overwrite findings, not
  dispatched).
- **Branch**: `fix/lane-a-duration-regression@d03dbbc37`.
- **Remaining gap**: native consumption of `completionReason`; RUN-control post-completion
  gating; phone-side recording disambiguation.
- **Next action**: Wave 1 push covers the reviewed web fix only. RUN-control/overwrite fixes are
  proposed (Santa Monica Lane L3), not dispatched.
- **Blocks**: pending push authorization for the reviewed piece; the RUN-control risk blocks the
  autonomous-loop verdict's data-integrity criterion until addressed.

### 4 · Post-run
- **Original acceptance criteria**: no false or self-contradictory post-run statement, ever; the
  correct card/state renders for every day a runner pages back to.
- **Current state — the ORIGINAL defect this cycle's audit started from is CLOSED**: broken
  pre-run cards on paged-back completed days, confirmed genuinely fixed via a two-round
  implementation and independently re-verified by device rendering against real production data
  (not fixture data) — 53/53 real days probed render correctly, zero bare broken cards. **The
  area as a whole is NOT closed.** Six items remain open, all previously named and explicitly
  not dropped:
  1. The API payload is self-contradictory (`before_run` and `viewedDayResolution` both present)
     and correctness depends entirely on one client's field-read order — no gate enforces which
     a client should trust.
  2. The resolution card for an unmatched real run offers only Move/Mark-skipped — no action
     reflects what actually happened, inviting a false skip record.
  3. Failed-read handling is inconsistent across sibling surfaces — `GET /api/plan/week` (feeds
     the week strip/calendar) and `/api/v5/today`'s own week strip still collapse "read failed"
     into "not done," while the main panel itself now handles this honestly.
  4. The Watch-side `completedTodayUnknown` flag is wired but currently inert — no Swift file
     reads it yet.
  5. Historical HR-cap provenance — old post-run cards, newly reachable by this fix, draw using
     TODAY's LTHR rather than whatever was live on the historical day (`ANCHORCAP-1`, confirmed
     4 stale rows in production, deferred).
  6. Supplemental/unmatched-run recap access — a real run that doesn't match any scheduled
     session has no dedicated recap surface of its own.

  **Separately, Santa Monica's forensic debrief found additional, distinct defects in the SAME
  area, not yet fixed**: the split array actually displayed comes from the less-accurate of two
  algorithms the app itself holds (`pickSplits` selects on GPS coverage, not accuracy); one
  displayed sentence is factually false ("some segments landed inside the window" when zero did);
  one pair of displayed sentences directly contradicts itself from the same underlying flag;
  course/RPE/target-gap content that already exists in the database never reaches the post-run
  payload.
- **Evidence**: [SRC][TEST][PROD][SIM] for the audit-parity resolution; [SRC][PROD] for the
  Santa Monica findings.
- **Owner**: Lane A lane; post-run audit lane (both resolved); Santa Monica debrief (new findings,
  not dispatched).
- **Branch**: `fix/lane-a-duration-regression@d03dbbc37` (in the Wave 1 candidate). **Correction,
  2026-09-13**: `fix/postrun-week-loader-swallow-round2@08ecbb7da` is CONFIRMED ABSENT from the
  Wave 1 candidate (`dce13caec`) — verified directly by git ancestry, not assumed. It is its own
  separate, reviewed, not-yet-pushed integration candidate, and must be tracked and authorized
  independently. It was never one of the five Wave-1 branches; an earlier version of this matrix
  implied otherwise by listing both branches under one status cell, which is corrected here.
- **Remaining gap**: the 6 named follow-ups above, plus the 4 Santa Monica findings (proposed as
  Lanes L1/L2/L8, not dispatched).
- **Next action**: the audit-parity fix is part of the pending Wave 1 push. The 6 follow-ups and
  the Santa Monica findings are named, scoped, and awaiting dispatch decisions — not silently
  absorbed into "closed."
- **Blocks**: nothing new blocks the Wave 1 candidate. The Santa Monica findings block the
  autonomous-loop verdict's "no false runner-visible statement" criterion until resolved.

### 5 · Activity/history
- **Original acceptance criteria**: history views show the same, most-accurate data as the
  original post-run surface; no data silently lost or misattributed.
- **Current state**: shares its root causes with #4 — the same split/elevation display defect
  Santa Monica found reaches history views; no dedicated evidence-store persists any
  interpretation of a run once made.
- **Evidence**: [PROD][SIM].
- **Owner**: post-run audit lane; Santa Monica debrief.
- **Remaining gap**: same as #4's Santa Monica findings.
- **Next action**: bundled with #4's proposed lanes.

### 6 · Block/plan experience
- **Original acceptance criteria**: a baseline plan stands without Adaptation rescuing it;
  doctrine-correct phase/taper/specificity logic.
- **Current state**: two narrow, independently-reviewed fixes (peak-stimulus window constant;
  fabricated-citation correction + C-race ramp-guard extension) are included in the pending Wave
  1 push-authorization request. **These do not change David's current live plan's numbers and do
  not close the Phase 3 redesign** (Wk9 overload, MP-dose insufficiency, Malibu taper length —
  all still open, Phase 3 still not resumed).
- **Evidence**: [REVIEW][TEST].
- **Owner**: Marathon Plan lane.
- **Branch**: `db9db751e` + `1506981b5`.
- **Remaining gap**: Phase 3 in full; per standing instruction, Phase 3 must ultimately
  evaluate/update David's actual plan, not only improve future generation.
- **Next action**: Phase 3 resumption, not yet scheduled.
- **Blocks**: pending push authorization (Wave 1) for the two narrow fixes only.

### 7 · Adaptation experience
- **Original acceptance criteria**: the plan can get harder in pace, volume and density, provably
  (Rule 21); every adaptation records what it did and why (Rule 21's logging corollary).
- **Current state**: Milestone 1 (RECORD_ONLY, one lever — DURATION, doctrine-supported
  ACCELERATE only) is independently reviewed clean across 3 rounds, included in the pending Wave
  1 push-authorization request. RECORD_ONLY framing independently confirmed at 4 checkable code
  points. **This is a foundation, not a completed runner-operable adaptation loop, and must not
  be described as one.** Confirmed by the combined-tree render: the real account has zero
  DURATION-lever proposals to render today, and the wired notice carries no Do-it/Leave-it
  controls for the runner to act on — RECORD_ONLY means the mechanism records a proposal for
  later review, it does not yet offer the runner anything to accept or decline. Separately,
  Santa Monica's forensic debrief confirmed a real Rule 23 defect: the nightly `run-adaptations`
  cron runs before `plan-drift` writes a same-day race result, making a race invisible to
  adaptation for a full extra day — not fixed.
- **Evidence**: [REVIEW][TEST] for Milestone 1; [SRC][PROD] for the Rule 23 finding.
- **Owner**: Adaptation lane; Santa Monica debrief (Rule 23 finding, not dispatched).
- **Branch**: `lane-c/adaptation-vertical-slice-round3-fix@58de21f53`.
- **Remaining gap**: this is RECORD_ONLY, not autonomous adaptation — no automatic mutation
  exists yet by design (the sealed boundary is intentional, not a gap). The Rule 23 cron-order bug
  is a real, unfixed gap.
- **Next action**: Wave 1 push covers Milestone 1 only. The Rule 23 fix is proposed (Santa Monica
  Lane L6), not dispatched.
- **Blocks**: pending push authorization (Wave 1) for Milestone 1. The Rule 23 bug blocks the
  autonomous-loop verdict directly — it is the mechanism this whole product exists to prove out.

### 8 · Move a Run / schedule management
- **Original acceptance criteria**: ranked alternatives, trade-off explanation, key-session
  spacing preservation, vacation handling.
- **Current state**: NOT STARTED as a dedicated review. One incidental touch only — the
  archived-plan-guard chain's undo-path test coverage, which is not a review of this area's own
  acceptance criteria.
- **Evidence**: [TEST], incidental only.
- **Owner**: none dedicated.
- **Remaining gap**: the entire area.
- **Next action**: not yet scheduled.

### 9 · Coaching voice
- **Original acceptance criteria**: coach voice throughout — short, direct, no hype, no
  exclamation marks, no em dashes, no invented causality, no false or misleading statement.
- **Current state**: the Natural Coaching canonical branch (removes a false "yours to change"
  affordance, drops internal tier-label jargon from 7 sites, fixes a pseudo-collective voice slip)
  plus its shadow-pin follow-up fix are both independently reviewed clean and included in the
  pending Wave 1 push-authorization request. **Separately**, Santa Monica's post-race copy audit
  traced all 9 displayed post-race sentences to source and found: 1 truthful, 5
  technically-true-but-misleading, 2 unsupported, 1 internally contradictory, 1 outright false —
  none of this is fixed, and none of it overlaps the Natural Coaching branch's own scope.
- **Evidence**: [REVIEW][TEST] for Natural Coaching; [SRC][PROD] for the Santa Monica audit.
- **Owner**: Natural Coaching lane; Santa Monica debrief (post-race copy findings, not dispatched).
- **Branch**: `claude/natural-coaching-programme-lead@a9006599c` + `fix/natural-coaching-shadow-pin@fb63182e7`.
- **Remaining gap**: the Santa Monica post-race copy findings (proposed Lane L2, not dispatched).
- **Next action**: Wave 1 push covers the reviewed Natural Coaching + shadow-pin work. The
  post-race copy findings await a dispatch decision.
- **Blocks**: pending push authorization (Wave 1). The post-race copy findings block the
  autonomous-loop verdict's honesty criterion until resolved.

### 10 · Progress and fitness
- **Original acceptance criteria**: one canonical fitness belief, confidence-weighted across
  anchors, never silently displaced by a single weak observation; idempotent, non-duplicating
  adaptation triggers.
- **Current state**: the canonical-fitness-resolver proposal is fully investigated and validated
  against real production data, but **NOT adopted or wired into anything live**. A real design
  flaw was found and correctly left unfixed for the record: a frozen-legacy-anchor veto would
  eventually and permanently refuse to answer for reasons unrelated to the runner's actual
  fitness (this codebase's own Rule 9/Rule 21 failure signature). **A directional ruling was made
  this checkpoint** for the next revision (canonical resolver stays sole authority; frozen
  divergence becomes diagnostic, never a veto; reduced-authority evidence qualifies confidence
  rather than blocking it; idempotency keys on evidence/decision/plan-lineage identity, not a
  frozen competing value) — not yet built. Santa Monica's forensic debrief independently found
  the concrete, real-world instance of the identical defect (a race's evidence was weighted 2%
  against a single training session's 98%) and its proposed fix (Lane L5) is conceptually folded
  into this same thread, but explicitly **not dispatched** until the Santa Monica findings are
  fully reconciled (the debrief's own duplicate-row/canonical-selection finding may change which
  race evidence is even safe to use as input here). `live-input.ts`'s evidence-versioning gap is
  under separate, dedicated read-only investigation before it's relied on for idempotency.
- **Evidence**: [SRC][TEST][PROD] for the proposal; [SRC][PROD][DEVICE] for the Santa Monica
  corroboration.
- **Owner**: Wave 2 lane.
- **Branch**: `proposal/wave2-canonical-fitness-resolver@0f08f52b8` (unwired).
- **Remaining gap**: the entire next-revision build, per the directional ruling above; migration
  166 remains unapplied (a separate, named blocker for adoption regardless of design quality).
- **Next action**: build the next revision per the ruling; complete the `live-input.ts`
  investigation; reconcile the Santa Monica debrief before scoping L5.
- **Blocks**: feeds the autonomous-loop's belief-update step directly — this is one of the most
  load-bearing open items in the whole programme.

### 11 · Race page
- **Original acceptance criteria**: one canonical finish-time/target number per race, correctly
  hill- and condition-adjusted; no two surfaces disagreeing on the same labeled quantity.
- **Current state**: fully investigated by the Santa Monica forensic debrief (findings only,
  nothing fixed). Five different live finish-time numbers were found for the same race (43:05 on
  the phone vs. 43:40 on the watch — the exact hill-cost delta one path applies and the other
  doesn't); two independently-implemented, unreconciled elevation-cost models; a real course
  climb profile that exists in the database and never reaches target-setting. Pre-race device
  evidence (7 different race-number values, logical-overlap and course-adjustment-traceability
  questions) remains separately unreconciled.
- **Evidence**: [SRC][TEST][PROD][DEVICE].
- **Owner**: Santa Monica forensic debrief.
- **Remaining gap**: everything named above; proposed as Lanes L4/L9, not dispatched.
- **Next action**: awaiting dispatch decision once the Santa Monica findings are reconciled.
- **Blocks**: the autonomous-loop verdict's "one quantity, one name" criterion (Rule 16).

### 12 · Race morning
- **Original acceptance criteria**: race-day guidance reflects the runner's actual, current-race
  conditions and terrain; no stale or contradictory safety threshold.
- **Current state**: fully investigated by the Santa Monica forensic debrief (findings only,
  nothing fixed). A two-owner problem for "how hard should this workout be" (a pre-race HR band
  vs. a disconnected post-race HR-ceiling reader); the published race-morning target was already
  roughly 3 minutes optimistic before the gun, for reasons unrelated to the mile-2 safety
  checkpoint (which itself worked correctly). Pre-race device evidence (fuel-timeline
  contradiction, temporal incoherence, race-aware Move/Skip actions appearing on race morning)
  remains separately unreconciled.
- **Evidence**: [SRC][PROD][DEVICE].
- **Owner**: Santa Monica forensic debrief.
- **Remaining gap**: everything named above.
- **Next action**: awaiting dispatch decision once the Santa Monica findings are reconciled.
- **Blocks**: the autonomous-loop verdict's honesty criterion for race-day guidance.

### 13 · Post-race
- **Original acceptance criteria**: a truthful, non-repetitive debrief; correct plan-impact
  statement; honest fitness-belief update or honest refusal to update.
- **Current state**: the first real coverage this area has received this entire programme cycle,
  via the Santa Monica forensic debrief (findings only, nothing fixed). The post-race copy audit
  (see #9), the Brain before/after evidence trace (nothing moved except one ingest receipt — this
  is doctrinally CORRECT for one race, with one caveat: "Under review" cannot resolve the way its
  own copy implies, for reasons compounding across cron ordering, a narrow reason-code allowlist,
  and the sealed automatic-mutation boundary), and the reconstructed runner-facing debrief
  prototype all live here.
- **Evidence**: [SRC][TEST][PROD].
- **Owner**: Santa Monica forensic debrief.
- **Remaining gap**: everything named above; see #9 and #10 for the overlapping copy and
  evidence-weighting findings.
- **Next action**: awaiting dispatch decision once the Santa Monica findings are reconciled.
- **Blocks**: the autonomous-loop verdict directly — "Under review" is this product's own stated
  mechanism for exactly this moment, and it does not currently do what it says.

### 14 · Shoes
- **Current state**: **CORRECTED 2026-09-14.** Was labeled NOT STARTED with no cited evidence — that
  absence of evidence was itself the tell (per F070). Independent product review confirmed the Shoes
  feature works end-to-end, including the native screen, against David's real account (8 real shoes,
  5 active/3 retired via `GET /api/shoe`). One real, separately-tracked defect exists on this same
  screen: a failed fetch silently renders as "zero shoes owned" with no error/retry state (F061,
  Rule 11 violation, existing fix pattern in the same file to reuse) — that is a live bug, not
  evidence the feature is unbuilt.
- **Evidence**: [SRC][DEVICE] — see F070, F061 in the findings register.
- **Owner**: none active for the F061 fix.
- **Remaining gap**: F061's silent-empty-state fix, not yet dispatched.
- **Next action**: dispatch F061 at normal priority.

### 15 · Health and runner metrics
- **Original acceptance criteria**: accurate, current health/injury data available to every
  consumer that needs it.
- **Current state**: one data point only — David's real injury history backfilled (row id 5,
  executed, independently verified, confirmed closed by David). **This is a single historical
  data write, not a review of the health/metrics surface itself.**
- **Evidence**: [PROD].
- **Owner**: this lead, directly (data write, no code branch).
- **Remaining gap**: the surface itself, entirely.
- **Next action**: not yet scheduled.

### 16 · Profile and settings
- **Current state**: NOT STARTED. No change this cycle.

### 17 · Notifications
- **Current state**: **CORRECTED 2026-09-14.** Was labeled NOT STARTED — the fourth confirmed-wrong
  "NOT STARTED" row found this session (after Shoes, Onboarding, and this one). A genuine, non-stub
  APNs stack exists and is wired end to end: ES256 JWT signing/HTTP-2 delivery, a real dispatch
  pipeline (prefs check → 24h dedup → quiet hours → send → log → dead-token reaping), a GitHub-
  Actions-ticked cron scheduler, and real device-token registration. Confirmed delivered, not just
  wired: APNs was unconfigured 2026-05-31 through 2026-08-17 (174 log rows, 0 delivered), fixed
  2026-08-18, and has since delivered at least 1 real push. Current (September) live delivery volume
  not independently re-confirmed. Real, separate gap found: 3 of ~9 shipped categories
  (`weekly_checkin`, `race_countdown`, `run_unread`) fire on a routine calendar/data basis, violating
  Roadmap Priority 4's "reserved for consequential changes or requested actions" rule; only 2 of ~8
  categories have any phone-side user control, the rest default ON.
- **Evidence**: [SRC][PROD] — see F091 (matrix correction), F092 (doctrine gap) in the findings
  register; PO-004 (product-opportunities register) for the per-category-controls idea this implies.
- **Owner**: none active.
- **Remaining gap**: F092's doctrine decision (are the 3 categories deliberate exceptions or should
  they be gated harder/exposed as settings); PO-004's granular controls, contingent on that decision.
- **Next action**: not yet scheduled; needs David's/roadmap owner's call on F092 first.

### 18 · Reliability and synchronization
- **Original acceptance criteria**: no silent data loss or corruption under concurrent writes; no
  false claim about system state under a read failure; correct deduplication.
- **Current state**: the archived-plan-guard chain is **CLOSED** — 8 independent adversarial
  review rounds plus one trivial follow-up (F9), each round finding and fixing a genuinely new
  defect, none rubber-stamped, all falsified by hand both directions. Included in the pending
  Wave 1 push-authorization request. **Separately, and NOT part of this closure**, Santa Monica's
  forensic debrief found: the Strava webhook echo is correctly but only softly de-duplicated (no
  check for "did Faff itself just push this activity"); the RUN control offers to start a fresh
  recording under an already-completed, still-unsealed race's own canonical ID (live risk); a
  same-day phone-only double recording would silently overwrite the first.
- **Evidence**: [REVIEW][TEST][PROD] for the archived-plan-guard chain; [SRC][PROD] for the Santa
  Monica findings.
- **Owner**: Archived-plan-guard lane (closed); Santa Monica debrief (new findings, not
  dispatched).
- **Branch**: `fix/archived-plan-guard-undo-twin-final-f9@a00fc9552` (the fully-reviewed tip,
  pending integration into the final Wave 1 candidate).
- **Remaining gap**: the Santa Monica findings above (proposed Lane L3).
- **Next action**: Wave 1 push covers the archived-plan-guard chain. The RUN-control/dedup
  findings await a dispatch decision.
- **Blocks**: pending push authorization (Wave 1) for the closed chain. The RUN-control finding
  blocks the autonomous-loop verdict's data-integrity criterion.

### 19 · Onboarding and first-plan experience
- **Current state**: **CORRECTED 2026-09-14.** Was labeled NOT STARTED this cycle with a caveat
  admitting "older work exists in repo history, not re-verified" — that caveat was the tell. A real,
  current 5-step onboarding flow (`OnboardingV5.swift`, commit `3f12aa6c4`, 2026-08-25) is live and is
  the app's actual front door for every launch (`FaffApp.swift` routes explicitly to it). Real,
  substantial gap confirmed: the "fitness" step collects 5 possible answers about a runner's
  background, but 3 of 5 are discarded before the network call even fires (recent-race distance/time,
  known effort pace, time-off/prior-mileage), and a 4th (self-reported experience level) is sent but
  deliberately unread by the plan router. Doctrine-grounded fix delivered for 3 of the 4 (recent-race
  time, effort pace, time-off wired to real evidence machinery per doctrine; experience-level
  confirmed correctly inert per a dated 2026-09-02 ruling) — implemented, migration columns written
  but not applied, native wiring explicitly out of scope for this pass. Separately, the goal-distance
  picker still omits the `coached` option despite full backend support — a specific gap already dated
  three weeks earlier in `docs/design-backend-alignment-2026-08-19.md`, still unfixed.
- **Evidence**: [SRC] — see F074, F090 in the findings register; PO-002 (product-opportunities
  register) for the separate missing connect-a-source-step question this pass also surfaced.
- **Owner**: Independent product review finding; fix branch `fix/f074-onboarding-evidence-2026-09-14`.
- **Remaining gap**: F074's fix pending external review; F090 (coached option) not yet dispatched;
  native wiring of all 3 evidence fields and `generate.ts` wiring are explicitly out-of-scope
  follow-on work per F074's own submission; PO-002 (connect-a-source step) is an open product
  question, not yet decided.
- **Next action**: get F074 through external review; dispatch F090 as a small, well-scoped fix.

### 20 · Readiness, illness, injury flows
- **Original acceptance criteria**: injury/readiness state correctly gates plan safety decisions
  end-to-end.
- **Current state**: one data point only (see #15) — **explicitly does not close this flow.**
- **Evidence**: [PROD].
- **Owner**: this lead, directly (data write only).
- **Remaining gap**: the flow itself, entirely.
- **Next action**: not yet scheduled.

### 21 · Travel and missed-training automation
- **Current state**: NOT STARTED. No change this cycle.

### 22 · Cold-start and returning runners
- **Current state**: NOT STARTED. No change this cycle.

### 23 · Additional runner types and goals
- **Current state**: NOT STARTED. No change this cycle.

### 24 · Generalize David-proven rules to other runners
- **Current state**: NOT STARTED. No change this cycle.

### 25 · App Store readiness/privacy/auth/commercial
- **Current state**: NOT STARTED. No change this cycle. Will eventually block TestFlight/release,
  not urgent today.

### 26 · Accessibility and device/layout coverage
- **Current state**: NOT STARTED. No change this cycle.

### 27 · Remove dead code and obsolete paths
- **Current state**: PARTIAL — 63 stale git worktrees reclaimed (~1TB), verified safe. This is
  repository/environment housekeeping, not source-level dead-code removal. A concrete example of
  actual untouched dead code: `lib/plan/injury-builder.ts`'s dead `buildInjuryPlanBody` path.
- **Evidence**: [SRC].
- **Owner**: Worktree hygiene (completed for its own narrow scope).
- **Remaining gap**: source-level dead-code removal, entirely.
- **Next action**: not yet scheduled.

---

## Standing checkpoint answers

**What moved this checkpoint**: archived-plan-guard chain fully closed (8 rounds + F9); Wave 1
combined candidate rebuilt fresh and re-gated (push authorization requested, pending the required
closeouts); the full Santa Monica forensic debrief completed and reconciled; a directional ruling
set for the Wave 2 canonical-fitness-resolver's next revision.

**What genuinely closed**: the archived-plan-guard chain's own scope (#18, partial — the chain
itself, not the whole reliability area); the original post-run paged-back-day defect (#4, partial
— the original defect, not the whole area); the injury backfill data point (#15/#20, partial — one
row, not the flow).

**What got only a foundation or partial fix**: #3 (native consumption still missing), #4/#5 (6 +
4 named follow-ups open), #6 (Phase 3 untouched), #7 (RECORD_ONLY only, Rule 23 bug found), #9
(post-race copy findings open), #10 (design ruling only, nothing built), #18 (new findings open),
#27 (housekeeping only).

**What's stalled or has no owner**: #1, #2, #8, #16, #21, #22, #23, #24, #25, #26 —
10 of 27 areas remain fully untouched this cycle. #11, #12, #13 now have real investigation for
the first time (via Santa Monica) but zero dispatched fixes. **Correction, 2026-09-14**: #14 (Shoes),
#17 (Notifications), and #19 (Onboarding) were previously listed here as stalled/NOT STARTED — all
three were confirmed WRONG by independent product review (IPR-20260914-005/009, plus the earlier
Shoes spot-check): real, live, working-or-mostly-working capabilities exist in all three areas, each
with its own separately-tracked real gap (see their per-area sections above). This is the third time
in one session an unevidenced "NOT STARTED" row was found stale — any remaining "NOT STARTED" row
above with no cited evidence (#1, #2, #8, #16, #21-#26) should be treated as unverified, not
confirmed-absent, until someone actually checks. This pass concretely checked #14/#17/#19 only —
#1, #2, #8, #16, #21, #22, #23, #24, #25, #26 were NOT re-verified and should not be assumed correct
or incorrect on the strength of this note alone.

**Highest-value next dispatch, in order**: (1) close out the Wave 1 candidate's remaining
requirements and get push authorization; (2) reconcile and scope the Santa Monica lanes without
creating a "collision factory" of ten uncoordinated dispatches; (3) build the Wave 2 next
revision per the directional ruling; (4) the Rule 23 cron-ordering fix (#7), since it is cheap,
isolated, and blocks the autonomous-loop verdict directly.

**Is the app materially closer to autonomous coaching operation?** Partially, and the honest
answer is more nuanced than yes/no: the REVIEW DISCIPLINE around changes is now extremely strong
(8-round adversarial review is not typical practice, it's this checkpoint's actual achievement),
but the Santa Monica debrief is the first real organic evidence this cycle has produced about
whether the LOOP ITSELF behaves correctly on a genuine race outcome — and it shows the loop
currently weighs evidence asymmetrically and cannot honestly resolve its own "Under review"
promise. That is a more valuable finding than a clean sweep would have been, but it means the
autonomous-loop verdict is NOT closer to a positive verdict this checkpoint — it has a sharper,
more concrete list of exactly what would need to be true first.
