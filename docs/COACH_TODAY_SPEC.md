# Coach voice + TODAY page · spec

**Status:** approved direction, paused pending log-data cleanup so future voice samples reference clean numbers (the dedup pipeline currently inflates weekly mileage ~7%, which makes "well over plan" reads unreliable).

**Working prompt + test rig:** [web/scripts/test-coach-voice.mjs](../web/scripts/test-coach-voice.mjs) — runs the working LLM prompt against 4 scenarios. Iterate the prompt there before porting to production.

---

## 1 · Principles (the truth contract)

1. **Coach reads truth, never invents.** Plan, run data, recovery, races — all from the source. (The "Tomorrow is rest" hallucination from commit `b4981ad` was the canonical failure case. Reverted in `f1230a9`.)
2. **Honest about data quality.** If a number is flagged unreliable, speak qualitatively ("well over plan") instead of numerically. Going silent beats being confidently wrong.
3. **One notable observation per run, not five.** Coach picks the thing worth saying; the rest stays in the evidence widget.
4. **"We" and "us". Goal by name** (AFC, CIM, the half). Never "your A-race."
5. **Coach is the eye of the app.** Plan adaptations, readiness reads, mode overrides — these are things the coach SAYS, not separate banners.

---

## 2 · The gold sample (David's own words)

This is the reference voice for every utterance the coach makes on the TODAY page:

> Great run today. 12.1 miles at an easy pace is the perfect execution. cadence was a bit low but thats okay for an easy run, it actually helps. this week gets us back into speed. Time to start pushing to hit that goal for AFC. Its possible, but we need to be strategic.
>
> Also, you're doing great with sustaining milage, going to up it a bit next week. Let me know how it feels.

### Voice traits to embody
- **Open with specific warmth** anchored to what just happened ("Great run today"). Never generic.
- **Notice ONE thing and contextualize** ("cadence was a bit low but for easy that's fine").
- **Use "we" and "us"** — collaborative, not reporting.
- **Name the goal by name** ("for AFC"). Never "your next race."
- **State intent** ("Time to start pushing", "going to up it a bit next week"). Coach acts, doesn't label phases.
- **Be honest about challenge** ("It's possible, but we need to be strategic").
- **Read meta-patterns** ("you're doing great sustaining mileage") — recognize behavior, not just quote numbers.
- **Ask for feedback** ("Let me know how it feels"). Loop closed.

### Hard rules (banned)
- "Aerobic engine", "stimulus", "absorption window", "compound off", "the engine showing up", "the work landing" — coach-textbook jargon.
- "You got this", "let's crush it", "trust the process", "great job", "send it", "lock in", "go time" — clichés.
- "Today's session is…" template openers.
- Em dashes. Use periods or commas.
- Exclamation marks.
- Reciting numbers the page evidence already shows (coach interprets; page records).

---

## 3 · Page spine — every state

```
COACH voice    ← the eye, speaking. Top. Prominent.
EVIDENCE       ← what coach refers to (run / target / recovery)
NEXT          ← week strip, forward look
```

Same spine, different EVIDENCE widget per state.

---

## 4 · State matrix — Group A (95% of days)

### POST-RUN (today, completed)
```
┌─ COACH ──────────────────────────────────────────┐
│ Multi-paragraph reflection per gold sample:      │
│ • opener + one observation                       │
│ • meta-pattern read                              │
│ • forward intent (next run / next week)          │
│ • feedback ask                                   │
│      [ 😀 Solid ] [ 😐 Tired ] [ 😩 Wrecked ]   │
├─ RUN RECAP ──────────────────────────────────────┤
│ dist · time · pace · HR · the metric coach named │
│ weather                            [ Full recap →]│
├─ THIS WEEK ──────────────────────────────────────┤
│ 7-day strip with today highlighted               │
└──────────────────────────────────────────────────┘
```
Hidden: big LONG/EASY title, 6-tile form grid, standalone readiness ring, plan-adaptation banner.

### PRE-RUN (today, planned, not started)
```
┌─ COACH ──────────────────────────────────────────┐
│ 1-3 sentences framing today's intent             │
│ Mode varies by time-of-day                       │
├─ WORKOUT TARGET ─────────────────────────────────┤
│ distance · target pace · est duration · fuel     │
│ route preview                                    │
│  [ START → ] [ View route ] [ Substitute ]       │
├─ THIS WEEK ──────────────────────────────────────┤
└──────────────────────────────────────────────────┘
```
Hidden: post-run stats, big readiness ring, yesterday rehash.

### POST-RUN partial (e.g., planned 5, did 2.8)
Same shape as POST-RUN; coach voice is honest acknowledgment + read on why + tomorrow framing. Evidence shows "X of Y mi."

### REST DAY (planned)
```
┌─ COACH ──────────────────────────────────────────┐
│ Short — 2-3 sentences. Why rest, what's coming.  │
├─ RECOVERY ───────────────────────────────────────┤
│ Sleep · HRV · resting HR · soreness check        │
├─ THIS WEEK ──────────────────────────────────────┤
└──────────────────────────────────────────────────┘
```
Hidden: workout hero, big title, intensity bar.

### SKIPPED (explicit or EOD with no run)
Coach voice: "Run didn't go in today. Real reason or excuse? Tomorrow brings X." Evidence shows what today WAS supposed to be + tomorrow's preview.

---

## 5 · Time-of-day voice overlay

Modifies the voice within any state. Same page structure.

| Window | Voice mode |
|---|---|
| **Morning (4am–12pm)** | Forward framing. "You've got X today." First read of the day. |
| **Midday (12pm–5pm)** | Run not done: nudge. Done: brief reflection. |
| **Evening (5pm–10pm)** | Full reflection if done. Honest ack if skipped. Frames tomorrow. |
| **Late night (10pm–4am)** | Muted. "Tomorrow brings X. Get some sleep." |

---

## 6 · The "one notable thing" rule (post-run)

Coach picks ONE observation per run. Ranking:
1. **Anything off baseline?** (cadence low, HR drift high, pace fell late, sleep short)
2. **Workout type-specific signal?** (tempo: did the band hold? long: did fueling land? easy: was effort honest?)
3. **Weather / conditions changed the read?**
4. **PR or new ground?**

The chosen one becomes coach prose. The rest stays in EVIDENCE for the runner to scan.

Implementation: small ranker reading run baselines + type expectations. Doesn't exist yet; build it alongside the LLM voice wiring.

---

## 7 · Coach autonomy — three tiers

The coach has authority to adapt; the question is what requires permission.

| Tier | Coach behavior | Examples |
|---|---|---|
| **Tactical** (autonomous) | Just does it. Mentions the change next time it speaks. | Cut a tempo rep when HRV crashed. Drop a mile in extreme heat. Swap easy for shake-out pre-race. Move today's run earlier when storm forecast at noon. |
| **Operational** (notify + undo) | Makes change, surfaces inline in coach voice, runner can undo. | Move a quality day to a different DOW. Add/drop a mid-week rest. Adjust week mileage ±5-15%. Reorder workouts after a partial. |
| **Strategic** (propose + accept) | Coach proposes inline with buttons; never executes without nod. | Phase shift. Race goal renegotiation. Mileage step >15%. A-race swap. Plan rewrite. |

**Key UX shift:** adaptations are NOT separate banners. The coach SAYS them.

Banner today:
```
COACH UPDATED YOUR PLAN
Running 10% above plan this week, nudging next week up within 10%/wk ramp cap.
```

Becomes coach voice:
> *"You're sustaining mileage really well right now. Going to nudge next week up about 6%, see how it holds."*

Strategic proposal inline in voice:
> *"You've been holding the threshold band cleanly three weeks running. Fitness has moved 18 seconds inside your AFC goal. Want to drop the goal to 1:33, or hold and bank the buffer for race-day heat?*
>
> *[ Drop to 1:33 ]  [ Hold the goal ]  [ Let me think ]*"

**Existing infrastructure** (already in codebase, just wired to the wrong UI):
- `coach/plan-adapter.ts` — plan adaptation logic
- `coach/coach-goal-proposals.ts` — goal renegotiation
- `coach_proposals` DB table
- `coach_actions` DB table
- `ProposalCard`, `CoachAdaptedIsland`, `ModePrescriptionCard` — current banner surfaces (to be absorbed)

---

## 8 · Tested LLM samples (May 24)

Run via [web/scripts/test-coach-voice.mjs](../web/scripts/test-coach-voice.mjs). Approved by David: "this voice is good."

### A · Sunday post-long-run (real data)
> Nice work on the long run. You hit the zone perfectly and the pace was right where it should be. A mile short of plan but you're well over volume this week so that's fine, maybe even smart given the humidity.
>
> Cadence was down around 160 today. For easy runs that's actually not a problem, sometimes helps you relax into the effort. If it starts showing up on tempo days we'll address it, but for now it's just part of the easy rhythm.
>
> Tomorrow's an easy 4, then Tuesday we're back into tempo work. 4 x 1 mile. First quality session in a bit, so we'll see how the legs respond. Let me know how the recovery feels tonight and tomorrow morning.

### B · Tuesday post-quality (hypothetical)
> Really solid tempo session this morning. All four miles right in the band, 7:04 to 7:09, and the drift was minimal. That's the kind of controlled effort we want, especially 82 days out from AFC. You held the pace, the HR stayed honest, and the progression was clean.
>
> Sleep was a little short last night, so good awareness there. We've got easy running Wednesday and Thursday, then the long run Sunday at 13. That's where we start building the aerobic base you'll need for the half. Keep the easy days truly easy, and let me know how the legs feel going into the weekend.

### C · Thursday rest (hypothetical)
> Rest day. Good timing after Tuesday's tempo. That quad heaviness is normal, it'll clear before the weekend.
>
> You've got 18 miles in through three days, which puts you right on track for the 31 we mapped out this week. Two rest days mid-week might feel like a lot, but it's the right call. We're building the base carefully so the mileage holds when we start layering speed back in.
>
> Saturday's shake-out is just movement. Then Sunday we're back to 13, which will be your longest in a while. Let me know how the legs feel going into it.

### D · Monday after partial + bad sleep (hypothetical)
> You got out there on 5 hours of sleep in that humidity and your body told you no at 2.8. That's the right call. HR was high, energy was low, and pushing through would've just dug the hole deeper for tomorrow.
>
> Tomorrow's tempo matters. Four mile repeats is real work and we need you fresh for it. Get to bed early tonight, eat well, and let's see how you feel in the morning. If the legs still feel heavy we can adjust, but I think one good night will turn this around.
>
> You're not behind. We just need to be smart this week.

---

## 9 · Implementation order (when we resume)

Logged here so the next session picks up cleanly without re-discussing.

1. **Wire LLM voice into /overview for POST-RUN state.**
   - Port prompt from `web/scripts/test-coach-voice.mjs` to `web/coach/llm.ts` as the daily-briefing call.
   - Build the "one notable thing" ranker.
   - Replace `generateBriefing()` call in `web/app/overview/page.tsx` with LLM call when state is POST-RUN.
   - Render multi-paragraph output cleanly (split `\n\n`, scale subsequent paragraphs down per `overview-v4.css`).
   - Cache result for the day (don't re-call LLM on every page load — `coach_today_cache` already exists).

2. **Strip the standalone alert banners** as their content gets absorbed into voice.
   - `CoachAdaptedIsland` → coach prose
   - `StravaGapCard` → coach prose ("haven't seen a run in 5 days, what's going on?")
   - `PostRaceCard` → coach prose (post-race mode voice)
   - `ModePrescriptionCard` → coach prose with mode register
   - `GetStartedCard` → coach prose in onboarding mode
   - `ProposalCard` → embedded inline in coach voice with accept/decline buttons

3. **PRE-RUN state** — workout target card + LLM voice for framing.

4. **REST + SKIPPED + PARTIAL states** — adaptive evidence widget per state.

5. **Adaptation surfacing inline** — tactical first (autonomous + mention), operational (notify + undo), strategic (propose + accept embedded in coach prose).

6. **Mode overrides** — race day (own page), race week, post-race recovery, sick, injured.

7. **iOS parity** — once the web TODAY page is right, port to the iOS app. The `/api/overview` route already serves the briefing as JSON, so iOS gets the same text without separate prompt logic.

---

## 10 · Known dirty edges

- **Log dedup pipeline** inflates weekly mileage ~7%. Background agent shipped 4 of 5 fixes (commits `ccd54cf`, `de05daa`, `55e3476`, `b7c452c`). Backfill (FIX 5) status check pending. This spec is paused until coach can read clean numbers — otherwise samples like "well over plan" will be wrong.
- The `coach-briefing.ts` deterministic generator is still in use as a fallback. Eventually delete once LLM voice is fully wired and trusted.
- iOS app reads the same briefing via `/api/overview`. Any change to briefing length/format propagates to iOS automatically (currently as a single string with `\n\n` paragraph breaks).

---

## 11 · Reference

- David's gold sample: §2
- Working LLM prompt + scenarios: `web/scripts/test-coach-voice.mjs`
- Page layout sketches: §4
- Autonomy contract: §7
- Current /overview layout (to be replaced): `web/app/overview/page.tsx`
- Voice doctrine v1 (predecessor, more academic): `web/coach/voice.md`

---

*Resume point: when log fixes ship and prod data is clean, run `node web/scripts/test-coach-voice.mjs` to re-verify voice against fresh numbers, then execute §9 step 1.*
