'use client';

/**
 * CoachDecisionCard · the ONE interruption chrome (web recomposition deck,
 * Decision 2 · approved 2026-08-17).
 *
 * Replaces four separate components:
 *   CoachProposalCard    · warn-red gradient, ACCEPT / STICK WITH CURRENT
 *   PlanProposalCard     · amber or teal gradient, ACCEPT / DISMISS
 *   WorkoutProposalBanner· its own .wpb CSS family, LET IT HAPPEN / KEEP ORIGINAL
 *   AdaptationCard       · .fa-adapt badge card with an X
 *
 * All four still feed it — proposals-state, plan proposals, workout
 * proposals and coach_intents are unchanged on the wire. What changed is
 * that they now arrive through selectCoachDecisions() as one ordered
 * queue, and exactly one card renders with an "N waiting" pager.
 *
 * That pager is why globals.css lost the `.prehero-stack>*:not(:first-child)`
 * gag: the one-banner cap used to be enforced by hiding DOM, which meant a
 * runner with three pending items simply never saw two of them. Now the
 * cap is structural and every item is reachable.
 *
 * Dressing is kind-driven, never source-driven:
 *   decision · amber left accent · "COACH · NEEDS A DECISION"
 *   notice   · recovery-blue left accent · "COACH · APPLIED"
 *
 * Dismissed notices persist in localStorage (carried over from
 * AdaptationCard · David 2026-06-04: "there shuld be a way to x out of
 * this and dismiss it"). Decisions have no X — a decision the coach is
 * waiting on is answered, not swept away. "DECIDE LATER" defers it for
 * the session without resolving the row.
 */

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  selectCoachDecisions,
  decisionAccent,
  pagerLabel,
  type CoachDecision,
  type DecisionAction,
  type SelectDecisionsInput,
} from '@/lib/coach/decision-cards';
import type { IntentRow } from '../toolkit/CoachTransparency';

const DISMISS_KEY = 'faff.dismissedIntents';

/** Recency gate for adaptation notices · "happened in the last day". */
const ADAPT_RECENCY_HOURS = 24;

export function CoachDecisionCard({
  coachProposals,
  planProposals,
  workoutProposals,
  todayISO,
  excludeKinds,
}: {
  coachProposals?: SelectDecisionsInput['coachProposals'];
  planProposals?: SelectDecisionsInput['planProposals'];
  workoutProposals?: SelectDecisionsInput['workoutProposals'];
  todayISO?: string;
  /** Plan-proposal kinds another surface owns · see TARGETS_OWNED_PLAN_KINDS. */
  excludeKinds?: readonly string[];
}) {
  const router = useRouter();

  // Adaptation notices are the one source that isn't on the seed · they
  // come from GET /api/coach/intents, unacked only so the engine's ack
  // pipeline still silences what it has already handled.
  const [intents, setIntents] = useState<IntentRow[] | null>(null);
  useEffect(() => {
    let alive = true;
    fetch('/api/coach/intents?limit=5&unacked_only=true')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive || !j) return;
        setIntents(Array.isArray(j.rows) ? j.rows : []);
      })
      .catch(() => { /* silent · the card simply carries fewer notices */ });
    return () => { alive = false; };
  }, []);

  // Per-item dismissals (notices only), keyed by the decision key.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DISMISS_KEY);
      if (raw) {
        const arr = JSON.parse(raw) as string[];
        if (Array.isArray(arr)) setDismissed(new Set(arr));
      }
    } catch { /* corrupt storage just means show everything */ }
  }, []);

  // Resolved-this-session items (accepted, kept, or deferred) drop out of
  // the queue immediately so the pager count is honest without a reload.
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const queue = useMemo<CoachDecision[]>(() => {
    const cutoff = Date.now() - ADAPT_RECENCY_HOURS * 3600 * 1000;
    const recentIntents = (intents ?? []).filter(
      (r) => new Date(r.ts).getTime() >= cutoff,
    );
    return selectCoachDecisions({
      coachProposals,
      planProposals,
      workoutProposals,
      adaptations: recentIntents.map((r) => ({
        ts: r.ts, summary: r.summary, severity: r.severity,
      })),
      todayISO,
      excludeKinds,
    }).filter((d) => !dismissed.has(d.key) && !resolved.has(d.key));
  }, [coachProposals, planProposals, workoutProposals, intents, todayISO, excludeKinds, dismissed, resolved]);

  // Keep the cursor inside the queue as items resolve out from under it.
  useEffect(() => {
    if (index >= queue.length && queue.length > 0) setIndex(queue.length - 1);
    if (queue.length === 0 && index !== 0) setIndex(0);
  }, [queue.length, index]);

  if (queue.length === 0) return null;
  const item = queue[Math.min(index, queue.length - 1)];
  const accent = decisionAccent(item.kind);
  const pager = pagerLabel(index, queue.length);

  function dismiss(key: string) {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(key);
      try {
        localStorage.setItem(DISMISS_KEY, JSON.stringify([...next].sort().slice(-50)));
      } catch { /* in-memory state still works */ }
      return next;
    });
  }

  async function act(decision: CoachDecision, action: DecisionAction) {
    if (action.role === 'link') {
      if (action.href) router.push(action.href);
      return;
    }
    if (!action.endpoint) return;
    setBusy(action.label);
    setErr(null);
    try {
      const r = await fetch(action.endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        ...(action.body ? { body: JSON.stringify(action.body) } : null),
      });
      const j = await r.json().catch(() => ({} as Record<string, unknown>));
      if (!r.ok && !(j as { ok?: boolean }).ok) {
        // 2026-08-25 · A REFUSAL IS AN ANSWER, NOT A FAILED SAVE.
        //
        // `/api/plan/undo` returns 409 with a `message` when it declines — the
        // runner has already run a day the two blocks treat differently, or
        // the plan has moved on since. Those are the sentences that explain
        // the runner's own training to them. Collapsing them into "that did
        // not save, try again" would tell him to retry something that will
        // refuse every time for a reason he was never shown.
        //
        // Only a response with NO message falls through to the generic line.
        const msg = (j as { message?: unknown }).message;
        if (typeof msg === 'string' && msg.length > 0) {
          setErr(msg);
          return;
        }
        const e = typeof (j as { error?: unknown }).error === 'string'
          ? (j as { error: string }).error
          : `HTTP ${r.status}`;
        throw new Error(e);
      }
      setResolved((prev) => new Set(prev).add(decision.key));
      router.refresh();
    } catch (e) {
      setErr('That did not save. Nothing was written, so it is safe to try again.');
    } finally {
      setBusy(null);
    }
  }

  const stampLabel = item.kind === 'notice' && item.stamp ? shortStamp(item.stamp) : null;

  return (
    <div
      className="cdcard"
      role="region"
      aria-label={item.kind === 'decision' ? 'Coach decision' : 'Coach notice'}
      style={{ borderLeftColor: accent }}
    >
      <div className="cd-top">
        <span className="cd-eyebrow" style={{ color: accent }}>{item.eyebrow}</span>
        {pager ? (
          <button
            type="button"
            className="cd-pager"
            style={{ color: accent }}
            onClick={() => setIndex((i) => (i + 1) % queue.length)}
          >
            {pager}
          </button>
        ) : stampLabel ? (
          <span className="cd-stamp">{stampLabel}</span>
        ) : null}
      </div>

      <div className="cd-title">{item.title}</div>
      {item.body ? <div className="cd-body">{item.body}</div> : null}

      <div className="cd-actions">
        {item.actions.map((a) => (
          <button
            key={a.label}
            type="button"
            className={`cd-btn cd-${a.role}`}
            style={{ borderColor: accent, color: accent }}
            disabled={busy != null}
            onClick={() => { void act(item, a); }}
          >
            {busy === a.label ? (a.busyLabel ?? 'WORKING') : a.label}
          </button>
        ))}
        {item.kind === 'decision' ? (
          <button
            type="button"
            className="cd-later"
            disabled={busy != null}
            onClick={() => setResolved((prev) => new Set(prev).add(item.key))}
          >
            DECIDE LATER
          </button>
        ) : (
          <button
            type="button"
            className="cd-later"
            onClick={() => dismiss(item.key)}
          >
            DISMISS
          </button>
        )}
      </div>

      {err ? <div className="cd-err">{err}</div> : null}
    </div>
  );
}

/** "AUG 14" · the notice's date, where a decision shows its pager. */
function shortStamp(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })
    .format(new Date(t))
    .toUpperCase();
}
