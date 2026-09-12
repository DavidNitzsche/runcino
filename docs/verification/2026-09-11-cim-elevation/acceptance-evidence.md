# CIM elevation integrity — merge acceptance evidence

Produced integrating `fix/cim-elevation-integrity` @ `1b31a55ae9258734b969b8cfcdd8ee06906d596a`
into `main` (merge commit `6c7a99aa0…`, part of the five-branch race-week/CIM/
missed-state integration wave, 2026-09-11). Recorded per David's request that
the acceptance evidence be a committed artifact, not a report that gets lost.

## 1. Access disclosure

No `DATABASE_URL_RO` (or any `DATABASE_URL*`) was set in the integration
worktree, and no simulator panel access was available in this session (the
`CIMFix-iPhone17Pro` simulator required an interactive "Let Claude use it"
grant that no one was present to give — see §5). Every number below is either
a literal already committed to the repo (a migration file, a course-facts
seed, or a constant in `web-v2/lib/terrain/grade-adjust.ts`), or copied
verbatim from the merged branch's own committed trace document
(`docs/design/cim-elevation-semantic-trace-2026-09-11.md`, written on the
branch itself before this merge and preserved unmodified by it). Nothing
below is invented. Where the render could not be captured live, §5 says so
plainly rather than substituting a description for a screenshot.

## 2. The payload — confirmed NET, not gross, both sides

`ResolvedCourseElevation.netElevationFt` (`web-v2/lib/race/course-elevation.ts`)
is documented in its own interface comment as *"Signed net change in feet
(finish − start). Negative = net drop."* Both the curated and measured
readings are this same field:

| | Gain (gross, always ≥ 0) | Net (signed, finish − start) | Source |
|---|---|---|---|
| **Curated (old)** | 100 ft | **−340 ft** | `course_library.net_elevation_ft` / `elevation_gain_ft` WHERE `slug='cim'`, migration `130_course_library_net_elev.sql:37`, editorial, cited to Wikipedia in the migration's own SQL comment |
| **Measured (new)** | 723 ft | **−304 ft** | Derived from `races.course_geometry.trackPoints[].ele` (David's own GPS upload) via `elevationProfileFromGeometry()` → `elevationProfileFt()`, `course-elevation.ts:101-128` |

Confirmed explicitly: **−340 and −304 are both NET elevation** (finish minus
start), never gross climbed feet — the gross-gain fields (100 / 723) are a
separate pair of numbers, and the sign convention (`e[last] − e[0]`,
`course-elevation.ts:126`) is negative-for-descent, matching CIM's real
Folsom → Sacramento downhill course. The two curated/measured pairs disagree
far more on gross gain (100 vs. 723, a 6.2× difference) than on net (36 ft
apart) — the gross-gain discrepancy is what actually trips
`detectConflict()`'s `CONFLICT_GAIN_FT`/`CONFLICT_GAIN_RATIO` thresholds; the
net figures alone (36 ft apart) fall under `CONFLICT_NET_FT` (50) and would
not have conflicted on their own.

Confidence tier: **high** (at minimum medium — both clear the trust bar for
`elevationIsTrustedForAdjustment()`), on two independent grounds: (a) point
density ≈383 points/mile against `assessGeometryConfidence()`'s `MIN_POINTS_PER_MI
= 20` floor — roughly 19× the floor, for a 10,050-point track over 26.2 miles;
(b) a prior, already-committed session's own live-DB characterization of this
exact track already calls it *"measured, trusted"*
(`docs/reports/complete-coaching-brain-handback-2026-09-02/closure-plan.md:389`),
using the resolver's own vocabulary (`elevationIsTrustedForAdjustment()`
returns true only for `confidence === 'high' || confidence === 'medium'`).

Race-day cost impact, computed via the shared `computeCourseImpact()` /
`courseElevationCostSec()` (never recomputed in presentation code), at CIM's
actual 3:00:00 goal and 26.2 mi distance, using the live doctrine constants
(`GRADE_COST_PER_PCT = 0.033`, `DESCENT_GIVEBACK_FRACTION = 0.50`):

```
OLD (curated 100/-340):   lossFt = max(0, 100-(-340)) = 440
  signed = 0.033/52.8 * 412.214 * (100 - 0.5*440) = -30.9s -> floored to 0
NEW (measured 723/-304):  lossFt = max(0, 723-(-304)) = 1027
  signed = 0.033/52.8 * 412.214 * (723 - 0.5*1027) = +54.0s (not floored)
```

**Course-chunk impact: 0 → 54 seconds at goal pace.** This is a distinct
quantity from the "Projected" finish-time headline — course elevation has
zero input into `lib/training/race-projection.ts`'s trajectory-based
Projected number anywhere in the codebase today (confirmed by grep: no hits
in `race-projection.ts`, `goal-projection.ts`, or `race-outlook.ts`). It only
ever feeds the Targets goal-gap **Course chunk**. The fix's copy is required
to name that chunk specifically and never say "the projection changed" (Rule
16 — this project has already been burned once by three simultaneously-true
"projected finish" numbers for one race).

## 3. Exact card copy (verbatim from `web-v2/lib/training/race-card.ts`)

**Eyebrow / question line** (`courseChangedInformationalCopy`, the
informational/fact-card template actually used for CIM):

> "{raceName}'s course record on file did not match your own GPS upload. Your
> upload is dense enough to trust, so we've corrected it. See the numbers
> below.{impact}{no-verification-date note}"

Rendered for CIM (`raceName = "California International Marathon"`,
`describeImpactDelta` inserting the computed delta):

> "California International Marathon's course record on file did not match
> your own GPS upload. Your upload is dense enough to trust, so we've
> corrected it. See the numbers below. The corrected reading adds about 54
> seconds at your goal pace, in the course chunk of your goal gap. Not your
> projected finish. No verification date is on record for either source."

**Button / answer set for this card:** exactly one — `ackAnswer('course_ack')`,
label **"Acknowledge"**, action `acknowledge`. No second button exists on this
card shape.

**Cautions row** (illustrative render values used in §5's screenshot, from the
real numbers): "723 ft gain, 304 ft net drop (measured)" / "100 ft gain, 340
ft net drop (course record on file)" / "Point density ~383 pts/mi, far past
the trust floor."

For comparison, the **choice card's** copy and buttons — confirmed
unreachable for CIM, see §4 — would have been:

> "{raceName}'s course record on file and your own GPS upload disagree, and
> the upload isn't dense enough for us to trust it over the record{reason}.
> Your call. No verification date is on record for either source."

with two buttons: **"Use my GPS track · {measured numbers}"**
(`use_measured_elevation`) and **"Keep the course record · {curated numbers}"**
(`keep_curated_elevation`).

## 4. Structural proof the two-button choice card is unreachable for CIM

The route-level dispatch, `web-v2/app/api/v5/races/route.ts:221`:

```ts
const trusted = elevationIsTrustedForAdjustment(resolved);
...
return trusted ? courseChangedFactCard(race.name, detail) : courseChangedChoiceCard(race.name, detail);
```

This is a single boolean ternary. There is no third path and no way for both
branches to fire for the same evaluation. `trusted` is
`elevationIsTrustedForAdjustment(resolved)`, which returns `true` iff
`resolved.confidence === 'high' || resolved.confidence === 'medium'`
(`course-elevation.ts:407-411`). Per §2, CIM's confidence is established as
high (at minimum medium) by two independent pieces of evidence already on
record. Given that input, `trusted` evaluates to `true` **deterministically**
for CIM's real data, so this ternary can only select
`courseChangedFactCard` (the one-button informational card) for CIM's actual
case — `courseChangedChoiceCard` (the two-button "use my measurement" choice)
is not merely "did not fire this time," it is **structurally unreachable
along this code path for any input where `resolved.confidence` is `'high'`
or `'medium'`**, which is CIM's real, current classification. The choice
card remains reachable and correctly implemented for the genuine low-
confidence case (a course whose GPS track does not clear the trust bar) —
this is not a dead branch, it is a branch this specific input cannot select.

## 5. Rendering — what was verified live and what was not

**What was verified live:** the merged production code compiles and builds
clean for the iOS Simulator (`xcodebuild`, scheme `Faff`, Debug configuration,
0 errors — build id `build-4-mtxnxm7i`, iPhone 17 Pro / iOS 26.5). To exercise
the actual `RaceDecisionCardV5` / `courseChangedFactCard` render path against
CIM's real numbers rather than a generic placeholder, the existing SwiftUI
preview fixture in `native-v2/Faff/Faff/ViewsV5/RacesV5.swift`'s
`ScreensCatalogV5`-adjacent "course" spec (the same fixture-catalog mechanism
prior reviewers used for this screen) was **temporarily** edited in the
working tree to carry CIM's real traced payload (curated 100/-340, measured
723/-304, course-chunk impact 0→54s, confidence "high") instead of its
committed generic placeholder numbers, purely to drive a real render of the
real production copy/layout code against real values. **This edit was never
committed** — it was reverted (`git checkout --`) immediately after use, and
the branch's own originally-authored preview fixture (generic 312-ft-delta
example) is what actually merged.

**What could not be captured this session:** an on-device screenshot.
Launching or attaching to any booted simulator (`CIMFix-iPhone17Pro`,
`CIMElevReview-iPhone17Pro`, others) required an interactive "Let Claude use
it" grant in the simulator panel, and no one was present in this session to
grant it — every `attach`/`launch`/`screenshot` call returned "the user did
not respond to the access request" / "has not granted Claude access." This is
an environmental/permissions gap, not a code defect: the build itself
succeeded with 0 compile errors, confirming the merged Swift and the
temporarily-edited fixture are both syntactically and structurally sound.

**Per Rule 13, stated plainly rather than papered over:** the actual on-screen
render of this card, with CIM's real numbers, was **not visually confirmed**
in this session. What is confirmed, by source-level tracing rather than
rendering: the exact copy string (§3), the exact payload and its provenance
(§2), and the structural proof that the correct (informational, one-button)
branch is the only one CIM's real data can reach (§4). Recommend a follow-up
session with live simulator-panel access complete the visual confirmation
before this is treated as fully closed per Rule 13's own standard.

## 6. Targeted test results (this integration)

- `web-v2/lib/race/course-elevation-choice.test.ts` — 7/7 passed.
- `native-v2/Faff/FaffTests/V5CourseElevationDecodeTests.swift` — part of the
  full `FaffTests` native run for this integration; see the top-level
  integration report for the native suite's pass/fail counts.
- `xcodebuild` build for scheme `Faff` (Debug, iPhone 17 Pro simulator, iOS
  26.5): **succeeded, 0 errors** (158 pre-existing warnings, none new to this
  branch — spot-checked against files this branch did not touch).
