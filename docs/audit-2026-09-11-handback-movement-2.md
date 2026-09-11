# Handback — Movement Since Last Recap (2026-09-11, wave 2)

Per your instruction, this contains only new movement — see `docs/audit-2026-09-11-session-handback.md` for full prior context.

## 1. Merges and deployments

| Branch | Merge commit | New `origin/main` | Railway |
|---|---|---|---|
| `fix/execution-identity-watch-matcher` @ `f4cbb67f8` | `6fd65a6f6` | `6fd65a6f642631fc7a9528a67e970f2df748d573` | `[PROD]` SUCCESS, confirmed on exact SHA |

CI on that commit, polled to terminal state: `test-full` SUCCESS (12,021 passed / 1 expected fail / 205 skipped), `build-check` SUCCESS, `native-check` SUCCESS (~25 min, normal range). `audit-suite` FAILURE — confirmed identical across 10+ consecutive runs over two days, a standing `DATABASE_URL_RO` credential gap unrelated to any merge.

Unrelated current-main content preserved: verified via diff against both merge parents, no divergence from the reviewed diff.

## 2. Review verdicts, this wave

| Item | Verdict | Notes |
|---|---|---|
| `fix/recovery-honesty-strides-grading` (Lane A) | **PASS**, no conditions | Reviewer had live `DATABASE_URL_RO` access (implementer didn't) and found a real completed strides workout in David's account with two genuinely short, unrecorded walk-backs — confirmed the fix changes that grade from `null`/`'executed'` to `false`/`'uneven'`. |
| `fix/standing-recommendation-convergence-and-cutback-copy` (Lane D) | **PASS**, no conditions | Verified the doctrine-routing citation against `docs/BRAIN_CONSTITUTION.md` directly; ran both fixes against David's real CIM plan (bug not currently live on his account, fix confirmed correct for when a reschedule would trigger it). Incidental, unrelated finding: two duplicate "race" workout rows for 2026-09-13 in his real plan — not investigated further. |
| `fix/execution-identity-watch-matcher` (Lane B) | **PASS**, condition closed | First pass found a real leak (ambiguity-refusal JSON reaching the runner's Profile "COACH ACTIVITY" timeline via an unfiltered read path). Fixed, re-reviewed clean. **Merged (see §1).** |
| `fix/santa-monica-race-day-copy` (Finding 4) | **PASS**, no conditions | Copy-only, correctly classified Refine per Lane G's own vocabulary. |
| `feat/shipping-lock-and-artifact-mapping` | **PASS**, 3 defects found → fixed → re-reviewed PASS | See §3. |
| `fix/cold-open-cache-honesty` (Finding 1) | **PASS**, no conditions | Reviewer stress-tested with a real local HTTP server (not mocks) to confirm disclosure timing; tried and failed to construct a wrong-day-run scenario, confirming the run-start path is architecturally decoupled from cache staleness. One non-blocking note: legacy `-faffLegacy`-gated views also lose the age gate, confirmed unreachable in production. |
| `fix/cim-elevation-integrity` (Finding 2) | **PASS** after 3 review rounds | See §4. |

## 3. Shipping-lock: adversarial review found 3 real defects, all fixed and re-verified

An adversarial review (attacking, not reading) found, each reproduced with a real `git push` against a real scratch bare-repo remote:
1. **Deleting `refs/heads/main` bypassed the gate entirely** — a real `git push origin :main` with zero authorization sailed through.
2. **TTL check failed OPEN on a corrupted timestamp field** — and a real 5-of-30-trial concurrent-authorize race could produce that corruption naturally, not just via manual tampering.
3. **`verify` reported false-clean on a wrong SHA** with an otherwise-correct build number/timestamp (a disclosed limitation, but the disclosure wasn't unconditional).

All three fixed, re-verified by a second reviewer who went further than the original attack (5×20-way concurrent authorize vs. the fix's own 3×3 test, cross-SHA race testing). One honest note: the second reviewer couldn't reproduce the *original* corruption bug in their own environment — flagged transparently; doesn't weaken the fix, since its correctness rests on a POSIX atomic-rename guarantee, not empirical hit rate. Final: `1050a48c7`, 26/26 and 21/21 assertions.

## 4. CIM elevation integrity: 3 review rounds, now clean

Round 1 implementation → **FAIL**: two blocking defects. (a) The Swift side genuinely didn't compile — a decoder-wiring bug, the exact `RACEWIRE-1` pattern this same file's own header warns about. (b) `use_measured_elevation` silently overwrote `course_library`, a global cross-user table, for an editorial-sourced row — contradicting an existing, documented policy elsewhere in the codebase (`promote-from-race.ts`'s "do NOT overwrite for source='editorial'").

Round 2 fix → **FAIL** again, narrower: both original defects genuinely closed (Swift compiles and renders both card variants against live CIM numbers; the `course_library` write now correctly refuses for editorial rows, verified against the real production row). But the fix's own stated justification — "a disclosed refusal, not a silent no-op" — turned out to be false as shipped: the native client only decodes response bodies on 4xx, so the 2xx refusal was silently discarded. A runner tapping "use my measurement" on CIM saw nothing.

Round 3 fix → **PASS**, fully clean. The 2xx `applied:false` body now decodes into the same `.refused` type the 4xx path already produces; verified byte-for-byte against the actual `note` copy, checked against coach-voice doctrine, confirmed zero regression on the 4xx path and the genuine-success path. Also fixed, in passing: the sample-catalog fixture for this card type never actually exercised this code path (wrong trigger key, no detail payload) — a live Rule 13 trap, now fixed so future verification passes actually test something real. Final: `1b31a55ae`.

## 5. Runner Data provenance receipt — delivered

Branch `audit/runner-data-v2.1-provenance-receipt` (content commit `4e31a3a9c`, chase commit `412192a4c`), all 15 files hashed. **Correction to my own earlier assumption**: the formalizing agent found the `v2-correction-*` files are not superseded scratch notes as I'd guessed — v2.1 itself cites them as live source material, the same track-file relationship v1 has with its domain reports — so all 15 files were kept, following the same pattern Brain and Coach's packets already used. One inconsistency found in v2 (not v2.1) and left unfixed per custodial mandate: a stale "only build ever shipped" claim already corrected in v2.1's equivalent section.

This is ready for your acceptance — the last gate on canonical v3's final status and on `fix/postrun-missing-pace-routing`'s merge specifically.

## 6. Now dispatched: Finding 3 (missed/skipped/moved state)

Its gating condition (Lane B integrated) is now satisfied. Dispatched with the full required state model (Completed/Moved/Skipped/Missed-unresolved/Supplemental-ambiguous), required to publish a date-boundary/timezone/grace-period design note before implementing, and required to build on the now-merged execution-identity matcher rather than a competing identity path. Result pending.

## Current merge-candidate roster (all independently reviewed PASS, awaiting your merge authorization)

- `fix/recovery-honesty-strides-grading` @ `886d1529e`
- `fix/standing-recommendation-convergence-and-cutback-copy` @ `ab5a5eb7c`
- `fix/santa-monica-race-day-copy` @ `38d090ec8`
- `feat/shipping-lock-and-artifact-mapping` @ `1050a48c7`
- `fix/cold-open-cache-honesty` @ `2a8ee1d89`
- `fix/cim-elevation-integrity` @ `1b31a55ae`

## Still holding, unchanged from last recap

- Migration 166/170: not authorized.
- No TestFlight candidate authorized.
- `progression-pass.ts` sibling defect: queued, not started (its own gate — race-week-protection's merge — is satisfied, but no explicit go given yet to start it).
- Canonical v3: still DRAFT, now unblockable pending only your acceptance of the Runner Data receipt above.
