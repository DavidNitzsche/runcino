# UI Health Report
_Session start: 2026-06-08 (overnight, autonomous, read-only). Role `faff_readonly` (write-denied, verified). No deploys, no data writes. David reviews in the morning._

Falsify, don't confirm. Every finding is anchored to a `file:line` or a real DB value. Flags: 🚨 = shows a runner WRONG information · ⚠️ = missing thing that significantly affects training. **Full rollup + GO-ready list + morning order at the bottom (`# FINAL SUMMARY`).**

> **TL;DR** — Web is mature; the real problems are the **iPhone lagging web** + a few **display bugs that show wrong values** + **the same metric disagreeing across tabs**. Five fixes are GO-ready (code-only, falsifiable): **🚨 4.2** web Activity classes every run as "easy" (iPhone is correct) · **🚨 5.2** Health training-form band ladder contradicts its own labels · **🚨 3.2** Targets says "ahead of target" while fitness is behind goal · **6.2** strength intents logged ×8 + contradictory · **9.2** watch readiness coach line is dropped. Biggest builds: **iPhone Health parity** (1.2 fabricated values / 1.4 fake recovery % + EARLIEST-QUALITY doctrine violation), a **watch complication** (9.3 — nothing is glanceable between runs), and **one canonical read per metric** (10.2 — readiness 38 vs 44, status off vs watching on the same day). No DB writes made; nothing deployed.

**Base:** `main @ 14868806` (= origin/main, clean). Audit against the live `main` line in the main working tree.
**DB:** Railway via `web-v2/.env.local` `DATABASE_URL_RO`. `current_user=faff_readonly`, `has_table_privilege(runs,UPDATE)=false`. Mechanically SELECT-only.
**Test subject:** David, `user_uuid=0645f40c-951d-4ccc-b86e-9979cd26c795`. 138 runs, 2923 health_samples, 1 profile row, 8 users (only David has health/run data).

---

## Foundational DB facts (used throughout)

**`health_samples`** (2923 rows, all David, source 99.97% `apple_health` + 1 `manual`). Schema: `id, user_id, sample_type, value, sample_date, source, metadata jsonb, recorded_at, user_uuid`. Counts by `sample_type` (whole DB = David):

| type | n | latest | type | n | latest |
|---|---|---|---|---|---|
| hrv | 378 | 06-08 | vertical_ratio | 135 | 05-25 |
| resting_hr | 376 | 06-08 | active_energy | 49 | 06-08 |
| respiratory_rate | 313 | 06-08 | spo2 | 49 | 06-08 |
| max_hr | 288 | 06-08 | sleep_{deep,rem,light,awake,unspec}_minutes | 16 ea | 06-08 |
| sleep_hours | 267 | 06-08 | vo2_max | 15 | — |
| wrist_temp | 193 | 06-07 | hr_recovery | 9 | 06-04 |
| run_power | 186 | 06-05 | lean_mass | 6 | 06-01 |
| stride_length / vertical_oscillation / ground_contact_time | 144 ea | 06-05 | body_mass | 6 | 06-01 |
| cadence | 135 | 05-25 | body_fat_pct | 6 | 06-01 |

**David `profile` (key fields):** `experience_level=advanced, sex=male, age=40, lthr=162 (derived: Disney+Rose Bowl HM avg), rhr=NULL, hrmax=NULL, hrmax_observed=NULL, goal_race_*=NULL, health_connected_at=NULL, strava_connected_at=2026-06-01`. NOTE: `profile.rhr/hrmax` NULL but the **canonical store is `users.max_hr=181 / resting_hr=52`** (correct — ratcheted; HK all-time max=181 matches). `profile.hrmax` is a vestigial fallback (`profile-state.ts:235`). David `users`: `timezone=America/Los_Angeles` (Pacific masks the −7h hack), `vdot_last_reviewed=46.6` (stale 05-19, snapshot=47.9), `fuel_brand=NULL, fuel_target_g_per_hr=NULL`.

**David recent daily (real values):**
| date | HRV | RHR | sleep h | resp | spo2 | hr_recov |
|---|---|---|---|---|---|---|
| 06-08 | 42 | 45 | 4.7 | 17 | 96.5 | — |
| 06-07 | 64 | 49 | 6.4 | 16 | 96.8 | — |
| 06-06 | 54 | 53 | 7.2 | 16 | 96.4 | — |
| 06-05 | 47 | 47 | 7.9 | 16 | 96.6 | — |
| 06-04 | 62 | 51 | 5.2 | 16 | 96.6 | 44 |
| 06-03 | 64 | 50 | 7.0 | — | 97.5 | 45 |
HRV 2wk range 42–69, RHR 42–53, sleep often <6h. **Body comp:** body_mass 84.8kg (06-01, range 83.9–85.9), body_fat 13.7%, lean_mass 73.3kg — tracked ~weekly since April.

---

## ITEM 1 · HEALTH TAB AUDIT

### 1.1 · Web Health tab · PASS (comprehensive, unit-correct, honest empty states)
**Finding:** The web Health tab (`HealthView.tsx`, 863 lines, redesigned 2026-06-01) is genuinely the "all-knowing recovery dashboard" — and it's correct. Architecture: HERO (gauge + drivers + aerobic + 7-day trend) → THE STORY + WHAT TO DO → RECOVERY PHASE → BODY → SLEEP STAGES → FORM → DEEPER INSIGHTS.
**Data source per metric (all live HealthKit via `health_samples`, assembled in `lib/coach/health-state.ts` + `seed.ts`):**
- BODY tiles (`seed.ts:1222-1338`): HRV, RESTING HR, SLEEP (last-night), WEIGHT, VO₂ MAX, WRIST TEMP, RESP RATE, SPO₂, BODY FAT, LEAN MASS, + conditional HRV CV / MAX HR / ACTIVE ENERGY / CYCLE(female).
- SLEEP STAGES (`seed.ts:1362-1386`): deep/rem/light/awake minutes.
- FORM tiles (`seed.ts:1415-1445`): CADENCE, GROUND CONTACT, VERTICAL OSC, STRIDE, VERT RATIO, RUN POWER (from `runs.data` + `health_samples`).
**Evidence — unit handling is correct:** WEIGHT converts kg→lb at `health-state.ts:461` (`*2.20462`); David `body_mass=84.8kg → 186.9lb`. LEAN MASS converts at `seed.ts:1215`. No naked-kg-labeled-lb bug.
**Evidence — honest empty states (carefully fixed):** `fmtValue` renders `—` on `noData` (`HealthView.tsx:60`); multi-tenant audit Pattern 1-5 fixes present (`seed.ts:1162-1169` — WRIST TEMP/RESP/SPO₂/BODY FAT/LEAN MASS/MAX HR all gained `!hasX` noData gates so an unconnected source shows `—`, not a fake "0% / good"). Baseline-vs-target captions are honest (`BarCard` TARGET_NOUN, `HealthView.tsx:88-124`).
**Falsifier:** open web /health for a user with HK data → every tile shows a real value + 14-bar trend; for a no-HK user → every tile shows `—` + "trend builds with daily syncs", no fake zeros.
**Awaiting:** nothing — PASS.
**Any-runner:** YES-correct.

### 1.2 · 🚨 iPhone Health BODY tiles FABRICATE values, charts, and coach narratives on missing data · MAJOR
**Finding:** Where the web shows an honest `—`, the iPhone `HealthSeed.bodyMetrics` substitutes hardcoded plausible numbers and a seeded fake trend, plus per-tile coach prose that asserts a direction/cause regardless of the actual data.
**Evidence (`native-v2/Faff/Faff/Components/HealthSeed.swift`):**
- Value fallbacks: `hrvCur = readiness?.hrvCurrent ?? 52` (`:27`), `vo2 = healthState?.vo2.current ?? 61.4` (`:31`), RESP `?? "15.1"` (`:117`), WRIST TEMP `?? "35.78"` (`:162`). A cold-start / pre-load / API-fail user sees **"VO₂ 61.4" (elite), "HRV 52ms", "RESP 15.1"** — fabricated.
- Fake trend series: `drift(from:to:n:seed:)` synthesizes a 14-point chart when the real series is empty (`:54,:61,:68,:122,:146,:167`). BODY TEMP always charts `drift(from:36.5,to:36.6,seed:71)` (`:146`).
- Hardcoded coach lines: VO₂ `coach:"Up across the block · aerobic engine is climbing."` (`:113`) fires even if VO₂ fell; RHR `"Sitting near baseline · cardiovascular load is low."` (`:99`); HRV `"…tracks short sleep, not a fade."` (`:84`).
**Proposed fix:** mirror the web — gate each tile on a real-data flag and render `—` + guidance when absent; derive the coach line from the actual delta direction (or drop it), never assert "climbing"/"near baseline" from a constant.
**Falsifier:** cold-start iPhone (no HK) → BODY tiles read `—`, not `52 / 61.4 / 15.1`; `rg "?? 61.4|?? 52|drift\(from:" HealthSeed.swift` → 0 after fix.
**Awaiting:** DECISION/GO (iPhone; ships via TestFlight).
**Any-runner:** YES — every cold-start or transient-no-data user sees fabricated elite-ish values and a fake trend; the web does not.

### 1.3 · ⚠️ iPhone BODY pane is missing 7 tiles the web shows, and has a phantom BODY TEMP tile · MAJOR
**Finding:** iPhone `bodyMetrics` returns exactly 6 tiles (HRV, RESTING HR, VO₂, RESP RATE, **BODY TEMP**, WRIST TEMP — `HealthSeed.swift:70-185`). The web BODY grid shows ~13. Missing on iPhone: **WEIGHT, BODY FAT, LEAN MASS, SPO₂, MAX HR, ACTIVE ENERGY, HRV CV** — all of which David has live data for (body_mass×6, body_fat×6, lean_mass×6, spo2×49, max_hr×288, active_energy×49). The iPhone also has a **BODY TEMP** tile (`id:btemp`, `:140`) for which **no `body_temp` sample_type exists** in `health_samples` (only `wrist_temp`) → it renders `—` value with a fabricated drift chart, permanently.
**Evidence:** DB has 24 sample types; `body_temp` is not one. iPhone bodyMetrics array ends at `HealthSeed.swift:185` (6 tiles). Web body array `seed.ts:1222-1338` (10 base + 4 conditional).
**Proposed fix:** add WEIGHT/BODY FAT/LEAN MASS/SPO₂/MAX HR/ACTIVE ENERGY/HRV CV tiles to iPhone bodyMetrics (data already on `HealthState`); remove the phantom BODY TEMP tile (no source) or map it to wrist_temp.
**Falsifier:** iPhone BODY pane shows WEIGHT 186.9lb + BODY FAT 13.7% + LEAN MASS for David; no BODY TEMP tile with a permanent `—`.
**Awaiting:** DECISION (iPhone parity build).
**Any-runner:** YES — every iPhone user sees a thinner Health page than web, and a permanently-empty BODY TEMP tile.

### 1.4 · 🚨 iPhone Health OVERVIEW runs on a deprecated backend shape (WATCHING TOMORROW + fake per-pillar recovery % + EARLIEST QUALITY countdown) · MAJOR
**Finding:** The iPhone reads `state.overview.{story, watchingTomorrow, recoveryPhase}` from the OLD `health-state.ts` producer; the web moved to `seed.readinessBrief.actions` ("WHAT TO DO") + the newer `recovery-phase.ts` (per-pillar `currentValue/severity/statusLine`). Three concrete regressions the iPhone still shows that David explicitly had removed on web:
1. **"WATCHING TOMORROW"** (`HealthView.swift:272`) — web replaced with actionable "WHAT TO DO" tied to `health-actions.ts` (`HealthView.tsx:505`, 2026-06-03).
2. **🚨 Recovery-phase per-pillar % is fake granularity.** `health-state.ts:1131` computes `percentRecovered = round(daysSince/recoveryDays*100)` ONCE, then assigns the **identical number to all 4 pillars** (Sleep/HRV/RHR/Glycogen, `:1145-1148`). The iPhone grid (`HealthView.swift:334 Text("\(p.percentBack ?? 0)%")`) shows e.g. "Sleep 60% · HRV 60% · RHR 60% · Glycogen 60%" — looks measured per-pillar, is one time-based number copied 4×. The web killed this exact panel ("what does this mean? just sort of random…", `HealthView.tsx:581`).
3. **🚨 "EARLIEST QUALITY · Nd"** (`HealthView.swift:343`, fed by `health-state.ts:1151 earliestQualitySession`) — a countdown telling the runner when to do quality. Web gutted this per the **locked no-reactive-coach doctrine** (`HealthView.tsx:622`; memory `feedback_no_reactive_coach`).
**Evidence:** producers still live: `health-state.ts:1099 watchingTomorrow`, `:1131-1151 percentRecovered/earliestQualitySession`, returned at `:1156`. iPhone renders them at `HealthView.swift:219-225, 315, 334, 343`. These fire whenever the recovery anchor is non-empty (post-hard/long session).
**Proposed fix:** repoint the iPhone OVERVIEW to the same sources as web — `readinessBrief.actions` for WHAT TO DO, `recovery-phase.ts` per-pillar severity/statusLine (drop the copied %), and remove the EARLIEST QUALITY line.
**Falsifier:** iPhone Health after a long run shows "WHAT TO DO" actions (not "WATCHING TOMORROW"), per-pillar recovery lines that differ across pillars (not 4× the same %), and no "EARLIEST QUALITY" countdown.
**Awaiting:** DECISION/GO (iPhone; ships via TestFlight). Severity 🚨 on (2) and (3) — they show fabricated precision and violate a locked doctrine.
**Any-runner:** YES.

### 1.5 · MINOR · profile.rhr / hrmax are vestigial NULLs (not a display bug)
**Finding:** `profile.rhr=NULL, profile.hrmax=NULL` despite rich HK samples, but the canonical HR store is `users.max_hr=181 / resting_hr=52` (ratcheted, correct — HK all-time max_hr=181 matches). `profile.hrmax` is only a fallback at `profile-state.ts:235` that never wins. No surface displays profile.rhr/hrmax directly.
**Proposed fix:** drop the dead `profile.rhr/hrmax/hrmax_observed` columns (or backfill from users) in a cleanup; not user-facing.
**Awaiting:** DECISION (low priority cleanup). **Any-runner:** n/a.

### Item 1 cold-start summary
A brand-new user with no HK: **web** = every tile `—` + "trend builds with daily syncs" (honest), readiness 70/READY (the known item-14 over-confidence, carried). **iPhone** = fabricated values (VO₂ 61.4, HRV 52, RESP 15.1) + fake drift charts + hardcoded "aerobic engine is climbing" coach lines (1.2). The two surfaces give a cold-start user opposite impressions; the iPhone's is wrong.

---

## ITEM 2 · READINESS DETAIL AUDIT

**David's real readiness (stored `readiness_snapshots`):** 06-08 = **38 PULL-BACK**, 06-07 = 55 MODERATE, 06-06 = 61 MODERATE. Today's pillars: HRV −18 (29ms vs base 56), Sleep −14 (5.7h 7-night avg, −1.8h), RHR −2 (49 vs 48), Load +2 (0.95 ACWR), HR Recovery 0 (44 vs 45 drop). 70 −18 −14 −2 +2 +0 = 38. ✓ Driven by HRV + sleep.

### 2.1 · Readiness compute + web breakdown · PASS (single-sourced, research-grounded, cold-start FIXED)
**Finding:** One compute site (`readiness.ts:38 computeReadiness`); web `ReadinessBreakdown.tsx` is well-designed (5 story rows · left accent strip by effect · eyebrow "SLEEP · 28%" · observed value + baseline · effect chip · plain-English `meaning`). **Corrects the prior audit (item 14):** the cold-start fix IS built — `readiness.ts:224-226` returns `{score:null, band:'unknown', label:'UNKNOWN'}` when every pillar is no-data; `ReadinessBreakdown.tsx:36` renders `score ?? '—'`. No longer 70/READY on no data.
**Evidence:** weights Sleep 28 / HRV 28 / RHR 24 / Load 15 / HR-recovery 5 = 100 (`readiness.ts` labels). NOTE cosmetic: inline code comments still say "30%/30%/25%" (`:42,:73,:112`) — stale vs the 28/28/24 labels the runner sees. Bands `>85 SHARP · 65-85 READY · 50-65 MODERATE · <50 PULL BACK`.
**Awaiting:** nothing (PASS) + optional comment cleanup. **Any-runner:** YES-correct (all HR/HRV/RHR pillars use the user's OWN baseline).

### 2.2 · 🚨 HRV pillar swings on a SINGLE night, against Research/15 doctrine · MAJOR
**Finding:** The HRV pillar reads `hrvCurrent = hrvAll.at(-1)` — **one night's value** (`health-state.ts:445`) — vs a 30d-excl-7 baseline. Research/15:101 explicitly says flag a meaningful drop "when the **rolling average** decreases by ≥ SWC", and §"interpretation errors" warns against reading single-day HRV. A single noisy night drives up to ±18 points — the largest pillar swing.
**Evidence (real, today):** the snapshot froze HRV at **29ms** (computed 06-08 12:42 UTC) → −18 → **38 PULL-BACK**. But the raw `health_samples` HRV for 06-08 is now **42ms** (single apple_health sample, recorded 07:00 UTC) → −12 → **live ≈ 44**. One night, two scores, one band-defining swing. (HK full-replace updated 29→42 intraday — see 2.3.)
**Proposed fix:** drive the HRV pillar off the 3-7 day rolling HRV average (or LnRMSSD trend per Research/15:101), not `at(-1)`. Keeps the pull-back signal when a *trend* drops, not when one night is noisy.
**Falsifier:** a single 29ms night against a 56ms baseline + otherwise-normal week → readiness does NOT drop to a pull-back band on that one reading; it tracks the 3-7d HRV average.
**Awaiting:** DECISION (which window) — then code-only. **Any-runner:** YES — every runner gets a band-flipping score off one noisy night.

### 2.3 · ⚠️ Readiness has a stored-vs-live split (B4 applied to readiness) · MAJOR
**Finding:** Two read paths disagree. `/api/readiness` does a **live** `computeReadiness(state)` (`app/api/readiness/route.ts:37`, "thin wrapper for clients") → today ≈44 (HRV 42). The cron-written `readiness_snapshots` (read by the 7-day trend + history) → today **38** (HRV 29). On the web Health hero the gauge uses live `readiness.score` (`HealthView.tsx:330`) while the 7-day bars prefer `brief.scoreTrend` (snapshot-derived, `:335`) — so the **hero number and the rightmost trend bar can show different "today" readiness on the same screen** (44 vs 38 today).
**Proposed fix:** pick one canonical read for "today's readiness" (snapshot or live) and have the hero + the last trend bar both use it; the other becomes history only. (Same decision as OVERNIGHT B4 for VDOT.)
**Falsifier:** web Health hero score == the last 7-day-trend bar for the same day; `/api/readiness` today == `readiness_snapshots` today.
**Awaiting:** DECISION. **Any-runner:** YES (worst on a day the HK value updates intraday, like today).

### 2.4 · DECISION (any-runner) · pillars interpret the value but never DEFINE the metric; iPhone drops the explanation entirely
**Finding:** The web `meaning` narrative interprets your value ("Below baseline. Could be stress, sleep, or accumulating load. Watch tomorrow.") but no pillar ever says **what HRV/RHR/ACWR is**. A beginner reading "HRV 29ms · baseline 56ms", "0.95 ACWR · acute 5.7 · chronic 6.0 mi/day", "44 bpm drop" has no idea what these terms mean. **Worse on iPhone:** `HealthDriversList.driverRow` (`HealthView.swift:745-790`) renders name + value + delta bar + points but **omits `input.meaning` entirely** — the iPhone readiness drivers carry zero interpretation, so an iPhone beginner sees only "HRV / 29ms · baseline 56ms / −18".
**Proposed fix:** (a) add a one-line "what is this" per pillar (HRV = nervous-system recovery; ACWR = this week's miles vs your month average; HR recovery = how fast your HR drops after a workout). (b) render `input.meaning` on the iPhone driver rows (or a tap-through to a full breakdown) so the iPhone is as explanatory as web.
**Falsifier:** an iPhone reader can tap a pillar and read the same narrative the web shows; both surfaces define each metric once.
**Awaiting:** DECISION (product). **Any-runner:** YES — this is the core "does it make sense to a beginner" gap; iPhone fails it hardest.

### 2.5 · MINOR · doctrine deviations vs Research/15 (defensible but uncited)
- **Metric identity:** Apple Health HRV is **SDNN**, but Research/15:76 thresholds are **RMSSD/LnRMSSD**-based. The pillar treats SDNN as RMSSD doctrine. Mostly OK because it's intra-individual, but the % thresholds are borrowed from a different metric.
- **Raw vs log:** pillar uses raw-%-change; Research/15:101 prescribes LnRMSSD × 20 / SWC.
- **RHR baseline window:** code uses a long baseline (`recorded_at >= NOW()-60d`, `health-state.ts:234`); Research/15:48 recommends a **7-day rolling** baseline recomputed monthly, and ±2bpm vs a **14-day** baseline (`:55`). Longer = stabler but slower to react.
- **ACWR computed twice (same window, separate queries):** readiness `state.loadAcwr` and `training-form.ts:195 acwr=acute7/chronic28` are BOTH **7d/28d** — windows match (an earlier draft mis-stated 7/42; corrected). Residual risk is B2-style input-duplication (two independent queries can drift), not a window mismatch. (Cross-ref Item 5.)
**Awaiting:** DECISION (bring to doctrine or document the deviation). **Any-runner:** YES (affects every score).

### 2.6 · Coaching action per pillar · PASS-by-design (descriptive, not prescriptive)
The `meaning` strings are deliberately descriptive ("watch for a streak", "if it stays up 3+ days, ease the load") not prescriptive — per the 2026-05-27 comment (`readiness.ts:149`) + the locked no-reactive-coach doctrine. The score informs; the plan/coach decides the action. Correct by design — not a gap.

---

## ITEM 3 · TARGETS PAGE AUDIT

**Real data:** goal `1:30` (`races.meta.goalDisplay`; also a B-goal `goalSafeDisplay "1:37"`), AFC Half, 2026-08-16 (priority A), `daysAway≈69`. VDOT flat **47.9**, HM projection **5694s = 1:34:54**, gap ≈ **4:54**. Goal VDOT for 1:30 HM ≈ 50.7 (vs current 47.9). David's other races: Dodgers (09-26 tune-up), Run Malibu (11-08), CIM (12-06), LA Marathon (2027-03-07).

### 3.1 · Web Targets · PASS (genuinely comprehensive; data correct)
**Finding:** `TargetsView.tsx` (rebuilt 2026-06-04) is a 5-section narrative: ANSWER (goal hero + projection band + days-out + status) · PATH (status headline + drift signals w/ evidence + recent/next test points + 3-rung ladder) · WORK (current VDOT + 6w delta + **Held** days + **Implies** 1:34:54 + **Goal VDOT ~50.7**) · PRs (anchored to goal w/ gap chip) · RACES (calendar + unlogged-race alert).
**It answers the prompt's "missing" list:** "what VDOT to hit 1:30?" → **Goal VDOT** chip (`:208 goalVdot = vdotFromRace(goalSec, distanceMi)`). Gap to goal → `gapSec` + projection band (`:73`). Race-day countdown → `daysAway` (`:121`). The honest current-fitness projection (1:34:54) is surfaced as **"Implies"** in the WORK section even while the headline holds the goal.
**Awaiting:** nothing (PASS). **Any-runner:** YES-correct.

### 3.2 · 🚨 Web on-track caption claims "ahead of the target" even when current fitness is BEHIND the goal · MAJOR (latent for David, any-runner)
**Finding:** `bandCaption` on-track branch (`TargetsView.tsx:606`) renders, unconditionally, `Raw fitness reads {fit} · ahead of the target.` — with no check whether `fit` is actually faster than the goal. For a runner mid-build whose status is on-track (executing well, no drift) but whose raw fitness is still behind the goal — **the normal early/mid-build state** — this prints "Raw fitness reads 1:34:54 · ahead of the target" when 1:34:54 is **4:54 BEHIND** the 1:30 goal. False reassurance on the highest-stakes page.
**Evidence:** `:602-608` on-track branch has no `fit < goalSec` guard; the watching/else branch (`:618-622`) correctly says "that gap is what we're watching." The iPhone equivalent is correct — `K_TargetsProjection.swift:417-421` only says "at or ahead of {goal}" when `gapSec == 0`, else "Projection {proj} · goal {goal}. {gap} to close."
**Why latent for David:** his Targets status is the `goal-projection` drift status (`seed.ts:2110`), currently "watching" (VDOT flat, no decline) → he hits the correct branch today. It fires the moment drift clears to on-track while fitness is still < goal.
**Proposed fix:** in the on-track branch, only say "ahead of the target" when `fitSec <= goalSec`; otherwise "still {gap} back · the build is written to close it" (mirror the iPhone copy).
**Falsifier:** on-track + fit 1:34:54 + goal 1:30 → caption does NOT say "ahead of the target".
**Awaiting:** GO (code-only). **Any-runner:** YES — every on-track runner whose current fitness trails the goal.

### 3.3 · iPhone projection panel is excellent — and richer than web for on-track/watching · PASS (note an IA inversion)
**Finding:** `K_TargetsProjection.swift` ("CLOSING THE GAP") decomposes the gap into **Fitness / Conditions / Course / Execution** with controllability tags (Trainable/Partly/Fixed) + provenance footnotes + a server-composed **HIT LIST** of the cheapest movable seconds + an honest cold-start variant ("need a clean baseline run"). Every number is server-derived (no client fabrication — contrast Item 1.2). This is the GapPanel equivalent. **But the web only shows this decomposition for OFF-TRACK** (`GapPanel`, `TargetsView.tsx:144-148`); on-track/watching web shows the simpler ProjectionBand. So for the common on-track/watching state, the **iPhone Targets is more detailed than the web** — the reverse of the Health/Readiness items. (Cross-ref Item 10 IA consistency.)
**Awaiting:** DECISION — consider bringing the gap-decomposition to web on-track/watching too. **Any-runner:** YES (positive).

### 3.4 · ⚠️ No confidence interval / range on the projected finish · DECISION
**Finding:** Both surfaces show a point estimate (1:34:54). A VDOT→race-time projection has real uncertainty (±1 VDOT ≈ ±1–2 min at HM; day-of conditions, pacing). The iPhone gap-decomposition partially answers "what's the gap made of" but neither surface shows a statistical range ("1:33–1:37 likely"). For a runner staring at a single number, a band communicates honesty about prediction error.
**Proposed fix:** render a range (e.g. ±1 VDOT bracket, or the iPhone's Conditions/Execution variance as an explicit band) around the projection.
**Awaiting:** DECISION (product + methodology). **Any-runner:** YES.

### 3.5 · MINOR · VDOT trend not visualized on Targets; methodology provenance thin
- **Trend:** web shows a 6-week VDOT delta number + Held days; iPhone shows VDOT + HELD + last MOVE pill. Neither draws a VDOT-over-time line, though `projection_snapshots` has 30+ rows (flat 47.9 since 03-31). Flat today, but a sparkline matters once fitness moves. (The Health page draws a VO2 trend; Targets could draw VDOT.)
- **Methodology:** the plan-trusts-itself doctrine is explained in copy ("we hold the line until the evidence clearly says we can't"; iPhone "Pure VDOT math against a flat, neutral-weather reference"). Neither explains HOW VDOT is derived (recent races + quality runs → Daniels table) — a beginner sees "Raw fitness reads 1:34:54" with no provenance.
- **B-goal unused:** `races.meta.goalSafeDisplay="1:37"` exists but isn't surfaced on Targets (only the A-goal 1:30). Minor.
**Awaiting:** DECISION (low priority). **Any-runner:** YES.

---

## ITEM 4 · ACTIVITY / HISTORY VIEW AUDIT

**Real data:** 138 runs, ~127 canonical (mergedIntoId null), 96%+ `apple_watch`/`watch`. Run names are generic ("Run"/"Watch run"); `data->>'type'` = "Run" ×70 / "easy" ×21 / null ×11 (i.e. sport type, not effort). The plan-matched effort lives in `plan_workouts.type` (06-02 threshold, 05-31 long, 05-26 threshold, 05-24 long for David's recent dates) and is exposed on the LogRun as `workoutType` (`log-state.ts:244`).

### 4.1 · Activity shows all runs · PASS
Both surfaces read canonical (deduped) runs and present a rich log: volume hero (month/year/all), effort-mix donut, PERSONAL RECORDS, 18-week clickable heatmap, BY THE NUMBERS facts, RECENT RUNS. iPhone has STATS/FEED modes (`ActivityView.swift`). No missing/duplicated runs found.

### 4.2 · 🚨 WEB Activity mis-classifies effort — every run renders as "easy" · MAJOR (web-only; iPhone correct)
**Finding:** The web Activity builders classify effort with `mapType(r.type)` — and `r.type` is the *sport* type ("Run") or null, not the effort. `mapType("Run") → 'easy'`, `mapType(null) → 'easy'` (`seed.ts:42-50`). So David's **threshold and long runs all render as easy**: the RECENT RUNS dots (`seed.ts:1579`), the **effort-mix donut** (`effortMix`, `:1681` → ~100% EASY), and the heatmap tooltips (`heatGrid`, `:1696/:1720` → "Run"). The plan-matched `r.workoutType` (threshold/long/easy) is on the LogRun but **unused** by these three builders.
**Evidence:** plan types for David's recent dates are threshold/long/easy (DB above), but `data->>'type'` is "Run"/null. Concretely: the 05-31 **12.36mi long run shows as easy (green)**, the 06-02 **threshold session shows as easy**. **The iPhone does it correctly** — `ActivityView.swift:543 FaffEffort.fromType(run.workoutType ?? run.type)` and `:433` heatmap `(r.workoutType ?? r.type ?? "Run")`. So a marathoner's web Activity says ~100% easy; the iPhone shows the real mix.
**Proposed fix:** change the three web builders to `mapType(r.workoutType ?? r.type)` (match the iPhone). One-line each.
**Falsifier:** web effort-mix donut for David shows threshold + long slices (not ~100% easy); the 05-31 run dot is yellow (long), the 06-02 dot is orange (tempo).
**Awaiting:** GO (code-only, web). **Any-runner:** YES — every runner with structured plan work sees a flattened all-easy history on web.

### 4.3 · ⚠️ Recent-runs feed: generic names + no planned-vs-actual verdict · MINOR
**Finding:** The feed shows `name: r.name || 'Run'` (generic) and a badge that is **only ever 'LONGEST'** (`seed.ts:1583`, fires at ≥18mi — David's longest recent is 12.36, so no badges at all). The `'NAILED IT'/'SOLID'/'PR'` badge styling in `ActivityView.tsx:193` is **dead** for the feed — a completed run never shows whether it hit its planned target in the list. (The verdict DOES exist one level down in `RunDetailModal.tsx:556-580` — per-phase target cells + "on target/fast/slow" pip.)
**Proposed fix:** label the feed row with the workout (e.g. "Threshold 5×1mi" from `workoutType`/`sub_label`) and surface the run's verdict as the badge (the data exists in the recap/glance verdict — cross-ref OVERNIGHT E5).
**Awaiting:** DECISION. **Any-runner:** YES (history reads as undifferentiated).

### 4.4 · PR tracking · PASS (present on 3 surfaces)
PRs render in web Activity (PERSONAL RECORDS, `ActivityView.tsx:133`), web Targets (PRs section), and iPhone (`PRSheet.swift` + `ActivityView.swift:307 recordTile`). Not a missing surface. (Race-data-source correctness of the PR values themselves is the OVERNIGHT race-audit's domain — not re-checked here.)

### 4.5 · ⚠️ Missing: weekly planned-vs-actual summary + year-over-year · DECISION
**Finding:** No per-week "ran 38 / planned 42" rollup in Activity (the week view in TrainView shows planned only — OVERNIGHT 19#6). No year-over-year overlay (the range filter is month/year/all, not "this year vs last"). David's run history is short (training began ~06-01) so YoY isn't actionable yet, but the structure is absent for when it is.
**Awaiting:** DECISION (product). **Any-runner:** YES for the weekly planned-vs-actual; YoY matters only for multi-season users.

---

## ITEM 5 · TRAINING FORM DISPLAY AUDIT

**Model:** `training-form.ts` is real Banister — CTL (42d EWMA), ATL (7d EWMA), TSB=CTL−ATL, `trend7` (TSB Δ vs 7d ago), `acwr` (acute7/chronic28). Labels (`labelForTsb:221`): `ctl<10 BUILDING · >25 DETRAINING · >10 RACE-READY · >−10 PRODUCTIVE · >−30 LOADED · ≤−30 OVERREACH`. **David's live value is computed-on-read (no stored row to query RO);** ACWR 0.95 + acute 5.7 / chronic 6.0 mi/day (from readiness) ⇒ CTL≈ATL ⇒ TSB near 0 to mildly negative (PRODUCTIVE/LOADED). NOTE: the prompt's "Fitness 35 / Fatigue 59 / −10" is illustrative — `delta = fitness − fatigue` by construction (`:185`), so 35/59 would read −24, not −10.

### 5.1 · Model + web surfacing · PASS
Web surfaces training form in TWO good places: a **/today ring** (`TodayView.tsx:4305`, label + signed delta + `FORM_HELPER` action line) and the **Health DEEPER INSIGHTS tile** (`HealthView.tsx:743`, Fitness/Fatigue/ACWR + a band ladder). The /today `FORM_HELPER` IS the per-band coaching action: LOADED "Running hot · watch sleep + recovery", OVERREACH "Pull back this week", RACE-READY "Don't add new load this week" (`:4298-4303`). So "what does −10 mean / what action" is answered on /today.

### 5.2 · 🚨 The Health-tile band explanation contradicts the actual label thresholds · MAJOR
**Finding:** The explanation ladder a runner reads to interpret their number (`HealthView.tsx:760`) is numerically wrong vs `labelForTsb`:
| band | tile ladder says | code (`labelForTsb`) |
|---|---|---|
| race-ready | +5 to +25 | **+10** to +25 (`tsb>10`) |
| productive | −5 to +5 | **−10 to +10** (`tsb>−10`) |
| loaded | −5 to **−15** | **−30 to −10** |
| overreach | **< −15** | **< −30** |
A runner at **TSB −20** is labeled **LOADED** by the code (and /today says "Running hot · watch sleep"), but the Health-tile ladder says < −15 = **overreach** → the explanation tells them to "pull back" while the label says "productive but watch." The teaching text disagrees with the number it's teaching.
**Proposed fix:** rewrite the `HealthView.tsx:760` ladder to the real boundaries (`>+25 detraining · +10/+25 race-ready · −10/+10 productive · −30/−10 loaded · <−30 overreach`), or change `labelForTsb` to match the ladder — pick one source.
**Falsifier:** the band ranges printed in the Health tile equal the `labelForTsb` cutoffs exactly.
**Awaiting:** GO (code-only, web). **Any-runner:** YES — every runner reads a mislabeled interpretation guide.

### 5.3 · ⚠️ The trend is computed but never shown · MINOR
**Finding:** `training-form.ts:188,202` computes `trend7` (TSB Δ vs 7 days ago — "trending fresher/more loaded"), but **no surface renders it.** The /today ring and Health tile both show only today's TSB + label. The prompt explicitly asks "is the trend shown?" — answer: no, though the data is right there.
**Proposed fix:** add a "↑/↓ N vs last week" line to the /today ring or Health tile from `seed.form.trend7`.
**Awaiting:** DECISION. **Any-runner:** YES.

### 5.4 · ⚠️ iPhone has no dedicated training-form display · MAJOR (parity)
**Finding:** The iPhone shows training form ONLY if the backend ships it as an INSIGHTS card (eyebrow "TRAINING FORM", `API.swift:1675`) — there is no iPhone equivalent of the web /today ring or the Health-tile gauge. So an iPhone-only runner may never see Fitness/Fatigue/Form/their band, while the web shows it on two surfaces.
**Proposed fix:** add a training-form ring/tile to the iPhone Today and/or Health (the data is already on `HealthState`/the brief).
**Awaiting:** DECISION (iPhone parity). **Any-runner:** YES.

### 5.5 · ACWR cutback guardrail · PASS (woven in; descriptive)
**Finding:** ACWR ≥1.5 / <0.8 is honored across surfaces: `race-header.ts:116` (→ watch status), `strength-recommender.ts:113` (>1.5 → drop strength to maintenance), `recovery-brief.ts:515` (RAMP_UP band), readiness Load pillar (−8 at >1.5), `BodyChips.tsx:89` (color). There's no single explicit "cut N% because ACWR" prescription on the training-form surface itself (per the no-reactive-coach posture — the guardrail acts on the plan/strength, not as a standalone command). David's ACWR 0.95 is safe (no cutback fires).
**Awaiting:** DECISION (whether to surface the guardrail explicitly next to the form number). **Any-runner:** YES-correct.

---

## ITEM 6 · COACH VOICE AUDIT

Sampled 30+ real messages: stored `coach_intents` (strength), `run-win.ts` win lines, `health-actions.ts` WHAT-TO-DO actions+cites, `readiness.ts` pillar meanings (Item 2). Voice is **deterministic** (no LLM, per Cardinal Rule #1) so it's consistent by construction.

### 6.1 · Voice quality · PASS (genuinely good, on-doctrine, explains WHY, session-aware)
**Consistency:** every line obeys the locked tone — no exclamation marks, no emoji, no em-dashes (uses ·), short, direct, no hype. **Explains WHY:** `health-actions.ts` pairs each action with a `cite` (the trigger): "Trim 2-3 miles from your next long run · load is in the injury-risk band." + cite "ACWR 1.6 · above 1.5 hard cap." (`:314`); "Watch closely for cold or flu symptoms" + "Wrist temp +0.4°C above baseline · illness-onset threshold" (`:304`). **Session-aware:** `run-win.ts` differentiates — easy "Easy and honest · legs stayed fresh" (`:196`), recovery "could have been easier" (`:198`), long "time on feet earned" (`:229`), tempo "Held the line · 6:42 dead even" (`:243`), intervals "Built the gear · each third quicker" (`:336`), race "Race executed" (`:324`). Real strength copy: "Strength suppressed this week · Composite readiness in pull-back band (SLEEP below 14d). Heavy lifting under multi-pillar fatigue is injury risk." — direct, reasoned. **This is the strongest surface in the app.**
**Awaiting:** nothing (PASS). **Any-runner:** mostly (see 6.3).

### 6.2 · ⚠️ Strength intents are logged non-idempotently → duplicates + same-day contradictions · MINOR (data hygiene; user-facing only if an inbox lists intents)
**Finding:** `strength-recommender.ts:740/790/851` `INSERT INTO coach_intents` with **no `ON CONFLICT`** (contrast `readiness-snapshot.ts:70` which dedups on `(user_uuid, snapshot_date)`). Result for David (RO): **06-07 logged `strength_resume` ×4 AND `strength_skip` ×8** — twelve rows, and the two reasons contradict ("Full strength rotation resumes" vs "Strength suppressed this week … injury risk").
**Why it's only ⚠️:** the runner sees the LIVE resolved `seed.strengthRecommendation` (`seed.ts:2419`, one value), not the raw log — so the contradiction isn't surfaced today. But any surface that lists `coach_intents` (a notification inbox / history) would show 8 identical "skip" cards + contradictory "resume" cards.
**Proposed fix:** add `ON CONFLICT (user_uuid, field, reason) DO UPDATE` (or a daily idempotency key) to the strength-recommender inserts; ensure resume and skip are mutually exclusive per evaluation.
**Falsifier:** re-running the recommender twice on one day leaves exactly one strength intent per (date, decision); no date has both resume and skip.
**Awaiting:** GO (code-only). **Any-runner:** YES (every user's intent log spams; surfaces if an inbox reads it).

### 6.3 · DECISION (beginner) · actions are plain, but the justifications are jargon-dense
**Finding:** The ACTION half is beginner-friendly ("Trim 2-3 miles", "Take 2-3 easy days", "Skip running until your knee clears"). The CITE/justification half is jargon-dense and undefined: "ACWR 1.6 · above hard cap", "TSB −22 · overreach band", "Composite readiness in pull-back band", "negative-split", "multi-pillar fatigue", "SLEEP below 14d". A beginner follows the instruction but can't evaluate the reasoning — same undefined-jargon gap as Item 2.4.
**Proposed fix:** keep the jargon cite for advanced runners but add a plain gloss on first use, or a glossary tap-through (HRV/ACWR/TSB/negative-split). One definition each.
**Awaiting:** DECISION (product). **Any-runner:** YES — the "does it make sense to a beginner" answer is "the WHAT yes, the WHY no."

---

## ITEM 7 · MISSING SURFACES

**Already present (NOT missing — verified):**
- **PR tracking** — web Activity (PERSONAL RECORDS), web Targets (PRs anchored to goal), iPhone `PRSheet.swift` + `ActivityView.swift:307`. Three surfaces.
- **Sleep trending** — Health SLEEP STAGES + the SLEEP tile 14-bar history + readiness sleep pillar trend. (Research/15:154 "trend total sleep" — honored.)
- **Fueling guidance** — `RaceView.tsx:593` FUELING PLAN (carbs/hr + gel-timing strip by mile + hydration), plus watch fuel reminders. More than reminders.
- **Body composition** — web Health WEIGHT/BODY FAT/LEAN MASS tiles (David's real data). (iPhone parity gap — Item 1.3.)
- **Cross-training/strength logging** — `LogNonRunSheet`, "Log strength / cross" on Targets + the RUN action menu.
- **Race calendar** — Targets RACES (David's 7 upcoming).

### 7.1 · ⚠️ Niggle / injury HISTORY view is missing (logging exists, review doesn't) · MAJOR
**Finding:** Three tables (`niggles`, `runner_injuries`, `niggle_recovery`) and a full logging UI (`NiggleModal.tsx`, `SickModal.tsx`, `BodyFlags.tsx`, iPhone `RunActionMenu`/`E_Nudges`) capture niggles — David has **2 logged (both cleared, 2 distinct body parts)**. But there is **no surface to review that history**: grep for niggle/injury history/recurrence/body-map views → 0 hits. A runner can log a niggle and gets nudged about an active one, but can never see "left calf: 3 flares this year" or a recurrence pattern. The data is captured and thrown into a drawer.
**Proposed fix:** an injury/niggle history view (list + body-map + recurrence count + "days since last flare per body part"). The data model already supports it.
**Falsifier:** a Health or Profile sub-view lists David's 2 past niggles with body part + dates + duration.
**Awaiting:** DECISION (build). **Any-runner:** YES — recurrence tracking is core injury-prevention for any runner.

### 7.2 · ⚠️ Race-result capture + a results history is missing · MAJOR (cross-ref OVERNIGHT Item 10)
**Finding:** The race CALENDAR exists, but there is no live writer for `races.actual_result` (OVERNIGHT Item 10 confirmed — "Tap to log" writes only `meta.finishTime`; no `/results` route). So a "race history with results" page (finish times, VDOT-at-race, race-over-race progression) cannot be built, and the AFC→CIM result→fitness→next-plan continuity has no entry point. David's 5 past races have `actual_result` only from a one-time backfill; AFC/CIM are NULL.
**Proposed fix:** the `actual_result` writer (OVERNIGHT Item 10 design) + a race-results history surface that reads it.
**Awaiting:** DECISION (designed feature; before Aug 16). **Any-runner:** YES.

### 7.3 · ⚠️ Body composition + training-form absent on iPhone · MINOR (parity, cross-ref 1.3 / 5.4)
WEIGHT/BODY FAT/LEAN MASS (Item 1.3) and the training-form gauge (Item 5.4) exist on web but not iPhone. For an iPhone-primary runner these surfaces simply don't exist.
**Awaiting:** DECISION (iPhone parity). **Any-runner:** YES (iPhone users).

### 7.4 · Year-over-year / multi-season comparison · DECISION (low priority)
No "this year vs last" overlay (Item 4.5). David has <1 season of run history so it's not actionable yet, but the structure is absent for returning users.
**Awaiting:** DECISION. **Any-runner:** only multi-season users.

**Net:** the app is surprisingly complete — the prompt's example gaps (PRs, sleep trend, fueling, body comp) mostly EXIST. The real holes are **review surfaces for data already captured**: niggle/injury history (7.1) and race results (7.2). Both store data today that no view reads back.

---

## ITEM 8 · IPHONE TODAY VIEW COMPLETENESS

Compared `native-v2/Faff/Faff/Views/TodayView.swift` (2139 lines) vs `web-v2/components/faff-app/views/TodayView.tsx` (4351 lines).

### 8.1 · Core information is consistent · PASS
Both surfaces carry the daily essentials: the workout prescription (PACE / HR CAP / DURATION / FUEL — iPhone `TodayPreRunBodyV3`, web `PlannedHeroV2`), readiness (iPhone `TodayReadinessPanel`, web hero gauge + chip), conditions/weather, the coach briefing topics (iPhone `BriefingTopicCard`, web `BriefingLoader`), the completed-run recap, this-week mileage (iPhone chip `:2050` = actual done; web THIS WEEK `:3909`), tomorrow's preview (iPhone `:1735`, web `:3937`), the adaptation intent, and the niggle daily-check. A runner gets "what do I do today + how am I" on both. No core inconsistency found.

### 8.2 · iPhone shows that web doesn't
- **WeekStrip day-scrubber** (`TodayView.swift:239`) — tap any day in the 7-day strip and the hero repaints to that day's session (preview tomorrow's intervals from Today). Web uses week-offset nav but the Today hero is anchored to today.
- **Dedicated `TodayRecoveryPanel`** (`:375`) — a post-hard-session recovery read as its own panel.

### 8.3 · Web shows that iPhone doesn't
- **Training-form ring** (`TodayView.tsx:4312` — Fitness/Fatigue/Form label + helper action). iPhone has no training-form on any surface (Item 5.4). This is the chronic-load / "fresh vs fatigued" axis.
- **Readiness pillar interpretations** — web's Today readiness tap-through shows the `meaning` narrative per pillar; the iPhone driver rows drop `input.meaning` (Item 2.4).

### 8.4 · Single most useful thing missing from iPhone Today
**The training-form / "fresh vs fatigued today" read** (the web ring). Readiness answers *acute* recovery (did you sleep, is HRV down); training form answers the *chronic* axis (are you carrying fatigue from the block, are you overreaching). The web Today shows both side by side; the iPhone shows only readiness, so an iPhone runner can't see on their daily screen whether today's tiredness is a one-off or accumulated load. Add a training-form ring to iPhone Today (data already on the brief). (Ties Item 5.4.)
**Awaiting:** DECISION (iPhone). **Any-runner:** YES.

### 8.5 · Note · both de-emphasize standing recommendations
Web `StandingRecAdvisory` is marked GUTTED per David (`TodayView.tsx:577`, no-reactive-coach), and the iPhone has no standing-advice card either — consistent with the locked doctrine. Not a gap; noting for completeness.

---

## ITEM 9 · WATCH GLANCE / BETWEEN RUNS

Between runs (no active engine) the watch home is a 3-page swipe TabView (`WorkoutRootView.swift:160-168`): **page 0 = today's workout** (`IdleView` — tag/distance/pace-range/time + START; or `NoWorkoutView` on rest day; or `WaitingForPhoneView` if unpaired) · page 1 = JustRun escape hatch · **page 2 = `ReadinessGlanceView`**.

### 9.1 · Today's workout IS visible between runs · PASS
`IdleView` (the default page 0) shows today's session pulled from the iPhone over WatchConnectivity ("it's just there"), with a 14h staleness guard (`WorkoutRootView.swift:51` refuses a stale workout and re-fetches). A runner opening the watch sees today's workout immediately.

### 9.2 · Readiness IS shown — but two swipes away, and the coach line is dropped · ⚠️ MINOR
**Finding:** `ReadinessGlanceView` (page 2) shows the score (state-colored), one-word label, HRV·RHR subline, and race countdown, with an honest dashed empty state. Two issues: (a) it's **page 2** — a runner must open to the workout then swipe twice; readiness isn't visible on open. (b) **The coach recommendation line is fetched but never rendered** — `WatchReadiness.recommendation` ("Sleep banked. Today's session is good to go.") exists on the model (`ReadinessGlanceView.swift:110`) but the view body (`:44-61`) omits it. The single sentence of coaching the watch has is dropped. (Corroborates OVERNIGHT Item 19 #7.)
**Proposed fix:** render `r.recommendation` under the HRV·RHR subline; consider making readiness reachable in one swipe.
**Awaiting:** GO (watch; TestFlight). **Any-runner:** YES.

### 9.3 · 🚨 No complication / widget — nothing is actually glanceable between runs · MAJOR
**Finding:** `rg "WidgetKit|TimelineProvider|ComplicationController|CLKComplication"` across `legacy/native` + `native-v2` → **0 hits**; there is no Widget Extension target in the Xcode project (targets: Faff, FaffWatch Watch App, + test targets only). So between runs there is **zero Faff information on the watch face** — to see today's workout or readiness the runner must launch the app and (for readiness) swipe twice. The watch's core value — a wrist-glance at "what's today / am I ready" without opening anything — does not exist. (Confirms OVERNIGHT Item 19 #8.)
**Proposed fix:** a watchOS complication (WidgetKit `AppIntentTimelineProvider`) showing today's session tag (e.g. "5×1mi @ T") + readiness score/band, refreshed from the same `/api/watch/today` + `/api/watch/readiness` the app already fetches. This is the single highest-value watch addition.
**Falsifier:** a watch-face complication shows "TODAY · TEMPO 8mi" + "READY 72" without opening the app.
**Awaiting:** DECISION (build — new widget target). **Any-runner:** YES.

### 9.4 · What a runner should be able to glance at (the bar)
Between runs the runner wants, from the wrist face: (1) today's session in one line, (2) readiness score + band, (3) optionally days-to-A-race. (1)+(2) exist in the APP but require opening + swiping; none is on a complication. Closing 9.3 delivers the actual "glance." Minor: easy/long work faces show HR as bare bpm rather than a zone label (OVERNIGHT Item 19 #9) — a between/within-run readability gap.

---

## ITEM 10 · INFORMATION ARCHITECTURE

**Nav (grounded):** Web (`Shell.tsx:26-37`) = Today · Train · Health · Targets (=/races) · Activity (=/log) · Profile. iPhone (`RootTabView.swift:28`) = Today · Train · Health · Targets + center RUN action; **Activity is NOT a tab** — it's a deep-link route (`:62`). Watch = state machine (Item 9).

### 10.1 · The Today→Train→Health→Targets hierarchy is sound · PASS
The five-surface order is coherent: daily execution (Today) → the plan (Train) → the body (Health) → the goal (Targets) → the past (Activity). Each surface has a clear primary job. The spine is right.

### 10.2 · 🚨 Same core metrics show DIFFERENT values across surfaces · MAJOR (the corrosive one)
**Finding:** Three canonical numbers each have >1 read path that can disagree on the same day — the IA-level manifestation of the store-vs-recompute splits:
- **Readiness** — live `/api/readiness` ≈ 44 today vs stored `readiness_snapshots` = 38 (Item 2.3). Surfaces it on Today (panel), Health (hero), and the standalone breakdown.
- **Goal status** — `composeStatus` (readiness-rolled → **off** today, `race-header.ts:123`) drives the /today bib, while `goal-projection` drift status (→ likely **watching**) drives the Targets page (`seed.ts:2110`). Same race, two statuses (Item 3; OVERNIGHT Item 15).
- **VDOT** — live profile recompute vs stored snapshot (OVERNIGHT B2/B4).
A new user who sees "READY" on Today and a lower readiness on Health, or "off track" on the bib but "watching" on Targets, can't tell which is authoritative — and one contradiction erodes trust in every number.
**Proposed fix:** one canonical read per metric per day; secondary surfaces display it, not recompute it. (Ties Items 2.3, 3, OVERNIGHT B2/B4.)
**Awaiting:** DECISION (architectural). **Any-runner:** YES.

### 10.3 · ⚠️ "Form" is overloaded on the Health page · MINOR
The Health page has a **FORM** section (running biomechanics: cadence/GCT/stride/vert-ratio/power) AND a **TRAINING FORM** insight (CTL/ATL/TSB). Two unrelated meanings of "form" on one screen (Items 1.1, 5.1). A runner reading "FORM" can't tell if it's their stride mechanics or their fitness/fatigue balance.
**Proposed fix:** rename the biomechanics section "RUNNING FORM" or "MECHANICS"; keep "TRAINING FORM" for TSB.
**Awaiting:** DECISION. **Any-runner:** YES.

### 10.4 · ⚠️ Activity (history) is demoted to a hidden deep-link on iPhone · MAJOR
**Finding:** Web treats Activity as a primary nav surface; iPhone drops it from the tab bar (`RootTabView.swift:62 case activity` lives outside `FaffTab`). A new iPhone user has **no obvious way to review their training history / run log** — the surface exists but isn't navigable from the bar. (Also inverts the cross-surface authority: Health/Readiness are richer on web — Items 1,2 — while the Targets projection is richer on iPhone — Item 3.3 — so "which surface owns this domain" flips by domain.)
**Proposed fix:** add Activity to the iPhone tab bar (or a clear entry from Today/Profile); align which surface is authoritative per domain across web/iPhone.
**Awaiting:** DECISION. **Any-runner:** YES (iPhone users).

### 10.5 · Single most confusing thing for a NEW user
**Two-layered:** (1) *findability* — "where is my plan / my history?" splits across Today (today only), Train (the week), Targets (the goal), with Activity hidden entirely on iPhone; there's no single "this is your training" home. (2) *trust* — the same metric (readiness, goal status) shows different values on different tabs (10.2). The first is felt on day one; the second is what makes a user stop believing the app. **Fix priority:** 10.2 (single canonical read) is the deeper win; 10.4 (Activity tab on iPhone) is the cheap immediate one.

---

---

# FINAL SUMMARY

Covered all 10 queue items, read-only throughout (`faff_readonly`, write-denied verified). Zero deploys, zero data writes. Every finding is `file:line`- or real-DB-value-anchored. Two prior claims corrected by falsification: **readiness cold-start IS fixed** (OVERNIGHT item-14 now stale — `readiness.ts:224` returns `unknown`), and my own draft Item 2.5 (ACWR is 7d/28d on both surfaces, not two windows).

**Headline:** the WEB surfaces are mature and mostly correct; the recurring real problems are (a) **the iPhone lagging the web** (fabricated Health values, deprecated overview shape, missing tiles/training-form, dropped readiness meanings), (b) **a handful of display-logic bugs that show a runner a wrong value**, and (c) **the same metric disagreeing across surfaces** (store-vs-live).

## 🚨 Shows a runner WRONG information (fix first)
1. **4.2 — Web Activity renders every run as "easy."** Effort is classed by `r.type` (sport "Run") not the plan-matched `workoutType`; David's threshold + long runs show as easy across the recent dots, the effort-mix donut (~100% easy), and the heatmap. **iPhone already does it right** (`workoutType ?? type`). One-line fix ×3 builders. *(GO-ready)*
2. **1.2 — iPhone Health fabricates body metrics.** Cold-start / no-data shows hardcoded "VO₂ 61.4 / HRV 52 / RESP 15.1" + seeded fake trend charts + hardcoded coach lines ("aerobic engine is climbing"). Web shows honest "—".
3. **1.4 — iPhone Health recovery panel shows fake per-pillar precision** (one `daysSince/recoveryDays` % copied to all 4 pillars) + an **EARLIEST QUALITY countdown** that violates the locked no-reactive-coach doctrine. Web removed both.
4. **5.2 — Health training-form band ladder contradicts the labels.** A runner at TSB −20 is labeled LOADED by the code but the on-screen explanation says <−15 = overreach. *(GO-ready)*
5. **3.2 — Web Targets says "raw fitness reads X · ahead of the target"** even when current fitness is *behind* the goal (the normal on-track mid-build state). Latent for David (watching today), live for any on-track runner. iPhone copy is correct. *(GO-ready)*
6. **2.2 — Readiness swings on a single night's HRV** (`hrvAll.at(-1)`); today HRV 29 froze a 38 PULL-BACK while the live value is 42 → ~44. Research/15:101 says flag on the rolling average, not one night.
7. **10.2 — Same metric, different values across tabs** (readiness 44 live vs 38 stored; goal "off" on the bib vs "watching" on Targets). Erodes trust in every number.

## ⚠️ Missing / significantly affects training
- **1.3** iPhone BODY missing 7 tiles (weight, body fat, lean mass, SpO₂, max HR, active energy, HRV CV) + a phantom BODY TEMP tile (no source).
- **7.1** No niggle/injury **history** view (David has 2 logged, never shown back). **7.2** No race-result capture/history (the AFC→CIM backbone).
- **5.4 / 8.4** No training-form display on iPhone at all (web has a /today ring). **5.3** `trend7` computed, never shown.
- **9.3** No watch complication — nothing is glanceable between runs without opening the app. **9.2** watch readiness coach line fetched but dropped.
- **2.4 / 6.3** Jargon (HRV/ACWR/TSB/"pull-back band") never defined; iPhone readiness drops the `meaning` narrative entirely.
- **6.2** Strength intents logged non-idempotently → ×8 dupes + same-day resume/skip contradiction. *(GO-ready)*
- **3.4** No confidence interval on the projected finish. **4.3** Activity feed: generic "Run" names + no verdict badge. **10.3** "Form" overloaded (mechanics vs TSB). **10.4** Activity demoted off the iPhone tab bar.

## ✅ Confirmed PASS / genuinely good
Web Health tab (comprehensive, unit-correct, honest empty states); readiness compute (single-sourced, research-grounded, cold-start fixed); web Targets (gap + goal-VDOT + PRs + test points); **iPhone projection panel** (gap decomposition + hit list — better than web on-track); training-form model (real Banister); **coach voice** (consistent, on-doctrine, explains WHY, session-aware — the strongest surface); Today core consistency; PR tracking (3 surfaces); fueling plan (RaceView).

## Ready for GO (code-only, low-risk, no data write)
- **4.2** web Activity effort → `mapType(r.workoutType ?? r.type)` (match iPhone).
- **5.2** rewrite Health-tile TSB band ladder to the real `labelForTsb` cutoffs.
- **3.2** guard the Targets on-track caption (only "ahead" when `fit ≤ goal`).
- **6.2** add `ON CONFLICT` idempotency to strength-recommender inserts.
- **9.2** render `r.recommendation` on the watch readiness glance.

## Needs DECISION (build / architecture / product)
- iPhone Health parity: stop fabricating (1.2), add 7 tiles + drop phantom (1.3), repoint to current backend shape (1.4).
- Readiness HRV window (2.2) + one canonical read per metric (2.3 / 10.2 / OVERNIGHT B2/B4).
- Watch complication (9.3 — new widget target). Training-form on iPhone (5.4/8.4). Activity tab on iPhone (10.4).
- Build review surfaces for captured data: niggle/injury history (7.1), race-result capture (7.2).
- Projection confidence interval (3.4); define jargon / glossary (2.4/6.3); rename "Form" (10.3); weekly planned-vs-actual (4.5).

## Suggested morning order
1. Glance the 🚨 list. 2. GO the five code-only fixes (4.2, 5.2, 3.2, 6.2, 9.2) — all low-risk, all falsifiable. 3. Decide the iPhone-parity batch (1.2/1.3/1.4 + 5.4) — it's the biggest cluster and all one surface. 4. Decide the architectural canonical-read (10.2) and the watch complication (9.3). 5. Schedule the review-surface builds (7.1/7.2) before AFC.

_Temp RO harness left untracked at `web-v2/scripts/_uihealth_ro.mjs` + `_q_*.sql` (guarded — refuses any non-`faff_readonly` URL); safe to delete or keep for re-running falsifiers._
