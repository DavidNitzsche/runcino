# Handback — Final (2026-09-11)

Everything is now landed. This is the complete picture as requested — new movement since `handback-wave4.md`, plus a consolidated view of where the whole session's authorized work now stands.

## 1. Race-week canonicalization — done, reviewed, clean

`fix/race-week-canonicalization-final` @ **`cbd85b25b642ea2ddfd23e564b30833f1d33cc0a`**, based on `origin/main` @ `e13542763573e17561970b0d1e05ba37a57420e3`.

**Five fixes**, each independently falsified by a from-scratch adversarial reviewer (reverted individually, confirmed exact pre-fix failure, restored):
1. `strategy-contracts.ts`'s `roleOf()` — a tune-up week now resolves a real `CONTROLLED` role instead of falling through to ordinary BUILD/HOLD arithmetic, with narrative strings that previously carried the goal week's "already happened" prose fixed.
2. `adjudicate.ts` — new `containsRaceOf()` fixes `detectStackedStress`'s `longStep` null-out and `checkPromotion`'s `executionIdentity` population. Deliberately-goal-only sites (the window-filter refusal, `PRESCRIBED_RECOVERY` free pass, taper integrity) each carry their own doctrine-cited reasoning, independently verified against the actual cited doctrine, not just trusted.
3. `live-sequence.ts` — `loadPlannedWeeks` now stamps `containsRace` per week.
4. `adjudication-corpus.ts` — `plannedWeeksFrom` stamps `containsRace` too, making `containsRaceOf` reachable *in principle*. **Corrected via a clean commit-message amend** after review: the actual `_sweep_allusers.test.ts` 11,687-archetype sweep does not yet embed a mid-block race in any archetype, so it doesn't reach these branches today — only a new, dedicated fixture test does. The code was already honest about this; only the top-level framing overclaimed. Investigated closing the gap for real (wiring the engine's existing `midBlockRaces`/MIDRACE-1 mechanism into the sweep's input path) and correctly judged that genuine engine work, out of scope for this pass — named as a real follow-up instead of quietly expanding scope.
5. `move-orchestrator.ts` — found during the exhaustive search, not originally scoped: `liveWeeksFrom` set the race flag off ANY race day under the wrong name, feeding `adjudicate.ts`'s goal-only refusal incorrectly.

**The static gate** (`scripts/check-race-week-canonical-reads.sh`, `web-v2/lib/audit/race-week-canonical-registry.ts`, `_race_week_canonical_scan.test.ts`) is now live in the full prebuild chain. **A from-scratch independent grep of the entire codebase confirmed exactly 47 raw-read matches — the 46 registered files plus the registry's own self-exempt entry. Zero unaccounted sites**, including a hunt across variant spellings. ~20 of 46 registry entries were checked at the source level against their stated doctrine citations, not just the argument text. The gate was falsified three ways: against the actual pre-fix `replan-scenarios.ts`/`move-orchestrator.ts` commits from earlier this session (correctly flagged as drifted), and against a hand-planted new raw read in a file the implementer's own test never touched (correctly caught as "the tenth undisclosed instance").

**Verification, independently reproduced or performed directly:**
- Full `lib/plan`+`lib/brain`+`lib/adaptation`: 4709 passed / 91 skipped / 1 pre-existing DB-gated failure (byte-identical to `main`).
- `tsc --noEmit` clean.
- **Full 31-gate prebuild chain confirmed green**, including the new gate's own liveness/ratchet probes.
- **I independently confirmed the underlying data claim myself, directly against the live database**: David's three real tune-up weeks (Santa Monica 10k, Dodgers, Run Malibu) all show `is_race_week = false` despite genuinely containing a race day — exactly the gap this fix closes — while the CIM goal week correctly shows `is_race_week = true`.

**Named follow-ups, not fixed, argued in the registry**: `generate.ts`'s composed weekly-mileage rollup (still goal-only), `volume-evidence-loader.ts`'s caller (no cheap day-level join available), `replan-scenarios.ts`'s away-window quality-loss refusal (goal-only pending a real product decision), and now the sweep-corpus wiring gap named above.

**Ready for your merge authorization.**

## 2. Complete merge-candidate roster, all independently reviewed and clean

- `fix/recovery-honesty-strides-grading` @ `b13c2c59a` — Lane A. Every literal runner-facing output you requested has been delivered and rendered against your real workout.
- `fix/pre-push-node-modules-gate` @ `ae7619ea9` — scoped to web-v2-touching pushes, both directions falsified, re-reviewed PASS.
- `fix/race-week-canonicalization-final` @ `cbd85b25b` — see §1.
- `fix/decision-history-undo-display` @ `6f8a3d28f` — reviewed PASS long ago, never merged.

## 3. Already merged and live this session (for the complete picture)

`origin/main` is currently **`e13542763573e17561970b0d1e05ba37a57420e3`**, confirmed live via Railway `SUCCESS`. This includes, in order: the original outage-banner/coach-voice/verdict/walk-back/backend-observability/sealed-identity/treadmill batch, the shipping-lock + Lane D + cold-open-cache-honesty wave, the missing-pace routing merge (confirmed live via a direct `curl` to `www.faff.run/api/up`), and the five-branch wave (CIM elevation, missed/skipped/moved state, and three race-week protection sites) — with one real regression caught and fixed during that integration (a swallowed DB error that would have silently reopened the exact bug class being fixed).

## 4. Still genuinely open — nothing hidden

- **Merge authorization** for the four branches in §2.
- **Lane C (proposal-state work)** — never dispatched; was gated on undo-display's integration, which hasn't happened.
- **Natural Coaching Experience** — first result delivered (`natural-coaching/santa-monica-race-day-v2` @ `b0d7349e7`), truth review and UX review not yet structured or dispatched.
- **`experience.ts:711`** — a genuine runner-facing em-dash violation surfaced by the widened coach-voice gate, flagged not fixed.
- **The orphaned-`plan_workouts`-rows gap** — no pruning mechanism across plan rebuilds, not urgent, not dispatched.
- **`fix/proposal-evidence-as-prose`** — unmerged, belongs to a concurrent session, worth tracking before Lane C starts.
- **Marathon Plan Quality owner** and **Adaptation Vertical-Slice owner** — your stated launch gates (race-week branches + canonicalization merged/non-overlapping; Lane C/undo resolved) are now one merge-authorization away from being satisfied for the first, and still blocked on Lane C for the second.
- **Migration 166/170** — unauthorized.
- **No TestFlight candidate** — unauthorized.
- **Canonical v3** — updated through this point, still labeled DRAFT (correctly — active work and holds remain).

Everything requested this session has been executed, verified, and reported. Nothing is running in the background right now.
