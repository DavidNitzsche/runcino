# 03 — Agent and Worktree Ledger

## This session's own worktree

| Path | Branch | Base SHA | Purpose |
|---|---|---|---|
| `/home/user/runcino` | `claude/epic-ride-9bvh99` | `a79c5c86d` (= `origin/main`) | Programme-lead session — ledger, dispatch, review |

## Sub-agents dispatched by this session

| Agent (internal id, not user-facing) | Task | Mode | Status |
|---|---|---|---|
| `a9ac868a75cfbb712` | Parse full CCR session-list dump for active/idle/archived runcino sessions | background | Completed — folded into `01-live-census.md` |
| `ac0eb22ba2f3e624e` | Verify 24 mandate-listed "reported merged" fixes against `origin/main` ancestry | background, read-only | Running |
| `a3c98cda791b4f49a` | Reconcile `lane-c/adaptation-vertical-slice` branch existence + PACE/DENSITY source claims | background, read-only | Running |

No implementer or code-writing agent has been dispatched yet — Wave 1 is intentionally not yet started (see `06-integration-waves.md`).

## Other sessions' worktrees (recovered from git + CCR session list, not directly inspectable)

| Branch | Worktree | Sessions on it | Pushed to origin? |
|---|---|---|---|
| `audit/brain-forensic-2026-09-10` | Unknown path, another machine/container | `session_01AYebi2TuR64WNujs3b7W3S`, `session_018q8uZGrJpbq2nEgxiuhx8P`, `session_01Tj9GqkzLeuc2P99UKt3rH1`, and idle `session_012tV6DYbCzdVhQmqUjmL1kv`, `session_01Lk3JoHX8v9nQfuEgCg18B9` | **No** — `git fetch origin audit/brain-forensic-2026-09-10` fails; branch does not exist on origin |
| `claude/faff-natural-coaching-vyloay` | Closed | (self-closed) | Yes, tip `7e5d46121` |
| `claude/natural-coaching-programme-lead` | Closed | (self-closed, superseded `vyloay`) | Yes, tip `a9006599c` |
| `audit/marathon-plan-quality-2026-09-12` / `-phase2-` / `-phase3-` | Closed (Phase 3 self-stopped for this transition) | (self-closed) | Yes |

## Rule going forward (mandate §5)

Every future implementer/reviewer gets its own isolated worktree via `Agent`/`isolation: "worktree"` or an explicit `git worktree add`, never this session's own shared checkout. This file gets a new row the moment a worktree is created, before any file is touched in it.
