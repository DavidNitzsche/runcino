'use client';

/**
 * CoachVoice · the 3–6 sentence voice paragraph slot inside Sibling.
 * Spec: design/components/CoachVoice.md
 * Doctrine: research/methodology/coach-voice-spec.md
 *
 * Renders ONE flowing paragraph (invariant 1). Inline stats from the
 * engine's `inlineStats` array get tabular-nums + 600wt styling. The
 * renderer does NOT compose voice — that's the coaching engine's job.
 * It also does NOT truncate; over-long briefs render fully and log a
 * dev warning so the engine catches the violation.
 */

import type { Surface } from '@/lib/faff/types';
import styles from './CoachVoice.module.css';

export interface InlineStat {
  text: string;
  valueColor?: 'default' | 'amber' | 'over';
}

export interface CoachVoicePayload {
  // The engine contract emits a single-element array. Typed as `string[]`
  // (not the tuple `[string]`) so the runtime defensive checks against
  // empty/extra elements compile under strict TS — they're not dead in
  // practice (engine bugs / bad cache hydration can produce either).
  voice: string[];
  inlineStats?: InlineStat[];
  surface: Extract<Surface, 'today' | 'plan' | 'race_detail' | 'health'>;
}

export interface CoachVoiceProps {
  payload: CoachVoicePayload;
}

const COLOR_CLASS = {
  default: styles.statDefault,
  amber: styles.statAmber,
  over: styles.statOver,
} as const;

// Sentence-count counter for the dev-mode <3 / >6 invariant check.
// Conservative: count `.` followed by space or end-of-string.
function countSentences(s: string): number {
  const matches = s.match(/\.(?:\s|$)/g);
  return matches ? matches.length : 0;
}

export function CoachVoice({ payload }: CoachVoiceProps) {
  if (!payload.voice || payload.voice.length === 0) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[CoachVoice] voice is empty — rendering nothing.');
    }
    return null;
  }

  // Per spec §"Render contract": render only voice[0]. Extras are an
  // engine bug; we log and drop.
  if (payload.voice.length > 1 && process.env.NODE_ENV !== 'production') {
    console.warn(
      `[CoachVoice] voice has ${payload.voice.length} elements — rendering voice[0] only.`,
    );
  }

  const paragraph = payload.voice[0];
  if (!paragraph) return null;

  // Dev-mode invariant check · sentence count.
  if (process.env.NODE_ENV !== 'production') {
    const n = countSentences(paragraph);
    if (n < 3) {
      console.warn(
        `[CoachVoice] paragraph contains ${n} sentences — engine fell below 3-sentence floor (invariant 1).`,
      );
    } else if (n > 6) {
      console.warn(
        `[CoachVoice] paragraph contains ${n} sentences — engine exceeded 6-sentence ceiling (invariant 1).`,
      );
    }

    if ((payload.inlineStats?.length ?? 0) > 3) {
      console.warn(
        `[CoachVoice] inlineStats.length=${payload.inlineStats?.length} exceeds 3-stat ceiling (invariant 5).`,
      );
    }
  }

  // Build the rendered paragraph by walking the inlineStats list. For each
  // declared substring, locate the FIRST occurrence in the remaining text,
  // emit the prose before it, then emit the styled stat span, then continue
  // from the slice after it. Substrings not found are skipped with a dev
  // warning.
  //
  // Ordering matters for overlap (e.g. "7:42" vs "7:42/mi" — the longer
  // string must match first or the shorter wins and the renderer never
  // styles the longer one). We sort by length DESC so the longest declared
  // substring wins precedence.
  const stats = (payload.inlineStats ?? [])
    .slice()
    .sort((a, b) => b.text.length - a.text.length);

  const parts: Array<{ kind: 'text' | 'stat'; text: string; color?: 'default' | 'amber' | 'over' }> = [];
  let remaining = paragraph;
  const consumed = new Set<string>();

  for (const stat of stats) {
    if (consumed.has(stat.text)) continue;
    const idx = remaining.indexOf(stat.text);
    if (idx === -1) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(
          `[CoachVoice] inlineStat "${stat.text}" not found in paragraph — skipping.`,
        );
      }
      continue;
    }
    if (idx > 0) {
      parts.push({ kind: 'text', text: remaining.slice(0, idx) });
    }
    parts.push({
      kind: 'stat',
      text: stat.text,
      color: stat.valueColor ?? 'default',
    });
    remaining = remaining.slice(idx + stat.text.length);
    consumed.add(stat.text);
  }
  if (remaining.length > 0) {
    parts.push({ kind: 'text', text: remaining });
  }

  return (
    <p className={styles.paragraph} data-surface={payload.surface}>
      {parts.map((p, i) =>
        p.kind === 'stat' ? (
          <span key={i} className={[styles.stat, COLOR_CLASS[p.color ?? 'default']].join(' ')}>
            {p.text}
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </p>
  );
}
