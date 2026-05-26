# Coach voice eval (P37)

Replaces the stale gold-corpus voice-eval that predated the tool-use loop.
Tests the live coach against 10 canonical scenarios + checks:
- which tools the LLM called
- whether required facts (pace/HR/sleep) are cited
- whether banned phrases ("crushed it", "Strava", etc) are absent
- voice traits land per-scenario

Run locally:
```bash
cd web-v2
node scripts/voice-eval/run.mjs
```

Set `EVAL_USER_ID` in `.env.local` to test against a different user;
defaults to DAVID_USER_ID.

This is a smoke-grade test, not a regression-blocker. Run it after any
change to:
- `lib/coach/engine.ts`
- `lib/coach/tools.ts`
- `coach/prompts/index.ts`
