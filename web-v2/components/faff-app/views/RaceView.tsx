'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { FaffSeed } from '../types';
import { CountdownLadder, CourseAnnotations, MARATHON_COUNTDOWN, StateChangeToast } from '../toolkit';
import { RouteMap } from '../RouteMap';
import { RaceRetrospectiveForm } from '@/components/races/RaceRetrospectiveForm';
import { parseRaceTime } from '@/lib/training/vdot';

interface RecalcResult {
  vdotBefore?: number | null;
  vdotAfter?: number | null;
  lthrBefore?: number | null;
  lthrAfter?: number | null;
  lthrMethod?: string;
}

/** 2026-06-01 · auto-rebuild result from PATCH /api/race. Backend fires
 *  fireAutoRebuild when race date, goal time, or A-race priority changes,
 *  rewriting plan_workouts atomically. See
 *  designs/briefs/backend-state-2026-06-01-landed.md §"Hooks that fire". */
interface AutoRebuildResult {
  kind: 'race_date_changed' | 'goal_time_changed' | 'a_race_added' | 'a_race_removed' | string;
  oldPlanId: string | null;
  newPlanId: string | null;
  ok: boolean;
  reason: string;
}

async function patchRace(
  slug: string,
  payload: Record<string, unknown>
): Promise<{ ok: boolean; recalc: RecalcResult | null; autoRebuild: AutoRebuildResult | null }> {
  try {
    const res = await fetch('/api/race', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, ...payload }),
    });
    if (!res.ok) return { ok: false, recalc: null, autoRebuild: null };
    const j = await res.json().catch(() => ({}));
    return {
      ok: true,
      recalc: (j?.recalc ?? null) as RecalcResult | null,
      autoRebuild: (j?.autoRebuild ?? null) as AutoRebuildResult | null,
    };
  } catch { return { ok: false, recalc: null, autoRebuild: null }; }
}

export type RaceDetailSeed = {
  slug: string;
  name: string;
  date: string;
  startTime: string;
  course: string;
  certification: string;
  // 2026-06-02: A/B/C race priority. Editable from the race detail page
  // via the priority chip; PATCH /api/race fires the auto-rebuild hook
  // when this changes (A → B/C demotes the plan, B/C → A promotes).
  priority: 'A' | 'B' | 'C';
  registered: boolean;
  bib: string;
  wave: string;
  daysAway: number;
  // 2026-05-30: post-race retro support. When isPast is true, the hero
  // swaps to a RESULT widget where the runner enters finish time + PB,
  // persisted to races.actual_result via PATCH /api/race.
  isPast: boolean;
  finishTime: string | null;
  pb: boolean;
  distanceMi: number;
  netElevFt: number;
  gainFt: number;
  goalPace: string;
  aGoal: string;
  bGoal: string;
  pacing: Array<{ seg: string; sub: string; bar: number; barColor: string; pace: string; cum: string }>;
  splits: Array<{ label: string; val: string }>;
  gels: Array<{ mi: string; left: number; caf?: boolean }>;
  preRace: string;
  onCourse: string;
  hydration: string;
  notables: Array<{ mi: string; tx: string }>;
  insight: string;
  start: { time: string; detail: string };
  shuttle: { value: string; detail: string };
  pickup: { value: string; detail: string };
  finish: { value: string; detail: string };
  elevPath: string;
  // 2026-05-30: real route shape projected from course_geometry trackPoints.
  // null when GPX hasn't been uploaded for this race — the map renders an
  // "Route unavailable" panel instead of the old hardcoded zigzag.
  routePath: string | null;
  routeStart: [number, number] | null;
  routeEnd: [number, number] | null;
  // 2026-06-02: raw lat/lng (thinned to ≤500 pts) for the Leaflet terrain
  // map. Lets the route panel use the same CartoDB tiles as the post-run
  // map instead of the abstract grid pattern. Null when no GPX is on file.
  routeLatLng: Array<[number, number]> | null;
  /** course_library provenance (migration 127). When source='promoted' AND
   *  contributorCount > 1 the course was crowd-sourced from N runners'
   *  uploads — surface that on the route panel as social proof. */
  courseSource: string | null;
  contributorCount: number;
  /** Editorial annotations from course_library (the 4 curated rows:
   *  americas-finest-city, big-sur-marathon, cim, sombrero-half).
   *  Null on crowd-sourced + stub courses. Drives CourseAnnotations
   *  toolkit render under THE COURSE block. */
  courseStartLabel?: string | null;
  courseFinishLabel?: string | null;
  courseNotes?: string | null;
  // Retrospective fields (past races) — persisted to races.meta via PATCH /api/race.
  avgHrBpm?: number | null;
  retroFelt?: string | null;
  retroExecution?: string | null;
  retroNotes?: string | null;
  // Post-race handoff: next upcoming A race after this one + any B/C tune-ups
  // between this race and that next A race. Drives the WHAT'S NEXT block.
  nextARace?: { slug: string; name: string; date: string; distanceMi: number | null } | null;
  bridgeRaces?: Array<{ name: string; date: string; daysBeforeNextA: number }>;
};

const FALLBACK: RaceDetailSeed = {
  slug: 'race', name: 'Race', date: '', startTime: '·',
  course: '·', certification: '·',
  priority: 'A',
  registered: false, bib: '·', wave: '·',
  daysAway: 0, isPast: false, finishTime: null, pb: false,
  distanceMi: 0, netElevFt: 0, gainFt: 0, goalPace: '·',
  aGoal: '·', bGoal: '·',
  pacing: [],
  splits: [],
  gels: [],
  preRace: '·', onCourse: '·', hydration: '·',
  notables: [],
  insight: 'Race details will appear here once the GPX and goal time are confirmed.',
  start:   { time: '·', detail: '·' },
  shuttle: { value: '·', detail: '·' },
  pickup:  { value: '·', detail: '·' },
  finish:  { value: '·', detail: '·' },
  elevPath: 'M0,58 L40,40 L80,70 L120,46 L160,78 L200,54 L240,86 L280,68 L320,96 L360,84 L400,104 L440,96 L480,112 L520,108 L560,120 L600,116 L640,128',
  routePath: null,
  routeStart: null,
  routeEnd: null,
  routeLatLng: null,
  courseSource: null,
  contributorCount: 0,
  avgHrBpm: null, retroFelt: null, retroExecution: null, retroNotes: null,
  nextARace: null, bridgeRaces: [],
};

export function RaceView({ seed: _seed, race, onBack }: { seed: FaffSeed; race?: RaceDetailSeed; onBack: () => void }) {
  const r = race ?? FALLBACK;
  const router = useRouter();
  // 2026-06-02 · normalize the incoming goal strings so a stored "1:30:00"
  // never renders as "1:30:00" then snaps to "1:30" on blur. Goal times are
  // H:MM only — seconds are noise on an aspirational target. Finish times
  // (line ~265) still keep seconds via fmtHMS.
  const [aGoal, setAGoal] = useState(normalizeGoalTime(r.aGoal));
  const [bGoal, setBGoal] = useState(normalizeGoalTime(r.bGoal));
  const [bib, setBib] = useState(r.bib);
  const [wave, setWave] = useState(r.wave);
  const [startTime, setStartTime] = useState(r.startTime);
  const [goalPace, setGoalPace] = useState(r.goalPace);
  // 2026-06-02 · priority editor. A/B/C drives the eyebrow label and PATCH
  // /api/race fires the auto-rebuild hook when this changes (A↔B/C).
  const [priority, setPriority] = useState<'A' | 'B' | 'C'>(r.priority ?? 'A');
  // 2026-05-30: post-race retro state. Hero swaps to a result card when
  // race.isPast — finishTime free-text edit (HMS) + PB toggle persist to
  // races.actual_result via PATCH /api/race.
  const [finishTime, setFinishTime] = useState(r.finishTime ?? '');
  const [pb, setPb] = useState(r.pb);
  const [savingFinish, setSavingFinish] = useState(false);
  const [finishAck, setFinishAck] = useState<'saved' | 'error' | null>(null);
  // 2026-06-02 · GPX upload. Triggers a hidden <input type="file">, POSTs
  // multipart/form-data to /api/race/gpx, then router.refresh() so the new
  // routePath + course annotations land without a hard reload.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingGpx, setUploadingGpx] = useState(false);
  const [gpxAck, setGpxAck] = useState<'saved' | 'error' | null>(null);

  async function commitA(text: string) {
    const sec = parseHMS(text);
    if (sec <= 0) { setAGoal(normalizeGoalTime(r.aGoal)); return; }
    const next = fmtHM(sec);
    setAGoal(next);
    setGoalPace(sec2pace(sec));
    const { autoRebuild } = await patchRace(r.slug, { goal: next });
    if (autoRebuild?.ok) setAutoRebuildToast(autoRebuild);
  }
  async function commitB(text: string) {
    const sec = parseHMS(text);
    if (sec <= 0) { setBGoal(normalizeGoalTime(r.bGoal)); return; }
    const next = fmtHM(sec);
    setBGoal(next);
    const { autoRebuild } = await patchRace(r.slug, { goal_safe: next });
    if (autoRebuild?.ok) setAutoRebuildToast(autoRebuild);
  }
  async function commitPriority(next: 'A' | 'B' | 'C') {
    if (next === priority) return;
    setPriority(next);
    const { autoRebuild } = await patchRace(r.slug, { priority: next });
    if (autoRebuild?.ok) setAutoRebuildToast(autoRebuild);
  }
  async function uploadGpx(file: File) {
    setUploadingGpx(true);
    try {
      const fd = new FormData();
      fd.append('slug', r.slug);
      fd.append('file', file);
      const res = await fetch('/api/race/gpx', { method: 'POST', body: fd });
      if (res.ok) {
        setGpxAck('saved');
        // refresh the server component so routePath + course annotations
        // re-render from the freshly-stored course_geometry.
        router.refresh();
      } else {
        setGpxAck('error');
      }
    } catch {
      setGpxAck('error');
    } finally {
      setUploadingGpx(false);
      setTimeout(() => setGpxAck(null), 2400);
    }
  }
  function pickGpx() {
    fileInputRef.current?.click();
  }
  function onGpxInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) void uploadGpx(f);
    // reset so picking the same file twice still fires onChange
    e.target.value = '';
  }
  function commitBib(text: string) {
    const next = (text || '').trim() || r.bib;
    setBib(next);
    void patchRace(r.slug, { bib: next });
  }
  function commitWave(text: string) {
    const next = (text || '').trim() || r.wave;
    setWave(next);
    void patchRace(r.slug, { wave: next });
  }
  function commitStartTime(text: string) {
    const next = (text || '').trim() || r.startTime;
    setStartTime(next);
    void patchRace(r.slug, { startTime: next });
  }
  // Recalc deltas returned by the race PATCH (when finishTime + avgHrBpm
  // were both set, the backend auto-recalcs VDOT + LTHR). Surfaced via
  // StateChangeToast for ~5s after a save lands. Closes line 1228.
  const [recalcToast, setRecalcToast] = useState<RecalcResult | null>(null);
  useEffect(() => {
    if (!recalcToast) return;
    const t = setTimeout(() => setRecalcToast(null), 5500);
    return () => clearTimeout(t);
  }, [recalcToast]);
  // 2026-06-01 · plan auto-rebuild notification. Fires when PATCH /api/race
  // returns autoRebuild in the response · goal time, race date, or A-race
  // priority change rewrites plan_workouts atomically on the backend. Same
  // information also lands in seed.planProposals on next refresh, but this
  // surfaces immediately so the runner doesn't wonder why their plan
  // changed between two views. 7s auto-dismiss matches recalcToast
  // pattern. Closes brief §"Hooks that fire on user actions".
  const [autoRebuildToast, setAutoRebuildToast] = useState<AutoRebuildResult | null>(null);
  useEffect(() => {
    if (!autoRebuildToast) return;
    const t = setTimeout(() => setAutoRebuildToast(null), 7000);
    return () => clearTimeout(t);
  }, [autoRebuildToast]);

  async function commitFinish(text: string) {
    const trimmed = (text || '').trim();
    // Normalize anything HMS-shaped to canonical H:MM:SS. Empty clears it.
    const normalized = trimmed === '' ? null : (parseHMS(trimmed) > 0 ? fmtHMS(parseHMS(trimmed)) : trimmed);
    setFinishTime(normalized ?? '');
    setSavingFinish(true);
    const { ok, recalc } = await patchRace(r.slug, { finishTime: normalized });
    setSavingFinish(false);
    setFinishAck(ok ? 'saved' : 'error');
    setTimeout(() => setFinishAck(null), 1800);
    if (recalc && (recalc.vdotAfter != null || recalc.lthrAfter != null)) {
      setRecalcToast(recalc);
    }
  }
  async function commitPb(next: boolean) {
    setPb(next);
    setSavingFinish(true);
    const { ok } = await patchRace(r.slug, { pb: next });
    setSavingFinish(false);
    setFinishAck(ok ? 'saved' : 'error');
    setTimeout(() => setFinishAck(null), 1800);
  }

  return (
    <>
      <div className="rp-back" onClick={onBack} role="button" tabIndex={0}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
        TARGETS
      </div>

      <div className="rp-hero">
        <div>
          <div className="rp-eyebrow">{r.isPast ? 'PAST RACE' : `${priority} RACE`} · {distLabel(r.distanceMi)}</div>
          <div className="rp-title">{r.name.split(' ').map((w, i) => <span key={i}>{w}<br/></span>)}</div>
          <div className="rp-meta">
            <span><b>{formatDateFull(r.date)}</b>{r.isPast ? '' : ' · ' + startTime}</span>
            <span>{r.course}</span>
            <span>{r.certification}</span>
          </div>
          <div className="rp-chips">
            {!r.isPast && (
              <div
                className="rp-chip"
                role="radiogroup"
                aria-label="Race priority"
                style={{ gap: 4, padding: '4px 6px 4px 12px' }}
              >
                <span style={{ opacity: 0.7 }}>Priority</span>
                {(['A', 'B', 'C'] as const).map((p) => {
                  const active = p === priority;
                  return (
                    <button
                      key={p}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => commitPriority(p)}
                      title={p === 'A' ? 'A race · goal' : p === 'B' ? 'B race · tune-up' : 'C race · workout'}
                      style={{
                        fontFamily: 'inherit', fontWeight: 800, letterSpacing: 'inherit',
                        fontSize: 'inherit', textTransform: 'inherit', lineHeight: 1,
                        width: 24, height: 24, borderRadius: 7, padding: 0, cursor: 'pointer',
                        background: active ? 'var(--ink, #fff)' : 'transparent',
                        color: active ? 'var(--bg, #10131A)' : 'inherit',
                        border: active ? 'none' : '1px solid var(--glass-line, rgba(255,255,255,.22))',
                        opacity: active ? 1 : 0.65,
                        transition: 'background 120ms, color 120ms, opacity 120ms',
                      }}
                    >{p}</button>
                  );
                })}
              </div>
            )}
            {!r.isPast && r.registered && (
              <div className="rp-chip reg">
                <svg viewBox="0 0 24 24" fill="none" stroke="#7BE8A0" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
                Registered
              </div>
            )}
            {r.isPast && pb && (
              <div className="rp-chip reg">
                <svg viewBox="0 0 24 24" fill="none" stroke="#7BE8A0" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/></svg>
                Personal best
              </div>
            )}
            {!r.isPast && (
              <div className="rp-chip">
                Bib{' '}
                <span
                  className="chip-edit"
                  contentEditable
                  suppressContentEditableWarning
                  spellCheck={false}
                  onBlur={(e) => commitBib(e.currentTarget.textContent || '')}
                >{bib}</span>
              </div>
            )}
            {!r.isPast && (
              <div className="rp-chip">
                Wave{' '}
                <span
                  className="chip-edit"
                  contentEditable
                  suppressContentEditableWarning
                  spellCheck={false}
                  onBlur={(e) => commitWave(e.currentTarget.textContent || '')}
                >{wave}</span>
              </div>
            )}
            {!r.isPast && (
              <div className="rp-chip">
                Gun{' '}
                <span
                  className="chip-edit"
                  contentEditable
                  suppressContentEditableWarning
                  spellCheck={false}
                  onBlur={(e) => commitStartTime(e.currentTarget.textContent || '')}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.currentTarget as HTMLElement).blur(); } }}
                >{startTime}</span>
              </div>
            )}
          </div>
        </div>
        <div>
          {r.isPast ? (
            <div className="rp-count">
              <div
                className="rp-countn edit"
                contentEditable
                suppressContentEditableWarning
                spellCheck={false}
                onBlur={(e) => commitFinish(e.currentTarget.textContent || '')}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.currentTarget as HTMLElement).blur(); } }}
                style={{ fontSize: finishTime ? undefined : 38, opacity: finishTime ? 1 : 0.6 }}
              >{finishTime || 'Tap to log'}</div>
              <div className="rp-countl">
                FINISH TIME
                {savingFinish && <span style={{ marginLeft: 8, color: 'var(--mute)' }}> · saving</span>}
                {finishAck === 'saved' && <span style={{ marginLeft: 8, color: 'var(--green)' }}> · saved</span>}
                {finishAck === 'error' && <span style={{ marginLeft: 8, color: 'var(--over)' }}> · retry</span>}
              </div>
              <div className="rp-goals">
                <div className="rp-goal a">
                  <div className="gk">A · GOAL</div>
                  <div className="gv">{aGoal}</div>
                </div>
                <div className="rp-goal gd" />
                <div
                  className="rp-goal"
                  onClick={() => commitPb(!pb)}
                  role="button"
                  tabIndex={0}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="gk">PR?</div>
                  <div className="gv" style={{ color: pb ? 'var(--green)' : 'var(--mute)' }}>{pb ? 'YES' : 'NO'}</div>
                </div>
              </div>
            </div>
          ) : (
            <div className="rp-count">
              <div className="rp-countn">{r.daysAway}</div>
              <div className="rp-countl">DAYS TO GO</div>
              <div className="rp-goals">
                <div className="rp-goal a">
                  <div className="gk">A · GOAL</div>
                  <div
                    className="gv edit"
                    contentEditable
                    suppressContentEditableWarning
                    spellCheck={false}
                    onBlur={(e) => commitA(e.currentTarget.textContent || '')}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.currentTarget as HTMLElement).blur(); } }}
                  >{aGoal}</div>
                </div>
                <div className="rp-goal gd" />
                <div className="rp-goal">
                  <div className="gk">B · SAFE</div>
                  <div
                    className="gv edit"
                    contentEditable
                    suppressContentEditableWarning
                    spellCheck={false}
                    onBlur={(e) => commitB(e.currentTarget.textContent || '')}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.currentTarget as HTMLElement).blur(); } }}
                  >{bGoal}</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="rp-stripstats">
        <div className="rp-ss"><div className="k">DISTANCE</div><div className="v">{r.distanceMi}<small> mi</small></div></div>
        <div className="rp-ss"><div className="k">NET ELEVATION</div><div className="v down">{r.netElevFt > 0 ? `+${r.netElevFt}` : r.netElevFt}<small> ft</small></div></div>
        <div className="rp-ss"><div className="k">TOTAL GAIN</div><div className="v">+{r.gainFt.toLocaleString()}<small> ft</small></div></div>
        <div className="rp-ss"><div className="k">GOAL PACE</div><div className="v">{goalPace}<small>/mi</small></div></div>
      </div>

      {/* Retrospective form · past races only. Writes actual_result.finishS via
          POST /api/race/result (canonical) and retro fields via PATCH /api/race. */}
      {r.isPast && (
        <div className="band">
          <div className="rp-sec">RETROSPECTIVE</div>
          <RaceRetrospectiveForm
            slug={r.slug}
            existing={{
              finishTime: finishTime || null,
              pb,
              avgHrBpm: r.avgHrBpm ?? null,
              retroFelt: r.retroFelt ?? null,
              retroExecution: r.retroExecution ?? null,
              retroNotes: r.retroNotes ?? null,
            }}
          />
        </div>
      )}

      {/* Race week countdown · only renders inside T-7 → T-0 window. */}
      {!r.isPast && r.daysAway >= 0 && r.daysAway <= 7 ? (
        <div className="band">
          <div className="rp-sec">RACE WEEK</div>
          <CountdownLadder entries={MARATHON_COUNTDOWN} today={r.daysAway} />
        </div>
      ) : null}

      <div className="rp-sec">
        THE COURSE
        <span className="rp-secr">
          {r.netElevFt < -100 ? 'Net downhill' : r.netElevFt > 100 ? 'Net uphill' : 'Net flat'}
          {r.courseSource === 'promoted' && r.contributorCount > 1 && (
            <span style={{
              marginLeft: 10, fontSize: 9, fontWeight: 800, letterSpacing: 1,
              color: '#9af0bf', border: '1px solid rgba(154,240,191,.4)',
              borderRadius: 5, padding: '2px 6px', textTransform: 'uppercase',
            }}>Crowd-sourced · {r.contributorCount} runners</span>
          )}
        </span>
      </div>
      <div className="rp-panel">
        <input
          ref={fileInputRef}
          type="file"
          accept=".gpx,application/gpx+xml,application/xml,text/xml"
          onChange={onGpxInputChange}
          style={{ display: 'none' }}
        />
        <div className="rp-elevhead">
          <div className="t">Route{r.course ? ` · ${r.course}` : ''}</div>
          <div className="s" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span>
              {uploadingGpx ? 'Uploading' :
                gpxAck === 'saved' ? 'GPX saved' :
                gpxAck === 'error' ? 'Upload failed · retry' :
                r.routePath ? 'GPX loaded' : 'No GPX yet'}
            </span>
            {!r.isPast && r.routePath ? (
              <button
                type="button"
                onClick={pickGpx}
                disabled={uploadingGpx}
                style={{
                  fontFamily: 'inherit', fontSize: 10, fontWeight: 700, letterSpacing: 1.4,
                  textTransform: 'uppercase', color: 'var(--ink, #fff)',
                  background: 'rgba(255,255,255,.07)', border: '1px solid var(--glass-line, rgba(255,255,255,.18))',
                  borderRadius: 10, padding: '5px 10px', cursor: uploadingGpx ? 'wait' : 'pointer',
                  opacity: uploadingGpx ? 0.6 : 1,
                }}
              >Replace</button>
            ) : null}
          </div>
        </div>
        {/* 2026-06-02 · two-column split. LEFT = the route, taller and
            more square inside its narrower column instead of wide-and-
            flat. RIGHT = start/finish labels + "what to expect" prose
            from CourseAnnotations. Better aspect for marathon courses,
            and pulls the wordy stuff out from under the map.
            On editorial courses (start/finish/notes present) we split
            the panel; on stub courses with no annotations the map gets
            the full width so it doesn't sit half-empty. */}
        {(r.courseStartLabel || r.courseFinishLabel || r.courseNotes) ? (
          <div style={{
            display: 'grid', gridTemplateColumns: 'minmax(0, 1.55fr) minmax(0, 1fr)',
            gap: 16, alignItems: 'stretch',
          }}>
            <RouteMapBlock
              routeLatLng={r.routeLatLng}
              height={240}
              uploadingGpx={uploadingGpx}
              pickGpx={pickGpx}
            />
            <div style={{
              background: 'rgba(255,255,255,.03)',
              border: '1px solid var(--glass-line, rgba(255,255,255,.12))',
              borderRadius: 12, padding: '14px 16px',
              display: 'flex', flexDirection: 'column', gap: 10,
            }}>
              <CourseAnnotations
                startLabel={r.courseStartLabel}
                finishLabel={r.courseFinishLabel}
                notes={r.courseNotes}
              />
            </div>
          </div>
        ) : (
          <RouteMapBlock
            routeLatLng={r.routeLatLng}
            height={240}
            uploadingGpx={uploadingGpx}
            pickGpx={pickGpx}
          />
        )}
      </div>

      <div className="rp-2col">
        <div className="rp-panel rp-elev">
          <div className="rp-elevhead"><div className="t">Elevation profile</div><div className="s">Start 360 ft → Finish 20 ft</div></div>
          <svg className="rp-elevsvg" viewBox="0 0 640 150" preserveAspectRatio="none">
            <defs><linearGradient id="elevfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#FF8847" stopOpacity=".42"/><stop offset="1" stopColor="#FF8847" stopOpacity="0"/></linearGradient></defs>
            <path d={`${r.elevPath} L640,150 L0,150 Z`} fill="url(#elevfill)" />
            <path d={r.elevPath} fill="none" stroke="#FF8847" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            <line x1="320" y1="0" x2="320" y2="150" stroke="rgba(255,255,255,.18)" strokeWidth="1" strokeDasharray="3 4" />
          </svg>
          <div className="rp-elevx"><span>START</span><span>10K</span><span>HALF · 13.1</span><span>30K</span><span>FINISH</span></div>
        </div>
        <div className="rp-panel">
          <div className="rp-elevhead"><div className="t">Notable miles</div></div>
          <div className="rp-coursenotes">
            {r.notables.map((n, i) => (
              <div className="rp-cn" key={i}>
                <span className="mi">{n.mi}</span>
                <span className="tx" dangerouslySetInnerHTML={{ __html: n.tx }} />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rp-sec">PACING PLAN<span className="rp-secr">Even effort for {aGoal} · {goalPace}/mi avg</span></div>
      <div className="rp-panel rp-pace">
        {r.pacing.map((p, i) => (
          <div className="rp-pr" key={i}>
            <div className="seg">{p.seg}<small>{p.sub}</small></div>
            <div className="bar"><i style={{ width: `${p.bar}%`, background: p.barColor }} /></div>
            <div className="pp">{p.pace}</div>
            <div className="cum">{p.cum}</div>
          </div>
        ))}
        <div className="rp-5k">
          {r.splits.map(s => <span key={s.label}>{s.label} <b>{s.val}</b></span>)}
        </div>
      </div>

      <div className="rp-sec">FUELING PLAN<span className="rp-secr">~70g carbs/hr · {r.gels.length} gels · fluids every aid station</span></div>
      <div className="rp-panel">
        <div className="rp-fuel">
          <div className="rp-ftrack">
            {r.gels.map((g, i) => (
              <div key={i} className={`rp-fgel${g.caf ? ' caf' : ''}`} data-mi={g.mi} style={{ left: `${g.left}%` }} />
            ))}
          </div>
          <div className="rp-fx"><span>START</span><span>10K</span><span>HALF</span><span>30K</span><span>FINISH</span></div>
        </div>
        <div className="rp-fgrid">
          <div className="rp-fg"><div className="k">PRE-RACE</div><div className="v">{r.preRace}</div></div>
          <div className="rp-fg"><div className="k">ON COURSE</div><div className="v">{r.onCourse}</div></div>
          <div className="rp-fg"><div className="k">HYDRATION</div><div className="v">{r.hydration}</div></div>
        </div>
      </div>

      <div className="rp-sec">COURSE INSIGHT</div>
      <div className="rp-panel rp-insight">
        <span className="ct">COACH</span>
        <span className="cx" dangerouslySetInnerHTML={{ __html: r.insight }} />
      </div>

      <div className="rp-sec">RACE LOGISTICS<span className="rp-secr">Saved to your race plan</span></div>
      <div className="rp-logi">
        <LogisticsItem icon={<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>} label="START"  value={r.start.time}    detail={r.start.detail} />
        <LogisticsItem icon={<path d="M4 16l4-8 4 5 4-9 4 12"/>}                                 label="SHUTTLE" value={r.shuttle.value} detail={r.shuttle.detail} />
        <LogisticsItem icon={<><path d="M6 2h9l3 3v17H6z"/><path d="M9 7h6M9 11h6M9 15h4"/></>}   label="PACKET PICKUP" value={r.pickup.value} detail={r.pickup.detail} />
        <LogisticsItem icon={<><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7z"/><circle cx="12" cy="9" r="2.5"/></>} label="FINISH" value={r.finish.value} detail={r.finish.detail} />
      </div>
      <div className="rp-links">
        <div className="rp-link">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>
          Official race site
        </div>
        <div className="rp-link">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 20l-5-2V4l5 2 6-2 5 2v14l-5-2-6 2z"/><path d="M9 6v14M15 4v14"/></svg>
          Download GPX
        </div>
        <div className="rp-link">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19V5M9 19V9M14 19v-6M19 19V7"/></svg>
          Past results &amp; weather history
        </div>
      </div>

      {/* Post-race plan handoff · shows when result is logged + there's a
          future A race. Manual trigger only — runner decides when ready. */}
      {r.isPast && finishTime && r.nextARace && (
        <div className="band">
          <RacePlanHandoff raceDate={r.date} nextARace={r.nextARace} bridgeRaces={r.bridgeRaces ?? []} />
        </div>
      )}

      {/* Race retro recalc toast · auto-dismisses after ~5s. Closes
          coverage line 1228. */}
      {recalcToast ? (
        <div
          style={{
            position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
            zIndex: 70, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center',
          }}
          role="status"
        >
          {recalcToast.vdotAfter != null ? (
            <StateChangeToast
              label="VDOT"
              before={recalcToast.vdotBefore ?? '·'}
              after={recalcToast.vdotAfter}
              message="VDOT updated from this race"
            />
          ) : null}
          {recalcToast.lthrAfter != null ? (
            <StateChangeToast
              label="LTHR"
              before={recalcToast.lthrBefore ?? '·'}
              after={recalcToast.lthrAfter}
              message={`LTHR re-calibrated${recalcToast.lthrMethod ? ` · ${recalcToast.lthrMethod}` : ''}`}
            />
          ) : null}
        </div>
      ) : null}

      {/* 2026-06-01 · auto-rebuild toast · fires when goal time, race
          date, or A-race priority change rewrites the plan atomically.
          Teal palette (recovery/passive · the system did the work),
          7s auto-dismiss. Includes a CLOSE button so the runner can
          dismiss before the timer. */}
      {autoRebuildToast ? (
        <div
          style={{
            position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
            zIndex: 70, maxWidth: 460, width: 'calc(100vw - 32px)',
            background: 'linear-gradient(135deg, rgba(72,179,181,0.14), rgba(72,179,181,0.04))',
            border: '1px solid rgba(72,179,181,0.42)',
            borderRadius: 14,
            padding: '14px 16px',
            boxShadow: '0 24px 50px -20px rgba(0,0,0,0.7)',
            backdropFilter: 'blur(14px)',
            color: 'var(--ink, #fff)',
          }}
          role="status"
        >
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 12,
          }}>
            <div style={{
              fontSize: 10, letterSpacing: '1.6px', fontWeight: 700,
              color: '#48B3B5',
            }}>
              PLAN · REBUILT
            </div>
            <button
              type="button"
              onClick={() => setAutoRebuildToast(null)}
              aria-label="Dismiss"
              style={{
                background: 'transparent', border: 'none', color: 'var(--ink, #fff)',
                opacity: 0.6, cursor: 'pointer', padding: 0, fontSize: 18, lineHeight: 1,
              }}
            >×</button>
          </div>
          <div style={{
            marginTop: 6,
            fontSize: 13, lineHeight: 1.5, color: 'var(--ink, #fff)',
          }}>
            {autoRebuildToast.reason || 'Plan rebuilt from your update.'}
          </div>
        </div>
      ) : null}
    </>
  );
}

/** 2026-06-02 · the route panel block · either the Leaflet terrain map
 *  (when trackPoints exist) or the "no GPX yet" upload CTA. Extracted so
 *  the 2-col / 1-col split in the parent doesn't have to duplicate this. */
function RouteMapBlock({
  routeLatLng, height, uploadingGpx, pickGpx,
}: {
  routeLatLng: Array<[number, number]> | null;
  height: number;
  uploadingGpx: boolean;
  pickGpx: () => void;
}) {
  return (
    // Plain wrapper · NOT .rp-map (globals.css forces absolute on child
    // svg, which would fight Leaflet's internal layers).
    <div style={{
      position: 'relative', height, minHeight: height,
      borderRadius: 12, overflow: 'hidden',
    }}>
      {routeLatLng && routeLatLng.length >= 2 ? (
        <RouteMap points={routeLatLng} splits={[]} height={height} />
      ) : (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 12, padding: 16,
          background: 'rgba(255,255,255,.02)',
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, opacity: 0.55, textAlign: 'center' }}>
            ROUTE UNAVAILABLE
          </div>
          <button
            type="button"
            onClick={pickGpx}
            disabled={uploadingGpx}
            style={{
              fontFamily: 'inherit', fontSize: 11, fontWeight: 700, letterSpacing: 1.6,
              textTransform: 'uppercase', color: 'var(--bg, #10131A)',
              background: 'var(--ink, #fff)', border: 0,
              borderRadius: 12, padding: '9px 16px', cursor: uploadingGpx ? 'wait' : 'pointer',
              opacity: uploadingGpx ? 0.6 : 1,
            }}
          >
            {uploadingGpx ? 'Uploading' : 'Upload GPX'}
          </button>
          <div style={{ fontSize: 10, opacity: 0.45, textAlign: 'center', maxWidth: 320, lineHeight: 1.5 }}>
            Adds route, elevation, and notable miles to this race.
          </div>
        </div>
      )}
    </div>
  );
}

function LogisticsItem({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail: string }) {
  return (
    <div className="rp-li">
      <div className="k">
        <svg viewBox="0 0 24 24" fill="none" stroke="#FFCE8A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{icon}</svg>
        {label}
      </div>
      <div className="v">{value}</div>
      <div className="d">{detail}</div>
    </div>
  );
}

function formatDateFull(iso: string) {
  // noon-UTC anchor on the date part so the label never shifts a day by timezone.
  return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(iso.slice(0, 10) + 'T12:00:00Z'));
}
function distLabel(mi: number): string {
  if (mi >= 25 && mi <= 27) return 'MARATHON';
  if (mi >= 12 && mi <= 14) return 'HALF MARATHON';
  if (mi >= 6 && mi <= 7) return '10K';
  if (mi >= 3 && mi <= 3.5) return '5K';
  if (mi > 0) return `${mi.toFixed(1)} MI`;
  return 'RACE';
}
/** 2026-06-09 · race-killer F2 — shared parser. The local 2-part branch
 *  forced H:MM, so a sub-hour goal typed "45:00" (10K) normalized to 45
 *  HOURS. parseRaceTime disambiguates h:mm vs m:ss (vdot.ts:145):
 *  "1:30" → 5400 · "45:00" → 2700. Keeps this file's number/0 contract. */
function parseHMS(t: string): number {
  return parseRaceTime((t || '').trim()) ?? 0;
}
function fmtHMS(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}:${String(m).padStart(2,'0')}${s ? ':' + String(s).padStart(2,'0') : ''}`;
}
/** 2026-06-02 · goal times only carry H:MM precision (a goal is "1:30",
 *  not "1:30:00" or "1:29:42"). Used by commitA / commitB so the editor
 *  doesn't flicker "1:30:00 → 1:30" on first blur. Sub-hour distances
 *  render as plain minutes ("42"). */
function fmtHM(sec: number): string {
  const totalMin = Math.round(sec / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}:${String(m).padStart(2,'0')}` : `${m}`;
}
/** Normalize any incoming goal string (could be "1:30:00" from a legacy
 *  row, "1:30" from a fresh edit, or "·" for empty) to the H:MM display
 *  shape. Anything unparseable passes through. */
function normalizeGoalTime(t: string): string {
  if (!t || t === '·') return t;
  const sec = parseHMS(t);
  if (sec <= 0) return t;
  return fmtHM(sec);
}
function sec2pace(sec: number): string {
  const per = sec / 26.2188;
  let m = Math.floor(per / 60);
  let s = Math.round(per % 60);
  if (s === 60) { m++; s = 0; }
  return `${m}:${String(s).padStart(2,'0')}`;
}

/** Adds `days` calendar days to an ISO date string ("2026-08-16" → "2026-08-30"). */
function addDaysISO(iso: string, days: number): string {
  return new Date(Date.parse(iso + 'T12:00:00Z') + days * 86_400_000).toISOString().slice(0, 10);
}
/** "2026-08-16" → "Aug 16" */
function monDay(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/**
 * RacePlanHandoff — post-race "WHAT'S NEXT" informational block.
 *
 * Shows when: isPast && finishTime is set && there's a future A race.
 * Displays recovery / bridge / training timeline. Plan generation happens
 * automatically in POST /api/race/result (step 4) — no button here.
 */
function RacePlanHandoff({
  raceDate,
  nextARace,
  bridgeRaces,
}: {
  raceDate: string;
  nextARace: { slug: string; name: string; date: string; distanceMi: number | null };
  bridgeRaces: Array<{ name: string; date: string; daysBeforeNextA: number }>;
}) {
  const recoveryEnd = addDaysISO(raceDate, 14);
  const bridgeEnd   = addDaysISO(raceDate, 28);
  const trainWeeks  = Math.round(
    (Date.parse(nextARace.date + 'T12:00:00Z') - Date.parse(bridgeEnd + 'T12:00:00Z')) / (7 * 86_400_000),
  );

  // Tune-up race: nearest bridgeRace within 14–35 days of next A race.
  const tuneUp = bridgeRaces.find(r => r.daysBeforeNextA >= 14 && r.daysBeforeNextA <= 35);

  return (
    <>
      <div className="rp-sec">WHAT&apos;S NEXT</div>
      <div style={{ marginBottom: 14 }}>
        <span style={{ fontSize: 15, fontWeight: 700 }}>{nextARace.name}</span>
        <span style={{ fontSize: 13, color: 'var(--mute)', marginLeft: 8 }}>
          {monDay(nextARace.date)}
          {nextARace.distanceMi === 26.2 ? ' · Marathon' : nextARace.distanceMi === 13.1 ? ' · Half' : ''}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 0, marginBottom: 18 }}>
        {[
          { label: 'Recovery', dates: `${monDay(raceDate)} – ${monDay(recoveryEnd)}`, note: '14 days easy only, no quality' },
          { label: 'Bridge',   dates: `${monDay(recoveryEnd)} – ${monDay(bridgeEnd)}`, note: 'aerobic base, strides, fartlek' },
          { label: 'Training', dates: `${monDay(bridgeEnd)} – ${monDay(nextARace.date)}`, note: `${trainWeeks} weeks specific prep` },
        ].map(row => (
          <div key={row.label} style={{
            display: 'grid', gridTemplateColumns: '80px 1fr 1fr',
            gap: 8, padding: '8px 0', borderBottom: '1px solid var(--line)',
            alignItems: 'center',
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1.2px', color: 'var(--mute)', textTransform: 'uppercase' }}>
              {row.label}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink)' }}>{row.dates}</div>
            <div style={{ fontSize: 11, color: 'var(--mute)' }}>{row.note}</div>
          </div>
        ))}
      </div>

      {tuneUp && (
        <div style={{ fontSize: 12, color: 'var(--mute)' }}>
          {tuneUp.name} ({monDay(tuneUp.date)}) is a natural tune-up {tuneUp.daysBeforeNextA} days out from {nextARace.name}.
        </div>
      )}
    </>
  );
}
