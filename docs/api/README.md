# Runcino API — categorized surface map

S6 deliverable · 2026-05-19 · last audit `585a3fb`.

89 routes total across `web/app/api/`.  Each falls into one of four
stability tiers.  Document, depend on, or avoid accordingly.

## Tier summary

| Tier | Count | What it means | iPhone treatment |
|---|---|---|---|
| 1 · **Stable public** | ~30 | Settled contracts.  Used by surfaces that aren't moving.  Safe to call from a native client. | Direct consumption · canonical source |
| 2 · **Web-app-internal** | ~40 | Next.js SSR bundles + auth handlers + OAuth flows.  Not designed for external use; shape may change to suit web's render needs. | Do NOT consume directly · build iPhone-specific equivalents |
| 3 · **Admin-only** | 22 | Diagnostic, audit, opt-token routes.  All under `/api/admin/`. | Off-limits |
| 4 · **Experimental** | 2 | Settling, may change.  Names smell or behavior depends on env keys. | Off-limits until promoted |

The categorization is what makes S6 actionable.  Without it, iPhone work
would build against routes that were never meant to be stable.

## File index

- [`tier-1-stable-public.md`](./tier-1-stable-public.md) — full docs for every tier-1 route (path · method · auth · response · consumers · audit)
- [`tier-2-internal.md`](./tier-2-internal.md) — one-line summaries.  Listed so iPhone knows what NOT to call.
- [`tier-3-admin.md`](./tier-3-admin.md) — one-line summaries.  Auth: admin session or opt-token.
- [`tier-4-experimental.md`](./tier-4-experimental.md) — flagged endpoints.
- [`iphone-integration-brief.md`](./iphone-integration-brief.md) — **the handoff** · what iPhone uses, what's missing, what to add before native work starts.

## Maintenance

When adding a new route:

1. Pick a tier deliberately.  If you don't know, it's tier 4.
2. Add it to the appropriate tier file.
3. If tier 1, run the discipline checks (see [Discipline audit](#discipline-audit)) before promoting.
4. If tier 1 and iPhone-relevant, update `iphone-integration-brief.md`.

When promoting a route from tier 4 → tier 1:

1. Confirm contract is stable (won't shape-shift based on conditions).
2. Confirm auth is well-defined.
3. Run discipline audit.
4. Update tier-1 doc with full entry; remove from tier-4.

## Discipline audit (run on every tier-1 promotion)

Per [`web/CLAUDE.md`](../../web/CLAUDE.md), tier-1 routes must satisfy:

- **Rule 1 · L6 source-of-truth**: reads from the canonical source for the data domain (e.g., race results from `races.actual_result`, not `strava_activities`).
- **Rule 2 · Falsifier required**: any adaptive verdict in the response includes a falsifier field.
- **Rule 5 · Per-finding context filters**: aggregating responses apply filters concretely, not by inheritance.
- **Shape stability**: response shape doesn't shape-shift based on conditions.  Optional fields are clearly typed; never `field: undefined` vs `field: { ... }` based on data presence — use `field: null` consistently.
- **Auth shape**: explicitly stated (cookie session, opt-token, admin session, or anonymous).

## Audit findings · 2026-05-19

- **No Rule 1 / 2 / 5 violations** detected across the tier-1 surface.
- **Shape concern · `/api/overview` (tier 2)**: returns a 14-field envelope optimized for SSR.  iPhone should NOT reuse this shape; granular tier-1 endpoints (`/api/fitness`, `/api/plan/active`, `/api/races`) are the canonical alternatives.
- **Naming smells flagged for tier 4**: `save-overrides` (dev-only tool), `research` (depends on `ANTHROPIC_API_KEY`).  Both blocked from production by guard or env check; documented in [`tier-4-experimental.md`](./tier-4-experimental.md).
- **Duplicate-looking pairs to revisit later** (not promoted to tier 1):
  - `/api/goal` (singular, POST) vs `/api/goals` (plural, GET) — one creates, one lists.  Could consolidate.
  - `/api/race-retrospect` vs `/api/retrospective` — duplication suspected; verify.
  - `/api/health/checkin` vs `/api/checkin` — backward-compat alias per the agent's read.

These are cleanup candidates, not blockers.

## How iPhone depends on this

The companion file [`iphone-integration-brief.md`](./iphone-integration-brief.md) is the actionable output.  It enumerates:

- Which tier-1 routes iPhone would use day-1
- What's missing (token-based auth, HealthKit ingest, push subscription, mobile OAuth) and needs to be added before native development starts
- Which tier-2 envelopes need iPhone-specific granular replacements
