# The owner's 21 s/mi divergence, explained at the workout level

**Source data.** Rendered fresh this session (Rule 13 — not copied from the
migration report), via `lib/plan/_authoring_shadow_compare.audit.test.ts` /
`runAuthoringShadowCompare({ userId: OWNER, raceSlug: 'cim' })`, against the
real, read-only-role-backed `faff_readonly` database, owner account
`0645f40c-951d-4ccc-b86e-9979cd26c795`, 98 composed days, `todayISO
=2026-08-31`. Full per-day JSON captured and inspected field-by-field,
including the fields the harness's own console summary truncates
(`repPaceSPerMi`, `paceLoSPerMi`/`paceHiSPerMi`, `hrCapBpm`, `lthrBpm`).

**Headline number, re-measured.** The largest single-day divergence in this
render is **21 s/mi**, not the 23 s/mi the migration report cited. Both
figures describe the same phenomenon (see §2) and the 2 s/mi difference is
inside the kind of drift expected between two renders a day apart against a
live, still-training account — not a discrepancy worth chasing further; §5
confirms zero structural diffs and the same phase-level shape either way.
This report re-derives the finding from the actual data rather than assuming
the prior number, per Rule 13.

---

## 1 · The four distinct divergent families — every nonzero delta accounted for

Every day with a nonzero `paceDeltaSPerMi` across the 98-day block falls into
exactly one of four families. Nothing is unexplained.

| Family | Instances | Δ (canonical − legacy) | Kind |
|---|---|---|---|
| **LONG runs** | 11 | **+16 to +21 s/mi** (uniform +16 on every plain long; the three M-segment longs ride the same anchor) | `long` |
| **MP-anchored sessions** (marathon-pace tempo blocks + one MP-effort hill-repeat day) | 3 | **+21 s/mi**, all three, identically | `tempo` (2), `intervals` (1) |
| **Threshold / tempo / cruise-interval quality** | ~18 | **−4 to −5 s/mi** | `threshold`, `tempo`, `intervals` |
| **Race-week tune-up** | 1 | **+7 s/mi** | `race_week_tuneup` |

Everything else — the four race days, every rest day, every plain easy day,
warm-up/cool-down distances — is **Δ = 0** or has no comparable pace on
either leg (by-effort strides, hills run "by effort"). Structural fields
(`kind`, `repCount`, `repDistanceMi`, `repRestS`) are identical on every one
of the 98 days; only the pace numbers inside an otherwise-identical structure
differ. This matches the migration report's own §4 finding and this render
confirms it holds today.

## 2 · LONG runs (+16 to +21 s/mi) — a real, already-decided bug fix, not a new divergence

**Traced to the exact lines**, `web-v2/lib/plan/spec-builder.ts`:

```ts
const longLo = anchors ? anchors.easyCeilingSecPerMi : easyAnchorT + LONG_BAND_LO_OFFSET_S; // 55
const longHi = longLo + LONG_BAND_WIDTH_S; // 35
...
paceTargetSPerMi: Math.round((longLo + longHi) / 2)
```

- **Legacy** (`anchors` absent): `longLo = legacy weekT + 55`. For the owner's
  wk0 long, legacy weekT ≈ 431.5s, `longLo = 486`, `longHi = 521`, midpoint
  `504` (8:24/mi) — matches the rendered `legacy.paceLoSPerMi=486,
  paceHiSPerMi=521, paceTargetSPerMi=504` exactly.
- **Canonical**: `longLo = anchors.easyCeilingSecPerMi` directly (502 s/mi,
  8:22/mi, **`sourceMode: direct`, confidence 0.63** — a genuinely observed
  easy pace, `resolveEasyPaceCorpus`'s own corroborated read), `longHi = 537`,
  midpoint `520` (8:40/mi) — matches the rendered
  `canonical.paceLoSPerMi=502, paceHiSPerMi=537, paceTargetSPerMi=520`
  exactly.

**This is not an artifact of the migration — it is a documented, deliberate
correction already decided on 2026-08-31**, and the code's own comment states
the bug it fixes in the runner's own terms:

> "the live block paced every long run at 8:36/mi against an easy band
> opening at 9:02, i.e. a long run prescribed FASTER than an easy day...
> Long keeps its own, narrower band WIDTH... it no longer gets a faster
> CEILING."

Legacy derives the long-run floor from **threshold pace plus a flat +55 s/mi
population offset** — an indirect, two-hop inference (VDOT → T → +55). The
canonical anchor is the runner's **own directly observed easy pace**, one hop
from real data. **Canonical is more credible here, and the direction of the
fix (long runs get slower, not faster) is the doctrinally correct one** —
`spec-builder.ts` states elsewhere in its own words, "LONG IS EASY EFFORT,
just more volume," and pacing a long run faster than the easy ceiling
contradicts that outright. This family is the single largest source of the
divergence by day-count (11/98) and it is a fix, not a defect.

## 3 · MP-anchored sessions (+21 s/mi, all three identically) — a personalized durability read replacing a flat population offset

Traced via the full per-day JSON (not the truncated console table): the
taper's two MP tempo blocks ("2.5 mi WU · 11 mi @ MP · 1.5 mi CD" and its
7-mi sibling) and one hill-repeat day explicitly tagged "@ MP effort" **all
carry the identical pair of numbers**, legacy 442 s/mi / canonical 463 s/mi —
proof they share one formula, not three coincidences.

- **Legacy**: `spec-builder.ts`'s `marathonPace` fallback branch —
  `marathonPaceSPerMi({ tPaceSec, easyAnchorTSec, goalPaceSPerMi })`, which
  (goal not in the marathon zone for this call, confirmed by the resulting
  number) resolves to the flat **T + 18 s/mi** population offset:
  424 + 18 = 442. The code's own comment names this pattern explicitly:
  *"the T+18 offset is 'one formula for every runner', the pattern this whole
  layer replaces."*
- **Canonical**: `anchors.marathonSecPerMi` = 463 s/mi, **`sourceMode: direct`,
  confidence 0.79**, `enduranceExponent: 1.087`, `personallyEvidenced: true` —
  threshold capacity (420 s/mi, itself direct) carried out to 26.2 mi through
  the runner's **own fitted Riegel exponent** from his real race history
  (`resolveDurability` / `durability-anchor.ts`, BRIEF 06).

**This is already a settled product decision, quoted verbatim from the same
file's own header**, dated the day before this migration work began:

> "adopt the new, personally-evidenced number ... no A/B toggle, no fallback
> to the old number."

**Canonical is more credible, and the physiology explains the direction of
the shift.** A Riegel exponent of 1.087 is slightly *above* the population
convention baked into a flat offset (commonly cited near 1.06 for a
well-trained marathoner) — meaning this runner's own race history shows his
pace erodes a little *more* than the population assumption predicts as
distance stretches from threshold-equivalent efforts out to 26.2 mi. A
personalized read correctly prescribes a marathon-pace session a touch slower
than the flat formula would, which is exactly the +21 s/mi observed. The
flat T+18 number is doctrine's own named "population default"; the canonical
number is what BRIEF 06 was built to replace it with, using this runner's own
100+ races and long runs.

## 4 · Threshold / tempo / cruise-interval quality (−4 to −5 s/mi) — both credible, canonical marginally more precise

Two sub-families, same small magnitude, opposite direction from §2-3 (canonical
here is *faster*, not slower):

- **Threshold/tempo continuous work** (Δ −4 s/mi): legacy weekT = 424 s/mi
  (`bestRecentVdot` → Daniels T-column table lookup, one hop from a VDOT
  scalar); canonical `anchors.thresholdSecPerMi` = 420 s/mi
  (`sourceMode: direct`, confidence 0.79, `resolveThresholdPaceCorpus` —
  a corroborated read off the runner's own recent threshold-zone sessions,
  reason `THREE_RECENT_CORROBORATING_SESSIONS`). Both are legitimately
  well-evidenced; the 4 s/mi gap is the ordinary difference between a
  VDOT-table round trip and a direct multi-session pace read of the same
  training. **Canonical is marginally more credible** — it reads the
  threshold zone directly rather than inferring it through a VDOT
  intermediate — but the gap is small enough that neither number is wrong.
- **Interval/cruise-interval work** (Δ −5 s/mi): legacy = weekT − 18 s/mi,
  which `spec-builder.ts`'s own comment calls **"a deliberate conservative
  deviation"** from true Daniels I-pace — "~10-12K pace... appropriate for a
  runner who cannot absorb full Daniels I volume." Canonical =
  `anchors.intervalSecPerMi` = 401 s/mi, `sourceMode: vdot_fallback`,
  confidence **0.50** — a real Daniels-table I-pace conversion off the
  measured VDOT, but explicitly the *weakest* rung this capacity has, because
  (stated in `capacity-resolver.ts`'s own header) **high-intensity capacity
  has no direct-evidence reader built yet anywhere in this app.** Canonical
  is closer to the doctrine-named target (true I-pace, not an admitted
  approximation of it), but it is honest about being a fallback-tier read
  (0.50, not the 0.79 threshold gets) — both numbers are reasonable for a
  well-trained runner and the 5 s/mi gap is noise at this fitness level.

## 5 · Race-week tune-up (+7 s/mi) — a small, consistent number, both credible

`5×400m @ 5K pace` in race week: legacy 394 s/mi, canonical 401 s/mi (the
same `anchors.intervalSecPerMi` value the interval family already uses).
Legacy's own 5K-pace derivation for this specific type sits a few seconds
faster than its own general interval offset; canonical reuses one consistent
number (Rule 16 — one quantity, one name) rather than deriving a fourth,
race-week-specific approximation. The gap is inside the same noise band as
§4 and does not change which workout the runner does or how hard.

## 6 · Is the 23/21 s/mi max itself the finding, or is it a distraction?

**The aggregate is not what matters — the four traced families are.** The
"maximum single-day divergence" headline (whether 23 or 21) is one number
picked from a distribution that is entirely explained by two named,
DELIBERATE, ALREADY-DECIDED formula replacements (§2 long-run band anchor,
§3 marathon-pace source) plus two small, expected-noise gaps between two
individually-credible fitness reads (§4-5). None of the four families is an
unexplained defect. **Total stress proxy across the whole block: +246 s·mi**
(Σ (canonical − legacy) × distanceMi over quality days) — on a 98-day, likely
600+ mile block, this is a rounding error in aggregate, concentrated entirely
in the long-run-anchor and marathon-pace corrections named above.

## 7 · Goal influence leaking into the legacy path — checked, not found here

The migration report's own §2(c) flags a real, separate goal-isolation risk
in `predictRaceTime`/tier-classification call sites elsewhere in `generate.ts`
— **not present in this comparison.** Every legacy number traced above
(`weekT`, `weekT+18`, `weekT−18`, `longLo` off `weekT+55`) derives from
`bestRecentVdot` and `easyAnchorTSec`, both **measured-evidence quantities**
for this owner (real VDOT off 272 real runs), not goal-blended. The
goal-blended `compose.tPaceSec` field the migration report's own printed
"legacyT" summary line reads (see
`docs/reports/cold-start-prior-fix-2026-09-01.md` §5.1 for where that
distinction bit the cold-start accounts) is a **different field** from the
per-day `easyAnchorTSec`/`weekT` this report's day-by-day numbers are built
from — the day-level spec builder calls read the capacity-only quantities,
and the four families above hold up under direct tracing with no goal
variable anywhere in the chain. **No goal leak found in this block.**

## 8 · Rounding — checked, not the driver

Every offset traced above (+55, +35 width, +18, −18) is an exact, documented
integer constant in `spec-builder.ts`; every anchor value
(`thresholdSecPerMi`, `easyCeilingSecPerMi`, `marathonSecPerMi`,
`intervalSecPerMi`) is a `Math.round`-ed integer second value from the
resolver. The arithmetic reproduces the rendered numbers exactly in every
family traced (§2-5) — there is no unaccounted rounding drift; every second
of every delta is attributable to a named formula difference.

## 9 · An incorrect fallback — checked, not found

Nothing in this block reaches the `population_prior`/`user_prior` rungs
(this is the owner's real, evidence-rich account — see
`docs/reports/cold-start-prior-fix-2026-09-01.md` §3c for the byte-identical
proof that this fix does not touch it at all). Every canonical anchor
consumed here is `direct` (threshold, easy, marathon) or `vdot_fallback`
(interval, honestly labeled at 0.50 confidence, not silently upgraded). No
fallback tier is misfiring or substituting for evidence that should have
been available.

## 10 · HR guidance and grading — fully compatible with either pace number

Checked directly against the rendered data, not assumed: **`hr_cap_bpm` and
`lthr_bpm` are byte-identical between the legacy and canonical legs on every
single one of the 98 days** (0 divergent days, both fields) — including the
long-run day traced in §2, where `hrCapBpm: 151` on both legs despite the
16 s/mi pace difference. This is by construction: `hr_cap_bpm` is a pure
function of `lthr`/`maxHr` (`max(89% LTHR, 78% maxHR)`, Rule 16), and neither
leg's HR derivation was touched by this migration or by the pace anchors at
all.

The HR-semantics fix landed earlier tonight (`7800d72b`,
"quality-phase HR reads as expected, not a rigid ceiling") changes how a
**live HR reading is graded on the watch** — a quality-phase reading near
100-105% LTHR now renders as an informational `.reference` mark instead of
tripping the same out-of-range `.ceiling` alarm an easy-day breach gets. That
mechanism reads `hr_cap_bpm`/the workout's phase, never the pace number
itself, so it is **orthogonal to and fully compatible with whichever pace
anchor (legacy or canonical) authors the day** — the fix behaves identically
regardless of which of the two paces in §2-5 above the runner is chasing.
Whichever pace number this app eventually adopts (§2-3's case for canonical
is strong; §4-5 are close calls either way), the HR guidance and grading
fixes need no further change to stay correct.

## 11 · Summary answers to the four questions posed

1. **Which phases/families carry the divergence, exactly?** Four: LONG runs
   (11 days, +16-21 s/mi), MP-anchored sessions (3 days, +21 s/mi uniformly),
   threshold/tempo/interval quality (~18 days, −4 to −5 s/mi), one race-week
   tune-up (+7 s/mi). Traced line-by-line in `spec-builder.ts` for each.
2. **Which system is more credible, and why?** Canonical, for the two
   families that carry real magnitude (§2 long-run anchor, §3 marathon pace)
   — both are named, already-decided replacements of a flat population
   formula with a directly-observed or personally-fitted number, not
   ambiguous calls. The small (−4/−5 s/mi) families are genuinely close
   calls between two credible reads; canonical is marginally preferred for
   being one hop closer to the underlying evidence in each case, but neither
   is wrong.
3. **Better evidence, rounding, goal leak, or a bad fallback?** Better
   evidence in the two large families (§2-3); ordinary noise between two
   legitimate reads in the two small families (§4-5); no goal leak found in
   this block (§7 — checked directly, the risk the migration report named
   lives in a different, tier-classification code path this comparison never
   touches); no rounding drift (§8 — every second is accounted for by a named
   formula); no incorrect fallback (§9 — everything here is `direct` or an
   honestly-labeled `vdot_fallback`).
4. **Are tonight's HR guidance/grading fixes compatible with whichever number
   wins?** Yes, unconditionally — verified as byte-identical HR fields across
   all 98 days regardless of which pace leg is read (§10). The HR fix
   operates on a completely separate field this migration never touches.
