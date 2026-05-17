# D4 — Coach LLM Design

The coach is the runtime that interprets a 24-doc generic running-research knowledge base plus the user's training data into prescriptions, insights, narrative, and chat answers. This document specifies the system: model choice, retrieval, context assembly, tools, voice, safety, latency, cost, and privacy.

---

## 1. Architecture

### 1.1 Three call types

The coach runs in three modes, all sharing the same retrieval and tool layer but differing in latency budget and prompt shape:

| Mode | Trigger | Latency budget | Streaming | Cache hit rate target |
|---|---|---|---|---|
| **Chat** | User opens Coach surface, types question | TTFT < 800 ms; full response < 6 s | Yes | > 85% |
| **Daily message** | Cron at 5am local + on app open | < 3 s, async | No (rendered as block) | > 95% |
| **Insight surfacing** | Triggered by data event (new run, HRV drop, etc.) | Background, no UX bound | No | > 95% |

### 1.2 Runtime flow

```
                ┌────────────────────────────────────────────────┐
                │                  Coach Runtime                 │
                │                                                │
   query ──▶  ┌─┴──────────────┐                                 │
              │ Intent router  │  classify: chat | proactive |   │
              │ (rule + tiny   │            recap | plan-edit    │
              │  classifier)   │                                 │
              └─┬──────────────┘                                 │
                ▼                                                │
              ┌─────────────────┐                                │
              │ Context builder │ ──▶ User snapshot (DB query)   │
              │                 │ ──▶ Retrieval (hybrid KB)      │
              │                 │ ──▶ Conversation summary       │
              └─┬───────────────┘                                │
                ▼                                                │
              ┌────────────────┐                                 │
              │ LLM call       │ ◀── prompt cache (system +      │
              │ (Claude Sonnet │      KB chunks pinned)          │
              │  4.6, stream)  │                                 │
              └─┬──────────────┘                                 │
                ▼                                                │
              ┌────────────────┐                                 │
              │ Tool loop      │ get_user_recent_activities,     │
              │ (≤ 6 hops)     │ propose_plan_change, etc.       │
              └─┬──────────────┘                                 │
                ▼                                                │
              ┌────────────────┐                                 │
              │ Output guard   │ citation check, refusal rules,  │
              │                │ structured-output validator     │
              └─┬──────────────┘                                 │
                ▼                                                │
              ┌────────────────┐                                 │
              │ Persist        │ ConversationHistory,            │
              │                │ ToolCallLog, RetrievalLog,      │
              │                │ CoachInsight                    │
              └────────────────┘                                 │
                                                                 │
              ┌──────────────────────────────────────────────────┘
```

The intent router is intentionally cheap — keyword + regex first, falling back to a Haiku 4.5 classifier only when ambiguous. Routing decides which tools are exposed and which KB shards are pinned in cache; this is the single biggest lever on cost and latency.

---

## 2. Context structure

The prompt is layered. Each layer has a different cache-friendliness profile, which dictates ordering: **most stable first** (cached for the cache TTL), most volatile last (always re-prefilled).

```
[1] System: voice + safety + tool catalog          ─┐
[2] KB shard pinned for this intent (5–25k tokens)  │  cached (5-min TTL,
[3] User profile (relatively stable: VDOT, goals)   │  refresh on edit)
                                                    ─┘
[4] Rolling user state snapshot (last 14 days)     ─┐
[5] Retrieved KB chunks (intent-specific, 1–4k)    │  cached per-conv
[6] Conversation summary + last 6 turns verbatim   │  (5-min TTL)
                                                   ─┘
[7] Current user message                            ← never cached
```

### 2.1 System layer (cached, ~3k tokens)

Contains:
- Voice contract (see §5)
- Refusal rules and hedging triggers (see §6)
- Tool catalog with descriptions (see §4)
- Output format conventions (markdown tags `WHY`/`FOCUS`/`BACK OFF IF`)

### 2.2 User profile (cached, ~1k tokens)

Stable for days/weeks. Re-cached when the user edits goals or completes a race:

```yaml
user:
  id: u_8a2f
  age: 34
  sex: M
  vdot: 52
  paces: { E: "8:10", M: "7:25", T: "6:45", I: "6:10", R: "5:50" }
  goal_race: { event: "Sombrero 50k", date: "2026-09-14", goal: "sub-5:30" }
  current_phase: "base"
  injury_history: ["L Achilles tendinopathy 2024"]
  preferences:
    voice: "direct"   # alternatives: "encouraging", "technical"
    units: "imperial"
```

### 2.3 Rolling state (cached per-conv, ~2k tokens)

Refreshed each conversation turn but cached within turn:

```yaml
state:
  last_14d:
    runs: 11
    miles: 64
    quality_sessions: 3
    long_run: { date: "2026-04-28", miles: 18, pace: "8:42", felt: 6 }
  acwr: 1.18
  hrv_7d_baseline: 78
  hrv_yesterday: 72  # -8% — flagged
  rhr_7d: 49
  sleep_7d_avg: "7h 12m"
  subjective_today: { energy: 3, soreness: 4, mood: 4 }
  upcoming:
    next_workout: { date: "2026-05-04", type: "T tempo", target: "6 mi @ 6:45" }
    days_to_race: 133
```

### 2.4 Retrieved KB chunks (~1–4k tokens)

Top-k chunks from hybrid retrieval, ranked, with provenance preserved:

```
[KB:01-pace-zones-vdot.md#§Daniels-T-pace]
T-pace ("threshold") corresponds to ~88% of VO2max...
[KB:00b-recovery-protocols.md#§HRV-drop-interpretation]
A single-day HRV drop of 5–10% relative to 7-day baseline...
```

### 2.5 Conversation memory

Two-tier:
- **Last 6 turns verbatim** (≤ ~2k tokens)
- **Running summary** of older turns (≤ 500 tokens), regenerated by Haiku every 6 turns or every 1500 tokens of accumulated history

Total conversation memory capped at ~2.5k tokens. Summaries focus on facts the user established (preferences, complaints, decisions) rather than full transcript fidelity.

---

## 3. Retrieval strategy

### 3.1 When to retrieve

Not every query needs KB retrieval. The intent router gates retrieval:

| Intent | Retrieve KB? | Notes |
|---|---|---|
| "How am I doing?" | No | User-data only |
| "Why is my HR so high today?" | Yes (→ 03, 15, 06) | Multi-doc |
| "What's my workout?" | No | DB lookup via tool |
| "Should I swap my long run?" | Yes (→ 00a, 22) | KB + plan tool |
| "I have heel pain" | Yes (→ 05) | Mandatory citation |
| "What pace for tempo?" | Yes (→ 01, 04) | Foundational |

Skipping retrieval saves ~1–4k tokens and one parallel call. Roughly 40–50% of chat turns can skip retrieval entirely.

### 3.2 Chunking

The 24 KB docs are chunked with a hybrid strategy keyed off the markdown structure they were written with (every doc has explicit `##`/`###` sections):

- **Primary chunks**: each `##` section → one chunk, ~400–1200 tokens
- **Sub-chunks**: long sections split at `###` sub-headers
- **Hard cap**: 1500 tokens; sections exceeding this are split at paragraph boundaries with 100-token overlap
- **Provenance metadata**: `{doc_id, doc_title, section_path, line_start, line_end, has_table, keywords[]}`

Lookup tables (VDOT table, fueling tables, plan templates) are stored as **single atomic chunks** never split — splitting a table destroys it. They're flagged `has_table: true` so the retriever knows to return whole.

Estimated total: ~24 docs × ~12 chunks/doc = ~290 chunks. Small enough to fit in pgvector with no sharding.

### 3.3 Hybrid search

Both signals run in parallel, then RRF fusion:

| Signal | Weight in RRF | Strength |
|---|---|---|
| BM25 keyword (Postgres `tsvector`) | 1.0 | "VDOT", "Achilles", "RPE", brand names like "Maurten" |
| Dense vector (Voyage-3-large embeddings, 1024-d) | 1.0 | "feeling beat up", "legs heavy", "race feels too far away" |
| **Reranker** (Cohere rerank-v3 on top-20) | tie-break | Final precision pass on top-k=4 |

BM25-first is essential for this corpus because much of the value is in technical terms (zone names, hormone names, drug interactions, brand-name fueling products). A pure-dense retriever silently misses "Maurten 320" matches because the embedding generalizes.

Voyage-3-large beats text-embedding-3-large by 4–6 MTEB points on domain-specific corpora and matters here — running science is dense with jargon. Cost is ~$0.18 / M tokens, embedding the full 290k-token KB once costs ~$0.05.

### 3.4 Retrieval shape

```
hybrid_retrieve(query, intent_filter, k=4)
  ├─ bm25_top20  ┐
  │              ├─ RRF fuse → top-10
  ├─ dense_top20 ┘
  │
  └─ rerank(top-10) → top-4
```

`intent_filter` is a metadata filter: e.g., a "I have heel pain" query only searches chunks tagged `category: injury` plus `category: footwear`. This roughly doubles precision at no recall cost because the corpus is well-tagged.

---

## 4. Tool design

The coach is an agent. It calls tools in a loop until it has enough data to answer (max 6 hops, fail-open after that with what it has).

### 4.1 Tool catalog

| Tool | Purpose | Read/Write | Latency |
|---|---|---|---|
| `get_user_recent_activities` | Pull runs in date range | R | <50ms |
| `get_activity_detail` | Full splits + chart data for one run | R | <80ms |
| `get_plan` | Active training plan, week range | R | <50ms |
| `get_health_metrics` | HRV / RHR / sleep series | R | <80ms |
| `get_subjective_log` | User check-ins | R | <50ms |
| `get_race` | Race detail (past or upcoming) | R | <50ms |
| `propose_plan_change` | Suggest plan edit (user must confirm) | W (proposed) | <100ms |
| `log_subjective_state` | Capture energy/soreness/mood from chat | W | <100ms |
| `compute_predicted_race_time` | Riegel/Daniels prediction from current fitness | R | <30ms |
| `compute_pace_for_conditions` | Adjust prescribed pace for weather | R | <30ms |
| `search_kb` | Explicit KB lookup (rare; usually pre-retrieved) | R | <300ms |
| `flag_for_human_review` | Escalate (e.g., severe injury described) | W | <50ms |

### 4.2 Schema example

```json
{
  "name": "propose_plan_change",
  "description": "Propose a modification to the user's training plan. Does NOT apply the change — generates a proposal the user confirms in UI. Use when user asks to swap, move, skip, or modify a workout, OR when subjective state suggests a change is warranted.",
  "input_schema": {
    "type": "object",
    "properties": {
      "change_type": {
        "type": "string",
        "enum": ["swap", "move", "skip", "shorten", "intensify", "deload"]
      },
      "target_date": { "type": "string", "format": "date" },
      "rationale": {
        "type": "string",
        "description": "One paragraph, coach-voice. Cite specific user data point that drove the change."
      },
      "new_workout": {
        "type": "object",
        "description": "Required if change_type is swap, shorten, intensify, deload",
        "properties": {
          "name": { "type": "string" },
          "description": { "type": "string" },
          "structure": { "type": "array", "items": { "type": "object" } }
        }
      },
      "kb_citations": {
        "type": "array",
        "description": "doc_id#section refs supporting the change",
        "items": { "type": "string" }
      }
    },
    "required": ["change_type", "target_date", "rationale", "kb_citations"]
  }
}
```

Critical detail: write tools never apply directly. They return a proposal object the UI surfaces with explicit confirm/reject affordances. This eliminates the largest LLM-product failure mode (silent destructive actions) and aligns with the brand promise of "always show the why."

### 4.3 Tool loop pattern

```python
messages = [system, user_query]
for hop in range(MAX_HOPS):  # 6
    resp = claude.messages.create(
        model="claude-sonnet-4-6",
        tools=TOOL_CATALOG,
        messages=messages,
        max_tokens=2048,
        stream=hop == MAX_HOPS - 1  # only stream the final answer
    )
    if resp.stop_reason != "tool_use":
        break
    for tool_use in resp.content:
        if tool_use.type == "tool_use":
            result = TOOLS[tool_use.name](**tool_use.input)
            messages.append({
                "role": "user",
                "content": [{"type": "tool_result",
                             "tool_use_id": tool_use.id,
                             "content": result}]
            })
```

Streaming only on the final hop is intentional. Mid-loop streaming wastes the user's perceived TTFT improvement on tokens they'll never see (the model won't render text that's about to be replaced by tool output).

---

## 5. Voice consistency

The brand voice is non-negotiable: **direct, honest, time-aware, always shows the why.** The Overview page already proves it works ("Recovery is the workout. Volume drop is intentional — let the legs absorb the race.").

### 5.1 System prompt (excerpt)

```
You are the coach for a personal running app. Your voice is:

- Direct. No sycophancy ("Great question!"), no hype ("You crushed it!").
- Honest, even when uncomfortable. "A bit hard — back off." is correct;
  "You did amazing!" is wrong.
- Time-aware. "Day 1 of 14." "3 days since Sombrero."
- Always show the WHY. Never prescribe without rationale.
- Personality over neutrality.

Format conventions:
- Use ALL-CAPS section labels: WHY, FOCUS, BACK OFF IF.
- Hero numbers belong on their own line.
- Pace shorthand: "7:25/mi · M" (mile pace · zone).
- Refer to workouts by zone (E, M, T, I, R), not generic ("easy", "hard").

You may call tools. Always cite KB chunks with [doc_id#section] when
making prescriptive claims.

[examples below — 3 exemplars]
```

### 5.2 Few-shot exemplars (3 in system prompt)

The prompt embeds three carefully chosen exemplars covering different intents — daily message, post-run analysis, plan-change rationale. Examples are the single strongest lever for style consistency. Without them, Sonnet drifts toward generic AI-coach voice ("Great work today! Here are some tips…"); with them, it stays in brand.

Exemplars are stored in `/coach/voice/exemplars/` and updated when the brand voice evolves; they're version-tagged so we can A/B test voice changes.

### 5.3 Output validators

A post-generation pass checks:

| Rule | Action on violation |
|---|---|
| No "Great question" / "Absolutely!" / "I'd be happy to" openers | Strip + regenerate that turn (max 1 retry) |
| Pace formatted as `M:SS/mi` not `M minutes SS seconds` | Reformat in-place |
| Prescriptive claim has a citation | If missing, downgrade to hedged language |
| Section labels uppercase | Reformat in-place |

This catches ~95% of voice regressions before they reach the user. Regenerating the whole turn on a "Great question" is cheap because Sonnet 4.6 cache hit makes the second attempt nearly free.

---

## 6. Safety / hallucination

### 6.1 Hedging triggers

The coach hedges when:
- The user's data contradicts the KB recommendation (e.g., HRV says rest, plan says hard)
- The retrieval confidence (top-1 rerank score) is below 0.4
- The query is outside the running domain (nutrition specifics, mental health, medication)
- The KB itself flags equipoise (e.g., cycle-based periodization in doc 13)

Hedging shape: "Best read of your data: X. But Y is plausible too. If A persists, B."

### 6.2 Refusal rules

| Trigger | Behavior |
|---|---|
| Acute injury described (sharp pain, sudden loss of function, stress fracture suspicion, chest pain) | Refuse to prescribe; surface medical-referral text + return-to-run protocol from doc 05 only as reference, not a plan |
| Eating disorder signals (RED-S risk markers in doc 13) | Refuse to engage with weight/composition prescriptions; surface clinical resources |
| Drug / supplement interaction questions | Refuse; redirect to MD/RD |
| Mental health crisis language | Refuse; surface crisis resources |
| Pregnancy / postpartum specifics beyond doc 13's generic guidance | Refuse; redirect to MD |

The refusal is not a wall — the coach states what it can't do, what it can, and where to get the answer it can't give. This matches the GPTCoach pattern that performed best in clinical evaluation.

### 6.3 Citation requirements

Every prescriptive claim ("do X", "don't do X", "pace should be Y") must carry a `[doc_id#section]` ref. The output validator strips claims that don't, replacing them with "based on your recent data" or similar grounded-in-user-data language. This keeps the coach honest about what's KB-backed vs. data-pattern.

Citations render in the UI as small clickable chips; tapping opens the source section. This is the same pattern WHOOP Coach uses with its proprietary research library — users trust answers more when sources are visible.

### 6.4 Hallucination mitigation summary

Five layers:
1. **Retrieval grounding**: pull KB chunks before answering
2. **Forced citation**: validator strips uncited prescriptive claims
3. **Self-consistency on numbers**: any pace, mileage, HR figure is checked against the user-state snapshot or recomputed via tool — never typed by the LLM freehand
4. **Refusal rules** for high-stakes domains
5. **Hedge language** when retrieval confidence is low

---

## 7. Insight surfacing

Reactive coach (chat) is half the system. The proactive coach surfaces patterns the user can't see.

### 7.1 Trigger sources

```
┌──────────────────────┐
│  Trigger detector    │  rules-based, runs nightly + on data event
│  (Postgres queries)  │
└─┬────────────────────┘
  │
  ├─ HRV drop > 10% from 7-day baseline (3 days running)
  ├─ ACWR > 1.5 or < 0.8
  ├─ Plan adherence < 70% over 14 days
  ├─ Pace at same HR improved > 5% over 4 weeks
  ├─ Long run skipped 2 weeks running
  ├─ Race < 14 days away
  ├─ Streak milestone (with sanity-check: not running through injury)
  ├─ Shoe mileage > 80% of expected lifespan
  ├─ Subjective energy ≤ 2 for 3 days
  └─ Weather forecast vs. workout incompatibility
  ▼
┌──────────────────────┐
│  Insight generator   │  LLM call w/ trigger + relevant data
│  (Sonnet 4.6)        │
└─┬────────────────────┘
  ▼
┌──────────────────────┐
│  De-duplication      │  same trigger pattern in last 7d? skip
│  + frequency cap     │
└─┬────────────────────┘
  ▼
┌──────────────────────┐
│  CoachInsight table  │  surfaced in Insights tab + push (if urgent)
└──────────────────────┘
```

### 7.2 De-duplication

A new insight is suppressed if all of:
- Same `trigger_type` fired in last 7 days
- User dismissed an insight of that type in last 7 days
- More than 2 active insights are already pending

Frequency caps: max 2 push notifications/week, max 5 in-app insights surfaced at once. Whoop and Garmin both fail here — the cap discipline is what separates a coach from a nag.

### 7.3 Lifecycle

| State | Meaning |
|---|---|
| `active` | Surfaced in UI, unread |
| `read` | User opened it, no action |
| `acted` | User tapped CTA (e.g., accepted plan change) |
| `dismissed` | User explicitly snoozed/dismissed |
| `expired` | Trigger condition no longer holds, auto-resolved |

`acted` and `dismissed` feed back into the trigger-suppression model — repeated dismissal of the same insight type lowers its surface rate for that user.

### 7.4 Urgency tiers

| Tier | Examples | Surface |
|---|---|---|
| Critical | Suspected stress fracture, race-week red flag, missed flight to race | Push + modal on app open |
| Action | Plan change suggested, recovery alert, shoe replacement due | Push (during active hours) + Insights tab |
| Observation | "PR pace pattern", "Easy pace at same HR improving" | Insights tab only |

---

## 8. Latency & cost

### 8.1 Recommended model

**Claude Sonnet 4.6** (`claude-sonnet-4-6`) is the primary coach model. Rationale:

- Best-in-class tool-call reliability (MCP-Atlas leadership) — the coach is heavily tool-driven
- Voice-following quality is materially better than GPT for branded copy when given exemplars
- Anthropic prompt caching (5-min and 1-hour TTL) gives 90% input-token discount — decisive for this workload because the system+KB cache layer is large and hits ~90%+ of turns
- 1M context window (Sonnet 4.6 includes it at standard pricing, no surcharge) — covers worst-case long-history users
- HIPAA BAA available via direct Anthropic enterprise or via Bedrock/Vertex

Auxiliary models:
- **Claude Haiku 4.5** for: intent classification, conversation summarization, output validators, insight de-duplication checks
- **Voyage-3-large** for embeddings
- **Cohere rerank-v3** for the rerank pass

### 8.2 Token-per-query estimates

| Component | Tokens (typical chat turn) | Cached? |
|---|---|---|
| System prompt + voice + tools | 3,000 | Yes (cache read) |
| Pinned KB shard (intent-specific) | 8,000 avg | Yes (cache read) |
| User profile | 1,000 | Yes (cache read) |
| Rolling state | 2,000 | Per-conv cache |
| Retrieved chunks | 2,500 | Per-conv cache |
| Conversation summary + history | 2,000 | Per-conv cache |
| User message | 200 | No |
| Output | 600 | — |
| **Input fresh** (per turn after first) | ~200 | — |
| **Input cache-read** | ~18,500 | 90% off |

### 8.3 Per-query cost (Sonnet 4.6)

Sonnet 4.6 base: $3.00 / M input, $15.00 / M output. Cache read: 0.10×. Cache write (5-min): 1.25×.

**First turn of conversation (cache miss):**
- Cache write: 14,000 tokens × $3.75/M = $0.0525
- Fresh input: 4,500 tokens × $3.00/M = $0.0135
- Output: 600 tokens × $15.00/M = $0.0090
- **Total: ~$0.075/turn**

**Subsequent turn (cache hit):**
- Cache read: 18,500 tokens × $0.30/M = $0.00555
- Fresh input: 200 tokens × $3.00/M = $0.0006
- Output: 600 tokens × $15.00/M = $0.0090
- **Total: ~$0.015/turn**

**Tool hop overhead** (each adds ~400 input + 200 output tokens): ~$0.005/hop. Average 1.5 hops per turn → $0.008.

**Effective per-turn cost: ~$0.022 average** (mostly cache hits, ~1.5 hops).

### 8.4 Daily query volume assumption

Per active user:
- 1 daily message (proactive, generated)
- 0–4 chat turns
- 0–2 insights (proactive, generated)
- 1–2 post-run recaps (proactive, generated)

Average ~6 LLM-touching events/day. Daily cost per active user: ~6 × $0.022 ≈ **$0.13/day**, ~**$4/month**.

Heavy users (10+ turns/day): ~$8–10/month. At 10k DAU mix, monthly LLM cost ≈ **$40–50k**.

### 8.5 Latency targets and how we hit them

| Surface | TTFT target | Strategy |
|---|---|---|
| Chat (web/phone) | < 800 ms | Stream from final hop; cache hit reduces prefill; tools in parallel where possible |
| Daily message | < 3 s, async | Generate at 5am local; pre-render before user opens app |
| Post-run recap | < 5 s, background | Triggered on activity ingest, cached by activity_id |
| Insight | No bound | Background queue |

Sonnet 4.6 TTFT with prompt caching is typically 400–700 ms on Anthropic direct. Bedrock adds ~150 ms. Vertex similar to direct.

---

## 9. Privacy

### 9.1 What's sent to the LLM

| Category | Sent? | Notes |
|---|---|---|
| User name | Optional, default off | Pseudonymized by `user_id` in prompt |
| Demographics (age, sex, weight) | Yes | Required for many KB recommendations |
| Activities (pace, HR, distance, route) | Yes | Route data downsampled or excluded |
| Subjective logs (energy, mood, soreness) | Yes | |
| Notes / journal text | Optional, opt-in | |
| Bloodwork / lab values | Opt-in only | High-sensitivity flag |
| Cycle tracking | Opt-in only | High-sensitivity flag |
| GPS traces | No | Coach uses route summaries (distance, vert, surface), not raw lat/lon |
| Photo metadata | No | |

The principle: send the minimum necessary to answer the query, not the full user record.

### 9.2 Provider choice

Anthropic via direct API, with Anthropic's enterprise BAA, is the default. Two reasons:

1. **No training on user data** — Anthropic's commercial agreement contractually excludes training, the same baseline OpenAI now offers but Anthropic has had longer with cleaner enforcement.
2. **Data residency**: US region only. EU users get either AWS Bedrock EU (Frankfurt) or GCP Vertex EU.

A consumer fitness app handling self-tracked data is **not a HIPAA-covered entity** as long as it doesn't connect to a provider's care plan. If we ever integrate with a clinical partner (e.g., a PT practice via referral), the boundary changes and the BAA becomes mandatory.

### 9.3 On-device vs. cloud

Cloud for the foreseeable future:
- The 24-doc KB plus user state plus tool surface is too large for current on-device models (Apple Foundation Models, Gemini Nano) to run with quality — Sonnet-class reasoning is required for the prescription quality this coach promises
- Latency on cloud is already < 1s with caching
- Battery cost of on-device inference for daily use exceeds the privacy benefit for users who explicitly chose a cloud-synced fitness app

Future: a stripped-down on-device model could handle the daily message and intent routing (offline-friendly), with cloud for full chat. Track Apple Foundation Models capability through 2026; revisit for v2.

---

## 10. Recommended stack

| Layer | Choice | Rationale |
|---|---|---|
| Coach model | Claude Sonnet 4.6 | Tool quality, voice, cache economics |
| Auxiliary model | Claude Haiku 4.5 | Cheap classifier/summarizer |
| Embeddings | Voyage-3-large (1024-d) | Domain accuracy on technical text |
| Reranker | Cohere rerank-v3 | Final precision pass |
| Vector store | pgvector on the existing Postgres | < 10M vectors; co-locates with relational user data; one DB to operate |
| Backend | Existing Postgres + Redis (cache) + worker queue (insight triggers) | |
| API gateway | Anthropic direct (US); Bedrock or Vertex for residency | |
| Observability | Langfuse or Helicone — token + latency + cost per intent | |
| Cache layer | Anthropic prompt cache (5-min TTL primary, 1-hour for daily-message base prompt) | |

---

## 11. Data model implications

New entities (or extensions to existing):

### `CoachInsight`
```sql
id              uuid pk
user_id         uuid fk
trigger_type    text          -- "hrv_drop", "acwr_high", etc.
trigger_payload jsonb         -- the data that fired the trigger
title           text          -- "HRV down 3 days running"
body            text          -- coach-voice narrative
urgency         text          -- "critical" | "action" | "observation"
state           text          -- "active" | "read" | "acted" | "dismissed" | "expired"
cta             jsonb null    -- { type: "plan_change", change_id: ... }
kb_citations    text[]
created_at      timestamptz
expires_at      timestamptz null
acted_at        timestamptz null
dismissed_at    timestamptz null
```

### `ConversationHistory`
```sql
id              uuid pk
user_id         uuid fk
turn_index      int
role            text         -- "user" | "assistant" | "tool"
content         jsonb        -- supports tool_use and tool_result blocks
summary_of      int[] null   -- if this row is a summary, the indices it covers
created_at      timestamptz
```

### `RetrievalLog`
```sql
id              uuid pk
turn_id         uuid fk
query           text
chunk_ids       text[]       -- retrieved chunks, in rerank order
scores          jsonb        -- { bm25: [...], dense: [...], rerank: [...] }
intent          text
latency_ms      int
created_at      timestamptz
```

### `ToolCallLog`
```sql
id              uuid pk
turn_id         uuid fk
hop_index       int
tool_name       text
input           jsonb
output          jsonb
latency_ms      int
error           text null
created_at      timestamptz
```

### `KBChunk` (rebuilt at deploy from research/*.md)
```sql
id              text pk      -- "01-pace-zones-vdot.md#daniels-t-pace"
doc_id          text
doc_title       text
section_path    text
content         text
content_tokens  int
embedding       vector(1024)
tsv             tsvector
metadata        jsonb        -- { has_table, keywords, category }
hash            text         -- content hash for change detection
indexed_at      timestamptz
```

---

## 12. Open questions

1. **Voice variants**: brand voice is "direct" by default, but the spec hints at "encouraging" and "technical" alternatives. How much of the system prompt is shared vs. swapped? Risk of fragmenting QA.
2. **Plan-change autonomy**: should the coach ever apply a plan change without explicit confirmation (e.g., auto-deload when HRV is critically low)? Probably no for v1 — explicit confirm is the safe default.
3. **Multi-language**: KB is English-only. Cost/quality of dynamic translation vs. translated KBs?
4. **Voice playback** (web/phone): TTS adds 1.5–4s latency on top of TTFT — at what point does the user prefer text-only? Likely text-only default with optional TTS toggle.
5. **Insight authorship transparency**: do we tell the user "this insight was generated automatically vs. surfaced by the rule alone"? The honest brand voice argues yes.
6. **Long-tail of injuries**: KB doc 05 is comprehensive but real users describe injuries in language that doesn't map cleanly to ICD-style labels. Need a fuzzy-mapping pre-step or rely on Sonnet's medical-text understanding?
7. **Race-day mode**: Coach LLM should probably go silent during a race (everything is on-watch). What happens to triggers that fire mid-race? Probably defer all to post-race.
8. **Cold-start users**: with < 14 days of data, the rolling-state snapshot is sparse. Coach should hedge harder during onboarding period; the threshold is currently a guess (14 days).
9. **Trigger calibration**: HRV-drop, ACWR, and similar trigger thresholds in §7.1 are KB-derived but every user runs slightly different baselines. When does per-user calibration become necessary?
10. **Retrieval evaluation**: we don't have a golden set for retrieval quality on this KB yet. Need to build one (50–100 query/expected-chunk pairs) before tuning RRF weights.
11. **Cost ceiling per user**: should there be a soft daily cap (e.g., 50 turns) to prevent a runaway-conversation user from costing $5/day? Probably yes; surface as "Coach is taking a breath" friendly limit.

---

## Sources

- [Anthropic — Prompt caching docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- [Anthropic API pricing 2026 (Finout)](https://www.finout.io/blog/anthropic-api-pricing)
- [Claude API pricing breakdown (MetaCTO)](https://www.metacto.com/blogs/anthropic-api-pricing-a-full-breakdown-of-costs-and-integration)
- [Anthropic — Tool use overview](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview)
- [Anthropic — Programmatic tool calling](https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling)
- [Hybrid Search for RAG: BM25, SPLADE, and Vector — Prem AI](https://blog.premai.io/hybrid-search-for-rag-bm25-splade-and-vector-search-combined/)
- [Optimizing RAG with Hybrid Search & Reranking — Superlinked](https://superlinked.com/vectorhub/articles/optimizing-rag-with-hybrid-search-reranking)
- [The Chunking Strategy Shift — RAGAboutIt](https://ragaboutit.com/the-chunking-strategy-shift-why-semantic-boundaries-cut-your-rag-errors-by-60/)
- [Mitigating Hallucination in LLMs — arXiv 2510.24476](https://arxiv.org/html/2510.24476v1)
- [Disclaimers and Referral Patterns for Medical Advice — PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC12991190/)
- [GPTCoach: Towards LLM-Based Physical Activity Coaching — arXiv 2405.06061](https://arxiv.org/html/2405.06061v2)
- [LLM Chat History Summarization — Mem0](https://mem0.ai/blog/llm-chat-history-summarization-guide-2025)
- [Time to First Token (TTFT) — IBM](https://www.ibm.com/think/topics/time-to-first-token)
- [How input token count impacts latency — Glean](https://www.glean.com/blog/glean-input-token-llm-latency)
- [Best Embedding Models 2026 (MTEB) — PE Collective](https://pecollective.com/tools/best-embedding-models/)
- [Voyage 3.5 vs OpenAI vs Cohere Embedding Models — BuildMVPFast](https://www.buildmvpfast.com/blog/best-embedding-model-comparison-voyage-openai-cohere-2026)
- [Vector Database Performance Compared — Vecstore](https://vecstore.app/blog/vector-database-performance-compared)
- [Best Vector Databases in 2026 — Firecrawl](https://www.firecrawl.dev/blog/best-vector-databases)
- [Claude vs GPT vs Gemini 2026 benchmarks — Cosmic JS](https://www.cosmicjs.com/blog/best-ai-for-developers-claude-vs-gpt-vs-gemini-technical-comparison-2026)
- [Best AI Models April 2026 — BuildFastWithAI](https://www.buildfastwithai.com/blogs/best-ai-models-april-2026)
- [LLM Personas: System Prompts & Style — Brim Labs](https://brimlabs.ai/blog/llm-personas-how-system-prompts-influence-style-tone-and-intent/)
- [How Examples Improve LLM Style Consistency — Latitude](https://latitude.so/blog/how-examples-improve-llm-style-consistency)
- [HIPAA Compliance AI: LLMs in Healthcare — TechMagic](https://www.techmagic.co/blog/hipaa-compliant-llms)
- [App Users Beware: Fitness Apps and HIPAA — Dickinson Wright](https://www.dickinson-wright.com/news-alerts/app-users-beware)
- [How to Use WHOOP Coach — WHOOP](https://www.whoop.com/us/en/thelocker/introducing-whoop-coach-powered-by-openai/)
- [WHOOP × OpenAI partnership — OpenAI](https://openai.com/index/whoop/)
