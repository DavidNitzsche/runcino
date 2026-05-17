# C6 — Content Inventory: Coach + Insights

Inventory of elements across (a) Coach chat (web + iOS), (b) the Insights pattern-detection page, (c) inline coach-voice blocks scattered across the app, and (d) proactive nudges via push / Live Activity / widgets. Inclusive, not curated.

Brand assumed: dark theme, hero numbers, small-caps gray labels, semantic color, WHY / FOCUS / BACK OFF IF voice blocks. Coach voice is honest, direct, time-aware, never sycophantic, shows the WHY before the WHAT.

LLM internals (model, retrieval, tool-use, eval) are deferred to `D4-coach-llm-design.md`. This doc covers **only what the user sees**. KB references = filenames in `/Research/`. ACWR insights honor `REVIEW_NOTES.md` §4 (directional, not deterministic).

---

## 1. Web Coach (chat)

### Job-to-be-done

"Ask the coach anything about my training and get a contextual, data-grounded answer. Save the ones I want to keep. Apply the ones I want to act on."

### Element inventory

| # | Element | Priority | Data source | KB ref | Rationale |
|---|---|---|---|---|---|
| 1 | Persistent chat thread (single rolling conversation) | must | app | — | One coach, one ongoing relationship; not a forum. |
| 2 | Multi-thread mode (named topics, e.g. "Boston build", "Achilles") | should | app | — | Power users separate concerns; threading mirrors how athletes journal. |
| 3 | Text input with multi-line support | must | app | — | Table stakes. |
| 4 | Voice input (push-to-talk + tap-to-toggle) | should | app + Whisper-class STT | — | Mid-stretch, mid-cooldown question capture. |
| 5 | Voice output (TTS playback per reply, replayable) | should | app + TTS | — | Hands-free morning. |
| 6 | Streaming token output | must | coach-LLM | — | First token <1.5s; full reply <8s for non-tool answers. |
| 7 | "Stop generating" affordance | must | app | — | User control. |
| 8 | "Regenerate" affordance | should | app | — | Reroll without losing context. |
| 9 | Suggested questions (quick-tap chips, context-aware) | must | app + coach-LLM | — | Cold-start scaffold; see §1a below. |
| 10 | Context badge ("Based on: today's plan, last 7 runs, HRV trend") | should | app | — | Trust through transparency. |
| 11 | Inline run reference (clickable run card embedded in reply) | must | coach-LLM tool-use | `04-workout-vocabulary.md` | "On Tuesday's tempo you ran X" → tap → run detail. |
| 12 | Inline chart (sparkline / mini chart rendered in reply) | should | coach-LLM tool-use | `15-wearable-data.md` | "Your HRV looked like this" — show, don't summarize. |
| 13 | Inline plan-week strip (rendered in reply) | should | coach-LLM tool-use | `22-plan-templates.md` | Reference next 7 days inline. |
| 14 | Inline workout card (with "Send to Watch" button) | should | coach-LLM tool-use | `04-workout-vocabulary.md` | Coach proposes → user sends. |
| 15 | Inline race card | nice | coach-LLM tool-use | — | Reference races by name/chip. |
| 16 | Citation chip ("KB: 15-wearable-data §HRV trends") | should | coach-LLM | All `/Research/` | Surface KB provenance on demand. |
| 17 | Citation expand sheet (full quoted snippet + jump-to-source) | should | app | All `/Research/` | Verify the claim. |
| 18 | "Save this answer" → notes / journal | should | user-input | — | Memory layer that persists outside the thread. |
| 19 | "Apply this suggestion" → modify plan | must | coach-LLM tool-use + plan engine | `22-plan-templates.md` | Coach proposes a swap; one click commits. |
| 20 | "Apply this suggestion" → log subjective state | should | user-input | `15-wearable-data.md` | "I'm feeling beat" → coach offers a 1-tap RPE / soreness log. |
| 21 | "Apply this suggestion" → set readiness override | should | user-input | `00b-recovery-protocols.md` | Coach pushes a rest day; user accepts → tomorrow's card flips. |
| 22 | "Apply this suggestion" → schedule a race | nice | user-input | — | "Try a tune-up race in 3 weeks" → calendar entry. |
| 23 | Conversation history (scrollback, infinite) | must | app | — | The relationship is the value. |
| 24 | History search (full-text across all threads) | must | app | — | "What did the coach say about my Achilles last fall?" |
| 25 | History pinning (star a turn) | nice | user-input | — | Mark gold. |
| 26 | History export (Markdown / PDF) | nice | app | — | Portability. |
| 27 | Topic filters in history (race-build, injury, recovery, gear, mental) | should | app + coach-LLM tagging | — | Tag turns by topic for retrieval. |
| 28 | Coach personality dial (Direct ↔ Encouraging) | should | user-pref → coach-LLM system prompt | — | Same coach, different bedside manner. |
| 29 | Coach detail dial (Concise ↔ Technical) | should | user-pref → coach-LLM | — | Power users want references and numbers; new users don't. |
| 30 | Length toggle per reply (Brief / Full) | should | user-input | — | Reroll with shorter/longer output. |
| 31 | "Explain this further" expand-in-place | should | coach-LLM | — | Drill without losing thread. |
| 32 | "Show me where you got this" — citation reveal | should | coach-LLM | All `/Research/` | On-demand transparency. |
| 33 | Confidence indicator on each reply (high / medium / low / out-of-scope) | must | coach-LLM | — | Honesty when the model isn't sure. |
| 34 | "Out of scope" deflection card | must | coach-LLM | — | Medical, legal, mental health crisis → handoff copy. |
| 35 | Privacy indicator ("This stays on-device" / "Sent to server") | must | app | — | Trust signal; matters for body-weight, cycle, mental-health turns. |
| 36 | Sensitive-topic mode (mental health, eating, body weight) | must | coach-LLM + content guardrails | `13-sex-specific-training.md`, `20-mental-training.md` | Tone shift + resource cards (Crisis Text Line, NEDA). |
| 37 | "What do you know about me?" data-summary card | should | app | — | The user can audit the context the coach is using. |
| 38 | "Forget this turn" / "Forget this thread" | should | app | — | Privacy control. |
| 39 | Latency state ("Coach is thinking…", with what tool) | should | app | — | "Pulling your last 7 runs…" beats spinner. |
| 40 | Tool-use trace (collapsible: "Read plan", "Read HRV", "Searched KB") | nice | coach-LLM | — | Power-user transparency. |
| 41 | Coach error state (recoverable vs. fatal) | must | app | — | "Rate-limited, try in 30s" beats blank. |
| 42 | "Continue from web on phone" handoff | should | sync | — | Same thread on iOS. |
| 43 | Daily message rendered as the first turn of the day | should | coach-LLM | `00b-recovery-protocols.md` | The Today daily message lives in the chat; user can reply to it. |
| 44 | Reply-to-daily-message inline | should | app | — | Turn the morning read into a conversation. |
| 45 | Suggested follow-ups after each coach reply | should | coach-LLM | — | "Want me to swap tomorrow?" / "Show me the data?" |
| 46 | Attach-a-screenshot input | nice | app + multimodal | — | "Garmin shows this — what is it?" |
| 47 | Attach-a-run input ("Ask about this specific run") | should | app | — | Right-click run anywhere → "Ask coach about this." |
| 48 | "@" mentions for entities (@plan, @last-race, @Tuesday) | nice | app | — | Power-user precision. |
| 49 | Date-picker for "what about Monday?" | nice | app | — | Disambiguate temporal references. |
| 50 | Conversation summary per thread (auto, on resume) | should | coach-LLM | — | "Last time we talked about your Achilles — here's where we left off." |
| 51 | Topic-thread auto-create on emerging theme | nice | coach-LLM | — | "I'll start a new thread for race build." |
| 52 | Thread archive (read-only) | should | app | — | Old build cycles, kept. |
| 53 | "Coach voice" preview / sample player (in personality settings) | nice | app | — | Hear before you commit. |
| 54 | Subscription / token meter (if applicable) | later | app | — | Honest if usage-capped. |
| 55 | Keyboard shortcuts (⌘↵ send, ⌘K thread switcher, ↑ edit last) | should | app | — | Power users live in keyboard. |
| 56 | Markdown rendering in replies (lists, tables, code-fenced workouts) | must | app | — | Workouts are structured text. |
| 57 | Workout block syntax in replies (rendered as a card, not a code block) | should | app + coach-LLM | `04-workout-vocabulary.md` | "2 mi WU / 4×1mi @ T / 2 mi CD" → card. |
| 58 | Pace-pill rendering ("7:25/mi · M") inline | should | app | `01-pace-zones-vdot.md` | Brand-consistent inline component. |
| 59 | "Compare to last block" mode | nice | coach-LLM tool-use | — | Side-by-side cycle view rendered inline. |
| 60 | Empty-state with prompt taxonomy ("Plan", "Recovery", "Race", "Gear", "Why") | should | app | — | Cold-start onboarding for the coach surface. |

### 1a. Suggested-question taxonomy (context-aware)

The chip strip at the top of the input is **not static**. It's chosen by app-side logic from the user's current state. Categories below; the coach surface picks 3–5 chips per session.

| Context trigger | Sample chips |
|---|---|
| Pre-workout (workout starts within 4h) | "Why this workout?" · "Adjust for today's heat?" · "What pace exactly?" · "Should I fuel?" |
| Post-workout (within 2h of finish) | "How did that go?" · "Was that the right effort?" · "What's tomorrow look like?" · "Any red flags?" |
| Low readiness (composite ≤ 40) | "Should I rest?" · "Modify today's session?" · "What's driving this?" · "How long does this usually last for me?" |
| Race week (≤ 7 days) | "Pacing strategy?" · "Fueling plan?" · "Sleep last 7 days OK?" · "Weather adjustment?" |
| Post-race (within 14 days) | "Lessons from yesterday?" · "When can I run again?" · "Recovery checklist?" · "Compare to last race." |
| Active injury | "Where am I in RTR?" · "Cross-training options?" · "When can I add intensity?" |
| Plan deviation (3+ missed) | "Adjust the plan?" · "Cut volume this week?" · "Reschedule long run?" |
| Building / no race set | "Help me pick a goal." · "What's my fitness say?" · "Suggest a tune-up race." |
| Cold-start / onboarding | "What's my plan today?" · "How do you read me?" · "What's a good first goal?" |
| HRV declining 7+ days | "Why is my HRV down?" · "Am I overreaching?" · "What should I change?" |

---

## 2. iOS Coach Chat

Same primitives as web; mobile shifts which are mandatory. Fewer power features, more in-context inputs (camera, voice, Siri).

### Element inventory (deltas from web)

| # | Element | Priority | iOS-specific notes |
|---|---|---|---|
| 1 | Single-thread default | must | Thread-switcher hidden behind tap; reduces mobile cognitive load. |
| 2 | Voice input as first-class input mode | must | Mic button is the same size as Send. |
| 3 | Voice output autoplay toggle | should | Off by default; on for "ask while running cooldown" pattern. |
| 4 | Suggested-question chips (horizontal scroll) | must | Same taxonomy as web §1a. |
| 5 | Streaming reply with subtle haptic on first token | should | Confirms the request landed. |
| 6 | Inline run / workout / chart cards | must | Tap to open native sheet, not navigate away. |
| 7 | "Save to notes" swipe action on a turn | should | iOS-native gesture. |
| 8 | "Apply suggestion" → confirmation sheet | must | Mobile = explicit confirms before plan mutation. |
| 9 | Copy turn / share turn | nice | iOS share sheet. |
| 10 | Reply via Siri ("Hey Siri, ask my coach…") | nice | Siri Shortcut. |
| 11 | Quick-ask widget (small home-screen widget → text-field shortcut) | nice | Lowest-friction entry. |
| 12 | Lock-screen reply on coach push notifications | should | Inline reply field on the push. |
| 13 | Camera input for shoe / fueling product / blood-test photo | nice | Multimodal. |
| 14 | Push-to-talk while running (audio-only, no screen) | nice | Apple Watch parallel; phone fallback. |
| 15 | Conversation history with full-text search | should | Same as web; secondary tab. |
| 16 | Privacy indicator per turn | must | "Local" / "Server" badge. |
| 17 | Sensitive-topic resource cards (NEDA, Crisis Text Line) | must | Same as web. |
| 18 | Network-aware degraded mode | should | "On cellular: voice off by default" guard. |
| 19 | Background-fetch handoff to web | should | Long replies finish on server, deliver via push. |
| 20 | Daily message hero on chat-tab open | should | The thread's first turn of the day, expanded. |
| 21 | Suggested follow-ups (chips below each reply) | should | Same taxonomy as web. |
| 22 | Coach personality + length toggles in chat header | should | Mobile-condensed pickers. |
| 23 | "Forget this thread" red-destructive action in thread menu | must | Privacy. |
| 24 | "Open in web for full chart" affordance | nice | Hand-off when answer is chart-heavy. |
| 25 | Scroll-to-top on new message arrival | should | Standard iMessage pattern. |

Watch coach (voice-only) is deferred to C2.

---

## 3. Web Insights (pattern detection)

### Job-to-be-done

"Show me patterns I can't see myself — what's working, what's drifting, what to watch — and tell me what to do about each one."

### Element inventory (page chrome + global controls)

| # | Element | Priority | Data source | KB ref | Rationale |
|---|---|---|---|---|---|
| 1 | Header: "Insights" + last-computed timestamp | must | app | — | Trust = freshness. |
| 2 | Time-window picker (7d / 4w / 12w / 52w / since last race / current cycle) | must | app | — | Most insights are window-bound. |
| 3 | Confidence filter (High / Medium / Low) | should | app | — | Hide low-confidence by default. |
| 4 | Action filter (Observe / Consider / Act) | should | app | — | Surface only actionables when wanted. |
| 5 | Topic filter (Pace, Volume, Recovery, Sleep, Heat, Cycle, Race, Plan, Gear) | should | app | — | Find the kind. |
| 6 | "Snoozed" tab | should | app | — | Don't lose snoozed items. |
| 7 | "Dismissed" tab (with un-dismiss) | should | app | — | Reversible. |
| 8 | Sort: Recency / Importance / Confidence | should | app | — | Power-user control. |
| 9 | Export insights (CSV / Markdown for journal) | nice | app | — | Portability. |
| 10 | "Ask coach about this" CTA per insight | must | coach-LLM | — | Insights → conversation handoff. |
| 11 | "Apply this" CTA per actionable insight | must | plan engine | — | Insight → mutation. |
| 12 | Weekly performance summary card (top of page, Sunday-fresh) | must | app + coach-LLM | `00a-distance-running-training.md` | Whoop-style weekly read. |
| 13 | Cycle summary card (when a training block closes) | should | app + coach-LLM | `22-plan-templates.md` | "8-week build complete: here's what changed." |
| 14 | Predicted race-time trajectory hero (per active goal race) | should | app | `02-race-time-prediction.md` | "On current trajectory: 3:14 ± 4 min." |
| 15 | Insight cards (the body of the page; see §3a inventory below) | must | app | various | The page is mostly cards. |

### 3a. Insight kinds (inventory)

Each row is one insight kind. Properties (trigger / confidence / action / frequency cap / dismiss-snooze / surface) are listed compactly per row. "Surface" key: I=Insights page, P=push, T=Today card, N=nowhere (silent log).

| # | Insight kind | Trigger | Confidence basis | Action class | Freq cap | Dismiss / Snooze | Surface | KB ref |
|---|---|---|---|---|---|---|---|---|
| 1 | Easy pace improvement at same HR | 4-week regression: easy-pace ↑ at HR drift held flat (≥ 5s/mi at ≤ 2 bpm) | High if n ≥ 12 easy runs in window | Observe | 1/week | Both | I+T | `01-pace-zones-vdot.md`, `15-wearable-data.md` |
| 2 | Easy pace regression at same HR | Inverse of #1; flat or worsening for 3 weeks | Med | Consider | 1/week | Both | I | `15-wearable-data.md` |
| 3 | Long-run consistency streak | 6+ consecutive weeks with a long run ≥ 90 min | High | Observe | 1/4 weeks | Snooze | I | `00a-distance-running-training.md` |
| 4 | Long-run cap drift | Long run > 30% of weekly volume OR > 110% of 30-day-max | Med | Consider | per occurrence | Both | I+T | `00a` (BJSM 110% rule) |
| 5 | Plan adherence percentage (last 4 weeks) | Computed nightly; surface when crosses thresholds (≥ 90% green / 70–90% yellow / < 70% red) | High | Observe (≥70%), Consider (<70%) | 1/week | Snooze | I | — |
| 6 | Heat / recovery correlation | Recovery score drops > 1σ on days following sessions in dew point ≥ 65°F | Med (n ≥ 8) | Consider | 1/2 weeks | Both | I | `06-weather-adjustments.md` |
| 7 | HRV trend declining | 7-day rolling avg below 30-day baseline by ≥ 1σ for 5+ days | High | Consider (5–7 days) → Act (8+ days) | escalates | Snooze (24h max) | I+T+P | `15-wearable-data.md`, `03-heart-rate-zones.md` |
| 8 | HRV trend improving | 7-day rolling avg above 30-day baseline by ≥ 1σ for 5+ days | High | Observe | 1/2 weeks | Snooze | I | `15-wearable-data.md` |
| 9 | HRV volatility (SD/mean) elevated | Rolling SD/mean above personal baseline by ≥ 1σ for 7+ days | Med | Consider | 1/week | Both | I | `15-wearable-data.md` |
| 10 | Sleep debt impact on workouts | Quality outcomes (RPE delta, completion %) correlate with prior 3-night sleep deficit | Med (n ≥ 6 quality sessions) | Consider | 1/2 weeks | Both | I | `00b-recovery-protocols.md`, `15-wearable-data.md` |
| 11 | Volume jump warning (ACWR) | ACWR ≥ 1.3 (yellow) / ≥ 1.5 (red); presented as **directional**, not deterministic, per `REVIEW_NOTES.md` §4 | Low–Med (KB hedge) | Consider (1.3–1.5) → Act (≥ 1.5) | 1/week | Snooze (3 days max for ≥1.5) | I+T+P (red only) | `00a`, `15`, `REVIEW_NOTES.md` |
| 12 | Workout reconciliation pattern | Repeated under/over execution of a target type (e.g., consistently 5–10s fast on T pace 4+ sessions) | High (n ≥ 4) | Consider | 1/2 weeks | Both | I | `04-workout-vocabulary.md`, `01-pace-zones-vdot.md` |
| 13 | Best-time-of-day analysis | Performance (pace at HR, completion rate) correlates with start-time bucket | Med (n ≥ 20 runs) | Observe | 1/8 weeks | Snooze | I | `12-travel-timezone.md` |
| 14 | Shoe / route correlation with feel | Feel rating + reconciliation differ by shoe or route beyond noise | Low–Med | Observe | 1/4 weeks | Snooze | I | `17-footwear.md`, `11-course-specific-training.md` |
| 15 | Predicted race-time trajectory | Recomputed weekly from VDOT + recent races; show 6-week projection band | High | Observe | weekly | Snooze | I+T | `02-race-time-prediction.md`, `01-pace-zones-vdot.md` |
| 16 | Cycle-phase performance trend (opt-in) | Performance metrics by cycle phase; surfaced only when n ≥ 2 full cycles | Low–Med | Observe | 1/cycle | Both | I | `13-sex-specific-training.md` |
| 17 | Weather impact on pace | Heat-adjusted pace ≠ raw pace by significant margin for last 4 weeks | Med | Observe | 1/4 weeks | Snooze | I | `06-weather-adjustments.md` |
| 18 | Cardiac drift trend | Drift across long runs increasing or decreasing 4-week trend | Med | Observe (improving), Consider (worsening) | 1/4 weeks | Both | I | `15-wearable-data.md`, `03-heart-rate-zones.md` |
| 19 | Recovery time after key workouts | Time-to-baseline HRV after T/I/race sessions trending up or down | Med | Observe | 1/4 weeks | Snooze | I | `00b-recovery-protocols.md` |
| 20 | Strain budget remaining (week) | Weekly load vs. computed budget given recent fitness; gauge | High | Observe (green), Consider (yellow), Act (red) | daily | Both | I+T | `15-wearable-data.md` |
| 21 | Periodization adherence | Phase-targets met (TID, long-run progression, intensity weeks) vs. plan | Med | Consider | 1/2 weeks | Both | I | `22-plan-templates.md` |
| 22 | Subjective vs. objective divergence | Subjective wellness ≤ 2 with objective recovery ≥ 70 (or inverse) for 3+ days | Med | Consider | 1/week | Both | I+T | `15-wearable-data.md` |
| 23 | Personal best alert | PR detected on a recognized distance (5K / 10K / HM / M / segment) | High | Observe | per occurrence | Dismiss only | I+P | `02-race-time-prediction.md`, `20-mental-training.md` |
| 24 | Streak milestone | Run streak / consistency streak crosses round threshold | High | Observe | per occurrence | Dismiss only | I | `20-mental-training.md` |
| 25 | Anti-streak guardrail | Streak active during illness / injury flag / risk alert | Med | Consider | per occurrence | Snooze | I+T | `00b`, `20`, `05` |
| 26 | Heat-acclimation status | Trend in heat-pace decoupling improvement over 10–14 days of heat exposure | Med | Observe | 1/2 weeks | Snooze | I | `06-weather-adjustments.md` |
| 27 | Altitude exposure note | Baseline altitude shifts triggering RHR ↑ / pace ↓ adjustment | Med | Observe | per occurrence | Snooze | I | `11-course-specific-training.md` |
| 28 | Travel / timezone risk | Upcoming race at ≥ 3-tz delta + insufficient adapt window | High | Consider | per occurrence | Snooze | I+T | `12-travel-timezone.md` |
| 29 | Bloodwork flag (recent ferritin / vit-D / etc.) | User-entered lab outside endurance reference range | High | Consider | per occurrence | Dismiss | I | `13-sex-specific-training.md` |
| 30 | Shoe replacement due | Active shoe crosses 70% / 90% / 100% of model-specific lifespan | High | Act | per crossing | Dismiss | I+T | `17-footwear.md` |
| 31 | Super-shoe wear curve | Super-shoe ≥ 150 mi → benefit decay note | Med | Observe | per crossing | Dismiss | I | `17-footwear.md`, `REVIEW_NOTES.md` §3 |
| 32 | Fueling rate vs. plan | Long-run / race fueling intake below planned g-carb/h | Med (when logged) | Consider | per occurrence | Both | I | `18-fueling-products.md` |
| 33 | Hydration / electrolyte heat-day flag | Heat day forecast + last sweat-rate estimate | Med | Consider | per heat day | Snooze | I+T | `19-hydration-electrolytes.md` |
| 34 | Cadence drift | 4-week cadence trend ± 5 spm vs. baseline | Low–Med | Observe | 1/4 weeks | Snooze | I | `16-form-biomechanics.md` |
| 35 | Form / GCT / vertical oscillation drift (if device supplies) | Trend break vs. baseline | Low | Observe | 1/8 weeks | Snooze | I | `16-form-biomechanics.md` |
| 36 | Strength-session adherence | Concurrent strength program adherence < 60% over 4 weeks | Med | Consider | 1/4 weeks | Snooze | I | `07-strength-programming.md` |
| 37 | Mobility / warmup adherence | Pre-quality warmup logged < 50% of time | Low | Observe | 1/4 weeks | Snooze | I | `10-mobility-warmup.md` |
| 38 | Illness watch | RHR ↑ ≥ 5 bpm + HRV ↓ ≥ 1σ + subjective ≤ 2 simultaneously | High | Act | per occurrence | Snooze 24h | I+T+P | `00b-recovery-protocols.md`, `15-wearable-data.md` |
| 39 | Overtraining risk composite | Multi-input flag (HRV down trend + sleep debt + RPE drift + adherence drop) | Med | Act | 1/week | Snooze 3 days | I+T+P | `00b`, `15`, `20` |
| 40 | Return-to-run progression status (active injury) | RTR stage + days-in-stage vs. protocol | High | Act | per stage | Dismiss not allowed during active | I+T | `05-injury-return-protocols.md` |
| 41 | Mental-training streak (e.g., 4+ weeks of journaling) | Adherence to logging | Low | Observe | 1/4 weeks | Snooze | I | `20-mental-training.md` |

### 3b. Insight card anatomy

Every insight card, regardless of kind, exposes the same fields. Card layout:

| Slot | Content | Required |
|---|---|---|
| Header | Insight kind name (small-caps) + topic chip | yes |
| Hero line | The pattern in one sentence ("Your easy pace dropped 9s/mi at the same HR over the last 4 weeks.") | yes |
| Confidence chip | High / Med / Low + sample-size hover | yes |
| Action chip | Observe / Consider / Act | yes |
| Body | 2–4 line coach narrative — WHY this matters | yes |
| Visual | Chart, sparkline, or comparison strip | when relevant |
| KB citation | "Based on: 01-pace-zones-vdot.md, 15-wearable-data.md" | when KB-grounded |
| Window stamp | "4-week window, 14 easy runs" | yes |
| Primary CTA | "Ask coach" / "Apply" / "Mark done" | when actionable |
| Secondary | Snooze (1d / 7d / cycle) · Dismiss · Share to notes | yes |
| Surface tag | "Also showing on Today" / "Push sent at 7:14am" | yes |

### 3c. Conditional layouts

- **Build phase** — promote: easy-pace-at-HR (#1), long-run consistency (#3), TID adherence (#21), volume warning (#11), strain budget (#20). Demote: race-time trajectory (#15), travel-timezone (#28).
- **Peak** — promote: predicted race time (#15), strain budget (#20), HRV trend (#7), workout reconciliation (#12), illness watch (#38). Demote: cadence drift (#34), super-shoe wear (#31).
- **Taper** — promote: HRV improving (#8), overtraining risk (#39, often clears), sleep debt (#10), travel (#28), bloodwork (#29). Demote: ACWR (#11; volume drop is intended), TID (#21).
- **Race week** — hero: travel/timezone (#28), heat-acclimation status (#26), illness watch (#38), predicted race time (#15) condensed. Suppress: easy-pace-at-HR (#1), volume warnings (#11).
- **Post-race (≤14 days)** — hero: recovery time after key workouts (#19), HRV trend (#7), subjective-vs-objective (#22). Suppress: TID (#21), volume warnings (#11), strain budget (#20).
- **Off-season** — promote: cycle-summary card (#13), strength adherence (#36), bloodwork (#29). Demote/hide: most performance trend insights.
- **Active injury** — hero: RTR progression (#40). Strongly demote: pace/volume/strain insights. Suppress: anti-streak (#25 already redundant).

### 3d. Insight properties (canonical schema)

Every insight, regardless of kind, has these properties. (Restated as a flat list for the data model.)

| Property | Type | Example |
|---|---|---|
| `id` | UUID | — |
| `kind` | enum (41 kinds) | `EASY_PACE_AT_HR` |
| `triggered_at` | timestamp | 2026-05-04T07:14Z |
| `window` | { start, end, n_samples } | 4w / 14 runs |
| `confidence` | enum: high / med / low | high |
| `action_class` | enum: observe / consider / act | observe |
| `status` | enum: active / snoozed / dismissed / superseded | active |
| `snooze_until` | timestamp \| null | — |
| `freq_cap_key` | string | "easy_pace_at_hr_weekly" |
| `surfaces` | set: {insights, today, push, none} | {insights, today} |
| `payload` | kind-specific JSON | { delta_pace_s_per_mi: -9, hr_drift_bpm: 1, … } |
| `narrative` | string (coach-LLM authored) | "Your easy pace dropped 9s/mi…" |
| `citations` | array of KB refs | ["01-pace-zones-vdot.md", "15-wearable-data.md"] |
| `cta` | enum + payload | { type: "apply", target: "plan", change: … } |
| `links` | array of internal entity refs | [{ type: "run", id: … }, { type: "race", id: … }] |
| `superseded_by` | UUID \| null | — |

---

## 4. Inline coach voice blocks (scattered surfaces)

Coach voice appears as named narrative blocks across workout / recovery / race / run / recap surfaces. Canonical labels: **WHY**, **FOCUS**, **BACK OFF IF**, plus **YESTERDAY** for one-line post-run continuity (per C1).

### Voice templates per label

| Label | Use | Length | Tone | Template |
|---|---|---|---|---|
| WHY | Justify the prescription. Always present on quality / long / threshold sessions. | 1–3 sentences | Frame the stimulus, the cycle position, the trade-off. | "[Stimulus] is the point. [Cycle context]. Hold pace, not pride." |
| FOCUS | One concrete cue for execution. | 1 sentence | Imperative, single thing. | "[Cue] · [why it matters in 4–7 words]." |
| BACK OFF IF | Honest guardrails. Always present on hard sessions. | 1–2 lines, bullet form. | Direct, never softened. | "RPE > 8 in [interval] · HR refuses to drop in recovery · pace bleeding > 5s." |
| YESTERDAY | Continuity after a key session. | 1 sentence | Plain read of what just happened. | "[Session name] · [actual vs prescribed read] · [what to take into today]." |

### Where each block appears

| Surface | WHY | FOCUS | BACK OFF IF | YESTERDAY | Notes |
|---|---|---|---|---|---|
| Web Overview / iOS Today (workout card) | yes | yes | when hard | yes (when prior day was a key session) | Already in C1. |
| Workout detail (web + iOS) | yes | yes | when hard | n/a | Pre-workout briefing. |
| Watch active workout (pre-warmup screen) | summarized to 1 line | the FOCUS cue is the screen | n/a (Watch isn't the right surface for guardrails) | n/a | C2 territory. Watch is reductive. |
| Run recap (post-run) | retrospective WHY ("This was a [stimulus] day. Read the data, not the feel.") | n/a | n/a | n/a | Closes the loop. |
| Recovery score detail | yes (what's driving the score) | one cue (e.g., "Two easy days, then reassess.") | n/a | n/a | Health-page voice. |
| Race detail (upcoming) | yes (cycle-arc framing) | yes (one execution cue) | yes (race-day red lines) | n/a | Pre-race brief. |
| Race detail (past, recap) | retrospective WHY | n/a | n/a | n/a | Lessons-from-the-race. |
| Plan view (week header) | one-line "what this week is about" | n/a | n/a | n/a | Cycle navigation. |
| Phase / arc visualization | one line per phase ("Build · 4 wks · raise the floor") | n/a | n/a | n/a | Hover/expand. |
| Active-injury banner | yes (RTR-stage rationale) | one cue ("Pain-free walks first.") | yes (red flags that bump back a stage) | n/a | Owned by `05-injury-return-protocols.md`. |
| Race-week schedule (each day) | one line | one cue | n/a (BACK OFF reframed as "Don't add anything") | n/a | Taper voice = "Volume drop is intentional." |
| Insights cards (body) | yes (the narrative line) | when actionable | n/a | n/a | See §3b. |

### Anti-patterns (voice rules)

- No cheerleading verbs without payload ("Crush it!" is banned).
- No conditional softening on guardrails. "BACK OFF IF: pain doesn't drop in 5 min" not "you might consider…"
- No hype superlatives in WHY blocks ("massive" / "game-changer" / "huge").
- No emoji in coach voice.
- No second-person flattery ("As an experienced runner like you…"). Address the runner as a peer, not an idol.
- No filler citations ("research shows…" without naming what). If the WHY relies on KB, surface a citation chip.

---

## 5. Proactive coach nudges (push, Live Activity, widgets)

Default cadence: **quiet by default, loud when it matters**. Each category has its own freq cap, quiet-hours behavior, and copy template.

### Categories

| # | Category | Trigger | Default frequency cap | Quiet hours respected? | Copy tone | Surface |
|---|---|---|---|---|---|---|
| 1 | Daily message (morning) | 7:00am local (user-tunable; default = 30 min before user's typical wake) | 1/day | yes | Direct, time-aware ("Good morning. Easy 6 today — legs absorb yesterday's tempo.") | Push + Today + chat first turn |
| 2 | Pre-workout reminder | 60–120 min before scheduled workout | 1 per scheduled workout | partially (only suppressed during sleep window) | Specific ("Tempo at 5pm. Heat is up — E pace +10s.") | Push + widget |
| 3 | Post-workout prompt | within 15–30 min of detected workout end | 1 per workout | yes | Reflective ("How did it land? Quick log here.") | Push + Live Activity end |
| 4 | Recovery alert | red-zone composite recovery + tomorrow has a quality day scheduled | 1/day | yes (delivered at next non-quiet wake) | Honest ("Recovery is red. Considering moving tomorrow's intervals to Thursday?") | Push |
| 5 | Plan adjustment proposal | coach-LLM-generated change candidate | 1/day | yes | Tentative ("Want me to swap Wednesday with Friday?") | Push (only when high-confidence) + Insights card |
| 6 | Race countdown | T-30, T-14, T-7, T-3, T-1, T-0 | per scheduled race | partially (race-day delivered any time post-04:30 local at race location) | Tone shifts by stage — see §5a | Push + Live Activity + widget |
| 7 | Coach insight push (high-confidence acts only) | a §3a insight with action_class=Act | 2/week max | yes | Specific, single-action ("Active shoe at 95% of lifespan — log a swap?") | Push + Insights |
| 8 | Milestone / streak crossings | thresholds (purple accent) | per occurrence | yes | Brief, no hype ("PR. Half-marathon: 1:32:14.") | Push + widget |
| 9 | Anti-streak intervention | streak active during illness/injury flag | per occurrence | yes | Direct ("Streak's not the goal. Log a sick day.") | Push |
| 10 | Travel / timezone race nudge | T-14 before race in different TZ | per race | yes | Practical ("Adjust sleep window 1 hr toward [city] starting tonight.") | Push + Insights + Today |
| 11 | Heat day flag | morning forecast + scheduled quality session | 1/day max | yes | Specific ("Dew 68. T-pace +8s/mi. Hydrate now.") | Push + Today |
| 12 | Air quality alert | AQI > threshold + scheduled outdoor session | per occurrence | yes (race day overrides) | Practical ("AQI 165. Move tempo indoors or swap to easy.") | Push + Today |
| 13 | Sleep debt nudge | 3-night cumulative deficit + quality session tomorrow | 1/week max | yes (delivered as next-morning daily message rider) | Quiet ("Sleep is short. Tomorrow's intervals will feel hard.") | Today + chat |
| 14 | HRV trend warning | category §3a #7 escalating | escalates with severity | yes | Increases with severity over days | Push + Today + Insights |
| 15 | Illness watch | category §3a #38 | per occurrence | yes (immediate on-wake delivery) | Direct ("Three signals say sick. Take the day.") | Push + Today |
| 16 | Bloodwork follow-up | recent lab outside reference | 1/week until acknowledged | yes | Practical ("Ferritin came in low. Good time to talk to your doctor.") | Push + Insights |
| 17 | Cycle-aware nudge (opt-in) | phase transition + scheduled session | per phase change | yes | Quiet, neutral ("Luteal phase — heat tolerance often drops. Watch the dew point.") | Today + Insights |
| 18 | Race day mode auto-arm | race-day morning | 1 (on race day) | overridden by race day | Anchored ("Race day. Mode armed. Watch is primary screen.") | Push + Live Activity arming |
| 19 | Live Activity: today's workout | from "Send to Watch" → workout end | continuous during run | n/a | Real-time targets | Lock screen |
| 20 | Live Activity: race countdown | from T-3 → race start | continuous | n/a | Hours-to-start, weather chip, fueling timer | Lock screen |
| 21 | Live Activity: race-day execution | race start → finish | continuous | n/a | Pace vs. target, mile splits, fueling intervals | Lock screen + Dynamic Island |
| 22 | Widget: Today (small / med / lg) | always | n/a | n/a | Recovery + workout + countdown chips | Home screen |
| 23 | Widget: Race countdown (sm / med) | when goal race within 60 days | n/a | n/a | Days-to-race + condition band | Home screen + Lock screen |
| 24 | Widget: Quick-ask coach (sm) | always | n/a | n/a | One-tap → chat input | Home screen |
| 25 | Lock-screen complication: recovery score | always (when permitted) | n/a | n/a | Single number + color band | Lock screen |
| 26 | Inline-reply on push | per push category that benefits (categories 3, 5, 7, 9, 11) | n/a | n/a | "Reply yes/no/later" | Notification |
| 27 | Push action buttons | per push (category-dependent) | n/a | n/a | "Apply" / "Snooze 1d" / "Open coach" | Notification |
| 28 | Critical alerts (off by default) | category 15 (illness watch — high severity) and 18 (race day mode arm) only | per occurrence | bypasses Do-Not-Disturb only when user opts in | Direct | Push |

### 5a. Race countdown copy progression

| Stage | Tone | Sample line |
|---|---|---|
| T-30 | Reorienting | "Thirty days. Build is closing — time to sharpen." |
| T-14 | Practical | "Two weeks. Volume drops from here. Trust the taper." |
| T-7 | Specific | "Race week. Sleep is the workout. Caffeine in normal dose." |
| T-3 | Logistics | "Three days. Carb-load starts tomorrow at 8 g/kg." |
| T-1 | Quiet | "Day before. Easy 20 min shakeout. Lay out the kit." |
| T-0 (morning) | Anchored | "Race day. The work is done. Run the plan." |

### 5b. Frequency cap enforcement (global)

- Hard cap: **3 push notifications per day** total across all categories (unless category is critical/race-day).
- Hard cap: **2 coach-insight pushes per week** (separate from #1).
- Quiet hours default: 22:00–06:30 local. Override per user.
- DND respect: yes by default. Critical alerts (category 28) require explicit opt-in.
- Race day overrides quiet hours.
- Travel days respect destination quiet hours, not origin.
- After 3 user dismissals of a category in 7 days, that category auto-mutes for 14 days and the user is told ("Muted recovery alerts for 2 weeks — you've been dismissing them.").

### 5c. Notification settings (granular)

Every category in §5 is independently toggleable in Settings. Defaults:

| Category | Default state |
|---|---|
| Daily message | on |
| Pre-workout reminder | on |
| Post-workout prompt | on |
| Recovery alert | on |
| Plan adjustment | on |
| Race countdown | on |
| Coach insight push | on |
| Milestones | on |
| Anti-streak | on |
| Travel TZ | on |
| Heat / AQ / weather | on |
| Sleep debt | off (opt-in; can be perceived as nagging) |
| HRV trend warning | on |
| Illness watch | on |
| Bloodwork follow-up | on |
| Cycle nudges | off (opt-in, sensitive) |
| Race day mode arm | on |
| Critical alerts | off (opt-in) |

---

## 6. Quick competitor scan

- **Whoop Coach** — text chat with strong context (your Whoop data is loaded). Direct, quantified replies. Weakness for runners: no plan-mutation, no inline workout cards, no race-week structure. Take their context badge ("Based on your data") and the directness.
- **Garmin Insights / Training Status** — server-computed cards (Productive / Maintaining / Detraining / Overreaching / Unproductive / Peaking). Strong taxonomy, weak narrative. Take the taxonomy of training-state labels; reject the black-box framing — show the inputs.
- **Strava Athlete Intelligence** — narrative weekly summary in conversational prose. Engaging, occasionally insight-light. Take the Sunday weekly cadence; reject the over-eager tone.
- **Athlytic Coach** — Athlytic-specific readiness narrative + "what to do today" line. Strong daily-message brand. Take the always-present 1-line read; reject the over-formal voice.
- **Apple Workout Coach (and Fitness+)** — pre-canned video/audio coaches; not data-grounded. Take the native HealthKit pipeline; reject the impersonal-celebrity-trainer framing.
- **Oura insights** — calm, low-noise, daily message + occasional cards. Take the low-frequency cap discipline. Reject the wellness-platitude tone for endurance use.

---

## 7. Open questions

- **When does the coach volunteer vs. wait?** Default: volunteers daily message + critical signals (illness, ACWR red, race-week milestones); waits for everything else. Test: do users prefer 1/day proactive + chat-on-tap, or richer ambient (3–5/day)? Likely user-tunable, with a default tested against a small cohort.
- **Voice options — one default voice or selectable?** Single canonical voice ships v1 (consistency = brand). Voice selection is a v1.1 nice-to-have; keep the personality dial (Direct ↔ Encouraging) as the v1 differentiation knob. Open: should there be a "named coach" persona (e.g., "Coach Mae") or a deliberately unnamed system voice? Recommend unnamed; less risk of personification drift.
- **Confidence display — show always, or only on low-confidence?** Argument for always: trust by transparency. Argument for only-on-low: reduces visual noise. Recommend: chip always present, but only colored on Med/Low; High = neutral chip.
- **Does the coach proactively change the plan, or only suggest?** Recommend: only suggest, with a 1-tap accept. Plan mutation must be a user action even when the coach proposes it. Exception: heat/AQI same-day pace adjustments (coach may apply automatically with a notice and undo).
- **Insight de-duplication across cycles** — when a fresh insight supersedes an older one (e.g., easy-pace improvement repeats next month), do we collapse history or keep both? Recommend: collapse with a "view trend" link.
- **How aggressive should the anti-streak guardrail be?** A streak-broken push when illness flag fires can feel preachy. Recommend: present as observation, not intervention; muted after one acknowledgment.
- **Sensitive-topic handoff** — should the coach attempt mental-health support at all, or always deflect? Recommend: limited motivational support tied to training context (mental-training KB doc 20); explicit deflection + resource cards for clinical territory.
- **Voice input on watch** — sketched in §1a but watch surface deferred to C2.
- **Citation depth** — should every coach reply ship citations, or only on demand? Recommend: chip always available, expanded only on tap. Reduces visual noise.

---

## 8. Data model implications

Restated for the backend; complements §3d above.

### Entities

| Entity | Fields | Notes |
|---|---|---|
| `CoachConversation` | id, user_id, title, created_at, last_active_at, archived, topic_tags[] | Single conversation = single thread. Default user has one; power users can create more. |
| `CoachMessage` | id, conversation_id, role (user / coach / system / tool), text, content_blocks[], created_at, parent_message_id, edited_at, pinned, voice_url, latency_ms, tool_calls[], confidence (high/med/low/oos), citations[], saved_to_note_id | content_blocks[] supports inline cards (run, workout, chart, plan-week). Tool_calls[] enables the trace UI. |
| `CoachInsight` | (full schema in §3d) | First-class entity; not just a message. |
| `CoachInsightDismissal` | insight_id, user_id, action (snooze / dismiss / muted), until, reason | Audit log for tuning frequency caps. |
| `CoachInsightFreqCap` | key, user_id, last_fired_at, count_window | Per-user, per-cap accounting. |
| `ProactivePromptCadence` | category (28 enum values), user_id, enabled, time_window, last_fired_at, daily_count, weekly_count, muted_until | Drives notification delivery. |
| `CoachPersonality` | user_id, directness (1–5), detail (1–5), voice_id, length_default | The personality dial. |
| `CoachContextSnapshot` | id, message_id, summary, included_data_refs[] | What context the coach was given for a turn — supports "What do you know about me?" surface. |
| `CoachSavedAnswer` | id, user_id, message_id, note_text, created_at | "Save this answer" → notes. |
| `CoachAppliedSuggestion` | id, message_id, target (plan / log / readiness / race), payload, applied_at, reverted_at | Audit trail for "Apply this suggestion." |
| `VoiceBlock` | id, surface_ref, label (WHY / FOCUS / BACK OFF IF / YESTERDAY), text, generated_at, kb_refs[] | The inline blocks scattered across surfaces. Cached, regenerated when underlying data changes. |
| `Citation` | id, ref_kind (kb-doc / run / race / metric), ref_id, span (line range or anchor) | Reusable across messages and voice blocks. |

### Relationships

- `CoachMessage.content_blocks[]` references `Activity`, `Workout`, `Plan`, `Race`, `HealthMetric` — inline render uses the existing entity.
- `CoachInsight.cta` → `Plan` mutation, or `SubjectiveLog` write, or `Race` create.
- `VoiceBlock.surface_ref` is polymorphic: workout / recovery / race / run / phase / week.
- `ProactivePromptCadence` is the source of truth for whether a push fires; `CoachInsight.surfaces` is intent, but cadence enforces.

### Privacy categories (per-entity sensitivity tag)

| Category | Examples | Storage policy |
|---|---|---|
| Public-ok | run pace, distance, plan adherence | normal |
| Personal | HRV, RHR, sleep, mood | encrypted-at-rest, exportable |
| Sensitive | body weight, body comp, eating notes, mental-health journal turns | encrypted-at-rest, redacted from non-essential context, opt-in inclusion in coach context |
| Health-PHI | bloodwork, medications, injuries with diagnosis | strictest tier; user-controlled retention; never sent to third-party LLMs without explicit consent |

### Versioning / supersession

- `CoachInsight.superseded_by` lets a refreshed-window insight replace an old one without losing history.
- Plan-modification suggestions store the prior plan-version ID; revert is one click.
- Daily messages are entries on the conversation thread, tagged `daily=true` for retrieval.

---

## 9. Cross-doc references

- `D4-coach-llm-design.md` — model selection, retrieval, tool-use, eval. Out of scope here.
- `C1-overview-and-today.md` — daily message, insights ticker, risk-alert banner consumers.
- `C2-watch-active-workout.md` — watch coach (voice) deferred there.
- `C3` (likely Run Recap / Log) — post-workout prompt + recap voice block consumer.
- `C4`/`C5` (Plan / Race) — race-week notifications, race-day mode handoff, plan-mutation CTAs.
- `/Research/REVIEW_NOTES.md` §4 — ACWR hedging language for insight #11.

---

## 10. Element counts

- Web Coach chat: 60 elements
- iOS Coach chat: 25 deltas
- Insights page chrome: 15 elements; 41 insight kinds
- Inline coach voice block surfaces: 13 surfaces × {WHY, FOCUS, BACK OFF IF, YESTERDAY}
- Proactive nudge categories: 28
- Data-model entities introduced: 11

Total inventoried elements across this doc: ~190.
