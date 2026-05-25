# Watch · coach ideas (running doc)

The watch app is shipping and working. This doc captures coach + insight ideas that surface during other work — for a future watch-focused session.

**Status:** living doc. Append-only as ideas come up. No commitments here.

---

## Live-during-run ideas

- **Cadence target overlay** — when the runner has locked in a cadence experiment ("Lock in for tomorrow"), the watch can show target SPM as a complication during the next run, with a soft haptic when drift > 5%.
- **HR zone breach warning** — gentle buzz when easy-run HR climbs above the runner's easy baseline + N bpm. Coach voice catches this post-run; watch can catch it live.
- **Fueling gel buzz** — already exists; could be smarter using post-run feedback (if you said "wrecked" on the last long run, watch suggests gel 15 min earlier).
- **Negative-split coach** — during a tempo or race, gentle reminder at the halfway point if pace is hot ("settle 5 sec/mi") or cold ("start to commit").

## Post-run ideas

- **One-line post-run summary on the watch face** — the same `voice` paragraph from the briefing, condensed to one watch-readable line. "Solid 11.1 at 8:50. Sleep was short, take it easy tomorrow."
- **Reply chips on watch** — SOLID / TIRED / WRECKED as a tap-anywhere prompt right after run ends. Writes to `post_run_rpe` same as the phone.
- **Streak / milestone watch buzz** — coach detects a meaningful pattern (4 weeks of held mileage, longest run since last race, etc) — watch buzzes with a tiny celebration glyph.

## Pre-run ideas

- **Today's workout face** — already in watch face inventory; consider tying the displayed target to the runner's stated focus ("cadence 168 today" from coach_intent table).
- **Weather adapt** — when the morning forecast shifts ("Now 92°F at noon, heat advisory"), watch surfaces a "move it earlier?" prompt that respects coach autonomy tiers.
- **Race-week countdown face** — when within 7 days of an A-race, the face shifts to race-week mode (countdown, fueling reminder, taper voice).

## Adaptive ideas

- **Live coach-presence pulse** — small dot on the watch face that pulses when the coach has something to say. Tap to read. Otherwise quiet — coach doesn't shout.
- **Watch as a sensor for coach state** — if HR / pace / cadence during the current run deviates from plan in a meaningful way, the watch can write a "live anomaly" record that the next briefing references ("you backed off at mile 4 — what happened?").

## Cross-app ideas (watch helping coach across surfaces)

- **Mid-run intent commit** — runner taps "Lock in for tomorrow" on the iPhone briefing. Watch reads the intent at the start of tomorrow's run, surfaces the target during the warmup.
- **Watch as the source of truth for fueling timing** — if the runner skipped the gel buzz, that's a real signal. Coach reads it next briefing: "you skipped both gels yesterday — was it the brand or did you forget?"
- **Race-day mode** — entire watch UX shifts. The race-day mockup in `docs/coach/mockups/watch-faces.html` is the visual reference; coach voice for race-day shows up on watch as the final pre-race brief + live splits target.

## Constraints to respect

- Watch screen is small. One thing dominates per face. Same DNA as the phone, just more compressed.
- Battery — no continuous heavy computation on-device. The watch surfaces coach output the iPhone already computed.
- Glanceable — every face must communicate in <1 second.
- No emoji. Watch UI uses monoline + simple graphics. See watch-faces inventory.

## Watch ↔ coach data contract (sketch)

The watch consumes a compressed version of the `{ voice, topics[] }` payload:

```
{
  watch_voice: "<one-line, under 80 chars>",
  watch_intent: { kind, payload, valid_until },   // active commitments
  watch_card: { kind, primary_value, sub }        // ONE card to display
}
```

The iPhone bridges this from the full briefing. The watch never calls the LLM directly.

---

*Append ideas here as they come up. When a watch session is ready, this doc is the starting point.*
