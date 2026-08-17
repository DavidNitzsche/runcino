# Doctrine-conformance audit · 2026-08-17

Read-only sweep of `web-v2/lib/{plan,coach,training,race,watch}` against `Research/` and
`BuildResearch/`. Commissioned after David caught a live defect on his phone: post-race
recovery prescribed 15 miles across 14 days for a 33 mi/wk runner with a goal marathon
16 weeks out.

**Standing rule this audit serves (David, 2026-08-17): nothing in the app should ever
happen that is not aligned with the doctrine.**

**Headline: the shipped defect is not a one-off.** A per-distance doctrine table encoded
at one row and applied to all distances recurs at least nine more times — taper depth,
carb loading, race-day pacing, warm-up, fuelling rate, caffeine, shoe life, recovery
duration, heat dosing. In several cases the code comment *names the distance the number
came from* and applies it universally anyway. In one case a test asserts the wrong row,
regression-locking the drift.

---

## Tier 1 · Could injure a runner

| Where | Engine says | Doctrine says | Verdict |
|---|---|---|---|
| `plan/injury-builder.ts:184` | whole return-to-run is 2/3/4 weeks by severity enum | `Research/05:475` "Total return: **8-16 weeks typical**"; `:487` high-risk 4-9 months | CONTRADICTS |
| `plan/injury-builder.ts:93-165` | `injury.site` loaded, echoed, **never read by the prescription** — one generic walk-run ladder | `05` §§2-19 are per-site; `:463` "**All confirmed BSIs: no running until clinical clearance**" | CONTRADICTS · most dangerous item in the app |
| `training/vdot.ts:815` | race anchor at full value to 180 days | `Research/01:670` "12+ weeks — **Expired. Don't anchor pace prescription on this VDOT**"; `:714` "use **≤56 days** as the canonical freshness window" | CONTRADICTS · 3.5× the window; sets every pace for every user |
| `plan/generate.ts:1194-1252` | long-run cap by distance only | `00a:217` "≤25-30% of weekly volume (**or by absolute time: <3.0-3.5 h**)" — the comment at `:1202` cites the time cap as its justification and never implements it | UNIMPLEMENTED · a 20 mi long at 13:00/mi is 4h20m, aimed at the least-trained cohort |
| `plan/generate.ts:2868-2872` | recovery rest days keyed to `restDow`, so a marathon week 1 can put an easy run on **day 1 post-race** | `00b:260` "Days 0-3: walks only or rest" | CONTRADICTS |
| `coach/heat-acclimatization.ts:43` | `HEAT_THRESHOLD_F = 75` applied to **air temp** | `06:172` heat dose is "**Tair ≥85°F or WBGT ≥75°F**" | CONTRADICTS · **WBGT's number read into the Tair slot** |
| `HealthView.tsx:1066` | rising RHR headlined as "Adapting" | `06:158-163` adaptation signature is **workload-HR falling** (−5 to −15 bpm) | CONTRADICTS · **inverted** |
| *(nowhere)* | — | `06:491-499` hard bail table; `:484` "WBGT ≥80°F → convert to easy time-on-feet" | UNIMPLEMENTED · safety |
| `coach/tier-rules.ts:106,117` | sleep floor *lower* for more advanced runners (6.0 h) | `00b:290-326` requirement scales **up** with mileage (80+ mpw → 9-10 h) | CONTRADICTS |
| `coach/tier-rules.ts:107,118` | ACWR caution raised to 1.7 for advanced_plus | `Research/15:215-220` one table, **no tier dimension**: >1.5 Danger | CONTRADICTS |
| `coach/strength-recommender.ts:747` | heavy strength on any quality day | `07:554` "VO2 / interval → **Maintenance only**" | CONTRADICTS |
| `coach/strength-load.ts:34` | strength minutes → run-miles, folded into ACWR | `09:350` "Quantify via **sRPE**; **do not equate to run minutes**" | CONTRADICTS · doctrine forbids this exact conversion |
| `training/fueling.ts:21` | 75 g/hr for any race | `18:371` half = **30-60 g/hr**; `:27` 60 g/hr is the GI-distress threshold | CONTRADICTS · marathon row → half |
| `race/race-detail-pacing.ts:104` | 20-minute 5K gets a caffeinated gel | `18:369` 5K = **0 g/hr** | CONTRADICTS |
| `api/shoe/route.ts:94` | 400 mi cap, no category | `17:279` super shoe **150-250 mi** | DRIFTED |

## Tier 2 · Could wreck a race — the recurring wrong-row cluster

- **Taper depth (`generate.ts:833` and `:3450`)** — `taperFactor` 0.45/0.60/0.82 with **no distance
  switch**. `Research/08:369-375` is a five-row table: 5K cut **25-35%**, 10K 30-40%, HM 30-50%,
  M 40-60%, ultra 50-70%. The 0.82/0.60/0.45 sequence comes from §9.2, titled "**Marathon** taper
  structure". A 5K peak of 30 mpw races off **13.5 mi** where doctrine wants 19.5-22.5.
  **This is the exact twin of the bug David caught**, duplicated in two places.
- **`validate.ts:49-57`** is distance-aware but **one-sided** — it only asks whether the taper was
  deep *enough*. A 55% cut on a 5K passes.
- **Carb loading (`execution-plan.ts:442`)** — "7-8 g/kg across 24-36h" for all distances;
  `08:453-457` gives 5K/10K 5-7, HM 7-8/24-36h, **M 8-12/36-48h**, ultra 8-12/48-72h. A marathoner
  is under-loaded by about a third — **and `execution-plan.test.ts:129` asserts the wrong row**.
- **Race-day pacing arcs** — five uncoordinated implementations for one race: execution-plan
  (+12s/+6s), pacing.ts (±2%), race-detail-pacing (+1.2%), RaceDayView.swift (+5 s/mi),
  build-workout (flat from the gun). Only one lands in a doctrine band, and only for the half.
  The watch and the phone actively contradict each other on race morning.
- **Warm-up (`execution-plan.ts:417`)** — one 45-min/1mi/drills/3-4 strides protocol for every
  distance; `08:588-593` gives 5K 15-25 min + 4-6 strides, **M 5-10 min, 0-2 strides**;
  `Research/10:133` "Marathon warmup… **No strides**." The comment at `:415` literally reads "(HM: …)".
- **Abort HR (`execution-plan.ts:387`)** — `lthr+3` for all distances; `08:271-276` gives
  5K 105-110% LTHR, HM 96-100%, **M 88-95%**.
- **Marathon taper quality (`generate.ts:1360`)** — MP-specific work is deleted from the taper and
  replaced with 5×400m; `08:384-388` wants 14-16 mi with 10-12 @ MP at wk-3.
- **Readiness weights (`coach/readiness.ts:12`)** — Sleep 28 / HRV 28 / RHR 24; `D1:111-113`
  specifies **HRV 40%**, Sleep 22%, RHR 18%, and `D1:43` warns "below 40% under-uses the signal".
  Load is applied additively where `D1:73` specifies a **multiplier after** the composite.
- **`recovery-phase.ts:138`** tells a half-marathoner "quality-ready day 5" while the plan engine
  holds quality for 14 days. `00b:197-202` says Day 10-14. Two surfaces, one runner, opposite advice.
- **Recovery denominator** — `RECOVERY_WEEKLY_PCT_OF_BASE` multiplies a **4-week average** where
  `00b:258`'s column header reads "**Volume vs. peak**". Residue on today's fix: marathon week 4
  lands ≈49% of true peak, not 70-80%. `_recovery_doctrine.test.ts:28` certifies the drift.
- **`RECOVERY_EFFORT_SCALE`** (A/B/C race scaling, `00b:210-218`) was added in `52174bcd` this
  morning and is **imported nowhere** — every tune-up still triggers full A-race recovery.
- **The 10% rule (`generate.ts:791`)** — a universal `min(1.10)` climb cap citing
  `Research/00a:738`, a section titled "**The 10% rule — reconsidered**" that says it is "not
  strongly supported by recent evidence" and reports novices at +24%/8wk with no higher injury rate.
  ≤10%/wk appears in doctrine only for injury return, post-layoff, and masters.
- **Volume bands (`goal-tiers.ts:285`)** — marathon-advanced peak band [55,75] against
  `Research/22:265`'s **65-90 mpw**, and `volumeCurve` targets the band floor, so a sub-3
  marathoner is built to 55 mpw. The `XTIER-1` fix corrected exactly this shape for 10K-advanced
  and left marathon untouched.

## Citation rot · comments that lie about their own constants

27 instances. The most dangerous class, because they defeat review. A prior automated sweep
verified that cited *headings exist* — never that the cited passage *contains the number* —
leaving 33 mechanically re-pointed citations and 17 self-admitted broken ones.

Representative:

- `generate.ts:717` says cutback "to **85%**"; code at `:803` is `× 0.80`.
- `generate.ts:2906` describes HM recovery as `[0.20,0.40]`; after `52174bcd` the branch is
  unreachable dead code.
- `goal-tiers.ts:132` says "always capped by the runner's own recent long"; `mediumMi` never
  reads `recentLongMi`.
- `heat-adjustment.ts:80` attributes "~1 bpm per 1°F" to `Research/06 §1`, which contains no bpm
  claim — and the code does not implement its own comment either.
- `adapt.ts:1751` attributes a "5/10 interrupts, 7/10 rests" rule to `Research/05 §1.2`, which
  says 0-2 / 3-5 / 6+. The quoted rule is not in the document.
- `readiness.ts:290` cites "Sevenfit literature"; `health-actions.ts:25` cites "Walker";
  `API.swift:2786` cites "Maughan's 5°F threshold" — none appear in any `Research/` source list.
- **Two-hop laundering**: `docs/PLAN_ENGINE_MID_BLOCK_DOCTRINE.md:439` lists
  "`Research/00a §progressive-overload (10%/wk cap)`" as a source. That heading does not exist and
  `00a` has no 10%/wk cap. Rules from that doc are then cited by name throughout `generate.ts`,
  so a secondary doc launders unsourced constants into apparent `Research/` citations.
- **Tests that model the engine instead of doctrine**: `plan-engine.test.ts:40-52` re-implements
  the volume curve inside the test with its own taper and deload values, both already diverged
  from the engine. It cannot catch drift because it is not looking at the engine.

## Doctrine that exists and is implemented nowhere

Whole files with near-zero footprint: `Research/12` (travel/timezone, 100%), the hydration half of
`Research/19` (no fluid, sodium, sweat-rate, or EAH ceilings — the string "sodium" does not appear
in `web-v2/lib` at all), `Research/10` (mobility/warm-up, ~95%), and `Research/06` §§3, 5, 6, 7, 9
(WBGT, cold, wind, altitude, AQI).

Highest-value gaps: A/B/C race recovery scaling; moderate- and long-layoff ramps (the detector
emits a note and mutates nothing); age-graded VDOT and sex offsets (`profile.age` and `sex` are
loaded and never touch VDOT); altitude; wind (`windMph` is populated by four callers and never
read); the cold slowdown table; 80/20 intensity distribution (**no easy/hard volume-share
constraint exists anywhere in the generator**); per-site injury protocols; the RHR action ladder;
plyometric contact counts by phase (form-tips ships ungated plyos inside race week, where `07:269`
says zero contacts); the cross-training substitution table; super-shoe weekly-mileage limits;
**12 of 21 seeded `workout_library` families are never requested — a marathon build contains
exactly three workout shapes: reps, tempo, long**; and strides, which `expand-spec.ts` cannot
express, so **the watch can never run a stride**.

## The twelve drift patterns the permanent gate must watch

1. **Wrong row of a per-distance table** (≥10 instances — the shipped bug's shape).
2. **Correct citation, wrong scope** (4) — the comment names the source distance and the code
   generalises anyway. A citation-existence check passes this.
3. **Anchor verification mistaken for content verification** — assert the number, not the heading.
4. **One doctrinal quantum, N disagreeing constants** — five pacing arcs, three elevation models,
   four heat taxonomies, three sleep targets.
5. **Regime-specific rule generalised** — the 10% cap, Riegel 1.06, T anchored to HM pace.
6. **Wrong column of a multi-column line** — today's bug; `HEAT_THRESHOLD_F`; a 1500m column read
   as miles; a "vs peak" percentage multiplied by a 4-week average.
7. **Partial fix, class not swept** — `XTIER-1`, the bounded round-trip, the CV threshold, the heat
   "unification". A fix to a shared constant requires a grep-all sweep, and the sweep is the deliverable.
8. **Doctrine action degraded to doctrine copy** — extreme-condition paths terminate in a sentence.
9. **Constant defined, wired to nothing** — `RECOVERY_EFFORT_SCALE`, `RAMP_PCT`, `VOLUME_FLOOR_MPW`.
10. **One-sided validators** — every doctrine band has two ends.
11. **Prose numbers escaping the engine** — carb load, caffeine timing, warm-up steps live as
    hardcoded English and are invisible to every test.
12. **Population-of-one calibration shipped as doctrine** — `cadence-target.ts:12` is "validated
    against David's actual runs" and prescribed to every user, against `Research/16:63`
    ("the intervention is a **relative shift**, not an absolute target").

## Two defects in the doctrine corpus itself

Route to whoever owns `Research/` — these are not code bugs:

1. `Research/01:75-109`'s "Mile" column is a **1500m** column mislabelled. The arithmetic
   reproduces the labelled VDOT at 1500m and over-reads by 2.7-5.3 at a mile — and an engine "fix"
   (AUDIT #7) was built on trusting the label, inverting the sign of the error it was written to remove.
2. `Research/00a:217` (long run ≤25-30% of weekly volume) contradicts `Research/22`'s own sample
   weeks (M-Beginner 54%, M-Intermediate 34.5%). The engine sits between them and matches neither.
   Live data: **2,543 plan-weeks across 860 plans above 40%**. Needs a ruling before it can be
   called a violation.

## Top ten fixes, ordered by runner harm

1. **Injury builder** — site- and risk-driven; **no running rows for confirmed or suspected BSI**.
2. **Taper depth per distance** at both sites, plus an upper bound in the validator.
3. **VDOT anchor freshness** 180 → 56 days with a floor-only band to 84.
4. **Long-run absolute-time cap** — implement the `<3.0-3.5 h` bound the code already cites.
5. **Race-day fuelling and hydration** — distance-key carb load, g/hr and caffeine; fix the test
   that locks the wrong row; add fluid, sodium and EAH ceilings.
6. **Recovery denominator** — peak, not a 4-week average; wire `RECOVERY_EFFORT_SCALE`.
7. **`recovery-phase.expectedDays`** — re-source so the app stops telling a runner day 5 while the
   plan holds quality for 14.
8. **Watch/phone race-pacing contradiction** — implement the settle phase `spec-builder.ts:461`
   already claims exists.
9. **Heat** — 85°F Tair (not WBGT's 75), un-invert the adaptation signal, add the bail gate.
10. **Readiness weights and ACWR tiering** — HRV to 40%, load as a multiplier, delete the
    experience axis that loosens safety thresholds with no doctrine support.
