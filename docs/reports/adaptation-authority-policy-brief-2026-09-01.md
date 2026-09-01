# Brief for external review — Adaptation Engine authority policy

## The question

Not "is the Adaptation Engine correct" — tonight's work answered that as far
as it can be answered right now. The actual open question: **given two
specific, structural evidence gaps that can't be closed by more engineering
tonight, what's the right policy for moving toward live authority — wait
and revisit later, or some staged/canary approach, and if the latter, what
would actually make it safe?**

## What's true right now, factually

**Built and proven tonight**, all shadow-mode, nothing writing to a live
plan:
- Capacity beliefs (threshold, easy ceiling, durability) are direct
  evidence, adversarially verified against real production data.
- The live plan-flex path (recompute/reanchor) runs nightly through the
  canonical resolvers — confirmed current, zero staleness found on audit.
- The Adaptation Engine's PACE lever: phase-aware targets (fixed a real
  blended-average bug), a pace/HR compatibility validator wired into the
  real decision pipeline, a four-state authoring/reanchor convergence guard
  that correctly classifies the account's plan as uncontaminated, a
  production shadow-log with a real zero-mutation checksum proof, and a
  bounded fixture corpus (13 PACE fixtures + 9 DURATION/VOLUME/DENSITY
  fixtures, all run through the real unmodified engine, all falsified
  before confirmed).
- Two real, non-trivial bugs found and fixed in the evidence layer itself
  tonight: a case where filtering could accidentally erase all evidence in
  a window and fall through to an unwarranted "proceed as planned" default
  (fixed conservatively — can only make the reader stricter, never looser);
  and a case where a correct decision was explained with a stale, reaching
  reason instead of the true, proximate one.

**Not, and can't be, closed by more work tonight:**
1. **Real multi-day stability.** Production shadow-compare has been live
   for roughly two hours. Determinism (same day, same inputs, repeatable)
   is proven. Whether a proposal stays sensible as real days actually pass
   — the thing "stability" is supposed to mean — genuinely requires
   elapsed time that hasn't happened yet.
2. **Cross-runner replay.** Exactly one account in the entire database has
   real training history. Every fixture built tonight, including
   tonight's new ones, is explicit that it proves the decision logic
   handles the right input *shapes* — not that a different runner's real
   training would actually produce them. This is a data-availability
   fact, not a coverage gap that more fixtures fixes.

A third, related fact: a separate migration (canonical initial-plan
authoring, not yet switched over) found tonight that cold-start/zero-run
accounts would get a ~35% too-slow prescription under the canonical path as
it stands today. Unrelated to PACE adaptation directly, but evidence that
"the same brain end to end" isn't finished — which was on the account
owner's own list of prerequisites before authority.

## The actual decision to weigh

**Option A — wait and revisit.** Let production shadow-compare run
unattended for a defined period (a week? two?), then review the
accumulated real evidence and decide. Simple, low-risk, but open-ended
without a stated criterion for "long enough."

**Option B — a staged/canary approach**, if one exists that's genuinely
safer than just waiting. Candidate shape: PACE lever only (already the
only lever proposing anything upward), the account owner's own account
only (already the only account with real evidence — a canary here doesn't
buy cross-runner diversity, it only buys "live vs. shadow" as a variable),
a hard kill switch, and explicit promotion criteria decided in advance
rather than a vibe check after the fact.

**The honest tension a reviewer should weigh:** a canary on the *only*
account with real data doesn't address the cross-runner-replay gap at all
— it only tests whether live-vs-shadow changes anything for the one
account already being watched closely. Is that distinction meaningful
enough to justify going live before the cross-runner gap is closed some
other way (more real users signing up, or a synthetic-history capability
that doesn't exist yet and was explicitly rejected as a platform to build
just for this)? Or does "wait" simply mean "wait until there are more real
accounts," which could be a long, undefined wait?

## What would make this decision well-formed, for the reviewer to propose

- A concrete definition of "enough multi-day evidence" — some number of
  real days, some number of real proposal cycles, some stability metric
  across them — rather than an open-ended "revisit later."
- An explicit answer to whether a single-account canary is worth doing at
  all, given it doesn't touch the harder of the two gaps.
- If canary: the exact kill-switch mechanism and rollback path, and who
  reviews each proposal before/after it would auto-apply.
- Whether the cold-start authoring gap needs to be closed first, or is
  genuinely independent enough to defer.

## Source documents, for full context

- `docs/reports/handback-round3-2026-09-01.md` — full technical state,
  all 14 points.
- `docs/reports/absorption-split-masking-fix-2026-09-01.md`,
  `docs/reports/adaptation-reason-honesty-fix-2026-09-01.md`,
  `docs/reports/duration-volume-density-fixture-corpus-2026-09-01.md` —
  tonight's three follow-up fixes.
- `docs/PRODUCT_DECISIONS.md`'s 2026-09-01 entries — the standing
  decisions this policy question sits on top of.
