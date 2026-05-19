# Tier 4 · Experimental

Routes that are still settling.  May change shape, may be removed,
may be promoted to tier 1 once stable.  **Do not depend on these.**

## Routes

### POST /api/save-overrides
- **Auth** · development-only (403 in production via env guard)
- **Purpose** · write race overrides JSON to disk during local migration tooling
- **Why tier 4** · naming smells like internal tooling; the dev-only guard blocks production use, but the route exists in the production deployment.  Cleanup candidate: either move to `/api/admin/` (tier 3) or remove from prod build.

### POST /api/research
- **Auth** · optional (no explicit check; routes through `researchCourse`)
- **Purpose** · drive course-research pipeline; calls Anthropic if `ANTHROPIC_API_KEY` is set, otherwise returns a hardcoded CIM stub
- **Why tier 4** · response shape depends on env config (stub vs. live).  Behavior may evolve as the research engine settles.  iPhone should not depend on either branch.

---

## Promotion criteria

A tier 4 route promotes to tier 1 when:

1. Contract is stable (response shape doesn't depend on env or runtime conditions).
2. Auth is well-defined (matches one of the four tier-1 patterns).
3. Discipline audit passes (Rule 1, 2, 5 + shape stability).
4. At least one stable client surface depends on it.
5. Removed from tier 4, added to tier 1 docs with full entry.

Routes that fail promotion criteria after a reasonable settle period
should be removed, not left to linger in tier 4.
