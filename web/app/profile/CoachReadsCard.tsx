/**
 * Coach Reads card — surfaces the fitness-resolver output so you can
 * verify the whole app is reading from the same numbers.
 *
 * If a workout shows 7:30/mi instead of 6:52/mi, the answer is on
 * this card: VDOT, max HR, active race goal, and the derived pace
 * bands. Every consumer (modal, training calendar, race plan,
 * workout descriptions) should match what's shown here.
 */

import type { ResolvedFitness, FitnessVdot } from '@/lib/fitness-types';
import { fmtPaceBand } from '@/lib/fitness-types';
import type { MaxHrValidationVerdict } from '@/lib/validate-max-hr';
import type { RaceFeasibilityVerdict } from '@/lib/validate-race-feasibility';
import { MaxHrValidationBanner } from './MaxHrValidationBanner';
import { PaceMigrationBanner } from './PaceMigrationBanner';
import { AdaptiveVdotBanner, type AdaptiveVdotVerdictForUI } from './AdaptiveVdotBanner';
import { legacyPaceCenters } from '@/lib/legacy-paces';

function fmtFinish(s: number): string {
  if (!s || s <= 0) return '—';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}

function fmtDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00Z');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** Natural-language aggregate explainer — written from the
 *  contributor data, not hand-coded. The voice goal: explain WHY
 *  VDOT lands where it does so the user can see the cycle-aware
 *  weighting + goal-tier exemption + chip-time correction in
 *  plain English. */
function aggregateExplainer(vdot: FitnessVdot): string | null {
  if (vdot.source !== 'aggregate' || vdot.contributors.length === 0) return null;
  const totalWeight = vdot.contributors.reduce((s, c) => s + (c.weight ?? 0), 0);
  if (totalWeight === 0) return null;

  const top = vdot.contributors[0];
  const topPct = Math.round(((top.weight ?? 0) / totalWeight) * 100);
  const others = vdot.contributors.slice(1);
  const othersPct = 100 - topPct;

  const topFinish = fmtFinish(top.finishS);
  const topDate = fmtDate(top.date);
  const ageDays = top.date
    ? Math.max(0, Math.floor((Date.now() - new Date(top.date + 'T12:00:00Z').getTime()) / 86_400_000))
    : null;

  const parts: string[] = [];
  parts.push(`Your current VDOT is **${vdot.value.toFixed(1)}**.`);

  // Top contributor framing
  const topProvSrc = top.source === 'races' ? ' (chip time)' : '';
  parts.push(
    ` Anchored by your **${top.name} ${topDate}** (${topFinish}${topProvSrc} → VDOT ${top.vdot.toFixed(1)}), weighted **${topPct}%** of the total.`,
  );

  // Goal-tier-in-cycle explainer
  if (top.isGoalTier && top.isInCycle && ageDays != null) {
    parts.push(
      ` This race is your goal-distance tier and falls inside your current training cycle, so it carries full weight despite being ${ageDays} days old.`,
    );
  } else if (top.isGoalTier && ageDays != null) {
    parts.push(
      ` This race matches your goal-distance tier but falls before the current training cycle, so its recency weight has decayed normally.`,
    );
  }

  // Other contributors summary — no asterisks; provenance is in the
  // per-contributor badge row below the explainer. Inlining "(chip
  // time)" reads as confirmation of curated source without dragging
  // an unexplained * into the prose.
  if (others.length > 0 && othersPct > 0) {
    // Group by name so two HMs collapse to one mention.
    const seen = new Set<string>();
    const labels = others
      .filter((c) => {
        if (seen.has(c.name)) return false;
        seen.add(c.name);
        return true;
      })
      .map((c) => c.name)
      .join(', ');
    parts.push(
      ` ${labels} contribute the remaining **${othersPct}%** via adjacent-tier recency decay.`,
    );
  }

  return parts.join('');
}

export function CoachReadsCard({
  fitness,
  maxHrVerdict,
  raceFeasibility,
  paceMigrationAckAt,
  adaptiveVdotVerdict,
}: {
  fitness: ResolvedFitness;
  maxHrVerdict?: MaxHrValidationVerdict | null;
  raceFeasibility?: RaceFeasibilityVerdict | null;
  /** Timestamp at which the user acknowledged the canonical pace
   *  migration. When null, the PaceMigrationBanner is rendered above
   *  the pace bands. Pulled from users.pace_migration_ack_at by
   *  /profile/page.tsx. */
  paceMigrationAckAt?: Date | string | null;
  /** L7 passive VDOT updater verdict. When kind is
   *  'vdot-bump-suggested' or 'vdot-downgrade-investigate', the
   *  AdaptiveVdotBanner is rendered below the VDOT section. */
  adaptiveVdotVerdict?: AdaptiveVdotVerdictForUI | null;
}) {
  const explainer = aggregateExplainer(fitness.vdot);
  const needsMigrationAck = !paceMigrationAckAt;

  // V4: compute legacy paces ONLY for the migration banner's
  // before/after table. Display-only; never used in a prescription path.
  const legacy = legacyPaceCenters(fitness.vdot.value);
  const beforeAfterPaces = legacy ? {
    legacyE: legacy.eS,
    legacyT: legacy.tS,
    legacyI: legacy.iS,
    legacyR: legacy.rS,
    newE: Math.round((fitness.paces.E.lowS + fitness.paces.E.highS) / 2),
    newT: Math.round((fitness.paces.T.lowS + fitness.paces.T.highS) / 2),
    newI: Math.round((fitness.paces.I.lowS + fitness.paces.I.highS) / 2),
    newR: Math.round((fitness.paces.R.lowS + fitness.paces.R.highS) / 2),
    vdot: fitness.vdot.value,
  } : undefined;
  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title-group">
          <div className="card-title">Coach Reads</div>
          <div className="card-sub">
            Every page, modal, and pace target in this app reads from these numbers.
            If something looks wrong, the answer is here.
          </div>
        </div>
        <div className="card-meta" style={{ color: 'rgba(13,15,18,.55)' }}>
          Resolved {fmtDate(fitness.today)}
        </div>
      </div>

      {/* ── ACTIVE RACE ── */}
      <div className="coach-reads-section">
        <div className="coach-reads-label">Active Race</div>
        {fitness.activeRace ? (
          <div className="coach-reads-row">
            <div className="coach-reads-headline">
              <strong>{fitness.activeRace.name}</strong> · {fmtDate(fitness.activeRace.date)} ·{' '}
              <span className="coach-reads-accent">{fitness.activeRace.daysAway} days away</span>
            </div>
            <div className="coach-reads-detail">
              {fitness.activeRace.distanceMi.toFixed(2)} mi ·
              goal {fitness.activeRace.goalDisplay} ·
              <strong> {fmtFinish(fitness.activeRace.goalPaceSPerMi)}/mi</strong> race pace
            </div>
            <div className="coach-reads-meta">
              All HM/race-pace workouts target this band: <strong>{fmtPaceBand(fitness.racePaceBand)}</strong>
            </div>
            {/* Race feasibility banner — surfaces stretch / aggressive
                / conservative verdicts with evidence + falsifier. */}
            {raceFeasibility && raceFeasibility.hasFinding && raceFeasibility.predicted && (
              <div className={`coach-reads-feasibility coach-reads-feasibility-${raceFeasibility.verdict}`}>
                <div className="coach-reads-feasibility-tag">
                  {raceFeasibility.verdict === 'stretch' ? '⚠ STRETCH'
                   : raceFeasibility.verdict === 'aggressive' ? '↑ AGGRESSIVE'
                   : raceFeasibility.verdict === 'conservative' ? '↓ CONSERVATIVE'
                   : 'FAIR'}
                </div>
                <div className="coach-reads-feasibility-reason">
                  {raceFeasibility.reason}
                </div>
                <div className="coach-reads-feasibility-falsifier">
                  <strong>What would change our mind: </strong>{raceFeasibility.falsifier}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="coach-reads-empty">
            No A-race on the calendar. Race-pace workouts fall back to threshold (T) band.
          </div>
        )}
      </div>

      {/* ── VDOT ── */}
      <div className="coach-reads-section">
        <div className="coach-reads-label">VDOT</div>
        <div className="coach-reads-row">
          <div className="coach-reads-headline">
            <span className="coach-reads-bignum">{fitness.vdot.value.toFixed(1)}</span>
            <span className="coach-reads-tag coach-reads-tag-source">{fitness.vdot.source}</span>
            {fitness.vdot.goalTier && (
              <span className="coach-reads-tag coach-reads-tag-goal">
                Goal: {fitness.vdot.goalTier.replace('_ISH', '').toLowerCase()}
              </span>
            )}
          </div>
          {/* Natural-language aggregate explainer — surfaces WHY this
              VDOT lands here. Built from contributor data, not
              hand-coded. */}
          {explainer && (
            <div
              className="coach-reads-explainer"
              dangerouslySetInnerHTML={{
                __html: explainer.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>'),
              }}
            />
          )}
          {fitness.vdot.sourceLabel && !explainer && (
            <div className="coach-reads-meta">{fitness.vdot.sourceLabel}</div>
          )}
          {fitness.vdot.contributors.length > 0 && (
            <div className="coach-reads-contributors">
              {fitness.vdot.contributors.slice(0, 4).map((c, i) => {
                const totalWeight = fitness.vdot.contributors.reduce(
                  (s, x) => s + (x.weight ?? 0),
                  0,
                );
                const pct = totalWeight > 0 && c.weight != null
                  ? Math.round((c.weight / totalWeight) * 100)
                  : null;
                return (
                  <div key={i} className="coach-reads-contributor">
                    <div className="coach-reads-contributor-line">
                      <strong>{c.name}</strong> {fmtFinish(c.finishS)} · {fmtDate(c.date)} →
                      <span className="coach-reads-accent"> VDOT {c.vdot.toFixed(1)}</span>
                      {pct != null && (
                        <span className="coach-reads-weight-pct">{pct}%</span>
                      )}
                    </div>
                    <div className="coach-reads-contributor-flags">
                      {c.source === 'races' && (
                        <span className="coach-reads-flag coach-reads-flag-curated">
                          ✓ chip time
                        </span>
                      )}
                      {c.source === 'strava' && (
                        <span className="coach-reads-flag coach-reads-flag-strava">
                          Strava elapsed
                        </span>
                      )}
                      {c.isGoalTier && (
                        <span className="coach-reads-flag coach-reads-flag-goal">
                          goal-tier
                        </span>
                      )}
                      {c.isInCycle && c.isGoalTier && (
                        <span className="coach-reads-flag coach-reads-flag-exempt">
                          ⊕ full weight (in cycle)
                        </span>
                      )}
                      {!c.isInCycle && c.recency != null && (
                        <span className="coach-reads-flag coach-reads-flag-decayed">
                          recency {(c.recency * 100).toFixed(0)}%
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {/* L7 adaptive-VDOT banner — fires when training execution
              evidence (3+ faster T workouts at controlled HR, or 2+
              slower) suggests fitness has moved between races. Same
              shape as the suspect-ceiling banner: evidence,
              reasoning, math, recommendation, falsifier, user
              agency. */}
          {adaptiveVdotVerdict && (
            adaptiveVdotVerdict.kind === 'vdot-bump-suggested' ||
            adaptiveVdotVerdict.kind === 'vdot-downgrade-investigate'
          ) && (
            <AdaptiveVdotBanner verdict={adaptiveVdotVerdict} />
          )}

          {/* Cycle-window explainer — small note explaining the C3
              cycle-aware exemption in plain language. */}
          {fitness.vdot.cycleStartIso && fitness.vdot.contributors.some((c) => c.isGoalTier && c.isInCycle) && (
            <div className="coach-reads-cycle-note">
              <strong>Cycle window:</strong> goal-tier races on or after{' '}
              {fmtDate(fitness.vdot.cycleStartIso)} count at full weight regardless of age.
              Off-distance races decay normally over ~90 days. Helps anchor your
              fitness to recent goal-distance evidence rather than letting older
              off-distance races dominate.
            </div>
          )}
        </div>
      </div>

      {/* ── ONE-TIME MIGRATION BANNER ── */}
      {needsMigrationAck && (
        <div className="coach-reads-section" style={{ borderTop: '1px solid rgba(13,15,18,.06)' }}>
          <PaceMigrationBanner beforeAfter={beforeAfterPaces} />
        </div>
      )}

      {/* ── DERIVED PACE BANDS (canonical Daniels) ── */}
      <div className="coach-reads-section">
        <div className="coach-reads-label">
          Pace Bands · canonical Daniels for VDOT {fitness.vdot.value.toFixed(1)}
          {Number.isInteger(fitness.vdot.value) ? '' : ' (interpolated)'}
        </div>
        <div className="coach-reads-pace-grid">
          <div className="coach-reads-pace-cell">
            <div className="coach-reads-pace-zone">E · Easy</div>
            <div className="coach-reads-pace-band">{fmtPaceBand(fitness.paces.E)}</div>
            <div className="coach-reads-pace-meta">Recovery, long runs, most training</div>
          </div>
          <div className="coach-reads-pace-cell">
            <div className="coach-reads-pace-zone">M · Marathon</div>
            <div className="coach-reads-pace-band">{fmtPaceBand(fitness.paces.M)}</div>
            <div className="coach-reads-pace-meta">Long-run finishes, marathon goal pace</div>
          </div>
          <div className="coach-reads-pace-cell">
            <div className="coach-reads-pace-zone">T · Threshold</div>
            <div className="coach-reads-pace-band">{fmtPaceBand(fitness.paces.T)}</div>
            <div className="coach-reads-pace-meta">Tempo, cruise intervals, HM pace ish</div>
          </div>
          <div className="coach-reads-pace-cell">
            <div className="coach-reads-pace-zone">I · Intervals</div>
            <div className="coach-reads-pace-band">{fmtPaceBand(fitness.paces.I)}</div>
            <div className="coach-reads-pace-meta">VO2max work, 5K race pace</div>
          </div>
          <div className="coach-reads-pace-cell">
            <div className="coach-reads-pace-zone">R · Repetition</div>
            <div className="coach-reads-pace-band">{fmtPaceBand(fitness.paces.R)}</div>
            <div className="coach-reads-pace-meta">Strides, mile race pace</div>
          </div>
        </div>
        <div className="coach-reads-pace-footnote">
          Bands are <strong>canonical Daniels</strong> values from the official
          Table 2 source (images committed at <code>docs/references/</code>).
          Single-value columns (M, T, I) come from the published table; E
          is the published range midpoint with ±10s synthesis; R derives
          from r400 × 4.023. Source-priority chain: published &gt; i1000 × 1.609
          &gt; i400 × 4.023 for I-mile.
        </div>
      </div>

      {/* ── HR ── */}
      <div className="coach-reads-section">
        <div className="coach-reads-label">Heart Rate</div>
        <div className="coach-reads-row">
          <div className="coach-reads-headline">
            <span className="coach-reads-bignum">
              {fitness.maxHr.value ?? '—'}
            </span>
            <span className="coach-reads-unit">bpm max</span>
            <span className="coach-reads-tag coach-reads-tag-source">{fitness.maxHr.source}</span>
            {fitness.restingHr.value && (
              <>
                <span className="coach-reads-bignum" style={{ marginLeft: 18 }}>
                  {fitness.restingHr.value}
                </span>
                <span className="coach-reads-unit">bpm resting</span>
              </>
            )}
          </div>
          {fitness.maxHr.sourceLabel && (
            <div className="coach-reads-meta">{fitness.maxHr.sourceLabel}</div>
          )}
          {!fitness.maxHr.value && (
            <div className="coach-reads-meta" style={{ color: '#B00020' }}>
              No max HR — HR zones won&rsquo;t show on the debrief and the coach falls
              back to qualitative HR bands. Set it on the Heart Rate Zones card below.
            </div>
          )}
        </div>
        {/* Adaptive recommendation: when stored max HR doesn't match
            the runner's actual race / peak data, surface the verdict
            with Apply / Keep current actions + a falsifier line. */}
        {maxHrVerdict && <MaxHrValidationBanner verdict={maxHrVerdict} />}
      </div>

      <style>{`
        .coach-reads-section {
          padding: 16px 40px;
          border-top: 1px solid rgba(13,15,18,.06);
        }
        .coach-reads-section:first-of-type {
          border-top: none;
        }
        .coach-reads-label {
          font-family: 'Oswald', sans-serif; font-weight: 600;
          font-size: 11px; letter-spacing: 1.5px;
          color: rgba(13,15,18,.45);
          text-transform: uppercase;
          margin-bottom: 10px;
        }
        .coach-reads-headline {
          font-family: 'Inter', sans-serif; font-size: 15px;
          color: #0D0F12;
          display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px;
        }
        .coach-reads-bignum {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 32px; line-height: 1; color: #0D0F12;
          letter-spacing: 0;
        }
        .coach-reads-unit {
          font-family: 'Inter', sans-serif; font-size: 12px;
          color: rgba(13,15,18,.55);
        }
        .coach-reads-tag {
          font-family: 'Oswald', sans-serif; font-weight: 600;
          font-size: 9px; letter-spacing: 1.2px;
          padding: 3px 8px; border-radius: 4px;
          text-transform: uppercase;
        }
        .coach-reads-tag-source {
          background: rgba(13,15,18,.06);
          color: rgba(13,15,18,.65);
        }
        .coach-reads-accent {
          color: #E85D26; font-weight: 600;
        }
        .coach-reads-detail {
          font-family: 'Inter', sans-serif; font-size: 13px;
          color: #0D0F12; margin-top: 4px;
        }
        .coach-reads-meta {
          font-family: 'Inter', sans-serif; font-size: 12px;
          color: rgba(13,15,18,.55); margin-top: 6px;
        }
        .coach-reads-empty {
          font-family: 'Inter', sans-serif; font-size: 13px;
          color: rgba(13,15,18,.55); font-style: italic;
        }
        .coach-reads-contributors {
          margin-top: 12px;
          display: flex; flex-direction: column; gap: 10px;
        }
        .coach-reads-contributor {
          font-family: 'Inter', sans-serif; font-size: 12px;
          color: rgba(13,15,18,.65);
          padding: 8px 10px;
          background: rgba(13,15,18,.025);
          border: 1px solid rgba(13,15,18,.05);
          border-radius: 8px;
        }
        .coach-reads-contributor-line {
          display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap;
        }
        .coach-reads-contributor-flags {
          display: flex; gap: 6px; flex-wrap: wrap; margin-top: 5px;
        }
        .coach-reads-weight-pct {
          margin-left: auto;
          font-family: 'Bebas Neue', sans-serif;
          font-size: 14px; letter-spacing: 0.5px;
          color: rgba(13,15,18,.75);
        }
        .coach-reads-flag {
          font-family: 'Oswald', sans-serif; font-weight: 600;
          font-size: 9px; letter-spacing: 1.0px;
          padding: 2px 6px; border-radius: 4px;
          text-transform: uppercase;
          background: rgba(13,15,18,.06);
          color: rgba(13,15,18,.55);
        }
        .coach-reads-flag-curated {
          background: rgba(44,168,47,.10);
          color: #1f6a21;
        }
        .coach-reads-flag-strava {
          background: rgba(252,82,0,.08);
          color: #b3450a;
        }
        .coach-reads-flag-goal {
          background: rgba(232,93,38,.10);
          color: var(--accent, #E85D26);
        }
        .coach-reads-flag-exempt {
          background: rgba(80,40,180,.08);
          color: #5028b4;
        }
        .coach-reads-flag-decayed {
          background: rgba(13,15,18,.04);
          color: rgba(13,15,18,.50);
        }
        .coach-reads-explainer {
          margin-top: 10px;
          padding: 12px 14px;
          background: rgba(13,15,18,.03);
          border-left: 3px solid var(--accent, #E85D26);
          border-radius: 6px;
          font-family: 'Inter', sans-serif; font-size: 13px;
          line-height: 1.55; color: rgba(13,15,18,.85);
        }
        .coach-reads-explainer strong { color: #0D0F12; font-weight: 600; }
        .coach-reads-cycle-note {
          margin-top: 10px; padding: 10px 12px;
          background: rgba(80,40,180,.04);
          border-radius: 6px;
          font-family: 'Inter', sans-serif; font-size: 11px;
          line-height: 1.5; color: rgba(13,15,18,.65);
        }
        .coach-reads-cycle-note strong { color: rgba(13,15,18,.85); font-weight: 600; }
        .coach-reads-tag-goal {
          background: rgba(232,93,38,.10);
          color: var(--accent, #E85D26);
        }
        .coach-reads-pace-grid {
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          gap: 10px;
          margin-top: 4px;
        }
        @media (max-width: 960px) {
          .coach-reads-pace-grid { grid-template-columns: repeat(2, 1fr); }
          .coach-reads-section { padding-left: 20px; padding-right: 20px; }
        }
        .coach-reads-pace-cell {
          background: rgba(13,15,18,.04);
          border: 1px solid rgba(13,15,18,.08);
          border-radius: 10px;
          padding: 12px 14px;
        }
        .coach-reads-pace-zone {
          font-family: 'Oswald', sans-serif; font-weight: 600;
          font-size: 10px; letter-spacing: 1.5px;
          color: rgba(13,15,18,.55);
          text-transform: uppercase;
        }
        .coach-reads-pace-band {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 22px; line-height: 1;
          color: #0D0F12; margin-top: 6px;
          letter-spacing: 0;
        }
        .coach-reads-pace-meta {
          font-family: 'Inter', sans-serif; font-size: 11px;
          color: rgba(13,15,18,.55); margin-top: 4px;
        }
        .coach-reads-pace-footnote {
          font-family: 'Inter', sans-serif; font-size: 11px;
          line-height: 1.5; color: rgba(13,15,18,.50);
          margin-top: 14px; padding-top: 12px;
          border-top: 1px solid rgba(13,15,18,.06);
          font-style: italic;
        }
        .coach-reads-feasibility {
          margin-top: 12px; padding: 12px 14px;
          border-radius: 10px;
          border: 1px solid;
        }
        .coach-reads-feasibility-stretch {
          background: rgba(212,144,10,.08);
          border-color: rgba(212,144,10,.32);
        }
        .coach-reads-feasibility-aggressive {
          background: rgba(232,93,38,.06);
          border-color: rgba(232,93,38,.25);
        }
        .coach-reads-feasibility-conservative {
          background: rgba(44,168,47,.06);
          border-color: rgba(44,168,47,.25);
        }
        .coach-reads-feasibility-tag {
          font-family: 'Oswald', sans-serif; font-weight: 700;
          font-size: 10px; letter-spacing: 1.5px;
          color: rgba(13,15,18,.65); margin-bottom: 6px;
        }
        .coach-reads-feasibility-reason {
          font-family: 'Inter', sans-serif; font-size: 12px;
          line-height: 1.5; color: rgba(13,15,18,.85);
        }
        .coach-reads-feasibility-falsifier {
          font-family: 'Inter', sans-serif; font-size: 11px;
          line-height: 1.5; color: rgba(13,15,18,.55);
          margin-top: 6px; padding-top: 6px;
          border-top: 1px solid rgba(13,15,18,.06);
          font-style: italic;
        }
        .coach-reads-feasibility-falsifier strong {
          color: rgba(13,15,18,.75); font-style: normal; font-weight: 600;
        }
      `}</style>
    </div>
  );
}
