# Deploy evidence · Rule 19

Green is not deployed. This records the deployment STATUS, not the push result
and not the CI result.

Queried via `gh api repos/:owner/:repo/deployments/<id>/statuses`, 2026-09-02:

| Commit | Deploy status | At |
|---|---|---|
| `0fb97214` | **success** | 22:31:02Z |
| `f20b0e06` | inactive (superseded) | 22:31:04Z |
| `a6a68a3d` | inactive (superseded) | 22:16:21Z |
| `dc9ee897` | in_progress | 22:57:46Z |

**The anchoring fix `b113a787` is deployed.** It is an ancestor of `0fb97214`,
whose deployment reports `success`. `inactive` on the earlier rows is the normal
state of a deployment that a later one replaced, not a failure.

`dc9ee897` (the goal-realism rename) was still `in_progress` at the time of
writing and must read `success` before the rebuild, since the rebuild runs
through `POST /api/cron/silent-rebuild` in production.

**The rebuild endpoint is reachable and auth-gated.** An unauthenticated
`POST https://www.faff.run/api/cron/silent-rebuild` returns **401**. That is the
correct refusal, and it was the only request made against production during this
check — no body, no credentials, no write.

Railway's own API could not be queried: `scripts/railway-status.sh` requires
`RAILWAY_TOKEN`, `RAILWAY_PROJECT_ID`, `RAILWAY_SERVICE_ID`, and none are
present in this environment. GitHub's deployment status is the authority used
here instead. If a stronger confirmation is wanted, the token would have to be
made available — stated rather than glossed.
