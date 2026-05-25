# faff.run · web-v2

Replacement for `legacy/web`. Built against the deck at
`docs/coach/mockups/deck-v1-2026-05-25.html` — that file is canonical for
design tokens, card primitives, voice doctrine, and state matrices.

## Current state

**Phase 0 scaffold.** Pages render with TopNav + design tokens but the
briefing endpoint is a stub (`app/api/briefing/route.ts` returns a fixed
payload from the v4 locked mockup). Phase 1 replaces it with the real
service.

## Surfaces

| Route                  | Surface                  | Phase |
| ---------------------- | ------------------------ | ----- |
| `/today`               | TODAY (4 states)         | P1–P2 |
| `/training`            | TRAINING (5 phase modes) | P3    |
| `/races`               | RACES (4 states)         | P3    |
| `/races/[slug]`        | RACE DETAIL (4 proxim.)  | P3    |
| `/health`              | HEALTH (3 states)        | P4    |
| `/profile`             | PROFILE                  | P4    |
| `/runs/[id]`           | Run detail (drill-down)  | P4    |
| `/learn/[slug]`        | Reader (research)        | P4    |

## Architecture

- `app/` — Next.js 15 app router. Server components by default.
- `app/api/` — JSON endpoints. `briefing` is the load-bearing one.
- `lib/coach/` — coach engine: state loader, surface router, LLM caller, prereq filter.
- `lib/topics/` — topic-kind schemas (Zod). Each kind has a prereq fn.
- `lib/voice/` — voice mode definitions per surface.
- `lib/db/` — db client (pg pool to Railway prod).
- `components/cards/` — one React component per topic kind.
- `components/layout/` — TopNav, frames, shared chrome.
- `components/charts/` — bar charts (no fake line sparklines per deck doctrine).
- `coach/prompts/` — LLM system prompts per (surface, mode).

## Run locally

```bash
cd web-v2
npm install
npm run dev
```

Requires `.env.local` with `DATABASE_URL` (Railway prod) and
`ANTHROPIC_API_KEY`.

## Voice eval + sims

```bash
npm run eval:voice    # diffs prompt outputs against gold corpus
npm run test:adapt    # synthetic 12-week build, verifies mode transitions
npm run test:truth    # deletes data fields, verifies no hallucination
```

## Deploy

Production currently builds from `legacy/web` via root `package.json`.
After cutover, root `package.json` will switch to `web-v2`.
