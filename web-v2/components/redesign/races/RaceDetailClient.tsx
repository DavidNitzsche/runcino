'use client';

import type { ReactNode } from 'react';
import dynamic from 'next/dynamic';
import type { RaceDetailSeed } from '@/components/faff-app/views/RaceView';
import type { RetroPhase } from '@/lib/race/retrospective';
import { parseRaceTime, formatRaceTime } from '@/lib/training/vdot';
import { Tile } from '@/components/redesign/core/Tile';
import { Badge, type BadgeTone } from '@/components/redesign/core/Badge';
import { Stat } from '@/components/redesign/core/Stat';
import { Progress } from '@/components/redesign/core/Progress';
import { ElevationProfile } from '@/components/redesign/graphics/ElevationProfile';
import { RangeScale } from '@/components/redesign/graphics/RangeScale';

/**
 * components/redesign/races/RaceDetailClient.tsx
 *
 * The redesigned Race Detail screen, wired to the SAME real data path the
 * live /goal/[slug] route renders: components/faff-app/raceDetail.ts#
 * buildRaceDetail(slug), called directly server-side (see
 * app/redesign/races/[slug]/page.tsx). Structurally ported from the
 * outside-studio handoff's WebRaceDetail.jsx (designs/design-review-0818/
 * ui_kits/web/WebRaceDetail.jsx, 61 lines) — that mock shows exactly one
 * state (an upcoming A race, goal set, mid-block) using seven components:
 * Tile, Badge, Button, ElevationProfile, RangeScale, Stat, Progress. This
 * file uses only those same primitives (Button is unused — see below) plus
 * plain styled divs for row layouts, the same way the mock's own local
 * `Ctx` helper is plain markup rather than a component.
 *
 * SCOPE — extended past the mock, matching the Activity screen's precedent
 * (components/redesign/activity/ActivityClient.tsx): the mock only shows
 * one race, mid-block, with a goal. The real RaceDetailSeed (and the live
 * RaceView.tsx that already renders it in the old design system) carries a
 * materially larger surface — course elevation + notable miles + route,
 * the full pacing/splits/fueling plan, race-admin readiness, logistics,
 * and — critically — an entirely different state for a race that has
 * already happened (finish time, PB, provisional-result labeling, the
 * phase-by-phase race story, VDOT movement, and the next-race handoff).
 * Per CLAUDE.md "Composition is state-driven, not template-driven": a race
 * four months out and a race that finished yesterday render meaningfully
 * different content here, not the same layout with different numbers.
 *
 * NOT ported from RaceView.tsx: every inline-edit affordance (contentEditable
 * bib/wave/gun/goal, the A/B/C priority radio, GPX upload, finish-time
 * editing, the "confirm provisional result" mutation, PATCH /api/race calls
 * generally). Those are write paths tied to the OLD app's interaction
 * components, not part of the new design system's declared vocabulary for
 * this task, and porting them honestly would mean designing new mutation UI
 * — out of scope for a read-only redesign pass. This page is the
 * display-only counterpart, same relationship RunDetailClient has to the
 * live RunDetailModal's edit affordances (it wires none either — see that
 * file's own SCOPE note re: race-result wiring, closed by this task).
 *
 * The mock's "Reply to the coach" button is dropped outright: David
 * removed the reactive coach layer app-wide 2026-06-03 (memory:
 * "No reactive coach layer" — rating/reaction/advice gutted, the engine
 * stays unmounted). Rendering a button whose only real-app destination was
 * deleted would be dead UI. "See the pace plan" is dropped too — in the
 * source mock it has no onClick at all, purely decorative.
 *
 * Every number on this page traces to a RaceDetailSeed field. Where the
 * mock had a number with no honest real-data source — the "+5.2 VDOT
 * needed... arrives week 15 of 20" fitness-gap line, and the "Confidence in
 * the projection · 0.62 · 34 runs, 63-day anchor" stat — the row is
 * dropped rather than approximated; see the inline comments at each spot
 * and the task report's Honesty gaps section.
 */

// Lazy, client-only — RouteMap talks to the DOM via Leaflet and must never
// run during SSR. Reused as-is from the live app (components/faff-app/
// RouteMap.tsx), same pattern RunDetailClient already established for this
// redesign: real CartoDB dark tiles, `points` prop built for exactly this
// case ("race courses where trackPoints are already resolved").
const RouteMap = dynamic(() => import('@/components/faff-app/RouteMap').then((m) => m.RouteMap), { ssr: false });

const PHASE_STATUS_TONE: Record<string, BadgeTone> = {
  on: 'signal',
  fast: 'attention',
  slow: 'attention',
};

function Ctx({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      style={{
        display: 'grid', gridTemplateColumns: '96px minmax(0,1fr)', gap: 'var(--sp-7)',
        alignItems: 'baseline', padding: 'var(--sp-7) 0', boxShadow: 'inset 0 1px 0 var(--rule-light)',
      }}
    >
      <div style={{
        fontFamily: 'var(--font-sub)', fontSize: 'var(--type-label-s)', fontWeight: 'var(--weight-label)',
        letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', color: 'var(--text-quiet)',
      }}>{label}</div>
      <div style={{ fontSize: 'var(--type-body)', lineHeight: 'var(--lh-body)', color: 'var(--text-secondary)' }}>{children}</div>
    </div>
  );
}

function Section({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 'var(--sp-3)' }}>
      <div className="faff-kicker">{title}</div>
      {right && <div style={{ fontSize: 'var(--type-label-s)', color: 'var(--text-quiet)' }}>{right}</div>}
    </div>
  );
}

function formatDateFull(iso: string): string {
  if (!iso) return '·';
  return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
    .format(new Date(iso.slice(0, 10) + 'T12:00:00Z'));
}

function distLabel(mi: number): string {
  if (mi >= 25 && mi <= 27) return 'Marathon';
  if (mi >= 12 && mi <= 14) return 'Half marathon';
  if (mi >= 6 && mi <= 7) return '10K';
  if (mi >= 3 && mi <= 3.5) return '5K';
  if (mi > 0) return `${mi.toFixed(1)} mi`;
  return 'Race';
}

/** "14 weeks out" for a distant race, "6 days to go" once inside two weeks
 *  — matches the mock's own eyebrow copy ("A race · 14 weeks out") while
 *  staying legible close in, where "2 weeks out" would round away the
 *  granularity a taper-week runner actually needs. */
function awayLabel(days: number): string {
  if (days < 0) return 'Past';
  if (days === 0) return 'Race day';
  if (days <= 13) return `${days} day${days === 1 ? '' : 's'} to go`;
  return `${Math.round(days / 7)} weeks out`;
}

/** Net elevation direction, same ±100 ft threshold RaceView.tsx uses for
 *  the identical read (course.rp-secr / elevation-panel subtitle). */
function elevDirection(netElevFt: number): string {
  if (netElevFt < -100) return 'Net downhill';
  if (netElevFt > 100) return 'Net uphill';
  return 'Net flat';
}

/**
 * Parses the server-built elevation SVG path (raceDetail.ts's
 * elevPathFromGeometry — 'M12.3,58.2 L45.6,40.1 L...') back into a plain
 * elevation-proportional series for ElevationProfile's `points: number[]`
 * prop. Real geometry either way, format conversion only: elevPathFromGeometry
 * maps y = 130 - normalized*90, so a HIGH elevation sample gets a SMALL y.
 * Negating y restores the correct direction (higher elevation → higher
 * value) — ElevationProfile only needs relative order and span, since it
 * renormalizes with its own min/max. Same conversion applies uniformly to
 * the built-in fallback zigzag (raceDetail.ts's FALLBACK path, rendered
 * when no GPX is on file) as to a real-GPX path — this file does not
 * special-case that, matching the live RaceView.tsx, which also renders
 * elevPath unconditionally with no "no course" branch on the chart itself
 * (only the route MAP has that branch, mirrored below in the Route tile).
 */
function elevPathToPoints(path: string): number[] {
  const out: number[] = [];
  const re = /[ML](-?[\d.]+),(-?[\d.]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(path))) out.push(-parseFloat(m[2]));
  return out.length >= 2 ? out : [0, 0];
}

/**
 * Converts real notable-mile rows (RaceDetailSeed.notables — mile-range
 * string + rich-text sentence, e.g. { mi: '1–9', tx: '<b>Steady descent.</b>
 * Let gravity do the work...' }) into ElevationProfile's `marks` prop
 * (fractional position + short label). The position is the real mid-mile
 * of the parsed range over the race's real distance; the label is the
 * sentence's own real <b> headline, not a re-write. Ranges that don't
 * parse (the '·' / "Course profile loading" placeholders raceDetail.ts
 * returns when there's no GPX yet) are skipped rather than guessed.
 */
function notablesToMarks(notables: RaceDetailSeed['notables'], distanceMi: number): Array<{ at: number; label: string }> {
  if (!distanceMi || distanceMi <= 0) return [];
  const out: Array<{ at: number; label: string }> = [];
  for (const n of notables) {
    const rangeMatch = /^(\d+(?:\.\d+)?)[–-](\d+(?:\.\d+)?)$/.exec(n.mi.trim());
    if (!rangeMatch) continue;
    const a = parseFloat(rangeMatch[1]);
    const b = parseFloat(rangeMatch[2]);
    const mid = (a + b) / 2;
    const at = Math.max(0, Math.min(1, mid / distanceMi));
    const headMatch = /<b>([^<]+)<\/b>/.exec(n.tx);
    const label = (headMatch ? headMatch[1] : n.tx.replace(/<[^>]+>/g, '')).replace(/\.$/, '');
    out.push({ at, label });
  }
  return out;
}

function parseHMS(t: string | null): number {
  return parseRaceTime((t || '').trim()) ?? 0;
}

/** "11:53 under goal" / "2:14 over goal" — the hero result-vs-goal read. */
function gapLabel(finishTime: string, aGoal: string): { text: string; under: boolean } | null {
  const fS = parseHMS(finishTime);
  const gS = parseHMS(aGoal);
  if (fS <= 0 || gS <= 0) return null;
  const gap = fS - gS;
  const a = Math.abs(Math.round(gap));
  const m = Math.floor(a / 60);
  const s = a % 60;
  const disp = m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  return { text: gap <= 0 ? `${disp} under goal` : `${disp} over goal`, under: gap <= 0 };
}

function addDaysISO(iso: string, days: number): string {
  return new Date(Date.parse(iso + 'T12:00:00Z') + days * 86_400_000).toISOString().slice(0, 10);
}
function monDay(iso: string): string {
  return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function RaceDetailClient({ race: r }: { race: RaceDetailSeed }) {
  const goalKnown = r.aGoal !== '·';
  const hasElevGeometry = r.elevPath && r.elevPath.length > 0;
  const elevPoints = hasElevGeometry ? elevPathToPoints(r.elevPath) : null;
  const marks = elevPoints ? notablesToMarks(r.notables, r.distanceMi) : [];
  const isProvisional = Boolean(r.finishProvisional || r.retro?.provisional);
  const provisionalLabel = r.finishProvisionalLabel ?? r.retro?.provisionalLabel ?? 'Provisional';
  const gap = r.isPast && r.finishTime && goalKnown ? gapLabel(r.finishTime, r.aGoal) : null;

  return (
    <div style={{ display: 'grid', gap: 'var(--stack-gap)', maxWidth: 1360, margin: '0 auto', padding: 'var(--sp-9)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 'var(--sp-6)', alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
          {/* ── Hero — state-driven: upcoming (goal + projection) vs past
              (result + gap-to-goal, provisional labeling front and center
              per the race-data doctrine). Raw inline styles here, not the
              Stat component: the mesh background sets `color:
              var(--text-on-mesh)` on the container for children to inherit,
              which Stat's own hard-coded `color` inline style would break —
              same reason the source mock hand-rolls this trio instead of
              using its own Stat component for it. */}
          <div style={{
            position: 'relative', overflow: 'hidden', borderRadius: 'var(--radius-2xl)',
            background: 'var(--g-quality)', color: 'var(--text-on-mesh)', padding: 'var(--sp-10)',
            display: 'flex', flexDirection: 'column', minHeight: 280,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--sp-6)' }}>
              <div style={{
                fontFamily: 'var(--font-sub)', fontSize: 'var(--type-label)', fontWeight: 'var(--weight-label)',
                letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', opacity: 0.85,
              }}>
                {r.isPast ? 'Past race' : `${r.priority} race`} · {distLabel(r.distanceMi)}{!r.isPast ? ` · ${awayLabel(r.daysAway)}` : ''}
              </div>
              <div style={{ display: 'flex', gap: 'var(--sp-5)', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {!r.isPast && (
                  <Badge tone={goalKnown ? 'signal' : 'quiet'}>{goalKnown ? 'Goal set' : 'No goal set'}</Badge>
                )}
                {!r.isPast && r.registered === true && <Badge tone="signal">Registered</Badge>}
                {r.isPast && r.pb && <Badge tone="signal">Personal best</Badge>}
                {r.isPast && isProvisional && <Badge tone="attention">{provisionalLabel}</Badge>}
              </div>
            </div>
            <div className="faff-display" style={{ fontSize: 'var(--type-display-1)', lineHeight: 0.92, marginTop: 'var(--sp-7)' }}>
              {r.name.split(' ').map((w, i) => <span key={i}>{w}<br /></span>)}
            </div>
            <div style={{ marginTop: 'auto', display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 'var(--sp-7)' }}>
              {(r.isPast
                ? [
                    [formatDateFull(r.date), 'Race day'],
                    [r.finishTime || 'Not logged', 'Finish time'],
                    [gap ? gap.text : (goalKnown ? r.aGoal : 'No goal set'), gap ? (gap.under ? 'Under goal' : 'Over goal') : 'Your goal'],
                  ]
                : [
                    [formatDateFull(r.date), 'Race day'],
                    [goalKnown ? r.aGoal : 'Not set', 'Your goal'],
                    [r.effectiveGoal, r.effectiveSource === 'projection' ? 'Projected' : 'Holding goal'],
                  ]
              ).map(([v, l]) => (
                <div key={l}>
                  <div className="faff-value" style={{ fontSize: 'var(--type-value-3)' }}>{v}</div>
                  <div style={{
                    fontFamily: 'var(--font-sub)', fontSize: 'var(--type-label-s)', fontWeight: 'var(--weight-label)',
                    letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', marginTop: 4, opacity: 0.85,
                  }}>{l}</div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Course — elevation profile (real geometry, format-converted;
              see elevPathToPoints) + notable miles (real, per-third course
              read from raceDetail.ts's notablesFromElevation). */}
          <Tile radius="l">
            <Section title={`Course · ${elevDirection(r.netElevFt)}`} right={r.course !== '·' ? r.course : null} />
            {elevPoints && (
              <ElevationProfile
                style={{ marginTop: 'var(--sp-7)' }}
                height={130}
                points={elevPoints}
                marks={marks}
                footnotes={[
                  `Net ${r.netElevFt > 0 ? '+' : ''}${r.netElevFt} ft`,
                  `Gain ${r.gainFt.toLocaleString()} ft`,
                ]}
              />
            )}
            {r.elevStartFt != null && r.elevFinishFt != null && (
              <div style={{ marginTop: 'var(--sp-5)', fontSize: 'var(--type-meta)', color: 'var(--text-quiet)' }}>
                Start {r.elevStartFt.toLocaleString()} ft → Finish {r.elevFinishFt.toLocaleString()} ft
              </div>
            )}
            {r.notables.length > 0 && (
              <div style={{ marginTop: 'var(--sp-9)', display: 'grid', gap: 'var(--sp-6)' }}>
                <div style={{ fontSize: 'var(--type-label-s)', color: 'var(--text-quiet)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-label)' }}>
                  Notable miles
                </div>
                {r.notables.map((n, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '56px minmax(0,1fr)', gap: 'var(--sp-6)', fontSize: 'var(--type-body-s)' }}>
                    <div style={{ color: 'var(--text-quiet)', fontVariantNumeric: 'tabular-nums' }}>{n.mi}</div>
                    <div style={{ color: 'var(--text-secondary)', lineHeight: 'var(--lh-body-s)' }} dangerouslySetInnerHTML={{ __html: n.tx }} />
                  </div>
                ))}
              </div>
            )}
          </Tile>

          {/* ── Route — real GPS shape via the live app's own RouteMap
              (Leaflet + CartoDB dark tiles), same reuse RunDetailClient
              already established for this redesign. Honest "no GPX yet"
              state instead of a placeholder map when routeLatLng is null. */}
          <Tile radius="l">
            <Section
              title="Route"
              right={
                r.courseSource === 'promoted' && r.contributorCount > 1
                  ? `Crowd-sourced · ${r.contributorCount} runners`
                  : r.routeLatLng ? 'GPX on file' : 'No GPX uploaded'
              }
            />
            <div style={{ marginTop: 'var(--sp-7)', height: 220, borderRadius: 'var(--radius-l)', overflow: 'hidden' }}>
              {r.routeLatLng && r.routeLatLng.length >= 2 ? (
                <RouteMap points={r.routeLatLng} splits={[]} height={220} />
              ) : (
                <div style={{
                  height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'var(--material-control)', fontSize: 'var(--type-label-s)', color: 'var(--text-quiet)',
                }}>
                  Route unavailable
                </div>
              )}
            </div>
            {(r.courseStartLabel || r.courseFinishLabel || r.courseNotes) && (
              <div style={{ marginTop: 'var(--sp-7)', display: 'grid', gap: 'var(--sp-5)' }}>
                {r.courseStartLabel && <Ctx label="Start">{r.courseStartLabel}</Ctx>}
                {r.courseFinishLabel && <Ctx label="Finish">{r.courseFinishLabel}</Ctx>}
                {r.courseNotes && <Ctx label="Notes">{r.courseNotes}</Ctx>}
              </div>
            )}
          </Tile>

          {/* ── Upcoming-only: plan against the goal. "Fitness gap" dropped
              — the mock's "+5.2 VDOT needed... arrives week 15 of 20" has
              no real field anywhere in RaceDetailSeed (fitness-trajectory.ts
              exists but is explicitly unwired per project memory; wiring it
              here would be new integration work, not a port). Replaced with
              the seed's real r.insight (raceDetail.ts's insightFor() —
              distance + net-elevation-derived coach copy), the honest
              substitute in the same slot RunDetailClient used for its own
              dropped fabricated Effort score. */}
          {!r.isPast && (
            <Tile radius="l">
              <Section title="The plan against the goal" />
              <div style={{ marginTop: 'var(--sp-3)' }}>
                <Ctx label="Pace">
                  {r.effectiveSource === 'projection'
                    ? <>{r.goalPace}/mi holds the projected {r.effectiveGoal}. {r.stretchGoal ? <>Your goal of {r.stretchGoal} rides along as the stretch.</> : null}</>
                    : goalKnown
                      ? <>{r.goalPace}/mi holds your goal of {r.aGoal}.</>
                      : 'Set a goal time to see the pace this course asks for.'}
                </Ctx>
                <Ctx label="Insight">
                  <span dangerouslySetInnerHTML={{ __html: r.insight }} />
                </Ctx>
              </div>
            </Tile>
          )}

          {/* ── Upcoming-only: pacing plan (real, course/goal-aware blocks
              from lib/race/race-detail-pacing.ts). Bar rendered via
              RangeScale progress mode on a single `race` hue rather than
              the legacy per-block hex (#3EBD41 etc.) race-detail-pacing.ts
              still carries internally — matching the Activity screen's own
              precedent of never reusing un-tokenized legacy hex in the new
              design system. */}
          {!r.isPast && r.pacing.length > 0 && (
            <Tile radius="l">
              <Section title="Pacing plan" right={`${r.effectiveGoal} · ${r.goalPace}/mi avg · ${r.effectiveSource === 'projection' ? 'from projection' : 'your goal'}`} />
              <div style={{ marginTop: 'var(--sp-7)', display: 'grid', gap: 'var(--sp-8)' }}>
                {r.pacing.map((p, i) => (
                  <div key={i}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--type-body-s)' }}>
                      <span style={{ color: 'var(--text-primary)' }}>{p.seg}<span style={{ color: 'var(--text-quiet)', marginLeft: 8 }}>{p.sub}</span></span>
                      <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-secondary)' }}>{p.pace}/mi · {p.cum}</span>
                    </div>
                    <RangeScale style={{ marginTop: 'var(--sp-4)' }} mode="progress" min={0} max={100} value={p.bar} hue="race" size="s" showEnds={false} />
                  </div>
                ))}
              </div>
              {r.splits.length > 0 && (
                <div style={{ marginTop: 'var(--sp-9)', display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-8)', boxShadow: 'inset 0 1px 0 var(--rule-light)', paddingTop: 'var(--sp-7)' }}>
                  {r.splits.map((s) => (
                    <Stat key={s.label} label={s.label} value={s.val} size="sm" />
                  ))}
                </div>
              )}
            </Tile>
          )}

          {/* ── Upcoming-only: fueling plan. Rate + gel count are real,
              distance/duration-derived (computeRaceFueling, Research/18
              §11) — never a flat marathon number stamped on every
              distance. preRace/hydration are the app's standing default
              copy (same status quo the live page labels "Standard plan"). */}
          {!r.isPast && (r.gels.length > 0 || r.fuelTargetGPerHr > 0) && (
            <Tile radius="l">
              <Section title="Fueling plan" right={r.gels.length > 0 ? `~${r.fuelTargetGPerHr}g carbs/hr · ${r.gels.length} gels` : 'No on-course fuel needed'} />
              {r.gels.length > 0 && (
                <div style={{ marginTop: 'var(--sp-7)', display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-5)' }}>
                  {r.gels.map((g, i) => (
                    <Badge key={i} tone={g.caf ? 'attention' : 'neutral'}>{g.mi}</Badge>
                  ))}
                </div>
              )}
              <div style={{ marginTop: 'var(--sp-3)' }}>
                <Ctx label="Pre-race">{r.preRace}</Ctx>
                <Ctx label="On course">{r.onCourse}</Ctx>
                <Ctx label="Hydration">{r.hydration}</Ctx>
              </div>
            </Tile>
          )}

          {/* ── Upcoming-only: logistics. Shuttle/pickup are permanently
              '·' in raceDetail.ts (no backend field feeds them yet) — shown
              as "Not set" rather than a bare '·', matching the same honesty
              convention raceDetail.ts/RaceView.tsx already use for an
              unset goal pace, not silently dropped (the values ARE real
              fields on the seed, just usually empty). */}
          {!r.isPast && (
            <Tile radius="l">
              <Section title="Race logistics" right="Saved to your race plan" />
              <div style={{ marginTop: 'var(--sp-3)' }}>
                <Ctx label="Start">{r.start.time !== '·' ? r.start.time : 'Not set'}{r.start.detail !== '·' ? ` · ${r.start.detail}` : ''}</Ctx>
                <Ctx label="Shuttle">{r.shuttle.value !== '·' ? r.shuttle.value : 'Not set'}</Ctx>
                <Ctx label="Pickup">{r.pickup.value !== '·' ? r.pickup.value : 'Not set'}</Ctx>
                <Ctx label="Finish">{r.finish.value !== '·' ? r.finish.value : 'Not set'}</Ctx>
              </div>
              {r.website && (
                <div style={{ marginTop: 'var(--sp-7)' }}>
                  <a href={r.website} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-secondary)', fontSize: 'var(--type-body-s)' }}>
                    Official race site ↗
                  </a>
                </div>
              )}
            </Tile>
          )}

          {/* ── Past-only: the race story. Phase-by-phase target vs actual
              from lib/race/retrospective.ts's RaceRetro — the same
              actual_result-sourced payload the live RaceRetrospective
              component renders, recomposed here with only this screen's
              declared primitives instead of the old design system's
              component. Renders only when buildRaceRetro succeeded (retro
              is null on any failure — raceDetail.ts already swallows that
              and this file does not retry or reconstruct it). */}
          {r.isPast && r.retro && r.retro.phases.length > 0 && (
            <Tile radius="l">
              <Section title="The race story" right={r.retro.milesSource === 'watch' ? 'From watch data' : undefined} />
              <div style={{ marginTop: 'var(--sp-7)', display: 'grid', gap: 'var(--sp-6)' }}>
                {r.retro.phases.map((p: RetroPhase, i: number) => {
                  const tone: BadgeTone = p.status ? (PHASE_STATUS_TONE[p.status] ?? 'quiet') : 'quiet';
                  return (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 'var(--sp-6)', alignItems: 'baseline' }}>
                      <div>
                        <div style={{ fontSize: 'var(--type-body-s)', color: 'var(--text-primary)' }}>{p.label}</div>
                        {p.note && <div style={{ fontSize: 'var(--type-meta)', color: 'var(--text-quiet)', marginTop: 2 }}>{p.note}</div>}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-5)' }}>
                        <span style={{ fontSize: 'var(--type-body-s)', fontVariantNumeric: 'tabular-nums', color: 'var(--text-secondary)' }}>
                          {p.actualDisplay ?? '·'}{p.targetDisplay ? ` vs ${p.targetDisplay} target` : ''}
                        </span>
                        {p.status && <Badge tone={tone}>{p.deltaDisplay ?? p.status}</Badge>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Tile>
          )}

          {/* ── Past-only: what it means — VDOT + projection movement off
              this result, real fields straight from RaceRetro. */}
          {r.isPast && r.retro && (r.retro.vdotRace != null || r.avgHrBpm != null) && (
            <Tile radius="l">
              <Section title="What it means" right={isProvisional && (
                <span style={{ color: 'var(--fault)' }}>{provisionalLabel.toLowerCase()}</span>
              )} />
              {/* 2026-08-18 · caveat added — the VDOT/projection/pace numbers
                  below derive from finishS, which can itself be an
                  unconfirmed run_match/watch fallback (races-state.ts). The
                  live RaceRetrospective.tsx co-locates this exact caveat with
                  its own VDOT tile (WHAT IT MEANS header, "watch time ·
                  provisional") — this port had the hero + Result-tile badges
                  but was missing it here, so an unconfirmed finish could
                  silently drive a displayed VDOT with no local caveat. */}
              <div style={{ marginTop: 'var(--sp-7)', display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-9)' }}>
                {r.retro.vdotRace != null && (
                  <Stat label="VDOT from this race" value={r.retro.vdotRace.toFixed(1)}
                    sub={r.retro.vdotBefore != null ? `${r.retro.vdotBefore.toFixed(1)} before` : undefined} size="sm" />
                )}
                {r.retro.projAfterSec != null && (
                  <Stat label="Marathon projection" value={formatRaceTime(r.retro.projAfterSec) ?? '·'}
                    sub={r.retro.projBeforeSec != null ? `${formatRaceTime(r.retro.projBeforeSec)} before` : undefined} size="sm" />
                )}
                {(r.avgHrBpm != null || r.retro.avgHr != null) && (
                  <Stat label="Average HR" value={Math.round(r.avgHrBpm ?? r.retro.avgHr ?? 0)} unit="bpm" size="sm" />
                )}
                {r.retro.avgPaceSPerMi != null && (
                  <Stat label="Average pace" value={formatRaceTime(r.retro.avgPaceSPerMi) ?? '·'} unit="/mi" size="sm" />
                )}
              </div>
            </Tile>
          )}

          {/* ── Past-only: what's next — real next-A-race handoff
              (raceDetail.ts's nextARace/bridgeRaces, computed off the
              races-state calendar, not a guess). Recovery/bridge/training
              windows are the same fixed 14/28-day protocol RaceView.tsx's
              RacePlanHandoff already states in prose — no engine call, just
              date arithmetic on real dates. */}
          {r.isPast && r.finishTime && r.nextARace && (
            <Tile radius="l">
              <Section title="What's next" />
              <div style={{ marginTop: 'var(--sp-6)' }}>
                <div style={{ fontSize: 'var(--type-body)', color: 'var(--text-primary)' }}>{r.nextARace.name}</div>
                <div style={{ fontSize: 'var(--type-label-s)', color: 'var(--text-quiet)', marginTop: 2 }}>
                  {monDay(r.nextARace.date)}{r.nextARace.distanceMi ? ` · ${distLabel(r.nextARace.distanceMi)}` : ''}
                </div>
              </div>
              <div style={{ marginTop: 'var(--sp-7)' }}>
                {[
                  { label: 'Recovery', dates: `${monDay(r.date)} – ${monDay(addDaysISO(r.date, 14))}`, note: '14 days easy only, no quality' },
                  { label: 'Bridge', dates: `${monDay(addDaysISO(r.date, 14))} – ${monDay(addDaysISO(r.date, 28))}`, note: 'aerobic base, strides, fartlek' },
                  { label: 'Training', dates: `${monDay(addDaysISO(r.date, 28))} – ${monDay(r.nextARace.date)}`, note: 'specific prep to race day' },
                ].map((row) => <Ctx key={row.label} label={row.label}>{row.dates} · {row.note}</Ctx>)}
              </div>
            </Tile>
          )}
        </div>

        <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
          {/* ── Race admin — real 4-item checklist derived from the seed's
              own registered/bib/wave/startTime fields (upcoming races
              only). The mock's identical Progress usage
              (`value={1} max={4} label="Ready to race" tail="1 of 4"`) had
              a hand-picked count with no field behind it; this counts the
              same four things the hero chips already show, honestly. */}
          {!r.isPast && (() => {
            const items: Array<[string, boolean]> = [
              ['Registered', r.registered === true],
              ['Bib assigned', r.bib !== '#pending'],
              ['Wave set', r.wave !== '·'],
              ['Start time known', r.startTime !== '·'],
            ];
            const done = items.filter(([, ok]) => ok).length;
            return (
              <Tile>
                <Section title="Race admin" />
                <div style={{ marginTop: 'var(--sp-7)', display: 'grid', gap: 'var(--sp-6)' }}>
                  <Progress value={done} max={items.length} label="Ready to race" tail={`${done} of ${items.length}`} />
                  <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
                    {items.map(([label, ok]) => (
                      <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--type-body-s)' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
                        <span style={{ color: ok ? 'var(--text-primary)' : 'var(--text-quiet)' }}>{ok ? 'Done' : 'Open'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </Tile>
            );
          })()}

          {/* ── Certification / bib / wave / gun — read-only summary of the
              same chip row RaceView.tsx makes editable; this page doesn't
              wire mutation, so it's plain text. */}
          {!r.isPast && (
            <Tile>
              <Section title="Race details" />
              <div style={{ marginTop: 'var(--sp-3)' }}>
                {r.certification !== '·' && <Ctx label="Cert">{r.certification}</Ctx>}
                <Ctx label="Bib">{r.bib !== '#pending' ? r.bib : 'Not assigned'}</Ctx>
                <Ctx label="Wave">{r.wave !== '·' ? r.wave : 'Not set'}</Ctx>
                <Ctx label="Gun time">{r.startTime !== '·' ? r.startTime : 'Not set'}</Ctx>
              </div>
            </Tile>
          )}

          {r.isPast && (
            <Tile>
              <Section title="Result" />
              <div style={{ marginTop: 'var(--sp-6)' }}>
                <Stat label="Finish" value={r.finishTime ?? 'Not logged'} size="md" tone={isProvisional ? 'attention' : 'primary'} />
                {isProvisional && (
                  <div style={{ marginTop: 'var(--sp-5)', fontSize: 'var(--type-meta)', color: 'var(--attention)' }}>
                    {provisionalLabel} — unconfirmed, resolves from Strava until the chip time is entered.
                  </div>
                )}
                {r.retro?.finishSource === 'actual_result' && (
                  <div style={{ marginTop: 'var(--sp-5)', fontSize: 'var(--type-meta)', color: 'var(--text-quiet)' }}>
                    Chip time on file.
                  </div>
                )}
              </div>
              {(r.retroFelt || r.retroExecution || r.retroNotes) && (
                <div style={{ marginTop: 'var(--sp-7)' }}>
                  {r.retroFelt && <Ctx label="Felt">{r.retroFelt}</Ctx>}
                  {r.retroExecution && <Ctx label="Execution">{r.retroExecution}</Ctx>}
                  {r.retroNotes && <Ctx label="Notes">{r.retroNotes}</Ctx>}
                </div>
              )}
            </Tile>
          )}
        </div>
      </div>
    </div>
  );
}
