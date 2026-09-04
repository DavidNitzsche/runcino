# Core-product closure — TASKS

Branch `core/closure-2026-09-04`, worktree `/private/tmp/core-closure-0904`,
based on `origin/main` @ `72f2f84c`.

Status vocabulary is deliberately separated (the brief requires it):
**implemented** / **merged** / **deployed** / **shipped** / **physically verified**.

---

## Closed this session

| Id | Stage | What | State |
|---|---|---|---|
| FORMATLINT-1 | 1, 6 | `spec-card.ts` whole-mile label dedup pinned to one spelling; the only thing keeping `test-full` red on main for three consecutive commits | merged `5104342f`, deployed |
| SEALDATE-1 | 2 | 4th date-coincidence-as-completion path (`app/api/plan/undo`), under a comment falsely claiming resolver parity | merged `5104342f`, deployed |
| EXECID-SCAN-1 | 2 | New SQL scanner: a surface that stops calling the canonical resolver now fails loudly. Falsified both directions | merged `5104342f`, deployed |
| NATIVE-MEASURED | 1 | Native + Watch suites measured for the first time (no CI covers either) | implemented (measurement) |
| RACENUM-1 | 7 | Cross-surface gate could not pass anywhere credentials exist; corrected to be evidence-aware | implemented |
| SNAPSHOTQUANTITY-1 | 7 | Daily projection snapshot removed from an identity contract it can never satisfy; replaced with a real Rule 23 freshness check | implemented |
| SEP13-RACE | 7 | Investigated: **the premise was false, nothing is missing** | closed, no change |
| LIVEDATES-1 | 8 | Two live audits pinned to hard-coded calendar dates against a plan the runner legitimately moves | implemented |
| LEXICONWORD-1 | 8 | Coach lexicon matched substrings: "Asics **Superb**last 3" reported as hype | implemented |

### Detail worth carrying

**FORMATLINT-1 / the whole-mile dedup.** The brief called this a known live
defect. Measured: it is **latent, not live**. Probed 6 / 6.5 / 15 / 15.5 / 20 /
3 mi through the real card builder — every case dedups correctly — and a
read-only query across all seven active plans found **zero** segment labels
beginning with a distance. It works only because `expand-spec.ts` and
`spec-card.ts` independently chose the same `toFixed(1)` spelling. Nothing
holds them together, and canonical `miNum` renders a whole mile without the
`.0`, so the first producer to migrate breaks whole-mile labels while
fractional ones keep working. Fixed by widening the comparison and taking the
ROUNDING from `roundTo`. The producer was deliberately **not** migrated:
phase labels are persisted with executed phases (`"5.0 mi easy"` sits on real
runs) and matched by string in post-run interpretation, stride detection and
marathon-pace detection — re-spelling them would rewrite history.

**SEP13-RACE.** `santa-monica-10k-2026-09-13` exists, priority B, 7:00 AM
start, GPX-derived course profile, full logistics. No goal time, correctly —
`race_execution` reads `feasibility: "no_goal"` and races it off current
evidence (target 43:00, likely 42:07–43:51). Nothing to insert. **The brief's
premise is contradicted by production.**

**RACENUM-1, and why the bound was not widened.** The failure was real:
`race_execution.expected_race_day_sec` stamped 12033, live 12025. The cause is
concrete — the nightly cron stamped at 05:13, the owner's 15.51 mi long run
landed at 08:20, and those 8 seconds *are* that run. Day-over-day the same
quantity moves 50s and 134s, so a 5s bound sits far below the natural quantum
of change and the gate fails on any day the runner runs. Widening it would be
Rule 18's own failure mode. Instead the comparison is told what has landed
since the stamp: nothing new → the 5s bound holds exactly as F4 left it;
evidence since → the divergence is explained and **freshness** is asserted
instead. A failed evidence read falls through to strict (Rule 11). This closes
the file's own declared hole 6, "It cannot prove a job RAN".

---

## Open, in priority order

| # | Stage | Item | Blocker |
|---|---|---|---|
| 1 | 3 | Evidence-validity states; correct the partial-vs-miss regression invariant | — |
| 2 | 5 | Adaptation proof: replay, boundary, shadow, promote/hold verdict | — |
| 3 | 4 | Baseline marathon-plan audit, week by week, against the live block | — |
| 4 | 6 | Treadmill / pre-run / post-run reconciliation + physical test script | — |
| 5 | 7 | Remaining race-number inventory (one name, one owner, one meaning) | — |
| 6 | 8 | Remaining coaching-voice closure outside Today | — |
| 7 | 9 | Today integration | **their handback** |
| 8 | 10 | Integrated ship with a commit↔build mapping true by construction | after 1–7 |

---

## Findings raised, not owned by this session

**TFCLAIM-1 · TestFlight 272's recorded contents are wrong.** The ship script
reserves the build number first and commits the counter only after upload, so a
ship commit always post-dates its upload — by 26–48 min for 269/270/271. Build
272 uploaded 2026-09-03 23:57:40; HEROPANEL-1 (`57ec2840`), which its commit
message credits, was authored **5h38m later**. Either 272 was built from
uncommitted working-tree code or the message is false. Today-lane; flagged, not
touched.

**NOCI-NATIVE · no workflow runs the native or Watch suites.** `grep -l
'xcodebuild\|swift' .github/workflows/*.yml` returns nothing. Both are green
today (346 and 223 tests), measured by hand in this session — but nothing would
have said otherwise. Note the trap that cost a false alarm here: built
unsigned, four `SignInFlowTests` fail on Keychain unavailability; they are an
artefact of the build, not a defect.

**VACUOUS-AUDITS · the live audit tests cannot fail where they run.** The 16
`*.audit.test.ts` files are `describe.skipIf(!DATABASE_URL_RO)`, and neither CI
nor Railway has that credential. Three of them were failing against production
all day while `test-full` and Railway reported green — including
`_cross_surface_contract.test.ts`, which is the Rule 16 enforcement for every
race number. A gate that cannot fail anywhere it runs is Rule 18's central
case. Recommendation in HANDBACK.

**MOVE-A-RUN · not built.** The owner moved his week by hand in the backend on
2026-09-03, around travel, because the in-app feature does not exist. Explicit
runner-requested rescheduling is in-scope doctrine; the surface is not built.
Recorded as a product gap, not a defect.
