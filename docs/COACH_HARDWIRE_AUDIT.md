# Coach Hardwire Audit · 2026-05-26

David's note: "POINT the coach WHERE the info will be, not what the
info is. You can't hardwire anything into the coach, ever."

This audit lists every place the engine HARDWIRES data into the LLM
prompt instead of pointing the coach at sources. The architectural
target is tool-use: the coach declares what it needs, our server
returns the answer, the coach composes voice from results.

## Where the engine calls the model

`web-v2/lib/coach/engine.ts:84` — single `messages.create()` call.
**No tools registered.** Every word the coach sees was authored by
us in `buildUserMessage()`. Nothing is retrieved.

## Hardwire inventory (`buildUserMessage`, engine.ts:200-298)

Every line below is data we hand the coach as a labeled fact.

### 1. Identity / orientation — ARGUABLY OK
- `RUNNER: David.` (line 201) — orientation, not data
- `TODAY: 2026-05-26 (Tuesday).` (line 202) — orientation; LLM has no
  internal clock, has to be told what "now" is
- `SURFACE: today · MODE: pre-run.` (line 203) — orientation

These three are arguably "system context" not "facts about the
runner." Could be split into a system-prompt header. Not strictly
hardwiring of training data.

### 2. Training data — ALL HARDWIRED
- `HR zones` (line 209-211, zones.ts:177-186) — we compute LTHR-based
  Z1-Z5 ranges + a citation + a usage rule, and paste them in
- `EXPERIENCE: advanced` (line 214-215) — pre-extracted from profile
- `LATEST RUN: 2026-05-25 ... 6.2mi · pace 8:25 · HR 133 ...` (line 219-221)
- `RECENT RUNS (last 7 days):` listing every run with mi/pace/HR (228-238)
- `WEEK: 6.2mi done / 43.8mi planned · phase BASE` (line 239)
- `THIS WEEK'S PLAN (Mon→Sun): ...` listing every day (line 247-256)
- `A-RACE: AFC on 2026-08-16 (August 16) — 82 days away · goal 1:30:00` (line 258-262)
- `SLEEP: 7n avg 6.7h · deficit 6.0h` (line 264)
- `RHR: current 52 · baseline 49 · delta +3` (line 266-267)
- `HRV: current 67ms · 30d baseline 71` (line 269-270)
- `CADENCE: 60d baseline 168 spm` (line 272)
- `PROFILE FIELDS: height_cm: 185` (line 274-275)
- `PENDING INTENTS:` (line 277-281)
- `RECENT CHECK-INS:` (line 284-289)

Every one of these is "what the info IS." None of them tell the coach
"plan rows live in plan_workouts; query via getPlanWeek(date) to
inspect."

### 3. Eligible-topic shortlist — HARDWIRED CONSTRAINT
- `ELIGIBLE TOPIC KINDS (prereqs met — emit ONLY these as cards):
  next_workout, race_horizon, ...` (line 294-295)

This pre-filters which cards the coach is allowed to emit. The coach
doesn't decide based on the data — we decide for it via
`TopicPrereqs[t.kind](state)` and hand it the survivors. Same pattern
as the others.

### 4. Server-side topic enrichment — HARDWIRED POST-PROCESS
- engine.ts:91-150 — after the LLM emits topics, we OVERWRITE numeric
  fields with deterministic values from state. The LLM authors voice;
  we patch the numbers in. That's not exactly hardwiring INTO the
  coach, but it does mean the coach can't actually move numbers —
  another flavor of "we do it for it."

### 5. State-loader pre-extractions (state-loader.ts)

State loader runs ~10 SQL queries to pre-extract:
- latest_activity (single row)
- recentRuns (last 7)
- currentWeekDays (this Mon-Sun)
- todayWorkout (single row, recently added)
- nextWorkout (single row)
- nextARace (single row)
- sleep7Avg / Deficit (aggregate)
- rhrCurrent / Baseline (aggregate)
- hrvCurrent / Baseline (aggregate)
- cadenceBaseline (aggregate)
- recentCheckIns (last 7)
- pendingIntents (last 5)

All of this packaging happens BEFORE the LLM is invoked. The LLM
never queries anything. State-loader IS the coach's eyes today.

## What "pointing the coach at sources" would look like

Anthropic tool-use loop:

```ts
// System prompt — describes WHERE not WHAT
"You are the coach. Today is {state.today}. To compose the brief, use
these tools to read from the runner's data sources:
 - getPlanWindow(daysBack, daysForward) — planned workouts
 - getRuns(daysBack) — logged runs
 - getProfile() — LTHR, MaxHR, experience, height
 - getReadiness() — composite score + inputs
 - getRace(priority?) — upcoming races (A/B/C)
 - getCheckIns(days) — runner's check-in history
 - getZones() — HR zone table (LTHR-anchored) + doctrine ref
 - getDoctrine(topic) — research-backed rules for a topic
   (e.g. 'threshold', 'cardiac-drift', 'taper-volume')

You decide which tools to call. We return JSON. Compose voice from
results. Truth contract: only narrate runs that getRuns returns and
sessions that getPlanWindow returns."

// Server registers handlers
const tools = [
  { name: 'getPlanWindow', input_schema: { daysBack, daysForward }, handler: ... },
  ...
];

// Loop
let resp = await claude.messages.create({ system, tools, messages });
while (resp.stop_reason === 'tool_use') {
  const toolResults = await Promise.all(
    resp.content.filter(b => b.type === 'tool_use')
      .map(b => handlers[b.name](b.input).then(r => ({
        type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(r)
      })))
  );
  resp = await claude.messages.create({
    system, tools,
    messages: [...messages, { role: 'assistant', content: resp.content },
                            { role: 'user', content: toolResults }],
  });
}
```

The coach navigates its own data. We define the surface — what
exists, where to find it, the doctrine. The values are never pasted
in.

## What this audit RECOMMENDS

1. Stop adding new hardwires (no `TODAY'S WORKOUT:`, no `THIS WEEK'S
   PLAN:` data dumps).
2. Plan a refactor to tool-use — engine.ts becomes a tool-use loop;
   state-loader becomes a set of read-only tool handlers; the prompt
   describes tools, not data.
3. While the refactor is in flight: cap further damage. Treat the
   existing prompt as a frozen surface — no new "we computed this for
   you" lines.

Scope estimate: ~300-500 LOC, 2-4 hours of focused work, would touch
engine.ts, state-loader.ts (split into per-resource modules), the
system prompts, and the cache signature (probably gets simpler:
hash the runner_id + date + plan_version, since the coach is now
reading fresh on each call).

Open questions for David before starting:
- Tool-use loop adds 1-3 extra round trips per briefing. Latency goes
  from ~5-10s to ~10-20s. OK with that?
- Do you want SOME server enrichment to stay (the deterministic
  number-injection at engine.ts:91-150 that the watch and topic
  cards depend on)? Or also nuke that and let the coach own numbers?
- Cache TTL — fresh-read on every call defeats the cache. Should
  briefings still cache by signature, or always regenerate?
