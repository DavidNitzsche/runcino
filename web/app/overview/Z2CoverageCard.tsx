/**
 * Z2 stimulus check · V5 surface on /overview
 *
 * Coaching finding that fires when easy-run Z2 coverage drops below
 * 40% across 3+ recent easy runs. Voice: direct, not hedged. Data
 * is data, coach is coach, both honest. The system observed the
 * pattern; the recommendation tells the runner what the data says,
 * not "you might want to consider..."
 *
 * Copy structure (locked with David round 4):
 *   Header     · "Z2 stimulus check"
 *   Evidence   · Data points from last 7d + last 28d
 *   Diagnosis  · "Your easy runs are too hard. Here's why it matters."
 *   Recommendation · HR-governed, specific, concrete
 *   Second-order observation · when threshold under-reach is present
 *   Falsifier  · "What would change our mind: ..."
 */

import type { Z2CoverageFinding } from '@/lib/z2-coverage';

interface Props {
  finding: Z2CoverageFinding;
}

export function Z2CoverageCard({ finding }: Props) {
  if (!finding.shouldRender) return null;

  const ceiling = finding.z2CeilingBpm ?? 139;
  const ePaceHint = finding.ePaceRangeDisplay
    ? `likely ${finding.ePaceRangeDisplay} on flat terrain, slower on hills or in heat.`
    : `let pace be whatever it needs to be, usually slower than feels natural at first.`;

  return (
    <div
      style={{
        marginTop: 16,
        maxWidth: 600,
        padding: '16px 18px',
        background: 'rgba(232, 93, 38, 0.05)',
        border: '1px solid rgba(232, 93, 38, 0.28)',
        borderRadius: 10,
        fontFamily: 'Inter, sans-serif',
        fontSize: 13,
        lineHeight: 1.55,
        color: 'rgba(8,8,8,.85)',
      }}
    >
      <div
        style={{
          fontFamily: 'Oswald, sans-serif',
          fontSize: 10.5,
          letterSpacing: 1.6,
          textTransform: 'uppercase',
          color: '#B3450A',
          fontWeight: 700,
          marginBottom: 10,
        }}
      >
        Z2 stimulus check
      </div>

      {/* Evidence */}
      <div style={{ marginBottom: 10 }}>
        <strong style={{ color: '#080808' }}>Last 7 days:</strong>{' '}
        {finding.last7d.runsInZ2}/{finding.last7d.easyRunCount} easy runs landed in Z2 band
        {' '}(HR ≤{ceiling}). <strong style={{ color: '#080808' }}>Last 28 days:</strong>{' '}
        {finding.last28d.z2SharePct}% of easy mileage in Z2 ({finding.last28d.z2Miles} of {Math.round(finding.last28d.easyMiles)} mi).
      </div>

      {/* Diagnosis, direct, no hedging */}
      <div style={{ marginBottom: 10 }}>
        <strong style={{ color: '#080808' }}>Your easy runs are too hard.</strong>{' '}
        Easy effort builds aerobic capacity without accumulating fatigue, 
        when easy runs drift into Z3 the aerobic-base adaptation weakens AND you carry more fatigue into quality days.
      </div>

      {/* Recommendation, specific, actionable */}
      <div style={{ marginBottom: finding.thresholdUnderReach ? 10 : 12 }}>
        <strong style={{ color: '#080808' }}>Easy days are HR-governed, not pace-governed.</strong>{' '}
        Hold HR ≤{ceiling}. Walk uphills if needed. Let pace be whatever it needs to be, {ePaceHint}
      </div>

      {/* Second-order observation, only when threshold under-reach is present */}
      {finding.thresholdUnderReach && (
        <div
          style={{
            marginTop: 10,
            padding: '10px 12px',
            background: 'rgba(8,8,8,.04)',
            borderRadius: 6,
            fontSize: 12.5,
            color: 'rgba(8,8,8,.78)',
          }}
        >
          <strong style={{ color: '#080808' }}>Connected observation:</strong>{' '}
          Your most recent threshold workout ({fmtDate(finding.thresholdUnderReach.date)}{finding.thresholdUnderReach.name ? `, ${finding.thresholdUnderReach.name}` : ''}, HR {finding.thresholdUnderReach.avgHr}) hit the pace band but stayed below Z4 ({finding.thresholdUnderReach.z4FloorBpm}+).
          {' '}This is often downstream of easy days carrying too much load, the body can't reach threshold intensity when not fresh.
          {' '}<strong>Slower easy days = harder hard days, the way they're supposed to be.</strong>
        </div>
      )}

      {/* Falsifier */}
      <div
        style={{
          marginTop: 12,
          paddingTop: 10,
          borderTop: '1px solid rgba(8,8,8,.10)',
          fontStyle: 'italic',
          fontSize: 11.5,
          color: 'rgba(8,8,8,.62)',
        }}
      >
        <strong style={{ fontStyle: 'normal', color: 'rgba(8,8,8,.78)' }}>What would change our mind: </strong>
        3+ consecutive weeks where ≥60% of easy mileage lands in Z2.
      </div>
    </div>
  );
}

function fmtDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00Z');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}`;
}
