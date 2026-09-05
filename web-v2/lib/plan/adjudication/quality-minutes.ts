/**
 * lib/plan/adjudication/quality-minutes.ts · HOW MANY MINUTES OF THIS WEEK ARE
 * QUALITY.
 *
 * `weekly-demand.ts` prices intensity as "minutes of running at threshold pace
 * or faster, plus race-pace work", and that number had no producer anywhere in
 * this app. `canonical-shadow/live-input.ts` supplied it as a literal `0` with
 * a comment saying it was "not read live yet" — a hard-coded zero standing in
 * for an unread quantity, which is CLAUDE.md Rule 11's exact defect and had a
 * real consequence: a zero-quality week prices a threshold-pace proposal at
 * zero added demand, so rule 1 could never defer a pace correction no matter
 * how full the week was.
 *
 * This reads the authored `workout_spec`, which already carries every number
 * needed. It is a PARSE, not an estimate. Where the spec does not carry them —
 * an effort-prescribed session with a distance and no pace — the answer is
 * UNKNOWN and says so.
 *
 * ── WHAT COUNTS, AND WHY WARM-UP DOES NOT ──────────────────────────────────
 *
 * The work phases only. `warmup_mi` and `cooldown_mi` are easy running and are
 * already inside the week's mileage, where they are priced at the volume
 * coefficient of 1.0. Counting them again as quality would double-charge them,
 * and would make a session with a long warm-up look harder than the same reps
 * off a short one, which is backwards.
 *
 * The long run's MP-finish block counts. `Research/00a` §"Training Intensity
 * Distribution (TID)" puts marathon-pace work on the quality side of the
 * easy/quality split, and the demand model's own field doc says "plus
 * race-pace work" in as many words.
 *
 * ── RULE 11 · THREE FACTS ──────────────────────────────────────────────────
 *
 *   a number   · the spec carried what was needed and this is the parse.
 *   0          · MEASURED zero. An all-easy week really has no quality, and a
 *                recovery week really is a recovery week.
 *   null       · the spec did not carry it. NEVER collapsed into 0, and a week
 *                containing ONE unreadable quality session is unknown as a
 *                whole rather than reported as the sum of the readable ones —
 *                a partial sum understates the week, and understating a week
 *                is the direction that licenses a bigger plan.
 *
 * ── RULE 22 · WHAT A GATE OVER THIS FILE CANNOT FAIL ON ────────────────────
 *
 * · A SPEC THAT LIES. If the authored rep pace does not describe what the
 *   session actually asks for, this returns a confident wrong number and no
 *   test here can tell. It reads the prescription, never the activity.
 * · WHETHER THE SESSION WAS RUN. This prices what the plan ASKED FOR. A week
 *   whose quality was skipped still costs what it was written to cost, on this
 *   reading, and pairing that with completion is the caller's job.
 * · WHETHER MP WORK BELONGS ON THE QUALITY SIDE at the same coefficient as
 *   threshold reps. The TID table gives shares, not load equivalence, and the
 *   demand model says so about its own coefficient.
 */

/**
 * The parse. `minutes` is null for unknown, and `why` always says which of the
 * three facts this is, so a caller printing it never has to guess.
 */
export interface QualityMinutesReading {
  readonly minutes: number | null;
  readonly why: string;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Metres per mile. Used only to convert `rep_distance_m` to miles. */
const M_PER_MI = 1609.344;

function repDistanceMi(spec: Record<string, unknown>): number | null {
  if (isNum(spec.rep_distance_mi)) return spec.rep_distance_mi;
  if (isNum(spec.rep_distance_m)) return spec.rep_distance_m / M_PER_MI;
  return null;
}

/**
 * Work-phase seconds for ONE authored session, or null when the spec does not
 * carry enough to say.
 *
 * `kind` drives the read, because the shapes genuinely differ and a generic
 * "find a pace and a distance" walk would silently price a warm-up.
 */
export function qualitySecondsOfSpec(
  spec: Record<string, unknown> | null | undefined,
  /**
   * The plan's OWN flags for this session, which exist on every row whether or
   * not a spec does.
   *
   * They are what makes a spec-less row readable at all, and the distinction
   * they carry is real rather than convenient. Measured on the owner's sealed
   * history: 262 of 570 prescriptions carry NO spec — older plan versions
   * authored before the spec builder — and of those, 180 are flagged
   * `easy` / `rest` / `shakeout`, neither quality nor long. A session the plan
   * itself says is not quality and is not long carries no threshold-or-faster
   * work, and reporting that as UNKNOWN made every week containing an easy day
   * unpriceable, which is how the first cut of this file produced a FAILED
   * demand posture on nine of thirteen historical boundaries.
   *
   * The other 82 — threshold, interval and long rows with no spec — stay
   * unknown, because for those the flags say work happened and nothing says
   * how much.
   */
  flags?: { readonly isQuality: boolean; readonly isLong: boolean },
): QualityMinutesReading {
  if (spec == null) {
    if (flags !== undefined && !flags.isQuality && !flags.isLong) {
      return {
        minutes: 0,
        why: 'the plan flags this session as neither quality nor long, so it carries no '
          + 'threshold-or-faster work. A measured zero, read off the authored flags.',
      };
    }
    return {
      minutes: null,
      why: flags === undefined
        ? 'the session carries no authored spec, so its quality work is unknown'
        : 'the plan flags this session as quality or long but authored no spec, so how much '
          + 'work it asks for is unknown',
    };
  }
  const kind = typeof spec.kind === 'string' ? spec.kind : null;
  if (kind === null) {
    return { minutes: null, why: 'the authored spec names no kind, so its quality work is unknown' };
  }

  const ok = (seconds: number, why: string): QualityMinutesReading =>
    ({ minutes: Math.round((seconds / 60) * 1000) / 1000, why });
  const unknown = (why: string): QualityMinutesReading => ({ minutes: null, why });

  switch (kind) {
    /* ── No work phase at all. A MEASURED zero, not an unknown. ─────────── */
    case 'easy':
    case 'recovery':
      return ok(0, `a ${kind} session carries no quality work`);

    /* ── Reps · time-based first, because an effort-prescribed hill rep
     *    carries its DURATION and is therefore fully known even though it
     *    carries no pace. Rule 11: "no pace" is not "no information". ─── */
    case 'threshold':
    case 'intervals': {
      const reps = isNum(spec.rep_count) ? spec.rep_count : null;
      if (reps === null) return unknown(`a ${kind} session with no rep count cannot be priced`);
      if (isNum(spec.rep_duration_s)) {
        return ok(reps * spec.rep_duration_s, `${reps} reps of ${spec.rep_duration_s}s of work`);
      }
      const mi = repDistanceMi(spec);
      const pace = isNum(spec.rep_pace_s_per_mi) ? spec.rep_pace_s_per_mi : null;
      if (mi === null || pace === null) {
        return unknown(
          `a ${kind} session prescribed by effort, with a distance and no pace and no `
          + 'duration, carries no readable work time',
        );
      }
      return ok(reps * mi * pace, `${reps} reps of ${Math.round(mi * 100) / 100} mi at ${pace} s/mi`);
    }

    case 'tempo': {
      const mi = isNum(spec.tempo_distance_mi) ? spec.tempo_distance_mi : null;
      const pace = isNum(spec.tempo_pace_s_per_mi) ? spec.tempo_pace_s_per_mi : null;
      if (mi === null || pace === null) {
        return unknown('a tempo session with no readable distance and pace carries no work time');
      }
      return ok(mi * pace, `${mi} mi of tempo at ${pace} s/mi`);
    }

    case 'mp': {
      const mi = isNum(spec.mp_distance_mi) ? spec.mp_distance_mi : null;
      const pace = isNum(spec.mp_pace_s_per_mi) ? spec.mp_pace_s_per_mi : null;
      if (mi === null || pace === null) {
        return unknown('a marathon-pace session with no readable distance and pace carries no work time');
      }
      return ok(mi * pace, `${mi} mi at marathon pace (${pace} s/mi)`);
    }

    case 'fartlek': {
      const segs = Array.isArray(spec.segments) ? spec.segments : null;
      if (segs === null) return unknown('a fartlek session with no segment list cannot be priced');
      let seconds = 0;
      for (const raw of segs) {
        const seg = raw as Record<string, unknown>;
        if (!isNum(seg.duration_s)) {
          return unknown('a fartlek segment carries no duration, so the session work time is unknown');
        }
        seconds += seg.duration_s;
      }
      return ok(seconds, `${segs.length} fartlek segments`);
    }

    case 'progression': {
      const mi = isNum(spec.prog_distance_mi) ? spec.prog_distance_mi : null;
      const from = isNum(spec.prog_start_s_per_mi) ? spec.prog_start_s_per_mi : null;
      const to = isNum(spec.prog_end_s_per_mi) ? spec.prog_end_s_per_mi : null;
      if (mi === null || from === null || to === null) {
        return unknown('a progression session with no readable distance or pace band cannot be priced');
      }
      // Linear in pace across the block, which is what the two authored
      // endpoints describe. Stated rather than dressed up: the spec carries
      // two paces and a distance and nothing about the shape between them.
      return ok(mi * ((from + to) / 2), `${mi} mi progressing ${from} to ${to} s/mi`);
    }

    /* ── The long run · only its FINISH block is quality. ──────────────── */
    case 'long': {
      const segs = Array.isArray(spec.finish_segments) ? spec.finish_segments : null;
      if (segs !== null) {
        let seconds = 0;
        for (const raw of segs) {
          const seg = raw as Record<string, unknown>;
          if (!isNum(seg.mi) || !isNum(seg.pace_s_per_mi)) {
            return unknown('a long-run finish segment carries no readable distance and pace');
          }
          seconds += seg.mi * seg.pace_s_per_mi;
        }
        return ok(seconds, `${segs.length} finish segments on the long run`);
      }
      const mi = isNum(spec.finish_mi) ? spec.finish_mi : null;
      const pace = isNum(spec.finish_pace_s_per_mi) ? spec.finish_pace_s_per_mi : null;
      if (mi === null || pace === null) {
        // A plain long run with no authored finish block. MEASURED zero: the
        // absence of the fields IS the prescription here, unlike every other
        // branch above where the fields are expected and missing.
        return ok(0, 'a long run with no authored finish block carries no quality work');
      }
      return ok(mi * pace, `${mi} mi finish at ${pace} s/mi`);
    }

    default:
      return unknown(`spec kind '${kind}' is not one this reader knows how to price`);
  }
}

/**
 * A whole week's quality minutes, from its authored sessions.
 *
 * An EMPTY week is a measured zero — no sessions is no quality. One unreadable
 * quality session makes the WEEK unknown, per the header.
 */
export function qualityMinutesOfWeek(
  sessions: ReadonlyArray<{
    readonly dateISO: string;
    readonly spec: Record<string, unknown> | null;
    readonly isQuality: boolean;
    readonly isLong: boolean;
  }>,
): QualityMinutesReading {
  if (sessions.length === 0) {
    return { minutes: 0, why: 'the week prescribes no sessions at all, so it carries no quality work' };
  }
  let total = 0;
  const unreadable: string[] = [];
  for (const s of sessions) {
    const r = qualitySecondsOfSpec(s.spec, { isQuality: s.isQuality, isLong: s.isLong });
    if (r.minutes === null) { unreadable.push(`${s.dateISO} (${r.why})`); continue; }
    total += r.minutes;
  }
  if (unreadable.length > 0) {
    return {
      minutes: null,
      why:
        `${unreadable.length} of ${sessions.length} sessions could not be priced: `
        + `${unreadable.join('; ')}. The week is reported unknown rather than as the sum of `
        + 'the readable ones, because a partial sum understates the week.',
    };
  }
  return {
    minutes: Math.round(total * 1000) / 1000,
    why: `${sessions.length} authored sessions, work phases only`,
  };
}
