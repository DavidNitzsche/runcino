# Design Audit Report
_Session start: 2026-06-08. Read-only (`faff_readonly`, write-denied — verified `can_write_runs=false`). No deploys, no data writes. PRODUCT + DESIGN lens, not a bug hunt: does each surface show **exactly the right information, in the right order, in the right way?**_

Falsify, don't confirm. Every finding is anchored to a `file:line` or a real DB value. Flags follow the overnight report:
**🚨 = shows the runner WRONG information · ⚠️ = missing something a runner needs · PASS = correct.** Per-item verdict adds **MAJOR / MINOR / DECISION** severity.

Audited against `Design/running-app-design-brief.md` (the locked design language) and the three prior reports (`AUDIT-FIXES.md`, `UI-HEALTH-REPORT.md`, `OVERNIGHT-REPORT.md`). Where a prior bug also damages the product experience it's cross-referenced and reframed through the design lens; this report does **not** re-litigate correctness bugs already filed.

---

## David's live state — reference block (today = **Monday 2026-06-08**)

Pulled read-only this session. Cited throughout.

- **Runner:** advanced, 40M. LTHR 162, HRmax 181, RHR 52. Pacific (PDT).
- **Goal:** Americas Finest City Half Marathon, **Sun Aug 16 2026 · 69 days out** · goal **1:30** (B-goal 1:37). Priority A.
- **Fitness:** VDOT **47.9** (flat since the Disney HM anchor, Feb 1). HM projection **1:34:54** (5694s). **Gap to 1:30 = 4:54.** Goal VDOT ≈ 50.7. Marathon projection 3:17:31.
- **Readiness today:** **38 PULL-BACK** (stored snapshot) / ~44 live. HRV −18 (29ms vs 56 base), Sleep −14 (5.7h 7-night avg, −1.8h), RHR −2 (49 vs 48), Load +2 (0.95 ACWR), HR-rec 0.
- **Training form:** ACWR 0.95 · acute 5.7 / chronic 6.0 mi-day → TSB ≈ 0 to mildly negative (PRODUCTIVE/LOADED).
- **Plan:** `pln_ca91f252bba50c74`, 11 weeks (Jun 1 → Aug 16). Phases **QUALITY** (wk0–5) → **RACE-SPECIFIC** (wk6–8) → **TAPER** (wk9–10, wk10 = race week). No "base" phase; **no peak week flagged** (`is_peak=false` on all 11 weeks). Paces still goal-anchored (`bestRecentVdot=null` at authoring — pre-C1).
- **Today (Mon 06-08):** EASY 6mi, HR cap 144, no pace target.
- **This week:** Tue tempo 8mi (2WU·4@T·2CD) @ 7:17 HR149 · Thu tempo 6.5mi @ 7:17 · Sun LONG 13mi @ 8:00. **45.5 mi planned.**
- **Last week executed:** planned 44.6 / actual 45.8 — slightly over (executing well).
- **Races:** 5 past (Rose Bowl/Disney/LA M/Big Sur/Sombrero — results backfilled), then AFC (Aug 16), Dodgers 10K (Sep 26), Run Malibu HM (Nov 8), CIM marathon (Dec 6, goal 3:00), LA M (Mar 2027).

---

## ITEM 1 · TODAY PAGE — WEB

`components/faff-app/views/TodayView.tsx` (4375 lines). Beat order as rendered (`:147–679`): top bar (date + **readiness chip**, top-right) → conditional banner stack (Adaptation, ProfileGap, missed-yesterday, coach/plan/workout proposals) → **week strip** (with prev/next week arrows) → strength-week chip → **workout hero** (`PlannedHeroV2`/`CompletedHeroV2`/rest panel) → **4 tiles** (`Tiles`).

### 1A · Hierarchy + three-question test · PASS (with one promotion question)
**What's right:** The page answers the brief's three questions in order. Q1 "what do I do" = the workout hero (`PlannedHeroV2:1618`) is unambiguously the visual hero — mesh gradient, 3-column, hero numerals. For David today it carries everything needed to execute an **EASY 6mi**: DISTANCE/TARGET PACE/EST TIME (`:1670`), EFFORT TARGET Z1–Z5 band (`:1675`), FORECAST/SHOE/FUEL/BEST WINDOW (`:1691`), SessionBlueprint chart + coach "why" (`:1712`), and a TARGETS rail with HR / effort ratio / cadence (`:1726`). Q2 "how am I doing it" = the readiness chip (`:159`, today **38 PULL-BACK**, ring correctly red `#FC4D64`). Q3 "overall" = the GAP/RACE-DAY tiles. The hero is genuinely comprehensive — nothing a runner needs before heading out is missing from the card itself.
**The one issue — readiness is demoted on a day it's the story.** Today is a **pull-back day** (38; HRV 29 vs 56, sleep 5.7h) *and* a trivial **easy 6mi**. The workout is near-zero-stakes; the body signal is the actual news. Yet readiness stays a 56px top-right chip while "EASY" takes the hero. The brief's "page is alive" rule lists "recovery score" as a valid composite hero and says the hero is *contextual, not positional* — on a low-readiness easy day the body state outranks the prescription. Today the page reads the same as a pull-back day and a sharp day with new numbers, which is the 4-month-test failure in miniature.
**Proposed change:** when `band==='pull-back'` AND the day is easy/recovery/rest, promote the readiness story above the workout hero (or visually swap which gets hero weight) and add one passive line tying them together ("HRV down — run this by the HR cap, not pace"). Keep the plan unchanged (no-reactive-coach safe — it's framing, not a re-prescription).
**Priority:** nice to have. **Effort:** ~0.5 day.

### 1B · 🚨 No race-day mode — race morning renders "RACE" as a generic workout hero · MAJOR
**What's wrong:** The brief is categorical: *"Race day. The race takes the page."* / *"Race day morning feels reverent."* The web Today has **no race-day composition.** Aug 16's plan row is `type=race, sub_label=RACE, 13.1mi` (DB-confirmed); on race morning `TodayView` feeds that to `PlannedHeroV2` exactly like a tempo or easy day — same mesh card, same DISTANCE/PACE/EST grid, same FORECAST/SHOE/FUEL row, same 4 tiles below with the RACE DAY tile reading "0 DAYS TO GO." `grep` for any race-day branch in `TodayView.tsx` → none; `Shell.tsx:241` only reaches `RaceView` on explicit navigation, never auto-promoted. So the single most important morning of the 69-day block looks like a Tuesday.
**Proposed change:** add a race-day hero variant to Today (or auto-promote `RaceView` into the Today slot when `goalRace.daysAway===0`). Race takes the page: countdown collapses to "TODAY," the orange race gradient surface (the brief's one sanctioned filled-accent surface) becomes the hero, goal pace + splits + fueling + logistics replace the generic workout grid, tiles recede. The machinery exists in `RaceView`; the gap is that Today never routes to it.
**Priority:** ship before AFC (Aug 16). **Effort:** 1–2 days (reuse RaceView content).

### 1C · The 4 tiles — right set, wrong form · MINOR/DECISION
**What's right:** GAP (on-track), RACE DAY (countdown 69 + phase label), WEEKLY VOLUME (8-wk bars + this-week mi), TRAINING FORM (Banister TSB) are a defensible "how am I doing overall" reference row, and three map cleanly to the brief's *training pulse* + *phase/arc* primitives.
**What's wrong:** (1) It's a **2×2 equal-weight tile grid** — the exact "SaaS look we're avoiding" the brief calls out; the rest of the page is editorial beats, then the bottom reverts to a grid. (2) **GAP and RACE DAY are both AFC tiles** side by side — the race name is printed in both eyebrows (`:4219`, `:4270`); per "no redundancy," countdown + projection could be one race tile. (3) **TRAINING FORM's hero number is a bare signed integer** ("−4", `:4352`) with no unit or label — the least glanceable number on the page; a runner can't read it without the helper line. It also colors with **teal `#48B3B5` (PRODUCTIVE) and amber `#F3AD38` (LOADED)** (`:4312`), neither of which is one of the five locked accents — an off-palette sixth/seventh color (cross-ref Item 12). (4) "PROJECTED FINISH" on the GAP tile shows **1:34:54 labeled as the projection while the goal is 1:30** (cross-ref OVERNIGHT Item 15 — the "PROJECTED" wording over a non-goal number).
**Proposed change:** merge GAP+RACE DAY into one race tile (countdown hero + projection sub); give TRAINING FORM a readable label not a bare integer; bring the two band colors onto the locked palette (LOADED→`--milestone`/amber is at least consistent if adopted as a named state color, PRODUCTIVE→`--recovery` or neutral ink). Consider demoting the tile row to a flat reference strip rather than equal cards.
**Priority:** nice to have (palette fix → ship before CIM). **Effort:** ~0.5–1 day.

### 1D · Rest day · PASS
**What's right:** Rest day (`:597` inline rest hero + `RestDayCard:3889` via WorkoutCard) is calm and useful exactly as the brief wants ("Rest day morning is calm"): "Let the load land" headline, a real **THIS WEEK** recap (miles done / days run / quality sessions from the week array), a **TOMORROW** preview so the rest day has a visible target, and specific recovery targets (sleep 8h, mobility 15 min hips/calves, fuel). Biometrics (sleep/RHR/HRV) sit in the mesh panel above. No empty-beat rendering. This is a model "the day has its own shape" surface.
**Priority:** n/a (PASS).

### 1E · Noise check · PASS (well-managed) with one latent risk
**What's right:** The conditional banner stack (`:210–273`) all returns `null` when empty and a 2026-06-04 pass explicitly killed the dead wrapper-div spacing — for David today the stack is silent and the page goes top-bar → week strip → hero. GUTTED reactive-coach surfaces (StandingRecAdvisory `:588 false &&`) are correctly dark.
**Latent risk:** if several proposals fire at once (coach proposal + plan proposal + workout proposal + missed-yesterday + adaptation), five stacked banners push the hero below the fold. No max-stack / collapse rule exists. Low probability for a steady-state user; worth a "collapse to one 'N updates' affordance" rule before multi-proposal states become common.
**Priority:** nice to have. **Effort:** ~0.5 day.

**Item 1 verdict:** the daily-execution core is strong (comprehensive hero, honest readiness, calm rest day). The two real gaps are **state-adaptivity**: no race-day mode (1B, ship before AFC) and readiness not promoting on a pull-back day (1A). The tiles work but are the page's one un-editorial, slightly off-palette corner (1C).


## ITEM 2 · TRAIN PAGE — WEB

`components/faff-app/views/TrainView.tsx` (1636 lines). Composition (`:548–1060`): header (race eyebrow + phase title + FOCUS line + countdown) → **phase ramp** (weekly-volume bars, phase-colored, click-to-focus, FULL PLAN button) → **EXECUTION strip** → lower dashboard (**phase cards** | THIS WEEK list | PROJECTION | KEY WORKOUTS). FULL PLAN modal = Calendar tab (`MonthCalendar`) + Weeks tab (`WeeksList`).

### 2A · Week context + execution strip · PASS (strong)
**What's right:** The block reads clearly. The header answers "where am I in the arc" (FOCUS line is real authored copy — for David's QUALITY phase, "Intervals + threshold sessions to lift aerobic ceiling," DB-confirmed) + "how far to race" (69 days). The **EXECUTION strip** (`:688–745`) is exactly the planned-vs-actual the prior audits flagged missing: per week it shows `actualMi/plannedMi`, a completion bar (green ≥95% / amber ≥80% / coral below), sessions done/total, a training-influence dot, and an adapt marker. For David last week that's **45.8/44.6 → ~100% green** — the page tells him at a glance he's executing. THIS WEEK list, PROJECTION (gap on a SLOWER↔FASTER axis + WHAT CLOSES IT levers), and KEY WORKOUTS (quality sessions with hit/miss influence) round it out. This is a genuinely complete training-block surface.
**Priority:** n/a (PASS).

### 2B · Phase progression — visible, but the peak week is invisible and the vocabulary diverges · DECISION
**What's right:** Progression is visualized well — the ramp colors bars by phase, the phase-cards grid (`:750`) shows each phase's name (in phase color), description, and TARGET VOL, with a NOW tag on the current phase. A runner can see QUALITY → RACE-SPECIFIC → TAPER → Race.
**What's wrong/missing:** (1) **The peak week has no marker.** David's volume ramps **44.6 → 64.5mi at week 7 (Jul 20) → tapers** (DB-confirmed), but `is_peak=false` on all 11 weeks and `is_cutback=false` on the week-5 cutback dip (55.5→45.5→59.5). The tallest bar just sits inside "RACE-SPECIFIC" with no "PEAK WEEK" or "CUTBACK" callout. The brief names Peak a distinct phase ("Load, sharpness, ACWR vigilance") and says "surprise/milestone gets a moment" — the block's biggest week is a milestone the page should mark. (2) **Vocabulary mismatch:** the engine's phase names (QUALITY/RACE-SPECIFIC/TAPER) are mapped onto the brand's *build/peak/taper colors* (`phaseKey():94`) but keep their own names, so the ramp/cards never use the brief's periodization words (base/build/peak/taper) and there's no "base" at all. For David (advanced, already race-fit off Sombrero May 3) **starting at QUALITY with no base is correct coaching** — this is a naming-consistency note, not a plan defect.
**Proposed change:** flag the peak week (`is_peak`) and cutback weeks in the plan data and mark them on the ramp (a "PEAK" pill on the tallest bar, a subtle down-glyph on cutbacks); decide one phase vocabulary across the engine and the brand palette so colors and names agree.
**Priority:** ship before CIM. **Effort:** ~1 day (data flag + ramp marker).

### 2C · Full Plan modal · PASS
**What's right:** Both tabs are complete. **Weeks tab** (`WeeksList:1465`) groups weeks under phase headers, each row a planned-track bar with an actual-fill overlay, key-workout label ("Tempo · 8.0 mi"), `actual/planned` mi for past+current and planned-only for future, session ratio, and an influence dot — plus a RACE row. **Calendar tab** (`MonthCalendar:1108`) renders real month grids today→race month, auto-scrolls to today, highlights race day in orange, and opens a day-detail panel on click. Nothing reads as broken or stubbed.
**Minor:** the WeeksList key-label and calendar tile show `type · mi` and drop any `sub_label` finish detail (the OVERNIGHT 19#5 "16mi · last 8 @ HM" gap). **N/A for David** — his longs are plain (HR-capped, no @M/@HM finish) — but the structural gap remains for marathon-finish longs (relevant for his CIM block).
**Priority:** nice to have (matters at CIM, not AFC). **Effort:** ~2 hours.

### 2D · "Why is this week structured this way" · PARTIAL
**What's right:** Phase-level WHY is well-surfaced — the FOCUS line + phase-card descriptions carry real authored rationale ("Pace + long-run integration at race-specific demands," "Volume drops sharply, intensity preserved"). For this week's two tempos + a long, the phase focus ("intervals + threshold to lift aerobic ceiling") adequately explains the structure.
**What's missing:** there is no **week-level** rationale surfaced, and the `plan_weeks.rationale` column that could carry it is a **stub** ("QUALITY · week 1", "QUALITY · week 2" — DB-confirmed), not real copy. The data model promises a per-week why it doesn't deliver. Acceptable today because the phase focus covers it; worth either populating week rationale with real coaching ("first of two threshold weeks — get comfortable at 7:17 before volume climbs") or dropping the column.
**Priority:** nice to have. **Effort:** ~0.5 day (if populated by the engine).

### 2E · What's missing — pace progression isn't visualized · MINOR
**What's wrong:** The ramp shows **volume** climbing to race day but never shows **paces tightening**. A runner closing a 4:54 gap wants to see the quality target sharpen week to week (tempo 7:25→7:17→7:10 as VDOT climbs). Neither the ramp nor KEY WORKOUTS draws this. (Compounded by the carried bug that David's paces are currently goal-anchored, so they're near-static at goal pace regardless — but once the in-place re-pace lands, a pace-progression view becomes the natural companion to the volume ramp.) The brief lists "long-run progression" as one of the few places a real chart earns its space — a pace-progression line is the Train-page equivalent.
**Proposed change:** add a secondary ramp/line for quality-pace progression to race day (or overlay target pace on the existing bars).
**Priority:** ship before CIM. **Effort:** ~1 day.

**Item 2 verdict:** the strongest planning surface in the app — execution strip, phase ramp, full-plan modal all complete and honest. The gaps are about **making the arc legible**: mark the peak/cutback weeks (2B), and visualize pace progression alongside volume (2E).


## ITEM 3 · HEALTH PAGE — WEB

`components/faff-app/views/HealthView.tsx` (863 lines). Order (`:369–860`): **GLANCE hero** (gauge + WHAT IS DRIVING IT + aerobic-fitness + 7-day readiness trend) → **THE STORY + WHAT TO DO** (2-col) → **RECOVERY PHASE** (post-hard, conditional) → **BODY** grid → **SLEEP STAGES** → **FORM** (biomechanics) → **DEEPER INSIGHTS** (training form, block comparison, DOW, predictors).

### 3A · Hierarchy + most-actionable thing · PASS (WHAT TO DO placement is a DECISION)
**What's right:** The page leads with the signal — the readiness gauge (`HeroGauge:374`, today's score + 14-day baseline + net delta) is the unambiguous hero, exactly the brief's "recovery score composite." The drivers column ("WHAT IS DRIVING IT," `:387`) decomposes it, and the aerobic-fitness + 7-day trend complete the GLANCE. The **most actionable** thing — **WHAT TO DO** (`:505`) — is in row 2, each action a priority chip (urgent/high/medium/low/on-course) + action + cite, every line tied to a real `health-actions.ts` trigger (no extrapolation). This is the strongest health-intelligence layout in the app.
**The decision:** WHAT TO DO is a **half-width column** sharing row 2 with THE STORY narrative. On a day with an urgent/high action (illness flag, ACWR over cap) the action is the page's real headline yet visually ranks below the gauge and beside the prose. Consider promoting WHAT TO DO to full-width (or above THE STORY) when its top action priority is urgent/high; keep the current 2-col when everything is ON COURSE.
**Priority:** nice to have. **Effort:** ~0.5 day.

### 3B · ✅ Training-form band ladder is now correct (corrects UI-HEALTH 5.2)
**Falsified the prior finding:** UI-HEALTH 5.2 flagged the Health-tile TSB band ladder as contradicting `labelForTsb`. As of now the DEEPER INSIGHTS → TRAINING FORM ladder (`:760`) reads **">+25 detraining · +10/+25 race-ready · −10/+10 productive · −30/−10 loaded · <−30 overreach"** — which **matches `labelForTsb` exactly.** The GO-ready fix landed. This now reads correctly for a runner. **PASS.**

### 3C · "FORM" is overloaded on one page · MINOR (confirms UI-HEALTH 10.3)
**What's wrong:** The page has a **FORM** section (`:713`, running biomechanics — cadence / ground contact / stride / vertical ratio / power) AND a **TRAINING FORM** insight (`:745`, Banister Fitness−Fatigue/TSB). Two unrelated meanings of "form" on the same screen — a runner reading "FORM" can't tell if it's their stride mechanics or their fitness/fatigue balance until they read the tiles. The brief's component vocabulary keeps each label unambiguous.
**Proposed change:** rename the biomechanics section **"RUNNING FORM"** or **"MECHANICS"**; reserve "TRAINING FORM" for the TSB insight.
**Priority:** ship before CIM. **Effort:** ~1 hour.

### 3D · BODY tiles — runner-relevance is mixed · DECISION
**What's right:** The BODY grid is comprehensive and unit-correct (UI-HEALTH 1.1 PASS), with honest `—` empty states.
**The decision:** for a *competitive marathoner*, the grid mixes training-actionable recovery signals (HRV, RHR, SLEEP, VO₂ MAX, RESP, WRIST TEMP-as-illness) with slow-moving general-wellness tiles (BODY FAT, LEAN MASS — David's are tracked ~weekly, range 13.7% / 73kg). Per "every element earns its place," the body-composition tiles add density without daily training action. They're defensible to keep (power-to-weight matters across a build) but they shouldn't sit equal-weight beside the recovery signals.
**Proposed change:** sub-group BODY into "RECOVERY SIGNALS" (HRV/RHR/sleep/VO₂/resp/wrist-temp — lead) and "BODY COMPOSITION" (weight/fat/lean — quieter, below), so the training-actionable tiles read first.
**Priority:** nice to have. **Effort:** ~0.5 day.

### 3E · Order (readiness → body → recovery)? · PASS — keep the current order (falsifies the prompt's premise)
**Finding:** The prompt proposes "readiness signal first, then body metrics, then recovery." The current order is readiness → **interpretation** (THE STORY + WHAT TO DO + RECOVERY PHASE) → **raw body** (BODY/SLEEP/FORM) → deeper insights. That is *more* actionable than the proposed order: interpretation (what your numbers mean + what to do + where you are in recovery) belongs above the raw tiles, not below them. A marathoner wants the verdict and the action before the metric wall. Recovery-phase-before-body is correct — it's interpretation, body is reference. **No change recommended;** the existing order is right.
**Priority:** n/a (PASS).

### 3F · Duplication with Today · PASS (intended glance/depth split)
**What's right:** Readiness appears on Today (chip) and Health (full gauge); sleep/RHR/HRV appear on Today's rest hero and Health's BODY grid. Per the brief this is the intended **glance (Today) vs depth (Health)** split across surfaces, not same-page redundancy. No fact is shown twice on the Health page itself.
**The real issue is not redundancy but disagreement:** the readiness number can differ between the Today chip and the Health hero on the same day (live ~44 vs stored 38 — UI-HEALTH 2.3). That's the corrosive cross-surface split, handled in Item 10, not a Health-page duplication problem.
**Priority:** n/a (defer to Item 10).

**Item 3 verdict:** the Health page is mature and correctly ordered — lead-with-the-signal, interpretation before raw tiles, the 5.2 ladder bug already fixed. The only real cleanups are the "FORM" naming overload (3C) and sub-grouping the BODY tiles by training-relevance (3D); WHAT TO DO could promote on urgent days (3A).


## ITEM 4 · TARGETS PAGE — WEB

`components/faff-app/views/TargetsView.tsx` (774 lines). Order (`:107–262`): **ANSWER** (goal hero + confidence label + status + days-out | **Projection band w/ CI**) → **PATH** (on-track/watching: headline + drift signals + test points + status ladder) *or* **GapPanel** (off-track only) → **WORK** (VDOT + Δ + Held + Implies + Goal VDOT) → **PRs** (anchored to goal) → **RACES**.

### 4A · Confidence interval (just shipped) · PASS — reads correctly
**What's right:** The CI renders cleanly and honestly. The `ProjectionBand` (`:383`) draws the interval as a shaded zone (`bci`) behind the fitness marker, and the marker caption shows the **range** "`lo – hi`" labeled "where today's fitness lands" (`:399`) with the goal as a separate "Plan target" tick. Above it the `confidenceLabel` shows word + descriptor + detail (e.g. "MEDIUM · doable, not banked," `:112`). This communicates prediction error honestly — a runner sees a band, not a false-precision point — resolving UI-HEALTH 3.4. Good shipped feature.
**One latent gap (verify):** David's `projection_snapshots.vdot_anchor_date` is **NULL** (DB-confirmed, both today's HM + M rows) despite CI-followup-1 marking the migration-125 anchor-date write "DONE." The §13.7 stale-anchor ±8% override reads that column — with it null, the **stale-input widening may not be firing**, so David's band is the standard distance-table width, not the research-span-stale width his 4-month-old Disney anchor should trigger. Worth confirming the cron actually writes `best.date`.
**Priority:** verify before AFC (cheap check). **Effort:** ~1 hour to confirm.

### 4B · ✅ On-track caption no longer claims "ahead of target" (corrects UI-HEALTH 3.2)
**Falsified the prior finding:** the `bandCaption` on-track branch (`:630`) now guards `gapSec <= 0` before saying "ahead of the target," and the `gapSec > 0` path reads "Raw fitness reads **1:34:54** · still 4:54 back · the build is written to close it." The false-reassurance bug is fixed. **PASS.**

### 4C · Gap decomposition is hidden for the common state · DECISION (confirms UI-HEALTH 3.3 inversion)
**What's wrong:** The Fitness/Conditions/Course/Execution gap decomposition lives in `GapPanel`, rendered **only when `status==='off-track'`** (`:153`). David is **watching**, so he never sees it — he gets the PATH narrative (drift signals + test points + ladder) instead. The **iPhone shows the decomposition in every state** (`K_TargetsProjection`), so for the common on-track/watching state the iPhone Targets is *more* actionable than web — an IA inversion. "What is my 4:54 made of, and which seconds are trainable" is the most useful thing a runner 69 days out can read, and on web it's gated behind a status they're usually not in.
**Proposed change:** bring a compact gap decomposition (the four buckets + controllability tags) to web watching/on-track, collapsed by default — the data already exists server-side (it feeds the iPhone). Don't reserve the most actionable content for the worst-case status.
**Priority:** ship before CIM. **Effort:** ~1 day (port the iPhone decomposition to web).

### 4D · "What should a runner do differently after reading this?" · PARTIAL
**What's right:** The page answers "are you on track" (status + posture), "what's the gap" (CI band + Implies 1:34:54 vs Goal VDOT ~50.7), and "what moves it" (TestPointsGrid — upcoming quality that will re-read fitness; StatusLadder). For a watching runner that's a coherent "keep executing, the next quality run tells us more."
**What's soft:** the actionable takeaway for a watching runner is deliberately gentle (plan-trusts-itself / no-reactive-coach). A runner with a real 4:54 gap might want the sharper lever the iPhone HIT LIST gives ("tempo 7:17 → ~7:05 to project 1:30"). That's the same content as 4C — the web watching state withholds the concrete levers.
**Priority:** folds into 4C.

### 4E · Methodology provenance is thin · MINOR (confirms UI-HEALTH 3.5)
**What's wrong:** The plan-trusts-itself doctrine is in copy and the CI adds a confidence word, but **how VDOT is derived** (recent races + quality runs → Daniels table) is never explained. A runner reading "Current fitness · VDOT 47.9 · Implies 1:34:54" has no provenance for the number that anchors the whole page. The VDOT trend also isn't drawn (flat 47.9 today, but a sparkline matters once it moves — `projection_snapshots` has 30 rows), and the **B-goal (1:37) isn't surfaced** anywhere (only the A-goal 1:30).
**Proposed change:** add a "how we read this" tap-through (VDOT source + window); draw a VDOT sparkline in the WORK card; optionally surface the B-goal as a secondary tick on the projection band.
**Priority:** nice to have. **Effort:** ~1 day.

**Item 4 verdict:** Targets is in good shape — the CI shipped and reads honestly (4A), and the 3.2 caption bug is fixed (4B). The one real product gap is that the **gap decomposition / concrete levers are hidden for watching/on-track on web** while the iPhone shows them always (4C) — bring them to web. Verify the anchor-date-null CI caveat (4A).


## ITEM 5 · ACTIVITY PAGE — WEB

`components/faff-app/views/ActivityView.tsx` (266 lines). Order: range tabs + totals → **VOLUME** (bars + avg line | effort-mix donut) → **PERSONAL RECORDS** → **CONSISTENCY** (18-wk heatmap) → **BY THE NUMBERS** → **RECENT RUNS** (log rows).

### 5A · ✅ Effort classification is fixed (corrects UI-HEALTH 4.2)
**Falsified the prior finding:** all three builders now read the plan-matched effort — `effortMix` (`seed.ts:1682`), `heatGrid` (`:1697`), and the recent-runs dot (`:1580`) all use **`mapType(r.workoutType ?? r.type)`**, matching the iPhone. David's threshold + long runs now classify correctly; the donut no longer reads ~100% easy. The GO-ready fix landed. **PASS.**

### 5B · ⚠️ No pace/HR efficiency trend over time — the #1 competitive-runner signal is absent · MAJOR
**What's missing:** The Activity page shows a **volume** trend (bars) and **consistency** (heatmap), but nowhere does it show whether the runner is **getting fitter**: pace improving, or — the single most-tracked marathoner signal — **HR dropping at the same pace.** A competitive runner wants "my easy pace at 145 bpm went 8:30 → 8:10 over 8 weeks" or "tempo HR at 7:17 fell 158 → 152." The history surface, of all places, should answer "am I improving." The aerobic-efficiency machinery even exists — `computeDecouplingTrend` (`seed.ts:2327`) — but it feeds the **Health** page as a *within-run* drift number, not a cross-run efficiency trend on Activity. The brief explicitly blesses "HRV trend with baseline ribbon, and long-run progression" as charts that earn their space; a pace-at-HR efficiency line is the same category and it's the chart the Activity page is missing.
**Proposed change:** add an EFFICIENCY trend to Activity — easy-run pace normalized to a fixed HR (or HR normalized to a fixed pace) over the range window, as a simple line with an accent dot at now. This is the page's reason to exist for a competitive runner.
**Priority:** ship before CIM. **Effort:** ~1.5 days (the decoupling/HR data exists; needs a cross-run aggregation + chart).

### 5C · ⚠️ Recent-runs feed: generic names + dead verdict badge · MINOR (confirms UI-HEALTH 4.3)
**What's wrong:** A feed row is `date · effort-dot · name · meta · badge` (`:189`). The **name is `r.name || 'Run'`** (David's watch runs are all literally "Run"), and the **badge only ever fires 'LONGEST' at ≥18mi** (`seed.ts:1585`) — David's longest recent is 12.36mi, so **zero badges ever show**, and the `NAILED IT` / `SOLID` / `pr` badge styling at `ActivityView.tsx:193` is dead code. So every run reads identically: "Run · 6.0 mi · 8:15." The per-run plan-vs-actual verdict exists one level down (RunDetailModal) but never in the list.
**Proposed change:** label the row by the workout ("Tempo · 4mi @ T" from `workoutType`/`sub_label`) and surface the run's verdict as the badge (NAILED IT / CAME UP SHORT — the data exists in the recap/glance verdict). Make the feed differentiated at a glance.
**Priority:** nice to have. **Effort:** ~0.5 day.

### 5D · PRs · PASS
**What's right:** PERSONAL RECORDS renders correctly and PR tracking is present across web Activity, web Targets, and iPhone (UI-HEALTH 4.4). Race-data-source correctness of the PR values (races.actual_result first) is the locked race-data checklist's domain, not re-litigated here.
**Priority:** n/a (PASS).

### 5E · What would make Activity more useful for a competitive runner
1. **The efficiency trend (5B)** — the headline gap.
2. **Per-run verdict in the feed (5C)** — differentiate the history.
3. **Weekly planned-vs-actual rollup** — now exists on Train's EXECUTION strip (Item 2A); Activity could mirror a compact version so the history surface also answers "did I hit my weeks."
4. **Year-over-year** — not actionable for David (<1 season of run data) but the structure is absent for returning users (UI-HEALTH 4.5).

**Item 5 verdict:** the 4.2 effort bug is fixed and the page is structurally complete, but for a *competitive* runner it's missing its most important read — **am I getting fitter** (5B). Add a pace-at-HR efficiency trend; differentiate the recent-runs feed (5C).


## ITEM 6 · IPHONE TODAY VIEW

`native-v2/Faff/Faff/Views/TodayView.swift` (2139 lines) + `RootTabView.swift`. Verified against current code (not the morning report).

### 6A · Workout card completeness · PASS (minor HR wiring)
**What's right:** The pre-run card (`TodayPreRunBodyV3`, mounted `TodayView.swift:910`) is execution-complete and matches web `PlannedHeroV2`: Oswald hero + name, Distance/Target-pace/Est-time trio (work-phase pace preference so intervals show rep pace), EFFORT Z1–Z5 gradient bar, CONDITIONS & KIT 2×2 (forecast/best-window/shoe/fuel), SESSION segment list with per-phase pace, a coaching CUE line, and THE PLAN block with verdict + HEART RATE/EFFORT/CADENCE rows.
**Minor:** the HR/effort/cadence targets in THE PLAN (`:626–660`) are **hardcoded per effort enum** ("<140 bpm · Z2" for easy) rather than driven by David's HRmax 181 / LTHR 162 or the real per-day cap. Today's actual cap is **144**; the card shows "<140" by coincidence, and the watch-authoritative `hrCeilingBpm` (144) lives in a now-unused `heroBlock` path, so card and watch can disagree.
**Proposed change:** feed `heartRateTarget` from `workout.hrCeilingBpm`/real zone bounds, enum string only as fallback; reuse the `HRTargetPill` component.
**Priority:** nice to have. **Effort:** ~2–3 hours.

### 6B · ✅ "ALL RUNS" placement · PASS
"ALL RUNS ›" is correctly a **Today entry, not a tab** — a `NavigationLink(value: .activity)` in the THIS WEEK strip header (`TodayView.swift:253`), with the tab bar staying 4 tabs + center RUN and `.activity` route-only (`RootTabView.swift:201`). Shipped as intended. **PASS.**

### 6C · ⚠️ Send-to-Watch is silent/automatic — no persistent CTA on the card · MAJOR
**What's wrong:** The brief names **Send-to-Watch the canonical primary action** with a persistent CTA on the workout card. There is none. `TodayPreRunBodyV3`'s only footer button is "Skip this run" (`TodayPreRunBodyV3.swift:664`); the bottom Start/CTA bar is suppressed (`TodayView.swift:497`, "dead-but-cheap symbols" `:1786`). The watch handoff happens silently/automatically via `WatchSync.pushTodayToWatch()` at launch (`WatchSync.swift:41`) — the runner gets no trigger, no "Sent ✓" confirmation, no affordance. The canonical primary action is invisible.
**Proposed change:** restore a persistent **"Send to Watch"** CTA on the card calling `pushTodayToWatch()`, flipping to "Sent ✓ — start on your watch" (reads `isWatchAppInstalled`/`lastSyncStatus`, already published). Reuse `startButtonShell` styling.
**Priority:** ship before AFC. **Effort:** ~0.5 day (mechanism exists; this is a button + state).

### 6D · ⚠️ No race-day mode on iPhone Today (parallels web 1B) · MAJOR
**What's wrong:** Same gap as web. `RaceDayView.swift` exists (warm-red mesh, hero, course/GPX, race-morning checklist) but its **only caller is `TargetsView.swift:300`** — `grep` for `raceDay`/`is_race_day` in `TodayView.swift` returns nothing. On race morning the plan `type="race"` maps to `FaffEffort.race` and renders the generic pre-run sheet: hero "RACE", hardcoded "Race effort" / "8-9 / 10" (`TodayPreRunBodyV3.swift:318,646`). No countdown-to-gun, no goal pace (1:30 / B 1:37), no gap, no course, no checklist on the day it all matters.
**Proposed change:** branch `TodayView.body` on race-day (it already branches on past-day / post-run) into an inline `RaceDayView` when today's effort is `.race`. The component is built — this is a branch + slug resolution.
**Priority:** ship before AFC. **Effort:** ~1 day.

### 6E · ⚠️ Missing training-form + dropped readiness "meaning" (confirms UI-HEALTH 8.3/8.4) · MAJOR
**What's wrong:** (1) **No Training Form / Banister TSB anywhere on iPhone Today** — web shows a Fitness/Fatigue/Form ring (`TodayView.tsx:4303`); iPhone's `TodayReadinessPanel` chips are Last-night/This-week/VO₂/Best-window/To-race/Next-hard only. The chronic "fresh vs fatigued" axis is absent on the daily surface during a build. (2) **Per-pillar `meaning` narrative dropped** — web's readiness model emits a one-sentence interpretation per pillar (`readiness.ts:33`); iPhone `WhyRow` (`TodayReadinessPanel.swift:335`) renders label + bar + raw value only. Today a runner sees a red bar and "29" but not "HRV well below baseline — your system is still under load."
**Proposed change:** add a FORM chip to `TodayReadinessPanel` (reuse `StatChip`, fed from the training-state envelope the Train tab already consumes); add `meaning` to the `ReadinessInput` model and render it as a dimmed caption under each `WhyRow` (copy already authored server-side).
**Priority:** ship before AFC. **Effort:** ~0.5 day each.

**Item 6 verdict:** the everyday card is mature (6A/6B), but iPhone Today has the **same race-day blindness as web** (6D), the brief's **primary action (Send-to-Watch) is invisible** (6C), and the **chronic-load + readiness-why reads are missing** (6E). The single most important gap is race-day mode.

## ITEM 7 · IPHONE HEALTH VIEW

`native-v2/Faff/Faff/Views/HealthView.swift` + `Components/HealthSeed.swift`. Build 176 fabrication fix verified against current code.

### 7A · 🚨→◐ Build-176 fabrication fix is real in the seed but left 3 residuals on screen · MAJOR
**What's right:** The de-fabrication pass is genuine and thorough **in `HealthSeed.swift`** — every `?? <plausible literal>` is gone (`?? 61.4`, `?? 52`, `?? "15.1"`, `?? "35.78"` → 0 matches), the `drift()`/fake-trend synth functions are **deleted**, and every tile now falls to `noDataMetric()` → "—" + empty bars (honest). Coach lines derive from the real signed delta (`coachForDelta()`), never asserting a direction from a constant.
**What's wrong:** the fix is incomplete **at the screen level** — three fabrication residuals survive in `HealthView.swift`, two of them glance-critical:
1. **`HealthView.swift:850`** — `HealthWeekBars.sevenDay()` still ends `return (0..<7).map { _ in score + Double.random(in: -8...4) }`. On cold start / partial sync the "7-DAY READINESS" hero chart paints **7 random bars** — the exact bug class 1.2 targets.
2. **`HealthView.swift:605–617`** — the **pinned hero baseline line** fabricates baseline as `score + 3` and delta as a hardcoded `−3`. For David it reads "baseline 41 · today 38 · −3" — an invented baseline in the highest-visibility spot, while web computes it from real `brief.composition`.
3. **`HealthView.swift:379`** — the aerobic mini-card still falls back to hardcoded "Aerobic engine still climbing · the long blocks are landing," asserting a rising trend from a constant.
**Proposed change:** wire the hero baseline line to `brief.composition` (hide when absent, never `score+3`); replace the `Double.random` 7-day fallback with honest "N-DAY" partial bars like web; drop the aero fallback string or derive from the real VO₂ series.
**Priority:** ship before AFC (fabricated numbers in the glance hero). **Effort:** ~2–3 hours total. **Keep UI-HEALTH 1.2 open until these three land.**

### 7B · ✅ BODY tiles + phantom BODY TEMP (resolves UI-HEALTH 1.3) · PASS
`HealthSeed.bodyMetrics` now emits **12 tiles** — the 7 formerly-missing (WEIGHT, SPO₂, BODY FAT, LEAN MASS, HRV CV, MAX HR, ACTIVE ENERGY) are present and read real `HealthState` fields; the **phantom BODY TEMP tile is gone** (`btemp` → 0 matches), wrist_temp used as the real source. Fully resolved. (Stale doc-comment at `HealthView.swift:12` still lists the old 6-tile set — cosmetic.)

### 7C · ✅ Deprecated overview shape (resolves UI-HEALTH 1.4) · PASS
All three regressions fixed at the render layer: **WATCHING TOMORROW → WHAT TO DO** (`HealthView.swift:276`, same `buildHealthActions` source as web); the **fake per-pillar recovery %** grid is deleted (card renders anchor + dayOf only); the **EARLIEST QUALITY countdown** is gone (honors no-reactive-coach). The dead fields still decode in `API.swift` but are never read — prune them to prevent accidental re-wiring (15 min).

### 7D · BODY tile order + what's seen first · PASS
Order is correct for a runner — recovery/autonomic first (HRV → RHR → VO₂ → RESP → WRIST TEMP), then body composition (WEIGHT/SPO₂/BODY FAT/LEAN MASS), then derived (HRV CV/MAX HR/ACTIVE ENERGY) (`HealthSeed.swift:31–225`). First thing on open = a **pinned 128pt readiness gauge** + coach verdict ("Recovery is dragging · ease today's effort…") + segmented control — one hero, coach voice. (The pinned baseline line under it is the 7A fabrication.) Minor: SPO₂ would sit more naturally next to RESP RATE.

### 7E · WHAT TO DO is present but buried + vanishes when empty · MINOR
**What's wrong:** iPhone has WHAT TO DO with full web parity (same priority taxonomy + threshold line), but it's the **5th card** in the overview stack (drivers → 7-day bars → aerobic → THE STORY → WHAT TO DO), whereas web puts it in the **top intelligence row** one scroll-stop from the gauge. On a 2-second-glance surface the single most actionable card is below four blocks. It also **vanishes silently when `actions` is empty** (`HealthView.swift:222`), where web always renders a "Building your picture · keep syncing" / ON COURSE state.
**Proposed change:** promote WHAT TO DO above the aerobic + STORY cards; render whenever `brief != nil` with an empty-state line.
**Priority:** ship before CIM. **Effort:** ~1 hour.

### 7F · Insights depth gap vs web · MINOR
**What's wrong:** web's DEEPER INSIGHTS renders typed cards (TRAINING FORM w/ Fitness/Fatigue/ACWR + band legend, block comparison w/ deltas, DOW, predictors, heat); iPhone's INSIGHTS pane (`HealthView.swift:478`) is a **generic passthrough** of `state.insights[]` (eyebrow/title/body) — no structured training-form or block-comparison cards. Whatever the backend pre-bakes is all the runner gets.
**Proposed change:** build a typed TRAINING FORM card (Fitness/Fatigue/ACWR + band reference) at minimum.
**Priority:** ship before CIM. **Effort:** ~0.5–1 day.

**Item 7 verdict:** Build-176 genuinely fixed 1.3 + 1.4 and de-fabricated the seed (big wins), **but 1.2 is not fully closed** — three fabrication residuals remain in `HealthView.swift`, two in the glance hero (7A). Plus WHAT TO DO is buried (7E) and insights are thin vs web (7F).

## ITEM 8 · IPHONE TARGETS VIEW

`native-v2/Faff/Faff/Components/Toolkit/K_TargetsProjection.swift` + `ToolkitPayloads.swift`. Build 177 CI band verified.

### 8A · ✅ Confidence band (Build-177) reads correctly · PASS
**What's right:** Render order is exactly right — `truthHeadline` → **`confidenceBand`** → `metaPills` (VDOT pills) (`K_TargetsProjection.swift:360–370`). The band reads `formatTime(lo) – formatTime(hi)` in natural slow-direction order (server guarantees `lo=center−half`, `hi=center+half`), with an **en-dash** (no em-dash, brief-compliant), then `· word · descriptor` ("MEDIUM · doable, not banked") tinted by `ciTint()` (high→green / medium→amber / else→red, matching web's tier classes). No-CI/cold-start collapses cleanly via an `if let` guard so the layout closes with no empty row; decode is defensively optional. Ship-clean.

### 8B · ✅ Gap decomposition · PASS (the strongest part of the surface)
**What's right:** Fully present and well-built — `gapRows()` (`:66–119`) decomposes into **Fitness / Conditions / Course / Execution** with controllability tags (Trainable/Partly/Fixed) + per-chunk provenance footnotes (forecast-vs-climate, course elev, observed-CV), a `StackedGapBar` that collapses when total ≤ 0, a server-composed **HIT LIST** of cheapest movable seconds (`LeverRow`, signed with a real minus glyph + controllability pill + → projected time), and an honest cold-start variant. Coach voice holds throughout. **This is richer than web's watching/on-track state** (cross-ref Item 4C — web hides this).

### 8C · ✅ No broken local race-time math (B1 already fixed) · PASS
**Falsified OVERNIGHT B1:** `K_TargetsProjection` does **zero** local race-time math (no `predictRaceTime`/Daniels/`pow(`) — every number is server-derived, so the iPhone CI is identical to web by construction. The separate `RaceDayView.swift:611 vdotPredictionRows` broken-Daniels bug (Half=2:29) is **gone** — the file is now 598 lines, the function no longer exists, and it renders the server's `raceProjections` strings. **B1 resolved.**

### 8D · ⚠️ Missing vs web: Goal VDOT, VDOT 6-week trend, PATH narrative · MINOR
**What's wrong:** vs web's WORK + PATH sections, iPhone shows only current VDOT + a single last-MOVE pill. Missing: (1) **Goal VDOT** (~50.7 — the number David is chasing; the server already computes it inside `computeConfidenceLabel`, just not exposed), (2) **VDOT 6-week trend** (is he closing?), (3) the **PATH drift-signals + test-points** narrative (iPhone collapses it to one status chip + headline), (4) **PRs anchored to goal** — and `goalTile` (`TargetsView.swift:356`) is **dead code** (no call site).
**Proposed change:** add a `GOAL VDOT` pill and a `6W` trend pill to `metaPills`; delete the dead `goalTile`. The single hero / numbers-carry-the-page brief justifies thinning PATH detail, but Goal VDOT is the cheapest highest-value add.
**Priority:** Goal-VDOT pill before AFC; rest nice to have. **Effort:** Goal-VDOT ~0.5h (server field), 6w-trend ~1–2h, dead-code delete ~5 min.

**Item 8 verdict:** the Build-177 CI band ships clean (8A) and the gap decomposition is the app's best projection surface (8B, richer than web). Only additive gaps remain — surface Goal VDOT + a VDOT trend (8D).

## ITEM 9 · WATCH FACES DURING A RUN

`legacy/native/Faff/FaffWatch Watch App/Faces.swift` + `ActiveWorkoutView.swift` + `WorkoutEngine.swift`. TF173 (interval HR) + TF174 (finish face) verified.

### 9A · ✅ TF173 interval HR floor really shipped + reads correctly (falsifies OVERNIGHT 19#1) · PASS
**What's right:** Contradicting the prior "quality faces show NO HR" claim, `WorkIntervalFace` renders HR as the **third row** (replacing total-distance, "the least load-bearing number mid-rep") when present (`Faces.swift:89–92`), with a "REP n/m · ♥162+" top label. Plumbing is live: `hrText` reads `tracker.heartRate` gated on `phase.hrTargetBpm` (`ActiveWorkoutView.swift:224`), role goes live-green at/above floor, and the backend scales intervals ×1.05 into a true VO₂max floor. The 4-row face is the busiest in the system but each row is single-purpose and rep-counter + strip double-encode progress, so it reads. **PASS.**

### 9B · ✅ TF174 FINISH face really shipped + routes correctly (falsifies OVERNIGHT 19#2) · PASS
**What's right:** The long-with-finish workout is now fully supported. `WatchPhase.isFinishSegment` decodes from the wire (defaults false on old payloads); the finish phase routes to `LiveFinish` while the easy BUILD phase is pulled onto `LiveEasy` via `isLongWithFinish()` — **neither shows "REP n/m"** (`ActiveWorkoutView.swift:110–118`). Crossing into the finish fires a `.phase(title:"Finish", sub:"<label> · <pace>/mi")` cue (`WorkoutEngine.swift:847`), and `LiveFinish` shows live pace · target HM pace · total distance · **finish-segment miles-to-go** (`phaseRemainingMi` counting the finish's own miles down). Transition cue + finish pace + distance remaining all present. **PASS.** (Minor: the boundary glyph is `mountain.2.fill` — off-vocabulary for a non-race long; use `flag.checkered`.)

### 9C · ⚠️ Tempo misroutes to the EasyFace — hides its pace + HR target · MAJOR (new finding)
**What's wrong:** A tempo session (warmup + 1 work phase + cooldown) is `isSingleWorkSession==true` with a target pace → it routes to **`LiveEasy`/`EasyFace`** — the same face as a recovery jog (`ActiveWorkoutView.swift:137`). Mid-tempo the runner sees center live-pace, a rotating HR⇄cadence guardrail, and a distance countdown — but **no persistent target-pace row and no steady HR row** (HR appears only 30s of every 60s via the rotation). For David's **two tempos this week** ("4mi @ T 7:17, HR target 149"), the watch hides both the 7:17 pace target and the 149 HR he's supposed to hold — even though the backend emits `hrTargetBpm` on the tempo work phase (it's just consumed only by faces tempo never reaches). This is the single biggest mid-run execution gap for David's actual week.
**Proposed change:** route single-work-phase quality (tempo/continuous-threshold) to a face that shows target pace + steady HR — cheapest is `displayHint:'progression'` for tempo in `build-workout.ts:499` (→ `ProgressionFace`: live · target · total · to-go), or a tempo branch on `WorkIntervalFace` with `topLabel:"TEMPO"`.
**Priority:** ship before AFC (David runs tempos Tue + Thu). **Effort:** ~0.5 day.

### 9D · ⚠️ Easy/long HR shown as bare bpm, not a Z2 zone label (OVERNIGHT 19#9 unfixed) · MAJOR
**What's wrong:** Easy (`EasyFace:170`) and long (`HRFace:217`) render raw bpm ("138"/"146"), never a zone. The brief explicitly says "Zone labels (Z2) are more glanceable than bare bpm." The data exists — the backend sends `hrCeilingBpm = round(lthr × 0.89)` (top of Z2) and the watch already computes in/over-ceiling — so the watch knows the zone but shows the number.
**Proposed change:** render the **zone tag** as the glanceable read — green "Z2" when `hr ≤ ceiling`, red "OVER" above (bpm optional subordinate). Binary Z2/OVER is cheap off the existing ceiling; a full 5-zone label needs `lthr`/zone-bounds added to the payload.
**Priority:** ship before CIM. **Effort:** binary ~0.5 day; full zone ~1 day.

### 9E · Clutter / coach-prose mid-run · PASS
No coach prose on any live face — pure number-rows under the `NumberFace` grammar; takeovers (GO/FUEL/MILE/PHASE) are brief and value-led. The reactive coach layer is correctly absent. The interval face's 4 rows is a justified ceiling. Minor: on an HR-capped easy run, HR rotates with cadence every 60s so the guardrail read blinks — pin HR when a ceiling is set (ties into 9D).

**Item 9 verdict:** the watch is in strong shape and both recent ships are genuine — **TF173 (interval HR) and TF174 (finish face) both read correctly**, falsifying the two prior watch findings. Two real MAJORs remain: **tempo misroutes to the EasyFace and hides its targets** (9C — hits David this week) and **easy/long HR shows bare bpm instead of the brief-mandated Z2 label** (9D).


## ITEM 10 · INFORMATION FLOW — END TO END

Synthesis across all surfaces. Nav (grounded): **Web** `Shell.tsx` = Today · Train · Health · Targets(=/races) · Activity(=/log) · Profile. **iPhone** `RootTabView` = Today · Train · RUN(center) · Health · Targets; Activity is a Today-entry deep-link, not a tab. **Watch** = state machine (idle workout / JustRun / readiness glance).

### 10A · Run-completion journey — value gradient is right, but the watch moment is too thin · MINOR
**What's right:** The four surfaces form a correct reductive→depth gradient. **Watch** post-run `SummaryView` = avg pace · miles · elapsed (`SummaryView.swift:8`). **iPhone Today** = completed recap (verdict + stats + splits). **Web recap** (`CompletedHeroV2`) = verdict + facts + per-mile splits + GPS map + HR zones + conditions note + coach tip. **Web Train** = the EXECUTION strip updates (actual mi) + KEY WORKOUTS trajectory influence. Each surface adds, not repeats — exactly the brief's surface-fit intent.
**What's wrong:** the **watch post-run summary is too thin at the highest-engagement moment.** `SummaryView` shows only 3 numbers — **no avg/max HR** (computed and sent, just not shown) and **no rep breakdown** (a 5×1mi shows one blended avg pace, not the per-rep splits the engine has). The run "just ends." (Cross-ref OVERNIGHT 19#3.) Second issue: the **completion verdict can differ across surfaces** — the web phase bars heat-adjust ("on, for the conditions") while the recap/glance judge raw ("missed") on the same run (OVERNIGHT Item 20). A runner who slowed correctly for heat reads a contradiction between the watch/recap and the web bars.
**Proposed change:** enrich the watch summary with avg/max HR + a per-rep ladder for quality (data already on the device); unify the heat-adjusted verdict across recap/glance/bars.
**Priority:** ship before CIM. **Effort:** ~0.5 day (watch summary) + the OVERNIGHT-20 verdict-consistency work.

### 10B · Wake-up: is the right surface doing its job? · PASS (with the Item 6 gaps)
**Finding:** A runner waking up should open **iPhone Today** — and it's the right surface (readiness hero + today's workout card). It mostly does its job: for David today it leads with the **38 PULL-BACK** gauge + "ease today's effort" verdict, then the EASY 6mi card. The gaps are the Item-6 ones: no race-day mode (6D), no training-form read (6E), dropped readiness "meaning" (6E), and a **fabricated hero baseline line** (7A). None breaks the wake-up job; all dilute it. The wake-up surface is fundamentally sound.

### 10C · 🚨 The single most confusing thing — the same metric shows different values across tabs · MAJOR
**Finding:** The most corrosive cross-surface issue is **trust**, not findability. Three canonical numbers each have ≥2 read paths that can disagree on the same day (UI-HEALTH 10.2 / OVERNIGHT B2/B4):
- **Readiness** — live `/api/readiness` ≈ 44 today vs stored `readiness_snapshots` = 38 (the Today chip and the Health 7-day-trend's last bar can disagree on the same morning).
- **Goal status** — the /today bib's readiness-rolled `composeStatus` (→ "off") vs the Targets `goal-projection` drift status (→ "watching") for the same race.
- **VDOT** — live profile recompute vs stored snapshot.
A runner who sees "READY" on Today and a lower readiness on Health, or "off track" on the bib but "watching" on Targets, can't tell which is authoritative — and one contradiction erodes every number on every surface.
**Proposed change:** one canonical read per metric per day; secondary surfaces display it, never recompute (the architectural fix in OVERNIGHT B2/B4). This is the highest-leverage trust fix in the app.
**Priority:** ship before AFC (it's load-bearing for believing the app). **Effort:** the B2/B4 consolidation (days).

### 10D · ⚠️ Race-surface sprawl — four race-ish entry points · MINOR
**Finding:** "The race" is split across **Targets** (the tab, = /races), **RaceView** (the race-detail drawer, opened from the RACE DAY tile / Targets), **RaceDayView** (the race-morning surface, reachable only from Targets), and the **RACE DAY tile** on Today. Four surfaces, one race, with no auto-promotion of the race-morning view on race day (Items 1B/6D). A runner asking "what about my race" has three different doors that lead to different depths.
**Proposed change:** collapse to a clear spine — Targets (the goal + projection) → Race detail (course + fueling + logistics) → Race-day mode (auto-promoted on race morning into Today). Name them consistently.
**Priority:** ship before CIM. **Effort:** ~1 day (mostly the race-day auto-promotion from 1B/6D).

### 10E · New runner, first week — what confuses most
**Finding:** (1) **Undefined jargon** — HRV, ACWR, TSB, VDOT, "negative split," "pull-back band" are interpreted but never *defined* on any surface (UI-HEALTH 2.4/6.3); a beginner follows the instruction but can't evaluate the reasoning. (2) **The metric disagreement** (10C) — the deepest trust erosion. (3) **"Where is my plan?"** splits across Today (today only), Train (the week + block), and Targets (the goal). The first is felt day one; the second is what makes a user stop believing the app. The `StatTile onExplain`/WHY hook is scaffolded (`atoms.tsx:177`) but unwired — a first-use glossary is the cheap fix for (1).
**Priority:** glossary nice-to-have; 10C is the real first-week fix.

**Item 10 verdict:** the surface-to-surface value gradient is correct (watch→phone→web adds depth), and the wake-up surface is sound. The two real flow problems are **trust** (the same metric disagreeing across tabs — 10C, the single most confusing thing) and **a too-thin watch finish moment** (10A). Race-surface sprawl (10D) and undefined jargon (10E) are the next layer.

## ITEM 11 · MISSING FEATURES — COMPETITIVE RUNNER NEEDS

What a 1:30-chasing marathoner is tracking manually or deciding without data. Ranked by leverage for David's AFC→CIM arc.

### 11A · ⚠️ Race result → VDOT → next-plan continuity (the AFC→CIM backbone) · MAJOR
**The gap:** there is **no live writer for `races.actual_result`** (OVERNIGHT Item 10 — "Tap to log" writes only `meta.finishTime`; no `/results` route). So when David runs AFC on Aug 16, the result can't be captured, can't update VDOT, and can't seed the CIM plan — the whole point of a multi-race arc. His 5 past races have `actual_result` only from a one-time backfill; **AFC and CIM are NULL**. A competitive runner's single most important data event (a goal race) currently doesn't inform what comes next.
**Proposed change:** the `actual_result` writer + a race-results history surface + result-anchored next-plan (OVERNIGHT Item 10 design). This is the AFC→CIM training-continuity backbone.
**Priority:** ship before AFC (Aug 16). **Effort:** 2–3 days.

### 11B · ⚠️ "Am I getting fitter" — efficiency trend (pace at HR over time) · MAJOR
**The gap:** the #1 thing a competitive runner tracks manually — is my HR dropping at the same pace, is my easy pace falling at the same HR — has no home (Item 5B). The within-run decoupling exists on Health; the cross-run efficiency trend doesn't exist anywhere.
**Proposed change:** an EFFICIENCY trend on Activity (Item 5B).
**Priority:** ship before CIM. **Effort:** ~1.5 days.

### 11C · ⚠️ Injury/niggle history + recurrence (prevention beyond the active nudge) · MAJOR
**The gap:** logging exists (`niggles`/`runner_injuries`) and David has 2 logged, but **no surface reads them back** (UI-HEALTH 7.1) — no "left calf: 3 flares this season," no recurrence pattern, no days-since-last-flare per body part. Injury prevention for a competitive runner is recurrence tracking, and the data is captured into a drawer no one opens.
**Proposed change:** an injury/niggle history view (list + body-map + recurrence count). The data model supports it today.
**Priority:** ship before CIM. **Effort:** ~1.5 days.

### 11D · ⚠️ Shoe mileage tracking is non-functional · MAJOR
**The gap:** OVERNIGHT Item 16 — auto-assign has never fired in prod, watch/HK runs (96% of David's) never get a shoe, the two manual systems don't reconcile, and stored mileage is fictional. A marathoner rotating shoes and watching for the ~400mi replacement window is tracking it on paper.
**Proposed change:** wire auto-assign into the watch/HK ingest path + compute mileage on-read from canonical runs (OVERNIGHT 16 fix).
**Priority:** ship before CIM. **Effort:** ~1–2 days.

### 11E · ⚠️ Long-run fueling protocol + race-day logistics depth · MINOR
**The gap:** fueling exists for races (`RaceView` FUELING PLAN) and a per-run fuel label is on the Today card, but there's no **long-run fueling protocol** (carbs/hr to practice during the 13mi long, gut training for race intake) and the race-day logistics are thin (no travel/parking/warm-up-timing/weather-specific pacing plan). A competitive runner rehearses race fueling on long runs and plans race-morning logistics manually.
**Proposed change:** extend the long-run card with a fueling rehearsal target (g carbs/hr to practice); deepen RaceDayView logistics (arrival/warm-up/weather-adjusted goal pace).
**Priority:** nice to have (fueling rehearsal before CIM marathon block). **Effort:** ~1 day.

### 11F · Decisions made without data support · DECISION
- **Race pacing strategy** — no "go out at 6:52/mi, here's your split band for 1:30" plan on any surface until race day, and even then RaceDayView's pacing is thin.
- **Taper execution** — the plan tapers (wk9–10) but there's no taper-specific guidance ("volume down, intensity held; expect to feel flat — that's normal").
- **Push vs recover** — readiness informs but deliberately makes no call (no-reactive-coach). For an advanced runner that's correct; worth confirming it stays opt-in.

**Item 11 verdict:** the app is surprisingly complete (PRs, sleep, fueling-for-races, body comp, strength all exist). The real competitive-runner holes are **review/continuity surfaces for data already captured** — race results (11A, the AFC→CIM backbone, before AFC), efficiency trend (11B), injury history (11C), and shoe mileage (11D). 11A is the one that must ship before Aug 16.

## ITEM 12 · DESIGN LANGUAGE CONSISTENCY

Audited `web-v2/app/globals.css` tokens + per-view usage against the locked brief palette/type.

### 12A · 🚨 Shipped color tokens diverge from the locked 5-accent palette · MAJOR (app-wide)
**What's wrong:** the implementation runs a **parallel, drifted color system** vs the brief's locked accents. Concretely (`globals.css:11–19`):
| Brief (locked) | Shipped token | Conflict |
|---|---|---|
| `--recovery #14C08C` (green, recovery only) | `--green #3EBD41` **and** `--eff-easy #14C08C` | different green; **recovery-green repurposed as "easy effort"** (the brief forbids using a semantic color outside its role) |
| `--race #FF5722` (orange) | `--race #FF8847` + `#FFCE8A` peach (Train NOW/countdown/adapted, `:780,891,933`) | **two extra race-ish oranges**; the locked `#FF5722` only survives in the brandmark gradient (`:75`) |
| `--warn #F43F5E` (rose) | `--over #FC4D64` | different rose |
| `--active #4F8FF7` (blue) | `--rest #008FEC` / `--dist #27B4E0` (cyan) | different blues + an un-briefed cyan |
| — | `--goal #F3AD38` (amber) | a **6th color**, used everywhere (status / training-form / best-window / adapted) |
The brandmark gradient (`:75`) *does* use the real 5 accents (`#F43F5E,#FF5722,#F5C518,#14C08C,#4F8FF7`), so the app contradicts itself: brand uses the locked palette, the dashboard body uses a drifted superset. Per the brief ("tokens that conflict... replace them; the brief wins") the body is out of compliance.
**Caveat:** color semantics are a known **unsettled app-wide discussion** (memory `feedback_color_app_wide_discussion` — David deferred canonical decisions to an app-wide pass). So this is the documentation for that pass, not a surprise.
**Proposed change:** run the app-wide color reconciliation — either adopt the locked 5 accents as CSS variables and map every `--green/--goal/--race/--dist/peach` usage onto them, or formally update the brief to the shipped system. Either way, end with one source of truth and restore "recovery green = recovery only."
**Priority:** ship before CIM (it's app-wide; do it once, carefully). **Effort:** 2–3 days (token sweep + per-view review).

### 12B · ⚠️ Three type families vs the brief's "one family" · MINOR
**What's wrong:** the brief says "One family… Don't reach for a second typeface." The app ships **three** — Anton (brandmark), Oswald (display/hero numerals), Inter (body) (`globals.css:4,33–34,75`). In practice Oswald+Inter is a deliberate, consistent brand pairing (and reads well), so this is less a defect than a **brief-vs-reality mismatch** to resolve on paper.
**Proposed change:** update the brief's typography section to ratify Oswald (display) + Inter (body) + Anton (brandmark), or consolidate. Don't leave the spec and the build disagreeing.
**Priority:** nice to have. **Effort:** ~1 hour (brief edit).

### 12C · ⚠️ Components that should be unified but aren't · MINOR
**Finding:** three patterns each have multiple divergent implementations:
- **Readiness** — Today chip (56px ring) vs Health gauge (128px + drivers) vs watch glance vs iPhone `TodayReadinessPanel`. Four treatments, and they can show different numbers (10C).
- **Projection/gap** — web `ProjectionBand` (CI) vs web `GapPanel` (decomposition, off-track only) vs iPhone `K_TargetsProjection` (decomposition always). The web hides the decomposition the iPhone always shows (Item 4C).
- **The week** — Today week strip vs Train week view vs Train EXECUTION strip — three representations of the same 7 days.
These are defensible per-surface (glance vs depth), but the *projection* split is a real inconsistency (web and iPhone disagree on whether to show the decomposition).
**Proposed change:** align the projection decomposition across web/iPhone (4C); accept the readiness/week multiplicity as intentional surface-fit but make them share one number (10C).
**Priority:** folds into Items 4C + 10C.

### 12D · Density + color-meaning · PASS (mostly)
**What's right:** information density is consistently medium across web pages (the brief's target), and color *meaning* is semantically consistent — green=good/recovery, amber=watch, red/rose=act, orange=race, gold=milestone — even though the hex values drift (12A). The one un-editorial spot is the Today 2×2 tile grid (Item 1C). The race gradient is correctly reserved as the single filled-accent surface.

**Item 12 verdict:** the design language is *semantically* consistent (meanings hold, density is even, voice is uniform) but **tokenly inconsistent** — the shipped palette is a drifted superset of the locked 5 accents (12A), with recovery-green repurposed and three race-ish oranges in play. This is the one app-wide cleanup, and it's already flagged for a dedicated color pass. Type (12B) and the projection-component split (12C) are smaller reconciliations.


---

# PRIORITY MATRIX

**Through-line:** the web command center is mature and several flagged bugs already landed (✅ verified this session: web Activity effort 4.2, Health TSB ladder 5.2, Targets "ahead of target" caption 3.2; iPhone Health tiles 1.3 + deprecated overview 1.4; iPhone Targets B1 broken predictions; watch TF173 interval-HR + TF174 finish-face — all confirmed fixed in current code). What remains is **state-adaptivity** (no race-day mode anywhere), **iPhone/watch parity + execution** (Send-to-Watch invisible, tempo misroutes, fabrication residuals), and two **foundational** issues — one metric read per surface (trust) and the race-result→next-plan backbone.

## Must ship before AFC (Aug 16) — 69 days

| # | Finding | Why it can't wait | Effort |
|---|---|---|---|
| **10C** | One canonical read per metric (readiness 38 vs 44, status off vs watching) | Foundational trust — David reads these numbers daily for 69 days; contradictions erode every surface. *Highest leverage; also the largest (B2/B4 refactor).* | days |
| **11A** | Race-result capture → VDOT → next-plan (`actual_result` writer + history) | AFC→CIM backbone — if Aug 16's result can't be logged, the race doesn't inform CIM. Must be ready *before* race day. | 2–3 d |
| **1B / 6D** | Race-day mode on web + iPhone Today (auto-promote `RaceView`/`RaceDayView`) | Race morning currently renders a generic workout hero on the app's single most important day. `RaceDayView` exists — wire it. | 1–2 d each |
| **9C** | Watch: route tempo off the EasyFace (show pace + steady HR target) | David runs tempos **Tue + Thu this week**; the watch hides 7:17 + HR 149 mid-run. | 0.5 d |
| **6C** | iPhone: persistent Send-to-Watch CTA on the workout card | The brief's canonical primary action is invisible (silent auto-push, no confirm). | 0.5 d |
| **7A** | iPhone Health: kill 3 fabrication residuals (random 7-day bars, `score+3` hero baseline, hardcoded aero line) | Fabricated numbers in the glance hero — the exact bug class Build-176 was meant to end. | 2–3 h |
| **6E** | iPhone Today: training-form chip + per-pillar readiness `meaning` | On a PULL-BACK day the chronic-load read + the "why" are exactly what the runner needs to decide. | 0.5 d ea |
| **8D**◐ | iPhone Targets: surface **Goal VDOT** (~50.7) | It's the number David is chasing; server already computes it. | 0.5 h |
| **4A**◐ | Verify `vdot_anchor_date` NULL → CI stale-widening may not fire | Cheap check; the CI the prompt asked me to validate may be under-wide. | 1 h |

## Should ship before CIM (Dec 6)

- **11B / 5B** — Efficiency trend (pace at HR over time) on Activity — the "am I getting fitter" read a competitive runner tracks manually. (~1.5 d)
- **11C** — Injury/niggle **history** view (recurrence per body part) — data captured, never shown. (~1.5 d)
- **11D** — Shoe mileage tracking fix (auto-assign on watch/HK ingest; mileage on-read). (~1–2 d)
- **4C** — Bring the gap decomposition (Fitness/Conditions/Course/Execution + levers) to web watching/on-track — iPhone shows it always, web hides it. (~1 d)
- **12A** — App-wide color reconciliation onto the locked 5 accents (recovery-green repurposed; three race-ish oranges; un-briefed amber/cyan/peach). (2–3 d)
- **2B** — Mark the peak week + cutback weeks on the ramp (David's wk7 64.5mi peak is unlabeled); reconcile phase vocabulary. (~1 d)
- **2E** — Pace-progression visualization on Train (paces tightening, not just volume). (~1 d)
- **9D** — Watch easy/long HR → Z2 zone label, not bare bpm (brief-mandated). (0.5–1 d)
- **10A** — Enrich watch post-run summary (avg/max HR + rep ladder) + unify heat-adjusted verdict across recap/glance/bars. (~0.5 d + OVERNIGHT-20)
- **5C** — Recent-runs feed: workout labels + verdict badge (kill generic "Run" + dead badge). (0.5 d)
- **7E / 7F** — iPhone: promote WHAT TO DO above the fold + render empty state; build a typed TRAINING FORM insight card. (~1 d)
- **3C** — Rename Health "FORM" (biomechanics) → RUNNING FORM/MECHANICS (overloaded with TRAINING FORM). (1 h)
- **10D** — Collapse race-surface sprawl (Targets / RaceView / RaceDayView / RACE DAY tile) into a clear spine. (~1 d, mostly 1B/6D)
- **8D** — iPhone Targets: VDOT 6-week trend pill; delete dead `goalTile`. (~1–2 h)
- **1C** — Today tiles: merge GAP+RACE DAY into one race tile; give TRAINING FORM a readable label; palette onto locked accents. (~1 d)

## Nice to have

- **1A** — Promote the readiness story above the workout hero on pull-back easy/rest days (page-is-alive).
- **3A** — Web: promote WHAT TO DO to full-width when the top action is urgent/high.
- **3D** — Sub-group Health BODY into "recovery signals" vs "body composition."
- **4E** — Targets: VDOT-derivation tooltip + VDOT sparkline + surface the B-goal (1:37).
- **2C / 2D** — Finish-segment label on weeks-list/calendar tile (matters at CIM); populate or drop `plan_weeks.rationale` (currently a stub).
- **5E** — Activity: weekly planned-vs-actual mirror + year-over-year (once multi-season).
- **6A** — iPhone: wire THE PLAN HR target from the real per-day cap, not the effort enum.
- **10E** — First-use glossary (HRV/ACWR/TSB/VDOT) via the scaffolded `StatTile onExplain` hook.
- **11E / 11F** — Long-run fueling rehearsal target; race pacing/taper guidance; deeper race-day logistics.
- **12B / 12C** — Ratify Oswald+Inter+Anton in the brief (or consolidate); align readiness/projection component treatments.
- **1E** — Today banner-stack collapse rule ("N updates") before multi-proposal states are common.
- Cosmetic: stale `HealthView.swift:12` doc comment; prune dead decoded API fields (`watchingTomorrow`/`percentRecovered`/`earliestQualitySession`); watch finish glyph `mountain.2.fill` → `flag.checkered`; pin watch easy HR (don't rotate with cadence) when a ceiling is set.

---

## One-paragraph close

For a runner 69 days out, the app already does the hard part well: the web command center is comprehensive, honest, and mostly correctly ordered, and the recent fix wave (effort classification, TSB ladder, on-track caption, iPhone tile coverage, watch interval-HR + finish-face) genuinely landed. The next 69 days should buy three things, in order: **trust** (make every surface read one number — 10C), **the race itself** (a race-day mode anywhere, and the result→next-plan backbone so AFC informs CIM — 1B/6D/11A), and **execution parity on the wrist** (tempo gets its targets, easy/long get zone labels, the finish moment gets HR — 9C/9D/10A). Everything else is refinement on an already-strong spine. The single most important sentence in this report: on the morning of August 16, the app should not show David a Tuesday.

