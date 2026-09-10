# Coach Forensic Audit — v2→v2.1 Correction Log

Short diff of what changed in v2.1 and why. v2 is preserved unmodified except
for the two wording fixes recorded below (item 3), which were content-
neutral. Full reasoning for every item is in
[`audit-2026-09-09-coach-forensic-audit-v2.1.md`](audit-2026-09-09-coach-forensic-audit-v2.1.md).

## Why this pass happened

The programme lead reviewed v2 against a separate Brain-audit pass and found
three direct disagreements, two overbroad claims, one residual wording slip,
and no closing commit-SHA provenance. Mid-pass, the programme lead also
supplied Brain's own v2.1 correction and flagged a fourth, sharper conflict
requiring direct execution rather than another source read.

## What changed

1. **Proposal accepted-after-Apply-failure**: v2 said every failure path
   reopens to `'pending'`. Corrected — true only of the legacy
   `AdaptationAction` lane in `accept/route.ts`; two newer branches added
   2026-09-05 (`applyBrainAction`/ACTIONCOMPLETE-1, and `reprice`) do not
   reopen and can leave a row permanently stuck `'accepted'`. Reachable from
   real cron-written proposals, zero test coverage. **Added to the
   TestFlight-blocker list.** Matches Brain v2.1's own framing exactly.

2. **`HowItWentPanel` reachability**: re-investigated exhaustively rather
   than re-asserted. Confirmed dead/unreachable again, with the disagreement's
   origin identified: the two threshold-ladder structs were genuinely live
   until commit `aac88aec139` (2026-07-10, David's own explicit decision)
   orphaned them. No change to severity.

3. **Race projection List vs. Detail label**: reconciled as a branch
   condition, not a contradiction. In the normal/coherent state (an active
   goal race with a working outlook — the common case), the label differs as
   v2 said. In a degraded/fallback rendering state (`raceLayers` incoherent
   or absent), the label is identical, as Brain said. No change to the
   underlying finding; the branch condition is now stated precisely, and the
   value/label axes are explicitly separated per Brain v2.1's own framing.

4. **C-race "rest is the work now" — re-litigated after Brain v2.1 disputed
   the underlying code's existence.** Brain v2.1 claimed no frequency-cap
   copy branch exists at all. Per explicit instruction, this was resolved by
   direct execution, not another source read: a fresh falsification script
   (preserved at `docs/reports/coach-audit-2026-09-09/falsify-crace-freqcap.test.ts`,
   independently re-run twice for reproducibility) confirms the branch exists,
   quotes it verbatim (it both mutates schedule fields AND sets `.notes` to
   the disputed sentence, in one mutation — not an either/or), and reproduces
   the exact string on current `origin/main`: 0/140 hits under the realistic
   plan shape, 18/56 hits (100% priority C) under the one edge condition
   (zero scheduled quality days + low frequency) already identified as
   necessary. The original Coach finding is **not closed** — it reproduces.
   A plausible explanation for Brain's miss (a structurally similar,
   honestly-worded, priority-gated block sits 16 lines above the disputed
   one) is offered, clearly flagged as inference rather than certainty.
   Severity unchanged from the prior narrowing: real, live under a narrow
   condition, correctly off the blocker list.

5. **"0s slow" fabrication**: unchanged from the prior narrowing pass (not
   part of this round's re-investigation) — still confirmed unreachable from
   any live route (the only real caller never wires the required field, and
   lives in the paused web frontend).

6. **Evidence wording**: two residual instances of "confirmed to actually
   render" / "still capable of rendering" in v2 (findings 11 and 17) were
   corrected in place to "confirmed to reach a render call site" / "still
   capable of reaching a render call site for" — content unchanged, wording
   no longer implies a device confirmation that never happened.

7. **Artifact manifest**: final commit SHA and clean/dirty status recorded
   below, computed after commit rather than left as a forward reference.

## What did NOT change

- v1 and the four track reports remain the untouched preserved evidence
  annex, exactly as in v2.
- No code was fixed, merged, or cherry-picked at any point in this pass.
- Findings not named in the programme lead's two messages (the full
  ledger in v2 §2, the ownership reclassification in v2 §4, the stride-day
  Brain dependency in v2 §6) are unchanged and not re-litigated here.

## Final provenance

| | |
|---|---|
| Branch | `audit/brain-forensic-2026-09-10` (shared checkout, not created/switched by this audit) |
| `origin/main` at completion | `9f082e33929c670c091920006b0602e85de5dc68` |
| Final commit (this pass) | `f11c77d698facbc7c74b9408f980ecd574ad1d2f` — local only, not pushed |
| Working tree status, this audit's own files, immediately after that commit | clean (zero output from `git status --short` scoped to every file this audit has written) |
