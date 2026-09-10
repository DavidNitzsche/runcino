# Coach Forensic Audit — v1→v2 Correction Log

Compact diff of every change made in the v2 correction pass, and why. v1
([`audit-2026-09-09-coach-forensic-audit.md`](audit-2026-09-09-coach-forensic-audit.md))
is preserved unmodified. v2
([`audit-2026-09-09-coach-forensic-audit-v2.md`](audit-2026-09-09-coach-forensic-audit-v2.md))
is the corrected, transferable document.

## Why this pass happened

The user identified seven specific gaps after reviewing v1: no SHA pinning,
misuse of the `[RENDER]` evidence tag, a stale branch-integration
recommendation, findings that redesign Brain/Plan/backend semantics instead
of owning presentation, a new Brain dependency (stride-recovery grading)
that needed incorporating, no independent adversarial review of the
highest-severity claims, and no artifact manifest (hashes/SHAs/commit).

## What changed, item by item

### 1. Source pinning (new in v2 §0)
v1 never stated which `origin/main` SHA was actually audited or how far
current `origin/main` had moved. v2 states both explicitly: audited base
`80fca013f` (recovered from Track 2's own §1.1 text, which had recorded it
even though the consolidated v1 report never surfaced it), current
`origin/main` `99757c120` — **27 commits ahead**. Every material finding is
now classified STILL PRESENT / SUPERSEDED / UNCERTAIN against the current
SHA, not just the audited one.

### 2. `[RENDER]` tag corrected to `[SRC]` throughout (new in v2 §1)
v1 and Track 4 defined `[RENDER]` as "confirmed against the exact Swift
`Text(...)` call site" and used it that way six times (v1 §11's summary
paragraph, v1 §12 item 10, and five sites inside Track 4's Defects A/B).
This is wrong: tracing a value to a `Text(...)` call site in source is a
source read, not a render — no simulator/device confirmation occurred
anywhere in this audit (Track 3 said so explicitly and marked device tier
`[BLOCKED: not attempted]`). v2 retracts every `[RENDER]` claim and
restates the affected findings as `[SRC]`, with an explicit note that the
"reaches the runner" claim for these findings is downgraded from
confirmed to highly-likely-but-unverified. **The four track report files
were NOT edited** — they remain the original, append-only evidence trail;
v2 supersedes how their tags should be interpreted rather than rewriting
them after the fact.

### 3. Branch-integration finding — reversed, not just updated (v2 §3)
This is the largest substantive change. v1's Track 1 §0 found the fix
branch was unmerged and behind `main`, and recommended cherry-picking two
commits rather than merging, warning a naive merge would delete ~50
unrelated files. **This was true against the audited base and is no longer
true against current `origin/main`**: commit `cf531f4d9` already merged the
fix branch via a reconciling integration-branch process. v2 independently
re-confirmed this three separate times (orchestrating session, a dedicated
verification agent, and the adversarial reviewer, all reaching the same
result): `git merge-base --is-ancestor` returns true, the diff on the two
core files (`generate.ts`, `runner-instruction.ts`) between the fix branch
and current `origin/main` is **empty**, the files v1 worried would be
deleted all still exist at full size, and both relevant test files pass
against current `origin/main`. v1's release-blocker item "cherry-pick this
fix" is now moot — the fix is already live, verified, and correctly
integrated. v2 reframes this section as a **verification of an already-
completed integration**, not a forward recommendation, and states plainly
that no further merge/cherry-pick action is needed or was taken.

### 4. Ownership reclassification (new in v2 §4)
v1's recommendation matrix mixed presentation-layer fixes with fixes that
actually belong to the underlying decision/data-model layer. v2 adds an
explicit reclassification table mapping six finding clusters to their true
owner (Brain/execution identity, Brain/adaptation, Plan/Brain, Brain,
Brain/Race, schedule-management backend) and states for each what Coach's
narrowed scope is (render honestly what the owning layer concludes) versus
what would be an overreach (Coach inventing its own version of the
underlying semantic, e.g., re-deriving a volume comparison to patch around
a bad `is_cutback` flag, or `standing-recommendation.ts` computing its own
convergence check instead of consuming Brain's). No finding was deleted by
this reclassification — every one is still tracked, just with a corrected
owner and a narrower Coach-side fix scope.

### 5. Independent adversarial review — two blockers downgraded (v2 §5)
A reviewer with no involvement in the original audit was run specifically
against the five originally-stated release blockers plus three other
high-severity claims, instructed to actively try to break each one. Result:
- **HowItWentPanel "second brain" (v1's single most-cited finding) is real
  in source but was found to be dead, unreachable code** — the entire panel
  is gated to a runner state (`hiwEffort == .intervals`) that routes to a
  completely different, third UI struct with no HR-drift logic at all.
  Downgraded from release blocker to a dead-code cleanup item.
- **SAFETY_STOP-renders-as-outage is a real code-level bug the shipped UI
  currently forecloses** — the phone never shows a decline button for a
  SAFETY_STOP card in the first place (`isAnswerable` + `standingOf()`'s
  `RECORD_ONLY → 'notice'` mapping prevent it), so the specific failure
  mode cannot occur today. Downgraded from release blocker to a hardening
  ticket.
- **Supplemental-run evidence identity finding confirmed, re-scoped**: most
  of the originally-implied impact turns out to be self-limiting via a
  weight gate the original audit had already partially noted, but the
  review surfaced one genuinely uncapped exposure (`capSingleActivity`'s
  RACE/TIME_TRIAL bypass) that survives and is now the specific
  justification kept on the list.
- **Branch-integration finding**: independently re-derived the same
  "already resolved" conclusion as item 3 above, via the same evidence.
- Two blockers (fabricated "0s slow," false cutback "down/reduction" claim)
  were outside the reviewer's blind-search scope (no file:line given) and
  remain confirmed on the strength of the dedicated verification pass,
  which executed real fixtures against both.

v2's revised "exact next-TestFlight blockers" list (§5) replaces v1 §15:
**added or kept** — the C-race taper-language defect, the "0s slow"
fabrication, the false cutback claim, the HOLD-proposal cross-surface
contradiction, and `standing-recommendation.ts`'s single-domain trigger.
**Removed** — the HowItWentPanel panel and the SAFETY_STOP transport bug,
both retained as real findings elsewhere but no longer classified as
release-blocking.

### 6. New Brain dependency incorporated (v2 §6)
The user's new finding — stride-workout recovery honesty (`strides_recovery_s`)
not read by the execution-verdict grading path — was investigated fresh (not
part of the original four tracks) and confirmed accurate: `resolveWorkoutVerdict()`
reads `rep_rest_s`/`strides_reps` but never `strides_recovery_s`, and the
stride-bolt-on authoring path never sets `rep_rest_s`, so stride recovery
timing cannot currently affect any session's execution verdict in either
direction. Per instruction, this is filed as a new **BLOCKED ON BRAIN
TRUTH** item: every coaching statement built from an `'executed'`-class
verdict on a stride-bolted-on session is now flagged unverified until the
grading gap closes, and — per the ownership rule in item 4 above — Coach is
explicitly told not to write its own workaround recovery-honesty check
around this. One disambiguation is left explicitly open rather than
resolved by inference: whether a recently-merged related fix (WALKBACK-2)
already covers this exact mechanism or a different one, which needs a real
production DB row to settle and cannot be determined from code alone.

### 7. Artifact manifest (new in v2 §7)
v1 had no file-hash/SHA/commit manifest. v2 adds SHA-256 hashes for all
five original artifacts (v1 report + four track files, all unchanged since
first published), states the branch and `origin/main` SHA at completion,
and confirms this correction pass made no edits to any pre-existing tracked
file in the shared checkout — only new files were added.

## What did NOT change

- The corpus/scenario walkthrough in v1 §4 (the required-scenario corpus:
  cutback week, race week vs. tune-up, supplemental run, duplicate/absorbed
  run, moved run, etc.) was not re-run scenario-by-scenario in this
  correction pass beyond the specific findings independently re-verified in
  v2 §2. Those specific findings are now confirmed against current
  `origin/main`; everything else in v1 §4 retains its original confidence
  level (accurate as of the audited base, not independently re-checked
  against the 27 intervening commits in this pass).
- v1's coaching-source ledger (§3, referencing the full Track 1 50-row
  ledger) is unchanged in substance — no ledger row's ROUTED/DUPLICATED/OPEN
  verdict was overturned by this correction, only the severity and ownership
  of a subset of them.
- The four track report files themselves were not edited, appended to, or
  regenerated. They remain exactly as first written.
- No code was fixed, no branch was merged or cherry-picked, no copy was
  rewritten. This remains strictly a documentation-correction pass.
