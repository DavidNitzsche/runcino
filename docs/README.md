# faff docs

The product docs for faff.run — a research-grounded running coach that lives on web, iOS, and watch.

## Start here

**[docs/coach/](./coach/)** — the heart. Coach philosophy, the TODAY page spec, the card library, the next-build plan. Read these first to understand what the app actually is.

## Other categories

| Folder | What's in it |
|---|---|
| **[coach/](./coach/)** | Coach product work — philosophy, page specs, card library, mockups, execution plan |
| **[architecture/](./architecture/)** | System design — schema, algorithms, plan architecture, [design system](./architecture/DESIGN_SYSTEM.md) (locked against v4 TODAY mockup), project map |
| **[research/](./research/)** | Canonical training research that grounds the coach (mirrored from `/Research/` at repo root) |
| **[domain/](./domain/)** | Domain-specific specs — race checklists, health page architecture, example data shapes |
| **[status/](./status/)** | Rolling status — master plans, migration trackers, session handoffs, gap analyses |
| **[sessions/](./sessions/)** | Dated session reports from overnight autonomous runs (`YYYY-MM-DD-*.{md,html}`) |
| **[design/](./design/)** | Visual design assets — HTML mockups, route renders, color passes |
| **[api/](./api/)** | API documentation |
| **[native/](./native/)** | iOS native app notes |
| **[references/](./references/)** | External references and citations |
| **[simulations/](./simulations/)** | Plan simulation results |

## Conventions

- **Dated session reports** (`docs/sessions/YYYY-MM-DD-*.{md,html}`) — long autonomous runs end with a self-contained report there. Filename starts with the ISO date.
- **Coach work is the source of truth.** When in doubt about what the app should do, check `docs/coach/` first. Other folders document the substrate.
- **Research is canonical.** `/Research/` at the repo root is THE source. `docs/research/` is a doc-level mirror for cross-reference.

## Code locations referenced by these docs

- `web/coach/prompts/daily-briefing.md` — the LLM system prompt
- `web/coach/daily-briefing.ts` — the briefing function (stub; wiring TBD)
- `web/scripts/test-daily-briefing.mjs` — test rig that runs the pipeline against real prod data
- `web/coach/voice.md` — historical voice doctrine (superseded by `docs/coach/PHILOSOPHY.md` + the prompt above)
- `web/lib/coach-briefing.ts` — deterministic briefing generator (legacy; replaced by LLM pipeline)
