# Coach simulation deck — 2026-05-19

**State of the system after tonight's overnight push (main at `1d4450f`).** Honest read of what's working, what's partial, what's missing. Real data where the system has it, hypothetical where it doesn't. No fake green pills.

**Verdict pills:**
- ✅ **WORKING** — shipped, behaving correctly with real data
- ⚠️ **PARTIAL** — logic exists but hasn't fired in real conditions, or shipped piece is incomplete
- ❌ **GAP** — should exist, doesn't yet

---

## Summary

- **A · Current state surfacing** — 2 ✅ · 3 ⚠️ · 1 ❌
- **B · Recent race ingestion** — 3 ✅ · 0 ⚠️ · 2 ❌
- **C · Adaptive triggers** — 0 ✅ · 7 ⚠️ · 0 ❌
- **D · Coaching voice** — 3 ✅ · 2 ⚠️ · 1 ❌
- **E · Edge cases & failure modes** — 0 ✅ · 3 ⚠️ · 3 ❌
- **F · Editorial** — see end

**Net read:** the surfaces that ship today work and speak coherent English. The adaptive triggers are all written but unfired in real conditions — they're scaffolding waiting for events. The edge cases mostly aren't built. The deck's job is to make that scaffolding-vs-shipped distinction legible.

---

## Section A · Current state surfacing

### A1 · Coach Reads card: VDOT explanation with weight breakdown
**Input:** David, 2026-05-18, 4 curated races
**Output:** "Your current VDOT is **45.7**. Anchored by your Half Feb 1 (1:34:54 → VDOT 48.1), weighted 38.7% of the total. This race is your goal-distance tier and falls inside your current training cycle, so it carries full weight despite being 106 days old. Half May 3, Marathon contribute the remaining 61.3% via adjacent-tier recency decay."
**Verdict:** ✅ **WORKING** — explainer paragraph writes itself from contributor data, per-contributor flags (✓ chip time / goal-tier / ⊕ full weight) render in badges, cycle-window note explains the C3 exemption.

### A2 · Coach Reads card: pace bands display (canonical Daniels)
**Input:** VDOT 45.7 (interpolated)
**Output:** Label reads "Pace Bands · canonical Daniels for VDOT 45.7 (interpolated)"; bands are E/M/T/I/R from the canonical Table 2 resolver; footnote cites the source images.
**Verdict:** ✅ **WORKING** — pacesFromVdot delegates to resolveTrainingPaces, source-priority chain encoded, snapshot tests pin 6 rows. Migration banner sits above the bands pending one-time user confirmation.

### A3 · Coach Reads card: HR zones + max HR validation
**Input:** max 175, resting 45
**Output:** HR zones now use HRR (Karvonen): Z2 cap rises from 122 (%max) to ~136 (HRR). Validator UI flipped: "⚠ Suspect ceiling" when ≥3 readings within 3 bpm of stored max, instead of "Confirmed across N runs".
**Verdict:** ⚠️ **PARTIAL** — HRR shipped, validator copy flipped, but the validate-max-hr.ts logic itself doesn't yet *fire a verdict* when sustained-effort peaks cluster near stored max. The banner only renders on direct excess (peak > stored), not on the "you're hitting max too often, this ceiling is suspect" signal. Logic still needs the new rule.

### A4 · TodayCard: workout with range + conditional guidance
**Input:** Tomorrow's prescription
**Output:** Single pace target rendered (e.g., "Easy 8 mi @ 8:38/mi"). No range display, no conditional guidance for legs-heavy / HR-drift / hot-weather scenarios.
**Verdict:** ❌ **GAP** — N1 deferred. The resolver returns a range (eLow/eHigh) but TodayCard reads only the single value. The data shape is there; the UI extension is the missing piece.

### A5 · Active plan view: current week
**Input:** Current 4-week build phase
**Output:** Week renders with prescribed workouts, each linked to its detail page. Plan tracking (prescribed vs actual mileage) presence not audited in tonight's pass.
**Verdict:** ⚠️ **PARTIAL** — exists, but tonight's pace migration may have shifted workout pace targets in ways the plan view doesn't visually call out. Plan-vs-actual mileage delta tracking presence unverified.

### A6 · Active race view: AFC HM countdown + readiness
**Input:** AFC HM Aug 16, 90 days away
**Output:** Countdown card now shows BOTH days-to-race AND readiness math:
```
90 days to go
Aug 16, 2026 · Half Marathon · 13.11 mi
─
Readiness
Projected at current VDOT 45.7: 1:39:35
Goal 1:30:00 requires VDOT 51.3
Gap: 5.6 VDOT points / ~30 sec/mi T pace
```
**Verdict:** ⚠️ **PARTIAL** — readiness shipped (`8f0acb2`), but "trajectory" piece (on track / behind / ahead based on key-workout adherence + HR-pace drift) is deferred. The gap is rendered honestly; the *direction of travel* is not.

---

## Section B · Recent race ingestion

### B1 · Disney HM Feb 1 · goal-tier anchor
**Input:** 1:34:54 (5694s), 106 days old, source='manual', stravaActivityId=17250968534
**Output:** VDOT 48.1, weighted 38.7% (full weight via cycle-aware exemption — goal-tier + in-cycle). Flagged as ✓ chip time, goal-tier, ⊕ full weight in Coach Reads.
**Verdict:** ✅ **WORKING** — drives the aggregate as intended.

### B2 · LA Marathon · chip-time divergence banner
**Input:** curated 3:31:40 (12700s) vs Strava 3:30:25 (12625s), Δ +75s
**Output:** On `/races/la-marathon-2026`, a banner between breadcrumb and coach strip:
> ⏱ Chip time used · Strava elapsed differs
> Your chip time of 3:31:40 is what the coach uses for VDOT computation. The matched Strava activity shows 3:30:25 — 75s slower than your watch recorded.
**Verdict:** ✅ **WORKING** — banner generalizes to any race with a chip-time/Strava-elapsed gap ≥ 2s.

### B3 · Big Sur Marathon · "hilly course excluded from VDOT"
**Input:** 3:36:55 (13015s), 22 days old, source='manual'
**Output:** **Currently INCLUDED in aggregate** at VDOT 42.9, weight 14.3% (adjacent-tier, recent, recency 0.78). Pulls aggregate down because Big Sur's net elevation makes the time slower than equivalent-effort flat course time would be.
**Verdict:** ❌ **GAP** — no hilly-course exclusion logic. David's mental model says Big Sur shouldn't count; the system has no way to know that. Needs the race-effort-level flag (tune-up / A-race / hilly-course exclusion) David already deferred to future ticket.

### B4 · Sombrero Half May 3 · goal-tier co-contributor
**Input:** 1:40:57 (6057s), 15 days old, source='manual'
**Output:** VDOT 44.7, weighted 38.7% (full weight via cycle-aware exemption — goal-tier + in-cycle). Equal weight with Disney HM Feb 1.
**Verdict:** ✅ **WORKING** — included after tonight's dedup fix. Pulls aggregate down to 45.7 because it's slower than Disney HM; honest read of fitness if treated as full goal-tier effort. (Future: tune-up flag would let David mark this as not-an-A-race-effort.)

### B5 · 10K from March · adjacent-tier decay
**Input:** the "10K 44:57" mentioned in prior conversations
**Output:** No 10K entry exists in the curated races table. Doesn't enter the aggregate.
**Verdict:** ❌ **GAP** — prior calculations assumed this contributor; strict Option-B revealed it isn't actually present. Either David has a 10K to add (along with Rose Bowl), or this contributor was never real. Either way: not in the system today.

---

## Section C · Adaptive triggers

> All seven of these have **logic written** but haven't fired in real conditions during tonight's session. Per the honesty constraint, all PARTIAL with explicit "hypothetical — system has the logic but hasn't fired in real data yet" caveats.

### C1 · 3 consecutive T workouts faster than prescribed at controlled HR → VDOT bump?
**Logic location:** adaptive-pattern.ts (Rule: multi-corroboration before adjusting prescription)
**Hypothetical output:** "3 of your last 4 threshold workouts came in 5-8 sec/mi faster than prescribed at HR ≤ 158. That's evidence your VDOT may have moved up. Suggest: bump VDOT 45.7 → 46.5 (with evidence: workouts of date X/Y/Z). Confirm to apply."
**Verdict:** ⚠️ **PARTIAL** — adaptive-pattern.ts has the rule framework; the actual trigger surface hasn't fired with David's workout history in this session.

### C2 · 3 consecutive T workouts slower despite good recovery → downgrade?
**Hypothetical output:** "3 of last 4 thresholds came in 5-8 sec/mi slower than prescribed, none flagged as hot/hilly/recovery-compromised. Suggest: review whether VDOT 45.7 is too high. Confirm to investigate or dismiss."
**Verdict:** ⚠️ **PARTIAL** — same framework as C1; no historical workouts have triggered it in real data.

### C3 · HM avg HR 161 → max HR validation banner appears
**Hypothetical output:** Validator computes 161/0.92 to 161/0.88 = 175-183 implied max → suggests bump to 179. Banner fires with reason + falsifier.
**Verdict:** ⚠️ **PARTIAL** — validator logic exists (Rule 2: race-suggests-higher); fires if Sombrero or Disney avg HR is high enough. The `/api/admin/race-hr-diagnostic` endpoint shipped tonight surfaces avg HR per race so you can test this with real data.

### C4 · Large pace shift on refresh → large-shift guard catches it
**Real signal:** the pace-band migration banner is exactly this scenario, firing once. Sim sweep documented 25 cells exceeding 15s/mi threshold across the VDOT range.
**Verdict:** ⚠️ **PARTIAL** — the one-time migration banner is shipped (`PaceMigrationBanner.tsx`) and represents this firing. The ONGOING guard (post-migration, new race → new VDOT → check before applying) isn't separately UI-built; the migration ack pattern covers the immediate case.

### C5 · Race a 10K at VDOT 49 equivalent → propose update with evidence
**Hypothetical output:** "Your Aug 12 10K at 41:21 implies VDOT 50. Current aggregate 45.7. Suggest: bump aggregate to ~47-48 weighted by the new race's recency × length × tier."
**Verdict:** ⚠️ **PARTIAL** — compute-vdot would re-run on the next sync; large-shift guard would catch the magnitude; no explicit "propose update" UI surface beyond what already exists.

### C6 · ONE good workout → confirm VDOT does NOT bump
**Hypothetical output:** Single 5-sec-fast threshold doesn't trigger anything. Banner stays silent.
**Verdict:** ⚠️ **PARTIAL** — the multi-corroboration rule in adaptive-pattern.ts is exactly this guard. Hasn't been adversarially tested.

### C7 · ONE bad hot-day workout → context filter attenuates, no downgrade
**Hypothetical output:** Hot-day attenuation rule prevents the slow effort from counting as fitness evidence.
**Verdict:** ⚠️ **PARTIAL** — context-filter rules exist in adaptive-pattern.ts; environmental modifiers live in pace_zones.ts. Hasn't been adversarially tested.

---

## Section D · Coaching voice

### D1 · Aggregate explainer paragraph
**Output (real):** See A1.
**Verdict:** ✅ **WORKING**

### D2 · Cycle-window explainer
**Output (real):** Small purple-bordered note in VDOT section: "Cycle window: goal-tier races on or after Jan 27 count at full weight regardless of age. Off-distance races decay normally over ~90 days."
**Verdict:** ✅ **WORKING**

### D3 · Chip-time correction narrative
**Output (real):** See B2. Banner on `/races/la-marathon-2026`.
**Verdict:** ✅ **WORKING**

### D4 · Pre-workout briefing for tomorrow (N7 spec)
**Spec:** "Tomorrow: [workout]. Target [pace]. Weather: [forecast]. Shoes: [rec]. Last similar: [date + outcome]."
**Verdict:** ❌ **GAP** — N7 deferred. Wider integration surface (weather + shoe rotation + last-similar-session) than tonight's scope allowed.

### D5 · Race countdown with trajectory
**Output (real):** See A6. Readiness math present.
**Verdict:** ⚠️ **PARTIAL** — readiness gap shipped, trajectory piece (on track / behind / ahead) deferred until passive VDOT updater signals exist.

### D6 · Migration banner with before/after framing (N10 spec)
**Output (real):**
> ⚙ ONE-TIME PACE CORRECTION
> Your training paces have been updated to canonical Daniels values from the official Table 2 source. The previous formula was derived from race times and drifted from the canonical bands — Easy paces ran too slow (over-conservative), Repetition paces ran too fast (mile race pace instead of Daniels' R).
> [Confirm canonical paces]

**Spec wanted (N10):** Specific before/after numbers — "Previous (race-derived): E 8:49-9:19, T 7:21, I 6:54 → Now: E 8:25-8:45, T 7:08, I 6:31".
**Verdict:** ⚠️ **PARTIAL** — banner shipped, copy explains the why, but doesn't show specific before/after pace numbers. N10's "deliberate edit" framing is the missing polish.

---

## Section E · Edge cases & failure modes

### E1 · Miss 3 days in a row
**Verdict:** ❌ **GAP** — no explicit behavior for missed-day clusters. Coach Reads/TodayCard don't acknowledge sustained gaps in activity. Would need a "haven't run in N days" signal feeding into the engine and a corresponding voice.

### E2 · Morning after a race
**Verdict:** ❌ **GAP** — no specific morning-after-race behavior. The coach doesn't know to say "yesterday was a race effort, today is recovery." Tomorrow's TodayCard would prescribe the planned workout without context-awareness.

### E3 · Workout fires large-shift guard
**Verdict:** ⚠️ **PARTIAL** — guard exists (`adaptive-pattern.ts → requiresLargeShiftConfirmation`), and the one-time pace migration banner is its current UI surface. No second UI surface yet for ongoing per-workout large shifts.

### E4 · Stale Strava data (no recent activity)
**Verdict:** ⚠️ **PARTIAL** — strava staleness presence on /profile not audited tonight. Likely some signal exists for "last sync time" but not for "no run in 14 days, are you injured?"

### E5 · No upcoming race set
**Verdict:** ⚠️ **PARTIAL** — `resolveGoalRace` falls back to most recently saved race when no upcoming exists; cycle window still resolves; coaching defaults still apply. UX should explicitly note "no goal race — set one to anchor your training" but I haven't audited the no-race state visually.

### E6 · Crossing from one training cycle to the next (Aug 17, day after AFC)
**Verdict:** ❌ **GAP** — no explicit transition logic. After Aug 16's HM, the system should know to: archive the active plan, transition the cycle window, suggest a recovery week, eventually propose the next build phase toward CIM. None of this is built.

---

## Section F · Editorial — gaps, opportunities, and tonight's lessons

### F1 · Fresh gaps surfaced during tonight's review

**Phantom-race noise floor (the 5K bug)** — fixed in `1d4450f`. compute-vdot was reading from `strava_activities` with a LEFT JOIN to races, so an auto-detected 5K best-effort segment leaked into the aggregate at VDOT 33.6, dragging it down ~0.4 points. The lesson: when curated and inferred data coexist, the trust boundary needs to be explicit. Strict Option-B (read only from races table) is the right default.

**Dedup-by-canonical-distance silently dropped Sombrero** — fixed in `1d4450f`. The "fastest per bucket" heuristic from the old top-3-average aggregate didn't translate to cycle-aware weighting; Sombrero Half (1:40:57) was being hidden behind Disney HM (1:34:54) in the Half bucket. The lesson: each race is its own signal; let weighting handle ordering, don't pre-dedupe.

**Max HR validator inverted logic** — UI flipped in `1d4450f`, validator logic still partial. "Confirmed across 6 runs hitting 175" was reading sustained effort as evidence the stored max is correct, when it's actually evidence the stored max is too low. A true physiological max appears briefly on terminal efforts, not repeatedly on sustained races. The lesson: the cluster pattern that "feels like confirmation" is actually the strongest disconfirming signal.

**HR zones too conservative under %max framework** — fixed in `1d4450f`. Z2 capped at 122 for max 175 (%max) vs ~136 for max 175 + resting 45 (HRR). The %max framework systematically underestimates zone ceilings for trained runners with low resting HR. The lesson: framework choice matters more than the percentages once you account for resting HR. HRR + Karvonen is the honest default when resting HR is known.

**Rose Bowl Half (David's Jan 18 race) missing from curated table** — flagged tonight by David. Race wasn't migrated when the system was bootstrapped. Race entry needs adding (with curated chip time).

**Race-priority editing UI absent** — the `/races/[slug]` page shows priority (A/B/C) but doesn't expose an edit affordance. David flagged this when reviewing the Recent Races strip; without an edit UI, priority becomes a write-once-via-database-seed field, which isn't how race priorities actually evolve.

### F2 · "Top 3 recommended next builds" based on what tonight's deck revealed

**1. Race-effort-level flag (tune-up / A-race / training run) + race-priority editing UI.** This is the single biggest aggregate-honesty improvement available. Right now Sombrero Half is dragging David's aggregate down because the system treats it as a full goal-tier effort when David ran it as a tune-up. Adding a `race_effort_level` field to `actual_result` (alongside the existing priority on meta) plus a small edit UI on `/races/[slug]` lets the user mark efforts honestly. The aggregate weighting takes a multiplier — tune-ups would get e.g. 0.4×, A-race results 1.0×. This combined work also covers the race-priority editing gap David flagged tonight.

**2. Pre-workout briefing on TodayCard (N7).** The single largest "the coach feels generic" gap. Tomorrow's workout shows a pace but no context — no weather, no shoe rec, no "last similar session". TodayCard is the surface a runner sees daily; right now it's a calculator more than a coach. The wiring is wider than one component (weather integration, shoe rotation rules, last-similar-session query) but each piece is well-defined.

**3. Adaptive trigger surfacing — actually fire C1-C7 in production.** All seven trigger types in Section C exist as logic but none have fired in real conditions in this session. The framework is there; what's missing is the connection from "the rule says fire" to "the user sees a banner". This is where the 'alive but not nervous' philosophy becomes visible: when David's threshold workouts collectively drift faster, the coach should notice and ask. Right now it would, in theory, but no one's verified it would actually surface.

### F3 · The deck's editorial read

Things that currently show numbers but no explanation: the heart rate zones table on /profile shows bpm ranges but doesn't say "this is HRR-based now because your resting HR is known" — even after tonight's fix.

Things the coach should know but doesn't yet: which races were tune-ups vs A-race efforts; whether a course is hilly enough to systematically distort the time-to-VDOT mapping; what David's actual avg HR was during Sombrero (the `/api/admin/race-hr-diagnostic` endpoint surfaces this but it's not in any user-facing UI).

Things the coach knows but doesn't surface: weight breakdown per VDOT contributor (now shipped on Coach Reads, well surfaced); cycle window start (shipped, well surfaced); chip-time vs Strava divergence (shipped on race detail page); the readiness gap to the goal (shipped on race detail page).

Behavior that's "almost right" but needs a small fix: the max HR validator UI now says "Suspect ceiling" when it should but the underlying validator rule that fires the banner still uses the old "peak exceeds stored" trigger. It needs the new "sustained-effort cluster near stored max" trigger added.

Things that exist but don't talk to each other: race-detail page knows the goal time and current fitness, but doesn't read tonight's HR-diagnostic endpoint to surface "your Sombrero avg HR of X means your stored max might be too low" — that signal lives across two endpoints with no bridge between them yet.

---

## Tonight's commits (closing artifact)

In order:
- `d9af552` — pace-band sim sweep diff report (P0 step 1)
- `5df4a35` — pacesFromVdot → canonical Daniels + Coach Reads enrichment + aggregate explainer + cycle note (P0 step 2-3, P1 step 4+6)
- `986cbb7` — LA Marathon chip-time divergence banner (P1 step 5)
- `8f0acb2` — race countdown with readiness math (P1 stretch step 8)
- `1c21348` — morning HTML report at `docs/2026-05-19.html`
- `1d4450f` — honesty pass: 7 issues from David's Coach Reads review
- (this commit) — simulation deck at `docs/simulations/coach-simulation-deck.md`

**Background agents this session:**
- `24e4537` — Agent A · retrospective fixture restored
- `6689af7` — Agent C · build-ramp peaks-too-early fix
- `caea219` — Agent D · VO2max wellness fold with corrected scope
- Agent B · no-op (HANDOFF ✓ pins already on main)

**Tests:** 478 passed, 4 skipped, 0 failed across 36 files.

**Aggregate state:** VDOT 45.7, pace bands canonical Daniels (interpolated VDOT 45.7), HR zones HRR-based, migration banner pending one click on `/profile`.

---

*Deck generated 2026-05-19 ~07:00 PT. Versioned for week-over-week diff per David's request — keep this around when the next deck lands.*
