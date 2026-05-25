# Coach docs

The coach is the product. This folder is the source of truth for what the coach does, how it speaks, what it puts on the screen, and how every surface of the app extends from one philosophy.

## Read order

1. **[PHILOSOPHY.md](./PHILOSOPHY.md)** — the soul. Coach as the product, not a feature. Three locked principles. Relationship framing. Multi-race continuity. Read first.
2. **[TODAY_SPEC.md](./TODAY_SPEC.md)** — the TODAY page. State matrix, layout per state, the v4 mockup as reference. The canonical worked example of the philosophy.
3. **[CARD_LIBRARY.md](./CARD_LIBRARY.md)** — every card kind. Schema, when emits, suppression rules, visual treatment, tap behavior, backend status. Extends across all surfaces.
4. **[NEXT_BUILD.md](./NEXT_BUILD.md)** — execution plan. Backend gaps, API wiring, surface-by-surface rebuild order, what ships first.

## Mockups

- **[mockups/today-v4-2026-05-24.html](./mockups/today-v4-2026-05-24.html)** — the current gold standard. POST-RUN state with real LLM output + real prod data.
- [mockups/today-v3-2026-05-24.html](./mockups/today-v3-2026-05-24.html) — first version with cards driven by topics
- [mockups/today-v2-2026-05-24.html](./mockups/today-v2-2026-05-24.html) — voice + cards iteration
- [mockups/today-v1-2026-05-24.html](./mockups/today-v1-2026-05-24.html) — first watch-face-DNA pass
- [mockups/watch-faces.html](./mockups/watch-faces.html) — watch face inventory (the design language source)
- [mockups/watch-redesign.html](./mockups/watch-redesign.html) — watch redesign exploration

## Historical / superseded

- [VOICE_AUDIT_AND_REWRITE.md](./VOICE_AUDIT_AND_REWRITE.md) — the original voice doctrine architecture. Useful for context; the active voice is now anchored on David's gold sample in PHILOSOPHY.md + the LLM prompt.
- [BUILD_PLAN_HISTORY.md](./BUILD_PLAN_HISTORY.md) — earlier coach build plan, superseded by NEXT_BUILD.md.
- [WIRING_AUDIT.md](./WIRING_AUDIT.md) — historical wiring audit.
- [ADAPTIVE_STATE.md](./ADAPTIVE_STATE.md) — earlier thinking on adaptive state surfacing.
- [coach-pulse-staleness.md](./coach-pulse-staleness.md) — historical note on cache staleness.

## Live code

- [`web/coach/prompts/daily-briefing.md`](../../web/coach/prompts/daily-briefing.md) — the LLM system prompt (the production voice doctrine)
- [`web/coach/daily-briefing.ts`](../../web/coach/daily-briefing.ts) — the briefing function stub
- [`web/scripts/test-daily-briefing.mjs`](../../web/scripts/test-daily-briefing.mjs) — end-to-end test rig against real prod data
