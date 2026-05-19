/**
 * Coach Reads card — surfaces the fitness-resolver output so you can
 * verify the whole app is reading from the same numbers.
 *
 * If a workout shows 7:30/mi instead of 6:52/mi, the answer is on
 * this card: VDOT, max HR, active race goal, and the derived pace
 * bands. Every consumer (modal, training calendar, race plan,
 * workout descriptions) should match what's shown here.
 */

import type { ResolvedFitness } from '@/lib/fitness-types';
import { fmtPaceBand } from '@/lib/fitness-types';
import type { MaxHrValidationVerdict } from '@/lib/validate-max-hr';
import type { RaceFeasibilityVerdict } from '@/lib/validate-race-feasibility';
import { MaxHrValidationBanner } from './MaxHrValidationBanner';

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

export function CoachReadsCard({
  fitness,
  maxHrVerdict,
  raceFeasibility,
}: {
  fitness: ResolvedFitness;
  maxHrVerdict?: MaxHrValidationVerdict | null;
  raceFeasibility?: RaceFeasibilityVerdict | null;
}) {
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
          </div>
          {fitness.vdot.sourceLabel && (
            <div className="coach-reads-meta">{fitness.vdot.sourceLabel}</div>
          )}
          {fitness.vdot.contributors.length > 0 && (
            <div className="coach-reads-contributors">
              {fitness.vdot.contributors.slice(0, 3).map((c, i) => (
                <div key={i} className="coach-reads-contributor">
                  <strong>{c.name}</strong> {fmtFinish(c.finishS)} · {fmtDate(c.date)} →
                  <span className="coach-reads-accent"> VDOT {c.vdot.toFixed(1)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── DERIVED PACE BANDS ── */}
      <div className="coach-reads-section">
        <div className="coach-reads-label">Pace Bands · race-pace derived from VDOT {fitness.vdot.value.toFixed(0)}</div>
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
          Bands are derived from your race performance (race-pace-derived),
          not Daniels&rsquo; published training-pace tables. They reflect your
          current race-pace capability and may run slightly slower than
          canonical Daniels training paces. Anyone using a Daniels-based
          calculator alongside this app will see ~15–30 sec/mi gap on T and
          I bands — that&rsquo;s the labeling-semantics difference, not a math
          error.
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
          margin-top: 10px;
          display: flex; flex-direction: column; gap: 4px;
        }
        .coach-reads-contributor {
          font-family: 'Inter', sans-serif; font-size: 12px;
          color: rgba(13,15,18,.65);
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
