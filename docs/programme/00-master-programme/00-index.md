# faff.run — Master Programme Ledger (00-index)

**Canonical location note:** the mandate specifies `/Volumes/WP/06 Claude Code/Runcino/for external review/00-master-programme`. This session runs in a cloud container with no access to that volume — `/home/user/runcino` is the only filesystem it can reach. This ledger therefore lives **in-repo**, committed to `claude/epic-ride-9bvh99` only (never `main`), at `docs/programme/00-master-programme/`. If a Mac-based session is available, it should mirror this directory to the `/Volumes/WP` location; until then, this is the canonical copy.

**Programme lead:** this session (`session_016aqpsw8WaCoDV77w8MsLu7`, branch `claude/epic-ride-9bvh99`).

**Status as of 2026-09-13 (takeover in progress, Wave 0):** census substantially complete; five sessions identified as unreachable and referred to David directly (see `01-live-census.md`); one possible duplicate programme-lead session (`session_018q8uZGrJpbq2nEgxiuhx8P`, "Transition to new master programme-lead session") flagged and not yet resolved — **this is an open authority question, not a green light to proceed as if resolved.**

## Files in this ledger

| File | Purpose | Status |
|---|---|---|
| `01-live-census.md` | Agent/session census, branch census, production/CI state | Substantially complete |
| `02-master-status-ledger.md` | Section-15 product master list, per-item disposition | Skeleton — most items UNINVESTIGATED |
| `03-agent-and-worktree-ledger.md` | Every worktree/branch and which agent (if any) owns it | In progress |
| `04-branch-and-file-occupancy.md` | File-collision map across hot branches | Partial — hot-zone only |
| `05-decisions-and-authority.md` | Authority boundaries from the mandate, decisions made/pending | Current |
| `06-integration-waves.md` | Wave 0-5 plan, this session's sequencing | Current |
| `07-release-readiness.md` | Section-16/17 release gate status | Not started — no candidate exists yet |
| `08-device-verification.md` | Section-17 physical checklist | Not started — no build to verify |
| `09-autonomous-runner-loop.md` | Section-2 acceptance-test tracking | Not started |
| `handbacks/`, `reviews/`, `renders/`, `manifests/` | Artifact directories | Empty, ready for use |

## Ground truth this ledger will NOT restate per-file (Rule 17)

- `origin/main` HEAD: `a79c5c86dfe9856bbc3a093649a1663531d8d030`, code-equivalent to `93e784e42` (the telemetry-refresh commit on top only touches `docs/SYSTEM_TELEMETRY.html`). CI (`build-check`, `test-full`) green on `93e784e42`.
- No open GitHub PRs. Integration happens via direct `git merge` to `main`, evidenced by ~15 prior "programme-lead integration" merge commits.
- This session has **no direct Railway or production-database access** (no `DATABASE_URL_RO` or equivalent in this container's environment). Anything requiring production confirmation is marked `[BLOCKED: no DB/Railway credential in this container]` rather than inferred.
