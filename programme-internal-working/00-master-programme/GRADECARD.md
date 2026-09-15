# faff.run gradecard — living, evidence-based

**Owner:** programme lead. **Updated:** whenever real evidence changes a grade, not on a schedule.
**Rule:** grade what fires today, not what exists, is tested, or is in progress. A/A+ requires
proof in a real runner journey (David's, until golden-runner fixtures exist), not passing tests or
clean code. A broken core path is never averaged away by strong surrounding work.

**A+ means:** exceptional, complete, reliable, independently verified (external review and/or
design review, not self-reported), and proven firing on a real runner's real data — not "the code
looks right," not "tests pass," not "implemented, pending merge."

Grade scale: **F** (broken/absent) · **D** (present, unreliable or unreachable) · **C** (works,
real known gaps) · **B** (works well, minor gaps) · **A** (works reliably, independently verified)
· **A+** (proven in a real runner journey, no known gaps).

---

## 1. Baseline plans

**Grade: C+**

**Why:** Doctrine-compliance gates (dosing caps, intensity distribution, long-run caps) are closed
and enforced in CI. But `lib/plan/_coach_sensible.test.ts` — the gate for Rule 12 (easy running
sized before quality, not with the remainder) — is *deliberately red right now*, on record as open.
A gate that's supposed to catch bad plans is currently failing on purpose, which means the
underlying defect it catches (a 3:00 marathoner getting 2-3mi easy days) has not been confirmed
fixed end-to-end.

**Evidence:** `Rule 7` doctrine registry (dosing/intensity/longrun CLOSED per CLAUDE.md); `Rule 12`
section of CLAUDE.md naming `_coach_sensible.test.ts` as deliberately red.

**Blocks next grade:** `_coach_sensible.test.ts` turning green against real archetypes, independently
re-verified, not just implemented.

**Next action:** code agent traces current state of that gate — is it still red, and if so why —
before anything else in this area gets touched.

**A+ here means:** every generated plan, for every archetype, prices easy days in minutes at the
runner's own pace before quality is laid in, verified by the gate that already exists, currently
green and independently re-confirmed.

---

## 2. Adaptation and progression

**Grade: C**

**Why:** The single most important mechanism in the app — real headroom reservation so upward
adaptation can fire — is fixed, independently reviewed, and confirmed *deployed* tonight (F034).
That's real, major progress from zero. But the app has never yet actually fired a real upward
adaptation for the one real runner it has. The fix makes it *possible*; it hasn't yet been *proven*
on a real case.

**Evidence:** F034 (register), confirmed DEPLOYED via `check-deploy-status.sh`, SHA `0e0a0cd36`.
`PUSH_THE_RUNNER_FORWARD_DOCTRINE.md`'s own measurement: 325 `coach_intents`, zero upward, as of
2026-09-14 — this is the number the fix needs to actually move.

**Blocks next grade:** a real, observed upward adaptation firing for David (or a golden-runner
fixture) end to end — proposed, accepted, delivered to the active plan, absorbed, and logged as
what it did — not just "the gate can now open."

**Next action:** watch the next real adaptation cycle against David's actual data; if none fires
within a reasonable evidence window, investigate why, don't just wait passively.

**A+ here means:** a documented real case of pace, volume, duration, or density genuinely
increasing because the runner earned it, delivered to the actual iPhone and Watch plan, with the
outcome logged and feeding the next decision.

---

## 3. Runner model and evidence

**Grade: C-**

**Why:** Independent review found `resolveRunnerState()` — a function shaped exactly like "the
canonical belief about the runner" — has zero live authority; it feeds a shadow comparison sealed
behind `AUTOMATIC_ADAPTATION_AUTHORITY: false`. `resolveThresholdCapacity()` is a genuine single
canonical resolver and works. VDOT/pace-anchor staleness (F032/F037) is doctrine-resolved but F037's
actual fix is still undispatched.

**Evidence:** IPR-20260914-001 (register F067, corrected); F032/F037 (register).

**Blocks next grade:** one real Runner Model that actually holds confidence-weighted beliefs across
capacity/threshold/durability, wired to something live — not a resolver plus a sealed-off shadow
engine standing in for it.

**Next action:** F037's fix (relabel or recompute the stale `pace_blend.season_anchor_vdot` field)
— small, well-scoped, not yet dispatched.

**A+ here means:** a single, live-consulted Runner Model, confidence-weighted, with every
consumer reading the same resolved values — proven by golden-runner fixtures across good/bad
races, missing HR, stale evidence, and aggressive goals.

---

## 4. Pace prescription

**Grade: B-**

**Why:** `resolveThresholdCapacity()` is genuinely canonical and doctrine-registry-verified. The
real, current gap is narrower and specific: the HR-ceiling verdict for an easy run is average-only
(F049), which is precisely why today's real 41-second excursion read as a clean pass. The watch
already computes the correct live signal and throws it away (F065-adjacent finding).

**Evidence:** F049 (coach consultant, code-verified); F065/finding 005 (design review).

**Blocks next grade:** F049's fix — wire a drift-aware check into the easy-run verdict, likely by
persisting the watch's own already-correct `hrOverCeiling` signal instead of reconstructing drift
from coarser data.

**Next action:** dispatch F049 alongside F066 once the safety investigation resolves.

**A+ here means:** a per-run verdict that reflects sustained excursions, not just the average,
using the most accurate signal already available (the watch's live check), proven against a real
run that actually drifted.

---

## 5. Coaching strategy and voice

**Grade: B**

**Why:** Real, recent, independently-verified progress tonight — the "doctrine" jargon-leak fix
(composeReviewTrigger) is deployed and confirmed correct by two independent reviewers. The
proactive voice audit found and is closing real gaps (F053 bare "try again", cross-platform).
Known, real remaining gap: the same jargon-leak pattern exists in an internal-only field
(`reconsiderIf`) not yet fixed, and F057's post-race copy (4 of 9 wrong sentences) is only
half-landed (5 fixed and reviewed tonight, 4 more never scoped).

**Evidence:** RR-025 CONFIRMED; F053; F057 (RR-029).

**Blocks next grade:** F057's remaining 4 sentences (#1/#4/#8/#9) scoped and fixed; the
`reconsiderIf` internal-string fix landed.

**Next action:** scope #1/#4/#8/#9 once F057's current round is confirmed.

**A+ here means:** every runner-facing sentence, on every screen, reads as a real coach's voice —
no jargon, no unsupported claims, no self-contradiction across the same screen — verified by a
real design-review coherence pass on real data, not just a lexicon test passing.

---

## 6. Today and Block

**Grade: C**

**Why:** The two most-visited screens in the app carry several live, confirmed, unfixed defects:
a permanently-decorative readiness score (being removed), a permanent stray dash with a false
VoiceOver announcement on Block (F062), a duplicate settled/open decision card (F060), and two
older still-open findings (F028 no plan-change notification, F029 week-strip color disagreeing
with its own day card). Real UI-correctness work is actively closing these, but the count of live,
confirmed issues on these two screens tonight is high for what David looks at most.

**Evidence:** F028, F029, F060, F062 (register); readiness removal (F001/IPR, in progress).

**Blocks next grade:** F062 and F060 landed and independently confirmed; F028/F029 actually
dispatched (they've been queued behind higher priority all session, correctly, but they're real).

**Next action:** once F056/F066 clear, F028/F029 are next in line — they've been correctly
deprioritized, not forgotten.

**A+ here means:** the runner opens Today or Block and every element is accurate, non-redundant,
and internally consistent — proven by a design-review coherence pass finding nothing, not by an
absence of open tickets. **Added 2026-09-15, Rule 26 (CLAUDE.md), David direct via David's Desk:**
also means loaded, cached, fluid, instant, live — a screen that's correct but spinner-first, slow,
or falsely offline-gated for data the app has already seen once has not met this bar even with zero
open correctness tickets. F147 (stuck offline flag) and F029 (stale week-strip cache) are the
concrete instances this grade should weigh, not just count.

---

## 7. Run execution and Watch

**Grade: C-**

**Why:** A real, high-confidence, currently-unresolved concern is live right now: a safety-relevant
bail mechanism (offers to end a session on sustained dangerous HR) failed to trigger in two
independent, differently-shaped reproductions (F066) — under active runtime investigation, not yet
explained. Separately: the force-quit/relaunch display bug (F056) is fixed and awaiting merge
authorization; a same-day workoutId collision can silently overwrite run data on the phone (F072,
Watch already has the fix); the watch shows the same rep count twice on one screen (F065). This
area currently carries the single most urgent open question of the whole gradecard.

**Evidence:** F066 (in progress, runtime instrumentation dispatched); F056 (RR-026 CONFIRMED,
awaiting authorization); F072; F065.

**Blocks next grade:** F066 resolved with a concrete, understood root cause (or confirmed
correctly-behaving after all); F056 authorized and confirmed LIVE-VERIFIED, not just deployed.

**Next action:** F066 is the standing top priority until resolved.

**A+ here means:** every safety mechanism proven to fire under the exact condition it's built for,
phone and Watch agree on every displayed fact, and a completed run always appears without
requiring a relaunch — all proven on-device, not from source alone.

---

## 8. Post-run learning

**Grade: C-**

**Why:** The recap screen currently states more confidence than the underlying check supports
(F049/the HR row), and a deliberate self-test (cutting a stride recovery short) revealed the app
records the signal correctly and never surfaces it either way (F048) — not judged wrong, just
silent, which is its own kind of failure for a "post-run learning" surface. The coach-voice fix for
one contradiction (F064) is deployed but currently invisible on David's actual screen due to a
sibling gate.

**Evidence:** F048, F049, F064 (register).

**Blocks next grade:** F048's two wiring gaps fixed (spec field name, GPS-route code path); F049's
fix landed; F064's gate resolved one way or the other.

**Next action:** F048 and F049 are both well-scoped and ready to dispatch once the current top
priorities (F066, F056) clear.

**A+ here means:** the recap accurately reflects everything the app actually knows about a run —
including a deliberate compliance test read correctly — with no sentence claiming more certainty
than its underlying data supports.

---

## 9. Race and season coaching

**Grade: B-**

**Why:** Real, substantial doctrine landed tonight (race tiering, season philosophy) and
immediately resolved a live ambiguity (Dodgers) with a clear, applied decision. Post-race copy
truthfulness is half-fixed (5 of 9 sentences confirmed correct and live-bound, 4 more scoped but
not started). The underlying race-authority/evidence-value machinery (curated result vs. training
fallback) is doctrine-registry-verified and solid.

**Evidence:** `RACE_TIERING_AND_SEASON_PHILOSOPHY.md`; Dodgers decision (settled); F057.

**Blocks next grade:** F057's remaining 4 sentences; a first real test of the new race-tiering
doctrine against a future race decision beyond Dodgers.

**Next action:** apply the new doctrine explicitly next time a race-priority question comes up,
to prove it's a working standard, not just a document.

**A+ here means:** every race automatically gets a real, stated job; post-race copy is 100% honest;
and priority never substitutes for actual evidence quality — proven across at least two real races
under the new doctrine.

---

## 10. Health, readiness, recovery

**Grade: D+**

**Why:** The real vision for this area is now well-written (`HEALTH_SECTION_VISION.md`) — but it's
explicitly not built, deliberately deferred behind higher priorities. What exists today (the
readiness composite score) is being actively removed tonight specifically *because* it's decorative
— it computes a number that hasn't affected any decision in months. There is currently no built
surface doing what this area is meant to do.

**Evidence:** `HEALTH_SECTION_VISION.md`; IPR-20260914-001/finding 001 (readiness score, confirmed
inert, removal in progress).

**Blocks next grade:** this area cannot meaningfully improve without becoming an active, scoped
build — that's a deliberate, correct sequencing choice tonight, not a failure, but the grade has to
reflect what's actually built, not what's planned.

**Next action:** none right now — correctly waiting behind current priorities per the roadmap.
Revisit sequencing once Priority 0-2 areas (this gradecard's C-and-below areas above) are stronger.

**A+ here means:** the vision document's own acceptance criteria — the coach reads sleep/HRV/RHR/
weight/load and produces genuine cross-signal insight, distinguishes noise from pattern, and
sometimes correctly says nothing needs to change — all proven on real data.

---

## 11. Reliability and data integrity

**Grade: B-**

**Why:** Real, concrete improvement tonight: the deploy pipeline was found silently broken for
~18 hours (found by direct verification, not luck-adjacent — well, it *was* luck this time, which
is exactly why a standing automated check now exists), fixed, and a repeatable `check-deploy-
status.sh` now answers "is main actually live" on demand. The submission-validator was hardened
after real packaging failures. But a real incident happened (the outage itself), and a same-day
run-record collision (F072) is a live data-integrity gap on the phone specifically.

**Evidence:** F052 (deploy incident, resolved); `check-deploy-status.sh` (built, falsified);
F072.

**Blocks next grade:** the standing deploy check running unattended for a real stretch without
another silent gap; F072 fixed.

**Next action:** F072 — small, well-scoped, proven pattern already exists on the Watch to copy.

**A+ here means:** no silent gaps between "pushed" and "actually reflected on the real app,"
proven by the standing check catching a real problem before anyone has to notice by hand again.
**Added 2026-09-15, Rule 26 (CLAUDE.md):** also no silent gaps between "the app already has this
data locally" and "the app tells the runner it can't reach it" — F147's stuck offline flag and
F056's stale-until-relaunch bug are this same class of gap, one level down the stack from the
deploy-pipeline gap this section already tracks.

---

## 12. Runner control

**Grade: C+**

**Why:** Real, positive standing doctrine exists and holds (coach projects, never renegotiates a
stated goal; a runner-initiated short recovery is allowed, never flagged as non-compliant). Real,
current gap: after a run completes, there's currently no guard against accidentally starting it
again, and no clear, deliberate path for a genuine second run — a real flow gap identified and
specified tonight (F073), not yet implemented.

**Evidence:** F073 (flow spec delivered, approved, not yet built); the no-forced-goal-changes
standing rule (holding, no violations found tonight).

**Blocks next grade:** F073 implemented on both phone and Watch.

**Next action:** F073 build, alongside F072's data-safety fix.

**A+ here means:** the runner is never surprised by an unrequested change to their plan, workout, or
goal, and every deliberate override (a genuine second run, a stated goal change) has one clear,
findable path — proven by real device use, not just a spec.

---

## 13. Onboarding

**Grade: D**

**Why:** A real, significant gap found tonight on the app's actual front door: a new runner's real
recent race time and known effort pace are collected, shown back to them, then discarded before
the plan is ever generated — along with a deliberately-unread experience-level field. A runner with
real evidence and a complete beginner currently get materially the same plan-generation inputs.
This is a genuine "collected but discarded" pattern this codebase has repeated in several other
areas tonight, now confirmed here too.

**Evidence:** F074/IPR-20260914-005 (source-traced, confirmed via direct code read).

**Blocks next grade:** a real product decision (which of the discarded/unread fields should
actually feed the plan) — genuinely needs David's call, not something to dispatch blindly.

**Next action:** on the hub's "Needs From You" — waiting on David's return.

**A+ here means:** every real piece of evidence a new runner provides materially shapes their first
plan, proven by two onboarding archetypes (a proven racer, a true beginner) producing genuinely
different first plans.

---

## 14. Release quality

**Grade: B**

**Why:** The review pipeline recovered from a genuinely bad start (0 of 8 confirmed) into something
that now catches real defects (including catching a mischaracterized test failure, and catching the
programme lead's own verification error tonight) rather than rubber-stamping. Submission packaging
was hardened after real failures. Real counter-evidence: the ~18-hour silent deploy outage happened
under this same process, and a merge-authority boundary had to be corrected mid-session after being
read too permissively for several real merges.

**Evidence:** RR pipeline history (register); F052; the merge-authority correction (this session).

**Blocks next grade:** a full session running the corrected authority boundary and the standing
deploy check without a new process gap surfacing.

**Next action:** none specific — this grade moves with sustained clean operation, not a single fix.

**A+ here means:** every release is independently verified, every production-affecting action has
explicit authorization on record, and "deployed" is never asserted without a fresh, direct check —
sustained over real time, not just tonight.

---

## Change history

- **2026-09-14, initial version.** All 14 grades assigned from tonight's actual evidence (the full
  findings register through F075, the independent product review's first reports, the run debrief).
  No prior baseline to compare against — this is the reference point going forward.
