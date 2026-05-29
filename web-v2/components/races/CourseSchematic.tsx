/**
 * Course schematic — honest stand-in for real GPX (§8.2 closed loop).
 * Terrain segments + mile markers + start/finish labels.
 * Renders against the deck's design exactly when no GPX is attached;
 * replaced with real polyline + per-mile elevation bars once
 * races.course_geometry is set.
 */
export function CourseSchematic() {
  return (
    <svg viewBox="0 0 600 280" style={{ width: '100%', height: 'auto' }}>
      {/* Terrain segments (0-3 flat, 3-5 rise, 5-6 climb, 6-9 descent, 9-13.1 flat) */}
      <rect x={60}  y={130} width={146} height={44} fill="rgba(39,180,224,0.18)"  stroke="rgba(39,180,224,0.30)"  strokeWidth={1} rx={6}/>
      <rect x={206} y={130} width={74}  height={44} fill="rgba(176,132,255,0.18)" stroke="rgba(176,132,255,0.30)" strokeWidth={1} rx={6}/>
      <rect x={280} y={130} width={36}  height={44} fill="rgba(255,136,71,0.32)"  stroke="rgba(255,136,71,0.50)"  strokeWidth={1} rx={6}/>
      <rect x={316} y={130} width={110} height={44} fill="rgba(62,189,65,0.18)"   stroke="rgba(62,189,65,0.30)"   strokeWidth={1} rx={6}/>
      <rect x={426} y={130} width={114} height={44} fill="rgba(39,180,224,0.18)"  stroke="rgba(39,180,224,0.30)"  strokeWidth={1} rx={6}/>

      {/* Mile ticks + labels */}
      <line x1={60}  y1={124} x2={60}  y2={180} stroke="var(--green)" strokeWidth={2}/>
      <line x1={170} y1={124} x2={170} y2={180} stroke="var(--line)" strokeWidth={1}/>
      <line x1={280} y1={124} x2={280} y2={180} stroke="var(--line)" strokeWidth={1}/>
      <line x1={390} y1={124} x2={390} y2={180} stroke="var(--line)" strokeWidth={1}/>
      <line x1={540} y1={124} x2={540} y2={180} stroke="var(--goal)" strokeWidth={2}/>
      {[
        { x: 60, label: '0' }, { x: 170, label: '3' },
        { x: 280, label: '6' }, { x: 390, label: '9' }, { x: 540, label: '13.1' },
      ].map((t) => (
        <text key={t.label} x={t.x} y={116} textAnchor="middle"
              fontFamily="Inter,sans-serif" fontSize={11} fontWeight={700}
              fill="var(--mute)" letterSpacing={0.5}>{t.label}</text>
      ))}

      {/* Terrain labels below strip */}
      {[
        { x: 133, label: 'COASTAL · FLAT', fill: 'var(--dist)' },
        { x: 243, label: 'GENTLE RISE',    fill: 'var(--learn)' },
        { x: 298, label: 'CLIMB',          fill: 'var(--race)' },
        { x: 371, label: 'DESCENT',        fill: 'var(--green)' },
        { x: 483, label: 'BAY · FLAT',     fill: 'var(--dist)' },
      ].map((t) => (
        <text key={t.label} x={t.x} y={198} textAnchor="middle"
              fontFamily="Inter,sans-serif" fontSize={10} fontWeight={600}
              letterSpacing={1.4} fill={t.fill}>{t.label}</text>
      ))}

      {/* Start / finish anchors */}
      <circle cx={60}  cy={152} r={11} fill="var(--green)" stroke="var(--card-2)" strokeWidth={3}/>
      <circle cx={540} cy={152} r={11} fill="var(--goal)" stroke="var(--card-2)" strokeWidth={3}/>
      <text x={60}  y={244} textAnchor="middle" fontFamily="'Oswald', 'Inter', sans-serif" fontSize={18}
            fill="var(--green)" letterSpacing={1.5}>START</text>
      <text x={540} y={244} textAnchor="middle" fontFamily="'Oswald', 'Inter', sans-serif" fontSize={18}
            fill="var(--goal)" letterSpacing={1.5}>FINISH</text>

      {/* Honest disclaimer */}
      <text x={300} y={35} textAnchor="middle" fontFamily="Inter,sans-serif"
            fontSize={10} fontWeight={700} fill="var(--dim)" letterSpacing={2}>
        COURSE SCHEMATIC · GPX IMPORT PENDING
      </text>
    </svg>
  );
}

/**
 * Pace plan table — 6 segments × terrain × target.
 * Fills the column under the elevation/route with actionable info.
 */
export function PacePlanTable({ goalLabel }: { goalLabel?: string }) {
  return (
    <div style={{ marginTop: 16, borderTop: '1px solid var(--line)', paddingTop: 14 }}>
      <div style={{
        fontFamily: 'var(--f-body)', fontSize: 10, fontWeight: 700, color: 'var(--mute)',
        letterSpacing: '1.6px', textTransform: 'uppercase', marginBottom: 10,
      }}>
        PACE PLAN{goalLabel ? ` · GOAL ${goalLabel}` : ''}
      </div>
      <div style={{
        display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: '8px 14px',
        fontFamily: 'var(--f-body)', fontSize: 12, lineHeight: 1.45,
      }}>
        <Row mi="1-3"   note="Coastal flat · hold back"           pace="7:00" />
        <Row mi="4-5"   note="Gentle rise · settle"               pace="6:55" />
        <Row mi="6"     note="Bridge climb · effort, not pace"    pace="7:10" pacecolor="var(--goal)" />
        <Row mi="7-9"   note="Descent · close gap"                pace="6:45" pacecolor="var(--green)" />
        <Row mi="10-12" note="Bay flat · lock in"                 pace="6:48" />
        <Row mi="13.1"  note="Finish chute · spend it"            pace="6:30" pacecolor="var(--race)" />
      </div>
    </div>
  );
}

function Row({ mi, note, pace, pacecolor = 'var(--ink)' }: { mi: string; note: string; pace: string; pacecolor?: string }) {
  return (
    <>
      <div style={{ fontFamily: 'var(--f-label)', fontSize: 14, color: pacecolor }}>{mi}</div>
      <div style={{ color: 'var(--mute)' }}>{note}</div>
      <div style={{ fontFamily: 'var(--f-label)', fontSize: 14, color: pacecolor, textAlign: 'right' }}>{pace}</div>
    </>
  );
}
