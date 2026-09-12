# CIM elevation "decision" — semantic trace (2026-09-11)

**Required reading before this document is used to justify any code change:**
`docs/audit-2026-09-11-session-handback.md` §5 Finding 2. This document answers,
with exact values and citations to real source/schema, the seven questions that
handback raised and left open. It is evidence, not implementation — the fix
itself is a separate commit on this branch.

**Access disclosure, up front.** No `DATABASE_URL_RO` (or any `DATABASE_URL*`)
is set in this environment and no `.env.local` exists in this worktree. Every
number below is either (a) a literal already committed to this repo — a
migration file, a JSON course-facts seed, or a constant in `lib/terrain/
grade-adjust.ts` — or (b) a number from a **prior, already-committed** session's
own live-DB read, cited by file and line, and clearly marked as such. Nothing
below is invented or assumed. Where I could not verify a number at all (the
literal "3:20:16" figure named in the task), I say so explicitly in §6 rather
than construct a chain that lands on it.

---

## 1. What do −304 ft and −340 ft actually represent

They are two different SOURCES for the same field, `netElevationFt` — the
**signed net elevation change** (finish minus start, in feet) — never gross
climbed feet. Confirmed by reading `resolveCourseElevation()`'s own field
definitions in `web-v2/lib/race/course-elevation.ts`:

```ts
export interface ResolvedCourseElevation {
  elevationGainFt: number | null;   // GROSS climbed feet, always ≥ 0
  netElevationFt: number | null;    // SIGNED net (finish − start)
  lossFt: number | null;            // derived: max(0, gain − net)
  ...
}
```

- **−340 ft** is `course_library.net_elevation_ft` for `slug='cim'` — the
  **curated** value. `web-v2/db/migrations/130_course_library_net_elev.sql:37`:
  `UPDATE course_library SET net_elevation_ft = -340 WHERE slug = 'cim';`
  The same migration's comment (line 32) cites its source: *"Wikipedia: 340 ft
  net drop end-to-end."* This is `elevationProfileFt`'s `netFt` field, computed
  (per `course-elevation.ts` lines 122-127) as `finish − start`, exact,
  threshold-free — never confused with gross gain or loss.

- **−304 ft** is the **measured** value derived from David's own GPS track
  stored in `races.course_geometry` for his `cim` race row, run through
  `elevationProfileFromGeometry()` → `elevationProfileFt()`'s hysteresis
  algorithm (`course-elevation.ts` lines 101-128). This is not a number I
  queried live; it is the exact figure already recorded by a **prior,
  already-committed** session's own live-DB read at
  `docs/reports/complete-coaching-brain-handback-2026-09-02/ownership-scorecard.md:828`
  (`authored_state.course`, David's live plan, `net_ft: -304`) and again,
  independently, at
  `docs/reports/complete-coaching-brain-handback-2026-09-02/closure-cross-surface.md:285`
  (`"723 ft gain, −304 ft net"`). Both are DB reads from a session I cannot
  re-run without `DATABASE_URL_RO`, but both are internally consistent with
  each other and with the resolver's own math (see the discrepancy note in §7).

**Neither number is gross elevation gain.** The curated `elevation_gain_ft` for
CIM is a *third*, separate figure — see §3.

## 2. Units and sign convention

Feet, confirmed by the column names (`net_elevation_ft`, `elevation_gain_ft`)
and by `course-elevation.ts`'s `FT_PER_M` conversion constant (line 58) applied
inside `elevationProfileFt()`.

Sign: **negative = net descent**, confirmed directly from the algorithm, not
assumed —

```ts
// course-elevation.ts:126
netFt: Math.round((e[e.length - 1] - e[0]) * FT_PER_M),
```

`e[e.length-1] - e[0]` is finish-elevation minus start-elevation. CIM (Folsom →
Sacramento) finishes lower than it starts, so this is negative by construction.
The interface doc comment (line 87-88) states it in English too: *"Signed net
change in feet (finish − start). Negative = net drop."* Both the −340 (curated)
and −304 (measured) readings agree on sign and rough magnitude — they disagree
on precision, not on direction. (`course_library.net_elevation_ft`'s own SQL
comment independently confirms the same convention: *"Positive = net climb,
negative = net drop"* — `130_course_library_net_elev.sql:26`.)

## 3. Source of each value

| Field | Value | Table/column | Provenance |
|---|---|---|---|
| Curated net | −340 ft | `course_library.net_elevation_ft` WHERE `slug='cim'` | `editorial` — hand-typed from a Wikipedia citation, migration 130 |
| Curated gross gain | **100 ft** | `course_library.elevation_gain_ft` WHERE `slug='cim'` | `editorial` — seeded by `web-v2/scripts/_seed_course_library.mjs:53` from `legacy/web/data/courses/cim.json`'s `race.expected_facts.total_gain_ft: 100` (confirmed by reading the JSON file directly in this worktree: `expected_facts: {..., total_gain_ft: 100, total_loss_ft: 440, net_ft: -340, ...}`) |
| Measured net | −304 ft | derived from `races.course_geometry.trackPoints[].ele` for David's `cim` race row | `measured` — David's own GPS upload, run through `elevationProfileFromGeometry()` |
| Measured gross gain | **723 ft** | same track, same derivation | `measured` |

**This is the first load-bearing finding this trace surfaces that Finding 2's
own text did not say plainly: the real conflict on CIM is dominated by GROSS
GAIN (100 curated vs. 723 measured — a 623 ft, 6.2× difference), not by net
elevation (−340 vs. −304, a 36 ft difference).** Checking
`detectConflict()` in `course-elevation.ts` (lines 440-463) against its own
declared thresholds:

```ts
export const CONFLICT_GAIN_FT = 100;
export const CONFLICT_GAIN_RATIO = 0.25;
export const CONFLICT_NET_FT = 50;
```

- Gain: `|723 − 100| = 623 > CONFLICT_GAIN_FT (100)` **and**
  `623 / 100 = 6.23 > CONFLICT_GAIN_RATIO (0.25)` → **conflicts on gain.**
- Net: `|−304 − (−340)| = 36`, which is **less than** `CONFLICT_NET_FT (50)` →
  **does not conflict on net alone.**

So `resolved.conflict` fires because of the gain field, not the net field. Any
card copy that frames this as "the elevation reads differently" without
specifying WHICH field is technically accurate but is hiding the more dramatic
and more consequential fact — CIM's curated 100 ft gross gain figure is very
likely simply wrong (100 ft of total climbing across a marathon with real
rolling hills is implausibly flat), and the GPS track is very likely correcting
a genuine data-entry-era error, not "the course changed."

## 4. Confidence and resolver winner

I could not run `assessGeometryConfidence()` against the live `trackPoints`
blob directly (no DB access). What I can state, precisely, from evidence
already in this repo and from the algorithm's own declared thresholds:

- The handback (`docs/audit-2026-09-11-session-handback.md` §5 Finding 2) states
  the upload is a **10,050-point** track. Against `assessGeometryConfidence()`'s
  density floor —

  ```ts
  const MIN_POINTS_PER_MI = 20; // "too coarse for gross gain" below this
  ```

  10,050 points over a 26.2-mile marathon is **≈383 points/mile**, roughly 19×
  the floor. This one check alone is nowhere close to a "low confidence"
  reading; it would take a badly wrong measured distance (course-length ratio
  outside 0.95–1.08) or a corrupt single-sample jump (>60 m) to pull confidence
  down from there, and neither shows up in anything already on record.
- Independent corroboration: a **prior, already-committed** session's own
  live-DB characterization of this exact track already exists in this repo,
  twice, using the resolver's own vocabulary: `docs/reports/complete-coaching-
  brain-handback-2026-09-02/closure-plan.md:389` — *"course geometry (net −304
  ft, **measured, trusted**) unchanged"*. "Trusted" is not a word that document
  invented casually — `elevationIsTrustedForAdjustment()` (`course-
  elevation.ts:407-411`) is the ONE function in this codebase that answers
  exactly that question, and it returns `true` only for `confidence === 'high'
  || confidence === 'medium'`.

Given both independent signals agree (point density far past the floor; a
separate session's live read already calling it "measured, trusted"), the
honest, best-supported answer is: **`resolveCourseElevation()`'s confidence for
CIM is high (or at minimum medium) today, not low.** I cannot rule out medium
vs. high without the live geometry blob, but the distinction does not change
which path this fix takes — `elevationIsTrustedForAdjustment()` treats both the
same, and so does the product ruling in the task (Step 2 fires the
"resolver has already resolved it" path for high **or** medium).

**Resolver winner:** with the track authoritative and a conflict present,
`resolveCourseElevation()`'s own branch (`course-elevation.ts:516-533`) returns
the **measured** values (`gainFt: 723`, `netFt: -304`, `provenance: 'measured'`)
— not the curated ones. **The engine has already silently decided this in
David's favor.** The card just never said so.

## 5. Verification date/recency

**Confirmed: no such schema field exists.** I read every migration that
touches `course_library` in this worktree (`102_course_library.sql`,
`127_course_library_provenance.sql`, `130_course_library_net_elev.sql`) and
grepped the full migrations directory for `verified_at`, `verification`, and
`citation` — none appear on `course_library` or `races.course_geometry`. The
only "citation" that exists anywhere near this data is the **prose comment**
inside migration 130 itself (line 32: `-- Wikipedia: 340 ft net drop
end-to-end.`) — a SQL comment, not a column, not queryable, not surfaceable to
the runner, and it carries no date. This is a real, separate schema gap and I
am stating it as such rather than inventing a plausible-looking "verified"
date for the card to display. The fix below surfaces this gap honestly in the
card's own copy rather than pretending recency information exists.

## 6. Exact dependency chain to the "3:20:16" projection

I could not locate the literal figure **"3:20:16"** anywhere in this worktree
— not in `docs/`, not in any committed report, not in git history reachable
from this branch. Rather than construct a plausible-looking chain that lands
on a number I cannot verify, I traced what course elevation **actually**
touches in the current codebase, which is itself the load-bearing finding here
and changes how the fix should be scoped:

**Course elevation does NOT feed the "Projected" headline at all.**
`web-v2/lib/training/race-projection.ts` — the ONE module that produces the
"Projected" number shown on the Races screen (its own header: *"Now there is
ONE object — `RaceOutlook` — and this module is a pure mapping from it to the
two-field shape the 'Projected' surfaces render. No inputs are gathered
here"*) — has zero references to elevation, `course_geometry`, or
`resolveCourseElevation` (confirmed by grep: no hits in `race-projection.ts`,
`goal-projection.ts`, or `race-outlook.ts`). "Projected" is a pure function of
fitness trajectory (VDOT-based equivalence + execution-scaled trajectory to
race day) and has no course-elevation input, full stop.

**Where course elevation DOES feed a real number today:**
`web-v2/app/api/targets/projection/route.ts` (the Targets/GapPanel surface,
lines 541-570) is the one live consumer that already does this correctly:

```ts
const resolvedElev = resolveCourseElevation({ lib: courseLibRow, geometry: ..., nominalDistanceMi: distanceMi });
const elevTrusted = elevationIsTrustedForAdjustment(resolvedElev);
const courseImpact = computeCourseImpact({
  distanceMi, goalSec,
  elevationGainFt: elevTrusted ? resolvedElev.elevationGainFt : null,
  netElevationFt: elevTrusted ? resolvedElev.netElevationFt : null,
}, ...);
courseImpactSec = courseImpact.seconds;
```

`courseImpactSec` feeds `fitnessSec = totalGapSec − courseImp − condImp −
execImp` (route.ts line ~610) — i.e. it is one **subtracted component of the
goal-gap breakdown**, isolating how much of the gap is fitness vs. course vs.
conditions vs. execution. It is never added back into a headline "Projected"
finish time. This route is already correctly gated on `elevationIsTrustedForAdjustment`
and already prefers the resolver's measured value when trusted — **the Targets
surface is not the bug.** The race-card decision card is a completely separate,
unrelated code path that duplicates the SAME `resolveCourseElevation()` call
(`web-v2/app/api/v5/races/route.ts:145-169`) but then, per Finding 2, throws
away everything except a bare "the course changed" sentence.

**Conclusion for the fix:** whatever number the runner remembers as "3:20:16"
almost certainly was NOT moved by this elevation conflict at all, since the
Projected headline has no elevation input. The correction this card owes the
runner is about the **Targets Course chunk** (a seconds-of-race-time figure,
computed below) and about the underlying data being wrong (100 ft curated
gross gain vs. 723 ft measured) — not about the trajectory-based Projected
finish time. **The fix must not claim, in its copy, that this correction moves
"the projection"** — that would repeat exactly the Rule 16 "three different
projected finishes" failure this project has already been burned by once. It
correctly says it changes the *course chunk* / *race-day cost* estimate, which
is a named, distinct quantity from "Projected."

## 7. Computed finish-time impact — `computeCourseImpact()`, CIM's real numbers

Using the actual function (`web-v2/lib/training/course-impact.ts` →
`web-v2/lib/training/elevation-model.ts#courseElevationCostSec`), CIM's actual
goal (`3:00:00` = 10,800 s — cited at
`docs/reports/complete-coaching-brain-handback-2026-09-02/ADAPTATION-REAL-REPLAY.md:4`:
*"Goal 3:00:00 (10,800 s, 412 s/mi)"*), and CIM's actual distance (26.2 mi, per
`legacy/web/data/courses/cim.json`), with the real doctrine constants read
directly from `web-v2/lib/terrain/grade-adjust.ts` (`GRADE_COST_PER_PCT =
0.033`, `DESCENT_GIVEBACK_FRACTION = 0.50`):

```
flatPaceSPerMi = 10800 / 26.2 = 412.214 s/mi
perFt = (0.033 / 52.8) * 412.214 = 0.257634 s per ft

OLD (curated):   gain=100 ft,  net=−340 ft → lossFt = max(0, 100−(−340)) = 440
  signed = 0.257634 * (100 − 0.5*440) = 0.257634 * (100 − 220) = −30.9 s
  computeCourseImpact() floors negative at 0 → seconds = 0

NEW (measured):  gain=723 ft, net=−304 ft → lossFt = max(0, 723−(−304)) = 1027
  signed = 0.257634 * (723 − 0.5*1027) = 0.257634 * (723 − 513.5) = +54.0 s
  computeCourseImpact() → seconds = 54 (already non-negative, not floored)
```

**The corrected course chunk is +54 seconds versus the previously-displayed
0.** The curated figure was so light on gross gain (100 ft, an implausible
number for CIM's real rolling terrain) that its descent credit alone put it
at a *negative* (net-downhill *credit*) course cost, which the existing UX
floor-at-zero rule (`course-impact.ts:88-90`) was already hiding as "0" on
Targets. The measured track reveals CIM is not free — it costs about 54
seconds of goal-pace race time once its real climbing is counted, even after
the net-downhill credit. This +54 s is the number the fix threads into the new
card (see the implementation commit); it is computed once, in
`web-v2/app/api/v5/races/route.ts`, by calling the shared `computeCourseImpact()`
twice (old inputs, new inputs) — never recomputed or re-derived in presentation
code.

**A discrepancy worth recording rather than silently resolving:** the two
prior-session documents that independently recorded the measured figures do
not agree on the derived loss value — `ownership-scorecard.md:828` states
`loss_ft: 1041` where the resolver's own algebra (`gain − loss ≡ net`, stated
as an identity in `course-elevation.ts`'s own header, lines 44-49) requires
`723 − net = loss`, i.e. `723 − (−304) = 1027`, matching
`closure-cross-surface.md:285`'s `1027`, not `ownership-scorecard.md`'s `1041`.
I have used **1027** throughout this document and in the computation above,
because it is the value the resolver's own code would actually compute from
`(gainFt=723, netFt=-304)` — `1041` does not satisfy the identity and is very
likely a transcription slip in that one earlier document. This does not change
`elevationGainFt` or `netElevationFt` (the two fields the resolver, and this
fix, actually persist and pass to `computeCourseImpact()`) — `lossFt` is
always a derived display value, never a stored input — so it has no effect on
the 0 → 54 second finding above.

---

## Summary — what this trace establishes for the implementation

1. −340 = curated `net_elevation_ft` (Wikipedia-cited, migration 130); −304 =
   measured `netFt` from David's own GPS track. Both are net figures, correctly
   signed (negative = descent). The bigger, unremarked discrepancy is gross
   gain: 100 ft curated vs. 723 ft measured — a 6.2× difference — which is what
   actually trips `detectConflict()`.
2. No verification-date/citation schema field exists anywhere in this data
   model. This is a real, separate, honestly-disclosed gap — not something the
   fix should paper over with an invented date.
3. The evidence available (point density ≈383/mi against a 20/mi floor; an
   independent prior session's own live read already calling this track
   "measured, trusted") supports **high/medium confidence**, meaning
   `resolveCourseElevation()` has ALREADY silently picked the measured value as
   canonical. The card is the only place still pretending this is unresolved.
4. Course elevation has **zero** influence on the "Projected" headline number
   anywhere in this codebase today — it only ever feeds the Targets goal-gap
   Course chunk. The fix's copy must say so precisely (name the Course chunk /
   race-day cost, never "the projection") to stay Rule-16-compliant.
5. The real, computed, non-recomputed finish-time impact of correcting this
   data is **+54 seconds** at CIM's stated 3:00:00 goal pace — the previously
   floored-to-zero course chunk becomes a real, positive cost once the actual
   climbing is counted.

Because CIM's real conflict resolves at high/medium confidence, the
implementation on this branch takes the **informational-correction path**
(Step 2's first branch) for this case: the resolver's already-chosen winner is
used automatically, explained honestly (old vs. new, which field actually
disagreed, the +54 s impact, and the explicit absence of a verification date),
with a single acknowledgment — not a fabricated two-button decision. The
low-confidence choice path is also implemented, for the case (not CIM's
today) where the geometry genuinely does not clear the trust bar.
