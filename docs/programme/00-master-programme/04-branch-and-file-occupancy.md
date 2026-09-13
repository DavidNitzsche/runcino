# 04 — Branch and File Occupancy

## Branch census summary

224 remote branches at takeover. 40 already ancestors of `origin/main` (safe to prune later, not detailed here). 182 unmerged. Full merged/unmerged list: `git for-each-ref` ledger regenerable via the one-liner in this session's history; not duplicated here per Rule 17 — regenerate with:

```
git for-each-ref refs/remotes/origin --format='%(refname:short) %(objectname:short)' | while read b sha; do git merge-base --is-ancestor "$b" origin/main 2>/dev/null && echo "yes $b" || echo "no $b"; done
```

## Hot zone (unmerged, touched in the last ~5 days) — the only branches actively tracked for collisions

| Branch | Tip SHA | Files touched vs `origin/main` |
|---|---|---|
| `audit/marathon-plan-quality-2026-09-12` (Phase 1) | `db9db751e` | `web-v2/lib/doctrine/registry.ts`, `web-v2/lib/plan/_midrace_invariants.test.ts`, `web-v2/lib/plan/generate.ts` (hunks @ L71, L11263) |
| `audit/marathon-plan-quality-phase2-2026-09-12` (contains Phase 1) | `1506981b5` | same + `generate.ts` (hunks @ L5348, L9837-9898) |
| `audit/marathon-plan-quality-phase3-2026-09-12` (contains Phase 1+2, WIP/incomplete) | `eb1e3cf19` | + `web-v2/lib/plan/_pq3_candidate.test.ts` only (no further `generate.ts` edits) |
| `claude/faff-natural-coaching-vyloay` | `90e6087e6` (per its own handback; branch tip may be later doc-only commit `7e5d46121`) | `docs/design/natural-coaching-*.md`, `web-v2/lib/plan/_midrace_goal.test.ts`, `_midrace_role.test.ts`, `web-v2/lib/plan/generate.ts` (hunks @ L8908, L9580-9620), `web-v2/lib/postrun/experience.ts`+test, `web-v2/lib/race/{execution-plan,race-outlook,race-page-layers,race-row-note}.ts`+tests, `web-v2/lib/training/race-card.ts`+test |
| `claude/natural-coaching-programme-lead` (contains `vyloay` + CA-13) | `a9006599c` | same as `vyloay` + `web-v2/lib/faff/{v5-decisions.ts,_v5_decisions.test.ts}` |

## Confirmed collision

**`web-v2/lib/plan/generate.ts`** is touched independently by two lineages: (marathon-plan-quality Phase1→2→3, sequential/stacked — internally fine) and (`vyloay`→`natural-coaching-programme-lead`, sequential/stacked — internally fine). Cross-lineage hunk ranges as of this snapshot: `{71, 5348, 9837-9898, 11263}` vs `{8908, 9580-9620}` — **no overlap today**, but this is a snapshot, not a guarantee. Rule per the mandate: never assume branch-name age proves non-overlap, and re-diff after either side merges.

**Decision (this ledger, pending David where it exceeds implied authority):** freeze both lineages from further edits until an integration wave is authorized. When authorized, merge order is: Phase 1 → Phase 2 (Phase 3 held back — see `06-integration-waves.md`, it's explicitly incomplete) → re-diff `generate.ts` → then natural-coaching lineage → re-diff again before push. Integration agent runs full gates after each step, not just at the end.

## Branches NOT yet individually audited for file occupancy

Everything in the unmerged-but-older-than-5-days set (roughly 170 branches). Many are almost certainly superseded by later programme-lead integration passes (the exact same bug fixed differently on `main` later) or abandoned experiments. Recommended next step, not yet executed: a bounded read-only agent that, for each unmerged branch older than 5 days, checks whether every file it touches has since been touched independently on `main` (a proxy for "probably superseded, needs a human glance before deleting, not before ignoring").
