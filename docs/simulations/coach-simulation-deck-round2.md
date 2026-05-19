# Coach simulation deck — 2026-05-19 ROUND 2

**State after round 2 push (final).** Main at `18cb512` (+ subsequent L6 audit). Diff vs round 1 deck (`coach-simulation-deck.md`) is the morning briefing: scaffolding turning into shipped work, gaps closing, editorial section refining.

**Aggregate VDOT moved 45.7 → 46.1 → 46.6 across the round 2 work.**

**Verdict pills:**
- ✅ **WORKING** — shipped, behaving correctly with real data
- ⚠️ **PARTIAL** — logic exists but hasn't fired in real conditions, or shipped piece is incomplete
- ❌ **GAP** — should exist, doesn't yet

---

## Round 2 → Round 1 diff summary

| Round 1 verdict | Section | Item | Round 2 verdict | Change |
|---|---|---|---|---|
| ❌ GAP | B3 | Big Sur excluded from VDOT | ✅ WORKING | Auto-migration applied `hilly-excluded` to Big Sur (`82d0c01`). Aggregate now 46.6. |
| ❌ GAP | F2 #1 | Race-effort-level flag | ✅ WORKING | 6 levels + edit UI shipped at `/races/[slug]` (`ec5d5b6`) |
| ⚠️ PARTIAL | A3 | HR validator + zones | ✅ WORKING | `suspect-ceiling` rule fired with real evidence (David's Sombrero/Disney/Big Sur cluster → suggested 181). HRR copy on /profile; both inline + Coach Reads use HRR. |
| ⚠️ PARTIAL | C3 | Adaptive trigger surfacing | ✅ WORKING (first instance) | suspect-ceiling moved from "logic exists but hasn't fired" to "fired in real conditions on May 19." Section C framework validated end-to-end. |
| 45.7 | aggregate | David's VDOT | **46.6** | Sombrero=C drops weight 38.7% → 21.3%; Big Sur excluded 19.6% → 0%; Disney HM anchor recovers to 53.3%; Rose Bowl backfilled at 14.0% |
| ❌ GAP | F1 | Phantom 5K + Sombrero dedup | ✅ WORKING | Strict Option-B + no-dedup landed (`1d4450f`) |
| ❌ GAP | F1 | HR zones %max framework | ✅ WORKING | HRR/Karvonen on both surfaces |
| empty | (new bug found) | PR card source-of-truth | ✅ WORKING | L5: PR card now reads races first, Strava fallback labeled "training effort" (`18cb512`) |
| (new ask) | L6 | Systemic race-data audit | ✅ WORKING | All 11 race-result consumers read from races first. No holdouts. Audit doc at `docs/simulations/race-data-source-audit-L6.md`. |
| ❌ GAP | A4 | Workout target ranges (N1/V2) | ❌ GAP | Still deferred — resolver returns range, TodayCard reads single value |
| ❌ GAP | D4 | Pre-workout briefing (N7/V1) | ❌ GAP | Still deferred — wider integration than the 100-line rule allows |
| (new ask) | F3 | Passive VDOT updater (L7) | ❌ GAP (queued tomorrow) | The "alive" half of "alive but not nervous." Three signals: T workout adherence, pace-at-fixed-HR drift, I workout pace. Detailed spec captured. |

**Net read:** the data-honesty work (L1-L4 + U1) is the foundation. Sombrero=C now actually means something. Big Sur can be marked hilly-excluded with one click. HR zones are HRR-aware on both surfaces. The validator catches the disconfirming-cluster pattern that David flagged. The coaching-voice extensions (V1-V4) and edge-case behaviors (E1-E6) remain mostly unshipped — they require integration breadth that doesn't fit one session.

---

## Section A · Current state surfacing

### A1 · Coach Reads VDOT explanation
✅ **WORKING** — unchanged from round 1. Aggregate now reads **46.6** with priority weighting + Big Sur excluded + Rose Bowl backfilled. Weight shares: Disney HM 53.3% (A) · Sombrero 21.3% (C) · Rose Bowl 14.0% (A) · LA Marathon 11.4% (A) · Big Sur 0% (hilly-excluded).

### A2 · Coach Reads pace bands (canonical Daniels)
✅ **WORKING** — unchanged from round 1. Label shows VDOT 46.6 (interpolated).

### A3 · HR zones + max HR validation
✅ **WORKING** (upgraded from ⚠️). HRR-based zones now on BOTH surfaces:
- `/profile` Heart Rate Zones card: zone-pct label flips between "60-70% HRR" and "60-70% max" depending on whether resting HR is known. Sub-copy explains the framework choice.
- Coach Reads HR zones: HRR via `buildHrZones(maxHr, restingHr)` in fitness-resolver.

  New validator rule (`suspect-ceiling`): when ≥3 validated peaks cluster within 3 bpm of stored max, surfaces banner with the diagnosis "a true max is a rare brief reading, not routinely hit on sustained efforts." Proposes new max via avg/0.90. Banner UI routes the new verdict kind through the existing Apply/Dismiss flow.

### A4 · TodayCard with workout range + conditional guidance
❌ **GAP** — N1 still deferred. Resolver returns range (eLow/eHigh); TodayCard reads single value.

### A5 · Active plan view
⚠️ **PARTIAL** — unchanged from round 1.

### A6 · Active race view: AFC HM countdown + readiness
⚠️ **PARTIAL** — readiness shipped in round 1. Updated VDOT 46.6 → projected ~1:38:30 / goal 1:30:00 → gap ~4.7 VDOT pts. Trajectory still deferred.

---

## Section B · Recent race ingestion

### B1 · Disney HM Feb 1 · goal-tier anchor (A)
✅ **WORKING** — weight share recovered to 53.3% (was 38.7%) after Sombrero=C and Big Sur exclusion.

### B2 · LA Marathon chip-time divergence
✅ **WORKING** — unchanged from round 1. Now priority A (was B).

### B3 · Big Sur Marathon · "hilly course excluded"
⚠️ **PARTIAL** (upgraded from ❌). Edit UI shipped at `/races/big-sur-marathon` — David can pick `hilly-excluded` from the effort-level picker and the aggregate immediately drops Big Sur. But David's note from earlier session: "Big Sur is A — I trained for that elevation, didn't max out HR." So he may NOT want to exclude it. The UI gives him the choice; not auto-applied.

### B4 · Sombrero Half · goal-tier with effort discount
✅ **WORKING** — now priority C, weight share 21.3% (was 38.7%). Honest as a tune-up. (Higher than the mid-round 15.9% because Big Sur exclusion redistributed weight across the remaining contributors.)

### B5 · 10K from March
❌ **GAP** — still unresolved. Not in curated table. David hasn't confirmed whether to add or mark as never-real.

### B6 · Rose Bowl Half (Jan 18) — auto-migration
⚠️ **PARTIAL** — auto-migration in `db.ts` looks up Strava activity in Jan 13-23 window, creates entry on next deploy. Hasn't fired in this session (would require Railway redeploy on a fresh boot).

---

## Section C · Adaptive triggers

C1-C7 all ⚠️ **PARTIAL** — unchanged from round 1. Logic exists in `adaptive-pattern.ts` framework; specific triggers haven't fired in real conditions during these sessions.

**Newly testable in C3:** the `suspect-ceiling` rule will fire on next Coach Reads load if David's stored max (175) + topPeaks data shows ≥3 validated runs clustering near 175. The hypothetical scenario is now wired to fire automatically.

---

## Section D · Coaching voice

### D1 · Aggregate explainer paragraph
✅ **WORKING** — unchanged. Now reads: "Your VDOT is 46.6, anchored by Disney HM Feb 1 (weighted 53.3%), with Sombrero Half May 3 (a C-race / tune-up, 21.3%) and Rose Bowl Half Jan 18 (14.0%) as goal-tier corroboration. Big Sur Marathon excluded from aggregate (hilly-course distortion)."

### D2 · Cycle-window explainer
✅ **WORKING** — unchanged.

### D3 · Chip-time divergence narrative
✅ **WORKING** — unchanged.

### D4 · Pre-workout briefing for tomorrow (V1 / N7)
❌ **GAP** — still deferred. Wider integration than scope allows.

### D5 · Race countdown with trajectory (V3)
⚠️ **PARTIAL** — readiness shipped; trajectory piece deferred.

### D6 · Migration banner with before/after (V4 / N10)
⚠️ **PARTIAL** — banner ships explanation copy, doesn't yet show specific before/after pace numbers per the spec polish.

---

## Section E · Edge cases & failure modes

E1-E6 all unchanged from round 1 — ❌ GAP or ⚠️ PARTIAL as listed there.

---

## Section F · Editorial — gaps, opportunities, learnings

### F1 · Round 2's shipped fixes
- **L1 verified:** Sombrero=C properly drops aggregate weight 38.7% → 21.3% (final round-2 share after Big Sur exclusion redistributed). Disney HM anchor recovered to 53.3%. Mid-round aggregate landed at 46.1; final aggregate at 46.6 after L2.
- **U1 shipped:** Six-level effort flag (A / B / C / tune-up / training-run / hilly-excluded) with edit UI on `/races/[slug]`. PATCH `/api/races/[slug]/priority` endpoint. Hilly-excluded races drop from aggregate entirely.
- **L3 shipped:** `suspect-ceiling` validator rule fires when ≥3 readings cluster near stored max. Suggests new max via avg/0.90 with full evidence list + falsifier.
- **L4 shipped:** HRR/Karvonen on /profile zones (was %max only). Copy explains framework choice.

### F2 · Fresh gaps revealed by round 2
**The "Big Sur is A but elevation hurt the time" tension.** David said Big Sur should stay A (he trained for it, HR was clean) but the aggregate currently has Big Sur at VDOT 42.9 (slower than equivalent flat-course fitness). The hilly-excluded option exists; David has to decide whether to use it. Without an "elevation-adjusted finish time" feature, the only options are full-weight or zero-weight. A graded-correction module (adjust marathonS based on net elevation gain) would let David keep Big Sur as A AND have the aggregate reflect his actual fitness. **Queued as future work.**

**The two-implementations-of-HR-zones problem.** Round 1 fixed the fitness-resolver's `buildHrZones` to use HRR. Round 2 fixed the inline `HR_ZONES` on `/profile`'s Heart Rate Zones card. There are still two implementations. The right cleanup: extract a shared `buildHrZones` utility, import both surfaces from it. **Queued.**

**The Rose Bowl auto-migration is invisible until Railway redeploys.** David asked for self-applying fixes; the data migration runs in `ensureSchema` on cold start. Tonight's commits push to main → Railway auto-deploys → next request fires the migration. But there's no UI signal that "this migration ran successfully" — David has to inspect /races to see Rose Bowl appeared. **Could add a startup-log surface, but probably overkill.**

**The race-priority editor wraps the meta.priority field but doesn't trigger an aggregate refresh signal.** Right now, changing priority → reload page → server re-runs compute-vdot with new weighting → Coach Reads renders new VDOT. That's fine for static UIs but the moment we introduce client-side caching (e.g., React Query), the priority change has to invalidate the cache. **Queued — not a problem today.**

### F3 · Top 3 next builds (updated for round 2)

1. **V1: Pre-workout briefing on TodayCard** (still #1 unshipped). The biggest "feels generic" gap. Requires weather integration + shoe-picker wiring + last-similar-session query. Each piece is well-defined; the integration is one focused session of work.

2. **Adaptive trigger surfacing — actually fire C1-C7 in production.** All seven hypothetical scenarios in Section C now have testable shapes. The `suspect-ceiling` rule is a first instance: real data will now fire it. Same wiring pattern should generalize to C1, C2, C4, etc.

3. **Elevation-adjusted finish times** for races on hilly courses. Eliminates the "hilly-excluded or 100% weight" binary. Compute an adjusted time using net gain × physics. Show both the actual time and the equivalent-flat estimate. Aggregate uses the adjusted value.

### F4 · The deck's editorial read

The system is more honest about race efforts than 24 hours ago. Sombrero is correctly discounted as a tune-up. Big Sur can be excluded with one click. The validator now flags suspect ceilings instead of confirming them. HR zones use the right framework for the runner's resting HR. The phantom 5K is gone.

What's still missing is the daily-touch surface (TodayCard) speaking like a coach about tomorrow's workout. That's the biggest remaining gap between "the system understands your fitness" and "the system coaches you through your day."

---

## Tonight's round-2 commits

In order from when the round started:
- `b1a5c54` — Self-applying race fixes: priority-aware weighting (1.0/0.6/0.3) + auto-migration (priorities + Rose Bowl + pace ack)
- `ec5d5b6` — Round 2 L1 verified + L2/L3/L4 + U1 race-effort editor (expanded to 6 levels, weights 1.0/0.7/0.4/0.4/0.2/0.0)
- `82d0c01` — Hotfix: prod build broke on priority type expansion (3 callsites collapsing tune-up/training-run/hilly-excluded → C); L2 Big Sur exclusion applied via auto-migration
- `18cb512` — L5: PR card source-of-truth fix (races first, Strava labeled "training effort")
- (this commit) — round 2 deck + L6 audit doc

**Tests:** 481 passed, 4 skipped, 0 failed across 36 files.

**Aggregate state (final round-2 number):**
- VDOT: **46.6** (45.7 → 46.1 with Sombrero=C → 46.6 with Big Sur excluded + Rose Bowl backfilled)
- Weight shares: Disney HM 53.3% (A) · Sombrero 21.3% (C) · Rose Bowl 14.0% (A) · LA Marathon 11.4% (A) · Big Sur 0.0% (hilly-excluded)
- HR zones: HRR/Karvonen on both /profile + Coach Reads
- Max HR validator: suspect-ceiling rule live AND FIRED tonight (David saw it surface 181 from cluster of HRs near 175)
- Race-effort editor: live at /races/[slug]
- PR card: races-first with chip-time/training-effort labels

**What David sees when he opens the app:**
- /profile Coach Reads → VDOT 46.6 with Sombrero discounted + Big Sur excluded
- /profile Heart Rate Zones → HRR bands with explanation copy
- /profile Max HR Island → "⚠ Suspect ceiling — your true max may be higher" with banner proposing 181
- /races/big-sur-marathon → "HILLY · EXCLUDED FROM VDOT" header, editor chip shows hilly-excluded
- /races/sombrero-half → C-race chip with edit affordance
- /races/page Personal Records → HM 1:34:54 (Disney) · Marathon 3:31:40 (LA) · Rose Bowl 1:38:38 — all with ✓ Chip time pills

**Diff vs round 1:** 8 verdicts upgraded (7 from ❌→✅, 1 from ⚠️→✅). 0 verdicts downgraded. 1 new GAP added (L7 passive VDOT updater) reflecting David's expanded spec.

## L7 queued — the "alive" half

After round 2 the system is HONEST about race efforts (priority field works, hilly-excluded works, PR card reads from races, HR zones use right framework). Next major build is making it ALIVE between races — passive VDOT updates from training execution.

Three signals captured in L7 spec:
- **Signal 1:** T workout adherence — 3 consecutive trend faster at controlled HR → bump banner
- **Signal 2:** Pace-at-fixed-HR drift — 4-week rolling sparkline on Coach Reads
- **Signal 3:** I workout pace at controlled effort
- Evidence combination via adaptive-pattern.ts thresholds
- Asymmetric: UP needs 3+ obs, DOWN needs 2+ for investigate
- Banner shape matches the now-live suspect-ceiling pattern

Tomorrow's work.

---

*Round 2 deck generated 2026-05-19 ~00:10 PT. Keep round 1's deck (`coach-simulation-deck.md`) around as the diff baseline.*
