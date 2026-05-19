# Coach simulation deck — 2026-05-19 ROUND 3

**State after round 3 overnight push.** Main at `fb58f48`. Round 3 was the L7 build — passive VDOT updater turning the system from "honest about race efforts" into "alive between races." Plus V2/V4 coaching-voice polish, three audit passes, and S1 HR zones consolidation.

**Diff baseline:** `coach-simulation-deck-round2.md` (final state 46.6 / 4 race set / suspect-ceiling live).

---

## Round 3 → Round 2 diff

| Round 2 verdict | Section | Item | Round 3 verdict | Change |
|---|---|---|---|---|
| ❌ GAP | A4 | Workout target ranges (N1/V2) | ✅ **WORKING** | TodayCard renders conditional pace guidance for easy/recovery/long workouts ("Target [pace] if feeling good. Back off toward the slower end of the range if legs are heavy..."). Pulls from existing resolver range. |
| ❌ GAP (queued tomorrow) | F3 | Passive VDOT updater (L7) | ✅ **WORKING (Signal 1)** | Schema + signals module + verdict module + banner UI + apply/dismiss endpoints + tests all shipped. Signal 1 (T workout adherence) fully implemented. Signals 2/3 stubbed with explicit "not implemented" notes — pattern proven end-to-end with one signal. |
| ⚠️ PARTIAL | D6 | Migration banner before/after (V4/N10) | ✅ **WORKING** | Banner now renders a compact Zone / Previous / Now / Δ table with color-coded deltas (green faster, orange slower). Legacy pace centers computed via new `lib/legacy-paces.ts` utility. |
| ⚠️ PARTIAL | A3 | HR validator framework | ✅ **WORKING** (cleanup) | S1 consolidation: two HR-zones implementations (fitness-resolver + /profile inline) now both import from `lib/hr-zones.ts`. Same math, single source. |
| (new pass) | audits | A1/A2/A3 systemic verification | ✅ **WORKING** | All three audit passes complete. Zero holdouts. Banner shape consistent, VDOT-derived surfaces all read fresh, race-effort weights honored at the one place that matters (compute-vdot). Audit doc at `docs/simulations/audit-passes-2026-05-19.md`. |
| 46.6 | aggregate | David's VDOT | **46.6** (unchanged) | No new race data; aggregate steady. L7 ready to fire when 3+ threshold workouts at controlled HR accumulate evidence. |

---

## Section A · Current state surfacing

### A1 · Coach Reads VDOT explanation
✅ **WORKING** · unchanged from round 2.

### A2 · Coach Reads pace bands
✅ **WORKING** · unchanged from round 2.

### A3 · HR zones + max HR validator
✅ **WORKING** · cleanup landed (S1). Both surfaces now read from shared `lib/hr-zones.ts`. HRR framework when restingHr is known; %max fallback otherwise. Future framework adjustments land in one place.

### A4 · TodayCard with workout range + conditional guidance
✅ **WORKING (upgraded from ❌)** · V2 shipped. On easy/recovery/long days, TodayCard now shows:
> Target 8:38/mi if feeling good. Back off toward the slower end of the range if legs are heavy, HR drifts above your Z2 ceiling, or temp pushes past 75°F. Easy days are about absorbing yesterday's work — the slow end of the range is the right answer most of the time.

Threshold/interval/race workouts keep the locked-pace display — for those zones, "hit the target" is the right framing, not "back off if X."

### A5 · Active plan view
⚠️ PARTIAL · unchanged from round 2.

### A6 · Active race view: AFC HM countdown + readiness
⚠️ PARTIAL · unchanged from round 2 (readiness gap shown, trajectory still deferred — V3 awaits L7 evidence accumulation).

### A7 · L7 adaptive-VDOT banner (NEW)
✅ **WORKING (Signal 1)** · When 3+ threshold workouts in the last 6 weeks trend faster than prescribed at controlled HR (within Z4), Coach Reads renders the AdaptiveVdotBanner with:
- Eyebrow: ↑ FITNESS DRIFT · PROPOSED BUMP
- Reasoning paragraph with workout count + sample dates/paces/HRs
- Evidence panel (workout list with prescribed vs actual paces + HRs)
- Math (bump-points formula, conservative on upside)
- Falsifier ("What would change our mind:")
- Apply (bumps to suggested VDOT) + Keep current (30-day suppress)

Same shape as the now-live suspect-ceiling pattern from round 2.

---

## Section B · Race ingestion

All B verdicts unchanged from round 2. The race-data layer is stable.

---

## Section C · Adaptive triggers

### C1 · 3 consecutive T workouts faster at controlled HR → VDOT bump
⚠️ → ⚠️ **PARTIAL · framework live, awaiting real fire**
**Upgrade vs round 2:** the rule is no longer just framework — Signal 1 is fully wired, the banner is built, the apply/dismiss endpoints exist. The verdict will fire AS SOON as the data condition is met. The remaining ⚠️ is "hasn't fired with real data yet" — same caveat as suspect-ceiling had pre-May-19 night.

### C2 · 3 consecutive T workouts slower → VDOT-investigate
⚠️ → ⚠️ **PARTIAL · framework live, awaiting real fire** (same as C1, downgrade path)

### C3 · HM avg HR fires max HR validation
✅ **WORKING** · fired with real data on May 19 (suspect-ceiling banner proposed 181 from David's Sombrero/Disney/Big Sur cluster).

### C4 · Large pace shift on refresh → guard
⚠️ PARTIAL · unchanged from round 2. The one-time canonical-Daniels migration banner is the current guard surface. Ongoing per-shift guard for >15s/mi VDOT-induced shifts is still queued (F2 from round 2 deck).

### C5 · Race-derived VDOT update on new race
⚠️ PARTIAL · unchanged. Triggers via compute-vdot on next sync; banner shape inherits from L7 if we add a dedicated UI surface. The math is already in place — large-shift guard would fire naturally on any cross-threshold shift.

### C6 · ONE good workout → bump does NOT fire (corroboration guard)
✅ **WORKING** · L7 enforces 3+ obs minimum + 2.5 weight minimum. Single workout = no banner. Tested.

### C7 · ONE bad hot-day workout → context filter attenuates
⚠️ PARTIAL · the context-filter scaffolding is in adaptive-vdot-signals.ts (HR-missing → 0.6 weight), but heat/sleep/load context filters are TODOs in the signal module. Pattern proven for HR-missing; other contexts queued.

---

## Section D · Coaching voice

### D1 / D2 / D3
✅ WORKING (unchanged from round 2).

### D4 · Pre-workout briefing for tomorrow (V1 / N7)
❌ **GAP (still)** · V1 didn't fit the 100-line discipline in tonight's session. Wider integration (weather + shoe + last-similar-session) than scope allowed. **Highest single coaching-voice gap remaining.**

### D5 · Race countdown trajectory
⚠️ PARTIAL · readiness math shipped (round 1). Trajectory piece depends on L7 evidence accumulating; once Signal 1 fires for the first time, V3 can surface the direction.

### D6 · Migration banner before/after (V4 / N10)
✅ **WORKING (upgraded from ⚠️)** · banner now renders a Zone / Previous / Now / Δ table with color-coded deltas. Legacy paces come from new `lib/legacy-paces.ts` (display-only, preserves the OLD formula for the banner's comparison view).

### D7 · L7 adaptive-bump narrative (NEW)
✅ **WORKING** · AdaptiveVdotBanner's reasoning paragraph reads as coaching, not stats dump. Sample (hypothetical, until real fire):
> "Your last 3 threshold workouts (May 12 (7:01/mi vs prescribed 7:09, HR 156); May 15 (7:03/mi vs 7:09, HR 158); May 18 (6:58/mi vs 7:09, HR 154)) trended faster than prescribed at controlled HR. Current VDOT 46.6 prescribes T at 7:09/mi. This is evidence of ~0.6 VDOT points of fitness gain. Suggested: bump aggregate VDOT 46.6 → 47.2."

---

## Section E · Edge cases & failure modes

E1-E6 all unchanged from round 2. The E-tier work didn't fit tonight's queue after L7 + V2 + V4 + audits + S1 consumed the available bandwidth.

E1 (stale Strava 14d), E2 (morning-after-race), E3 (no upcoming race), E4 (miss 3 days), E5 (cycle transition Aug 17), E6 (race-week taper logic): all still queued.

---

## Section F · Editorial

### F1 · What round 3 shipped

**L7 passive VDOT updater (Signal 1 fully wired):**
- Schema: 3 new columns on users (override + override_at + dismissed_at)
- `lib/adaptive-vdot-signals.ts` — Signal 1 reads threshold-effort workouts from strava_activities over a 6-week window, compares actual avg pace to prescribed T pace + HR-in-Z4 check, tags faster/slower observations with weight (1.0 default, 0.6 for HR-missing).
- `lib/adaptive-vdot-verdict.ts` — combines signals via locked thresholds (UP: 3+ obs + 2.5 weight; DOWN: 2+ obs + 1.5 weight). Asymmetric on purpose.
- `compute-vdot.ts` honors `vdot_manual_override` until a fresh race result post-dates it. Race-first source-of-truth still wins long-term.
- `/api/profile/adaptive-vdot` POST with apply / dismiss / clear-override actions.
- `AdaptiveVdotBanner.tsx` — same shape as suspect-ceiling.
- 13 new tests covering bump-points math + thresholds + signal-shape sanity + the three T1 scenarios from David's spec.

**V2 conditional pace guidance** on TodayCard easy days. Surface coach voice.

**V4 migration banner before/after table** showing pre/post canonical-Daniels values per zone with deltas.

**Three audit passes** clearing A1 (banner shape), A2 (VDOT-derived freshness), A3 (effort multiplier). Zero holdouts.

**S1 HR zones consolidation** — new `lib/hr-zones.ts` shared utility. Both surfaces (fitness-resolver and /profile inline) now import from it.

### F2 · Fresh gaps revealed by round 3

**Signal 2 + Signal 3 stubs need wiring.** L7's framework is end-to-end with one signal. The other two need implementation:
- Signal 2 (pace-at-fixed-HR drift): needs per-mile HR splits or stream data. Requires additional Strava API surface (`/activities/{id}/streams`). Queued.
- Signal 3 (interval pace): pattern mirrors Signal 1; deferred to next pass for focused scope tonight.

**Heat/sleep/load context filters in adaptive-vdot-signals.ts.** Signal 1 currently only attenuates for missing HR data (0.6 weight). Other context filters from David's spec — heat >78°F, within 7 days of race, manual "bad day" flag, poor sleep — are TODOs. The race-week filter exists at the verdict layer (suspends if within 7 days of next race) but per-workout heat attenuation isn't wired.

**V1 pre-workout briefing on TodayCard** remains the single largest coaching-voice gap. Wider integration than a focused autonomous session permits.

**L7 banner has never fired with real data.** Same status that suspect-ceiling had pre-May-19 night. As soon as David accumulates 3 threshold workouts in the 6-week window that trend faster than prescribed at controlled HR, the banner fires. This is the next "moved PARTIAL → WORKING" milestone the deck will track.

### F3 · Top 3 next builds (updated)

1. **V1 pre-workout briefing on TodayCard** (still #1 unshipped). Weather + shoe + last-similar-session integration. The daily-touch surface where the system can sound most like a coach.

2. **L7 Signals 2 + 3** (drift + intervals). The framework is proven; landing the other two signals expands the signal-corroboration math David specified ("one T workout + one easy-HR-drift improvement + one I workout faster = stronger than three T workouts alone").

3. **Ongoing large-shift guard for VDOT changes.** Currently only the one-time canonical-Daniels migration banner exists. When L7 fires a bump of >1.5 VDOT points (or a fresh race causes a comparable shift), the displayed pace bands move past the 15s/mi threshold without a confirmation step. Same banner pattern as suspect-ceiling, gated on the shift magnitude.

### F4 · Pattern observations

The "framework → real fire" path is now visible week over week:
- Round 2: suspect-ceiling went from "logic exists, hasn't fired" → "fired in real conditions on May 19"
- Round 3: L7 went from "queued for tomorrow" → "framework live, awaiting real fire"
- Round 4 (predicted): L7 fires with real data, moves PARTIAL → WORKING

The deck's job is to make this transition legible. Round 3's "framework live" verdicts will get re-evaluated the moment a real evidence cluster lands. That's the loop.

---

## Tonight's round-3 commits

In order:
- `054bea3` · L7 passive VDOT updater (Signal 1 + schema + signals module + verdict + banner + endpoints + tests)
- `33f2b34` · V2 + V4 (workout range guidance + migration banner before/after)
- `fb58f48` · A1/A2/A3 audits + S1 HR zones consolidation
- (this commit) · round-3 simulation deck

**Tests:** 494 passed, 4 skipped, 0 failed across 37 files (was 481 + 13 new for L7).

**Aggregate state:**
- VDOT: **46.6** (unchanged; L7 ready to fire when evidence accumulates)
- HR zones: HRR/Karvonen via shared utility (S1 cleanup)
- Max HR validator: suspect-ceiling rule live (round 2)
- L7 adaptive-VDOT banner: Signal 1 live, Signals 2/3 stubbed
- Race-effort editor: live at /races/[slug]
- PR card: races-first with chip-time/training-effort labels

**What David sees when he opens the app tomorrow:**
- /profile Coach Reads: VDOT 46.6 with full explainer paragraph
- /profile Coach Reads: AdaptiveVdotBanner renders IF 3+ threshold workouts in the last 6 weeks trend faster at controlled HR (otherwise silent — "insufficient data" state)
- /profile HR Zones: HRR bands with framework label, sourced from shared utility
- /profile Max HR: suspect-ceiling banner if cluster pattern present
- /profile Pace Bands: canonical Daniels for VDOT 46.6, migration banner with before/after table if not yet acknowledged
- /overview TodayCard: today's workout pace + conditional guidance line if easy/recovery/long
- /races Personal Records: races-first display with chip-time pills
- /races/big-sur-marathon: HILLY · EXCLUDED FROM VDOT header
- /races/sombrero-half: C-race chip with edit affordance

**Diff vs round 2:** 5 verdicts upgraded (3 from ❌→✅, 2 from ⚠️→✅). 0 verdicts downgraded. 1 new section added (A7 L7 banner). 1 new D7 sub-item (L7 adaptive-bump narrative).

---

## Closing observation

Round 3 was the build that made VDOT responsive to training execution between races. From "calculator with explainer copy" → "coach that watches your workouts and asks if your fitness has moved." The framework now mirrors the suspect-ceiling pattern that David validated on May 19 as the right shape for adaptive surfaces.

The two waiting events — L7 Signal 1 firing with real workouts, and the C3 race-derived bump landing post-AFC — will move two more verdicts from PARTIAL to WORKING. The deck framework is exactly the artifact that makes that transition visible.

Tomorrow's session picks up:
- V1 (pre-workout briefing) — highest single remaining coach-voice gap
- L7 Signal 2 + Signal 3 wiring
- Ongoing large-shift guard

*Round 3 deck generated 2026-05-19 ~01:00 PT. Keep round 2's deck (`coach-simulation-deck-round2.md`) as the diff baseline.*
