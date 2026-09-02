# faff.run · coaching-system handback for external review
### 2026-09-02 · `main` at `c6841508`, deployed

---

## 0 · For a reader who was not here

faff.run is a marathon-training app for one serious runner, its owner. This
document reports one continuous working session: a five-stage programme to
finish its coaching engine, the owner's rejection of that programme as
incomplete, and the ordered closure pass that followed.

**It is deliberately unflattering.** Every number that was wrong is stated with
its magnitude. Every claim that could not be verified says so. Five corrections
to my own earlier statements are kept in rather than edited out, including one
process failure that put test data into the owner's production account.

Read section 2 first. If you read nothing else, read section 9.

The detailed chronological record is `CONSOLIDATED-HANDBACK.md` beside this
file; the per-workstream reports are its other siblings.

---

## 1 · What was done, in one paragraph

Eighty-four commits to `main`, all deployed. Five directive stages: locking the
coaching brain, plan-generation contracts, a coaching-explanation contract, the
post-run experience, and a cross-surface contract suite. Then, after the owner
rejected the result as complete, a six-workstream closure pass covering the
post-run breakdown, watch capture, cross-surface disagreements, safety
ownership, plan-engine decisions, and a rebuild-anchoring fix still in progress.
Final state: 450 test files, **8,751 tests passing**, 19 build gates green, and
every commit confirmed as a successful deployment rather than a successful push.

---

## 2 · Verdict

**The half of the coaching brain that PRICES training is sound and verified on
the runner's screen. The halves that decide whether training is SAFE and whether
it should CHANGE were not owned by anyone at the start of this session; safety
now has an owner, adaptation still does not.**

An earlier version of this handback opened "all five stages are complete." That
was wrong and the owner rejected it, correctly — it was contradicted by the same
document's later sections. Executing five directive stages and completing the
programme are different claims.

Stated in four honest categories:

**Completed, deployed, and verified on live data or on the screen**
The six-anchor pace spine, agreeing across engine, plan, watch and stamp. The
durability model. Heat. The workout catalogue. The plan-mutation boundary. Goal
immutability, proven in four months of production data. A canonical safety
verdict. One post-run interpretation across three routes. The coaching thesis,
rendered.

**Corrected in code, NOT yet in the runner's live data**
Session structures, HR targets, and race abort rules. Authoring-time work does
not reach an already-authored block. Section 6.

**Shadow-only and deliberately unvalidated**
Upward pace adaptation. Six production cycles, agreeing with the live engine
zero times. That is simultaneously evidence the path can reason and the reason
it has not earned authority.

**Not owned, not verified, or still broken**
Adaptation has no single owner: three legacy paths mutate training while the
claimed owner is shadow-only, and nothing asserts the legacy paths stop when it
is promoted. `generate.ts` remains substantially a monolith. The watch's
compiled grading is now tested through `xcodebuild` but the boundary between
that and the shipping binary is stated rather than closed. And the rebuild that
would carry the structural fixes to the runner cannot yet preserve his block's
start date — section 6.

---

## 3 · What was found

Each of these was live, each has a magnitude, each is fixed unless stated.

| Finding | Magnitude |
|---|---|
| Race screen prescribed the runner's GOAL pace while the same screen refused that goal in prose | **31 s/mi · ~13 min over a marathon** |
| A goal-derived pace ladder priced training paces off the typed goal | **60 s/mi at the marathon** |
| Two routes wrote that goal-derived pace into stored workout specs | Persisted, not cosmetic |
| Post-run screen composed the runner's session from a SIMULATOR's payload | Every number on the screen |
| Server graded ceilings at a fallback while the wrist used the phase's own tolerance | **10–12 s/mi**, every easy and long day |
| Threshold rows shipped a work target of 168 bpm beside their own pass line of 164 | Contradiction on the wrist |
| Two records of the prescribed race target, plus a third in the abort rule | **180 s**, and **29 s/mi** |
| Three values for downhill giveback, including a full symmetric refund | 40 s on the goal race |
| Watch capture stopped recording at the last prescribed phase | **0.43 mi / 4:52** of a real run |
| `beliefTension` had never fired for any runner, ever | A screen claiming evidence it never had |
| The pain veto had never fired for any runner, ever | Query filtered on a value the column never holds |
| `loadRunDetail` resolved absorbed run ids to the discarded half | 118 of 274 rows are merge losers |
| A clock that prints `6:60` | Rounded seconds after splitting them |

**The recurring shape** is worth more than any single row: the code read
correctly, the tests passed, and the defect lived in what the code was asked
rather than in whether it did it. Nine of the thirteen were found by measuring
production rather than by reading source.

---

## 4 · The owner's decisions, and how each was implemented

He issued eight rulings. Seven are implemented; the eighth is section 6.

1. **Downhill giveback** — one owner at 0.50, conservative pending better
   evidence. Three values collapsed to one. The doctrine claim now parses the
   source's own Minetti table at run time, which gives 0.50–0.60 and
   contradicts the same document's prose.
2. **A failed safety read must never become "not injured"** — implemented as a
   TYPE. The UNKNOWN branch carries no `state` field, so reading it is a compile
   error until the caller branches; the one field readable without branching has
   `WITHHOLD_PENDING_CHECK` as its unknown value.
3. **A typed goal must not increase training volume** — the goal is removed from
   the parameter tuple with a compile-time assertion making its return a `tsc`
   error. Across 8,900 matrix cells: 1,395 moved down, **zero moved up**.
4. **One primary stressor per day, binding** — and the old test was the wrong
   test. It compared long-run MILES where the engine sizes the long as a share
   of the week, so binding it as written would have refused every ramping week.
   It now binds on the share: 8,781 plans, 91,199 transitions, zero findings.
5. **Watch compatibility** — telemetry shows one user with any watch run in 120
   days and nothing identifies a build, so the uncertainty is documented and the
   safer behaviour chosen: STOP suppresses the runnable workout.
6. **A robust sustained-volume estimator** — the third-highest fully
   representative week, bound to the engine's existing sustained-rank constant.
   33.7 → 39.5 mi/wk, sitting 1.5 mi above the runner's own median where the
   mean sat below it. Nothing fitted to the 43.5 figure, as instructed.
7. **The truncated run** — preserved with provenance, not overwritten. The
   capture defect is fixed; reverting the fix reproduces the stored row to the
   digit.
8. **The live rebuild** — authorised conditionally. Not done. Section 6.

---

## 5 · What is verified, and how

**Rendered on the device, against live data:** the prescription screen showing a
canonical easy ceiling of 8:22/mi and an HR ceiling of 151 derived from the
re-anchored threshold; the block screen showing the coaching thesis; the races
screen showing a projection that matches what an independent audit read from a
different code path entirely.

**Verified against production reads:** the six pace anchors agreeing across the
engine, the plan's stamp, the watch payload and the phone; the safety verdict;
the sustained-volume estimator; the race pace plan before and after.

**A cross-surface contract suite** resolves each quantity the runner can see on
more than one surface through every live path and asserts they are one number.
**19 contracts, 218 live production readings, zero fixtures.** It found six
disagreements rather than passing clean, which is the correct outcome for a
first run over a system this size.

**Falsification is the standard throughout.** Every gate added this session was
broken on purpose, in both directions, with the failing output recorded. One
falsification found a real gap in its own gate. Another — the most useful —
happened by accident when a contract read the wrong column and reported six
different numbers across 67 paths, catching its author's own scoping mistake.

**What is NOT verified:** the watch's shipping binary, as distinct from the code
`xcodebuild` exercises. The race-detail screen's pixels. Anything on a device
after the closure pass, which is server-verified only.

---

## 6 · The open decision: the rebuild

The structural fixes — session shapes, warm-up ratios, ladder rungs, placement
rules — exist in the generator and not in the runner's plan, because authoring
work does not reach an already-authored block.

A rebuild would carry them. It currently cannot preserve his block's start date:
`startAnchor` defaults to Monday of the current week and `startDateISO` is
clamped to `≥ today`. His block runs 2026-08-24 → 2026-12-06; a rebuild today
produces 14 weeks from 08-31, dropping a week that contains real completed
sessions and re-phasing the volume curve.

**That re-phasing was initially mistaken for a volume cut**, and the correction
matters for anyone assessing this work. Composing on the pre-closure commit and
on the current one produces a **byte-identical** weekly volume array. The
apparent reduction — peak week 61.0 → 57.5, peak long 21.5 → 20.0 — is entirely
the shorter, re-anchored block. No engine change touched it.

The clamp exists for onboarding, where scheduling runs before a runner joined
would be absurd. A mid-block rebuild is the opposite case. **Making the rebuild
honour the active block's own start is the correct fix and is in progress.**

---

## 7 · Process failures, and corrections to my own work

Recorded prominently because a review of engineering judgement should be able to
see where it failed.

**An agent wrote test data into the owner's production account.** A live watch
simulator session, testing the crash-recovery path, completed two workouts that
posted through the normal ingest route. His log read 6.95 miles across 3 runs
for a day he ran 6.41 across one. The instruction "production is read-only"
governs DATABASE access; a simulator session writes through the app's own
endpoint and never touches a connection string, so the rule was satisfied to the
letter and violated in substance. The instruction was mine and it was
insufficient. Blast radius was measured, not assumed: two rows, no other account
affected. They were removed only after the owner's explicit approval.

**Five corrections to my own statements:**

1. I claimed the programme complete when my own evidence said otherwise.
2. I told the owner his run data was complete when 0.43 mi was missing.
3. I claimed a render verified a fix when the app had not fetched for eleven
   hours and was painting a cache.
4. I diagnosed a 20 s/mi watch-versus-phone gap that did not exist; the agent
   that checked found the real defect one layer down.
5. I recommended against a rebuild on reasoning the owner correctly rejected.

**And one correction I checked and rejected**, because the discipline runs both
ways: an agent reported that two anomalous training weeks fell inside a race
window and were therefore already excluded. They do not, and the original
analysis stood.

---

## 8 · What remains open

- **Adaptation has no single owner.** Three legacy paths mutate; the claimed
  owner is shadow-only; nothing asserts the legacy paths stop on promotion.
- **The rebuild cannot preserve a block's start date.** In progress.
- **Structural fixes have not reached the runner's plan.** Consequence of the
  above.
- **`generate.ts` is substantially a monolith.** One of eight layout splits done.
- **The watch's shipping binary is not directly tested**, only the code beneath it.
- **The post-run strides section needs an app release.** The server half deploys
  immediately; the section, the reconciliation line and the layout fix are Swift.
- **`/api/targets/projection`'s rename needs a Swift change**; until then that
  section hides rather than breaks.
- **184 injury-adjustment proposals, zero accepted, over nine days.** The
  safety-to-training arm has never executed.
- **Alerts are recorded and delivered to nobody** — no webhook is configured.
- **The watch test bundle drives real speech synthesis**, which disturbed the
  owner once already.

---

## 9 · The question the owner asked

> Can I now use the app for daily training without manually auditing its
> coaching numbers and workout interpretation?

**Not yet, and the honest answer has three parts.**

**The numbers you are prescribed are now trustworthy.** Pace anchors, HR
ceilings, race targets and the durability model are canonical, cross-checked
across every surface by a suite that reads production rather than fixtures, and
verified on the screen. The specific ways this app used to lie about pace — a
goal-derived ladder, a race plan for a refused goal, three answers for one
projection — are gone and gated.

**The interpretation of what you ran is nearly there.** One post-run
interpretation now serves every surface. The remaining gap is presentational and
needs an app release, not more engine work.

**What still requires your judgement rather than the app's:** anything the
adaptation engine would decide. It has no single owner, three legacy paths still
mutate training, and its upward half has never agreed with production. Until
that is closed, a change the app makes to your plan is worth reading rather than
trusting. That is one system, it is named, and it is the last one.

**And the standing caveat that outlives this session:** a fix in the generator is
not a fix in your plan. Until a rebuild lands, your stored block carries the
structures it was authored with in August.

---

## 10 · Where the evidence lives

| Document | Contents |
|---|---|
| `CONSOLIDATED-HANDBACK.md` | The full chronological record with reasoning at each step |
| `ownership-scorecard.md` | Eighteen coaching questions scored for competing owners |
| `closure-safety.md` | The canonical safety verdict |
| `closure-watch.md` | Capture truncation, stale-day state, Swift grading |
| `closure-cross-surface.md` | Projection naming, canonical runs, downhill, sustained volume |
| `closure-plan.md` | Goal-volume seal and the primary-stressor rule |
| `postrun-breakdown.md` | The post-run experience and the simulator-payload defect |
| `stage5-cross-surface.md` | The contract suite and its sixteen falsifications |
| `renders/` | Device screenshots, including the verified prescription screen |
| `evidence/` | Raw production snapshots |

---

## 11 · Accepted boundary, and what comes next

The owner reviewed this document and accepted its stated boundary verbatim: the
prescribed pace and HR system is trustworthy; structural plan improvements are
implemented but not in his live plan; post-run interpretation is nearly complete
and needs an app release; **adaptation is not yet trustworthy or canonically
owned**; the app is not yet at "just works."

**In progress:** the rebuild-anchoring fix, then an exact dry-run preview of his
rebuilt plan against eleven stated proofs and a fifteen-week before/after diff.
No live write until that preview is reviewed.

**Required next, and not yet built — a hard mutation barrier.** He has ruled the
production simulator write a serious process failure and specified the remedy
technically rather than procedurally: production-derived verification must be
genuinely read-only; simulator and automated test clients must be structurally
unable to post activities, complete workouts, or mutate his account; environment
labelling and connection-string policy are explicitly insufficient; and a test
must prove production writes are refused during verification.

That is the correct diagnosis. The instruction that failed was a convention, and
a convention that can be satisfied to the letter while being violated in
substance is not a control.

**The final coaching-brain programme, defined and not started: adaptation
consolidation.** One canonical Adaptation Engine; the three legacy
training-mutation paths inventoried and removed; every proposed change flowing
through the canonical owner carrying evidence, confidence, magnitude limits,
safety state and explicit reasons; refusal preserved as a legitimate outcome;
upward pace adaptation shadow-only until predetermined promotion criteria are
met; proof that shadow evaluation cannot mutate live training; a gate proving
legacy writers cannot continue once canonical authority is enabled; validation
against his real training history; before/after plan diffs for every proposed
mutation; and one adaptation decision explained identically by phone, watch,
plan, post-run interpretation and race outlook.

**That is the last system on the list in section 9.** When it closes, the answer
to his question changes.
