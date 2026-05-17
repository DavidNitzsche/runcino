'use client';

/**
 * /profile · Identity, goals, gear, engine details (May 2026 port).
 *
 * Mockup: designs/profile-2026-05-09.html — locked.
 *
 * Architecture mirrors /log:
 *   - Single useEffect loads via /api/profile (server-side bundle).
 *   - Skeleton + error fallback via <EmptyState>.
 *   - Cards composed from @/app/components primitives.
 *
 * Row plan (1:1 with mockup):
 *   1 · IdentityHeroCard      (span 7) — name + 4 lifetime KPIs
 *       LifetimePrsCard       (span 5) — 5-row PR list
 *   2 · PersonalGoalsCard     (span 12) — 6 goals + Coach respect copy
 *   3 · VdotCard              (span 3) — gradient hero, 49.2
 *       HrCard                (span 3) — HRmax + RHR + 5 zones
 *       TierCard              (span 3) — mileage tier + band marker
 *       PrefsCard             (span 3) — long-run / quality / rest / units
 *   4 · ConnectionsCard       (span 4) — Strava / HealthKit / Garmin
 *       ShoeRotationCard      (span 8) — active shoes (DB-backed)
 *   5 · CoachEngineCard       (span 12) — engine details + integrity validation
 *
 * No Coach methods directly invoked. Profile READS from coach-state.
 */

import { useEffect, useState } from 'react';
import {
  Topbar,
  Stage,
  Row,
  Card,
  CardHeader,
  CardLabel,
  CardPin,
  CardFoot,
  Greet,
  GreetId,
  GreetState,
  GreetTile,
  EmptyState,
  Skeleton,
} from '@/app/components';
import { AddGoalModal } from '@/app/components/AddGoalModal';
import { EditProfileModal } from '@/app/components/EditProfileModal';
import { ConnectorsCard } from './ConnectorsCard';
import {
  loadProfileData,
  formatTopbarClock,
  accentVar,
  type ProfileData,
  type LifetimePr,
  type Goal,
  type Pref,
  type ShoeRow,
  type Connection,
  type HrZone,
  type Tier,
  type EngineBlock,
} from './data';

export default function ProfilePage() {
  const [now, setNow] = useState<Date | null>(null);
  const [data, setData] = useState<ProfileData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    setNow(new Date());
  }, []);

  useEffect(() => {
    if (!now) return;
    let cancelled = false;
    setLoadError(null);
    loadProfileData()
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [now, reloadTick]);

  const reload = () => setReloadTick((t) => t + 1);

  const clock = now ? formatTopbarClock(now) : null;

  return (
    <Stage>
      <Topbar
        activeTab="profile"
        clock={clock !== null ? clock : <Skeleton width={140} height={12} />}
      />

      <ProfileGreet data={data} />

      {loadError && (
        <Row>
          <Card span={12}>
            <EmptyState
              variant="error"
              title="Couldn't load Profile"
              body={loadError}
            />
          </Card>
        </Row>
      )}

      {data ? (
        <ProfileBody data={data} onRefresh={reload} />
      ) : (
        !loadError && <ProfileSkeleton />
      )}
    </Stage>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Greet band — eyebrow + 4 lifetime KPI tiles
// ─────────────────────────────────────────────────────────────────────

function ProfileGreet({ data }: { data: ProfileData | null }) {
  if (!data) {
    return (
      <Greet>
        <GreetId
          eyebrow={<Skeleton width={300} height={11} />}
          title={<Skeleton width={180} height={48} />}
        />
        <GreetState>
          {[0, 1, 2, 3].map((i) => (
            <GreetTile key={i} eyebrow="—" value={<Skeleton width={56} height={20} />} />
          ))}
        </GreetState>
      </Greet>
    );
  }

  const k = data.identity.kpis;
  return (
    <Greet>
      <GreetId eyebrow={data.identity.idLabel} title="PROFILE" />
      <GreetState>
        <GreetTile
          variant="coach"
          eyebrow={k[0].label}
          value={k[0].value}
          unit={k[0].unit ?? undefined}
          delta={k[0].detail}
          deltaColor="var(--coach)"
        />
        <GreetTile
          variant="good"
          eyebrow={k[1].label}
          value={k[1].value}
          unit={k[1].unit ?? undefined}
          delta={k[1].detail}
          deltaColor="var(--good)"
        />
        <GreetTile
          variant="amber"
          eyebrow={k[2].label}
          value={k[2].value}
          unit={k[2].unit ?? undefined}
          delta={k[2].detail}
          deltaColor="var(--att)"
        />
        <GreetTile
          variant="race"
          eyebrow={k[3].label}
          value={k[3].value}
          unit={k[3].unit ?? undefined}
          delta={k[3].detail}
          deltaColor="var(--race)"
        />
        {k[4] && (
          <GreetTile
            eyebrow={k[4].label}
            value={k[4].value}
            unit={k[4].unit ?? undefined}
            delta={k[4].detail}
            deltaColor="var(--coach)"
          />
        )}
      </GreetState>
    </Greet>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Body
// ─────────────────────────────────────────────────────────────────────

function ProfileBody({ data, onRefresh }: { data: ProfileData; onRefresh: () => void }) {
  return (
    <>
      <Row>
        <IdentityHeroCard data={data} onRefresh={onRefresh} />
        <LifetimePrsCard data={data} />
      </Row>

      {/* Personal Goals card removed per designs/profile-v4.html.
          Race-time goals already live on each race in /races (goal +
          goalPace); a standalone goals section was just decoration that
          didn't influence anything. */}

      {/* Connectors card — full-width, replaces the old ConnectionsCard.
          Source-of-truth for what activity sources / coach platforms /
          recovery wearables the user has connected. Source spec:
          designs/profile-v4.html §CONNECTORS. */}
      <Row>
        <ConnectorsCard />
      </Row>

      <Row>
        <VdotCard data={data} />
        <HrCard data={data} />
        <TierCard data={data} />
        <PrefsCard data={data} />
      </Row>
      <Row>
        <ShoeRotationCard data={data} />
      </Row>
      <Row>
        <CoachEngineCard data={data} />
      </Row>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// ROW 1 · Identity hero (span 7)
// ─────────────────────────────────────────────────────────────────────

function IdentityHeroCard({ data, onRefresh }: { data: ProfileData; onRefresh: () => void }) {
  const [editing, setEditing] = useState(false);
  const id = data.identity;
  const hasProfile = id.fullName != null;
  const nameForDisplay = id.fullName ?? 'Anonymous runner';
  const nameParts = nameForDisplay.split(/\s+/);
  const initialsForDisplay = id.initials ?? '—';
  return (
    <Card
      span={7}
      padding="32px 36px"
      style={{
        background: 'linear-gradient(135deg, rgba(0,143,236,.08), var(--l1) 60%)',
      }}
    >
      <CardHeader>
        <CardLabel>{id.idLabel}</CardLabel>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {id.yearsRunningPin && (
            <CardPin variant="blue">{id.yearsRunningPin}</CardPin>
          )}
          {hasProfile && (
            <button
              type="button"
              className="card-pin muted"
              style={{ border: 0, cursor: 'pointer' }}
              onClick={() => setEditing(true)}
            >
              EDIT →
            </button>
          )}
        </div>
      </CardHeader>
      <div style={{ display: 'flex', alignItems: 'center', gap: 24, marginTop: 18 }}>
        <div
          style={{
            width: 96,
            height: 96,
            borderRadius: 24,
            background: id.initials
              ? 'linear-gradient(135deg, var(--corp), var(--xp))'
              : 'var(--l3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'var(--f-display)',
            fontWeight: 700,
            fontSize: 42,
            color: id.initials ? '#fff' : 'var(--t2)',
            flexShrink: 0,
          }}
        >
          {initialsForDisplay}
        </div>
        <div>
          <div
            style={{
              fontFamily: 'var(--f-display)',
              fontWeight: 700,
              fontSize: 64,
              letterSpacing: '-.015em',
              lineHeight: 0.95,
              textTransform: 'uppercase',
              color: id.fullName ? 'var(--t0)' : 'var(--t2)',
            }}
          >
            {id.fullName
              ? nameParts.map((n, i) => (
                  <span key={i} style={{ display: 'block' }}>{n}</span>
                ))
              : <span>NO PROFILE YET</span>}
          </div>
          <div
            className="mono-sm"
            style={{
              marginTop: 10,
              fontSize: 11.5,
              letterSpacing: '.6px',
              color: id.bioLine ? 'var(--t1)' : 'var(--t3)',
              fontWeight: 600,
            }}
          >
            {id.bioLine ?? 'NO DATA YET'}
          </div>
          {!hasProfile && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              style={{
                marginTop: 18,
                padding: '12px 22px',
                background: 'var(--corp)',
                color: '#fff',
                border: 0,
                borderRadius: 8,
                cursor: 'pointer',
                fontFamily: 'var(--f-data)',
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: '1.2px',
                textTransform: 'uppercase',
              }}
            >
              + ADD YOUR INFO
            </button>
          )}
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 22,
          paddingTop: 24,
          marginTop: 24,
          borderTop: '1px solid var(--l4)',
        }}
      >
        {id.kpis.map((kpi) => (
          <div key={kpi.label}>
            <div
              className="mono-sm"
              style={{ fontSize: 11, letterSpacing: '.12em', color: 'var(--t2)' }}
            >
              {kpi.label}
            </div>
            <div
              style={{
                fontFamily: 'var(--f-display)',
                fontWeight: 700,
                fontSize: 42,
                letterSpacing: '-.015em',
                lineHeight: 0.95,
                marginTop: 10,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {kpi.value}
              {kpi.unit && (
                <small style={{ fontSize: '.32em', opacity: 0.5, fontWeight: 700, marginLeft: 4 }}>
                  {kpi.unit}
                </small>
              )}
            </div>
            <div
              className="mono-sm"
              style={{
                fontSize: 10,
                letterSpacing: '.12em',
                color: 'var(--t2)',
                marginTop: 10,
                lineHeight: 1.5,
              }}
            >
              {kpi.detail}
            </div>
          </div>
        ))}
      </div>
      <EditProfileModal
        open={editing}
        onClose={() => setEditing(false)}
        onSaved={() => { setEditing(false); onRefresh(); }}
      />
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────
// ROW 1 · Lifetime PRs (span 5)
// ─────────────────────────────────────────────────────────────────────

function LifetimePrsCard({ data }: { data: ProfileData }) {
  return (
    <Card span={5} padding="24px 26px">
      <CardHeader>
        <CardLabel>LIFETIME PERSONAL RECORDS</CardLabel>
        <CardPin variant={data.newPrCount > 0 ? 'green' : 'muted'}>
          {data.newPrCount > 0 ? `${data.newPrCount} NEW · ${data.today.slice(0, 4)}` : 'NO NEW PRS'}
        </CardPin>
      </CardHeader>
      <div
        style={{
          fontFamily: 'var(--f-display)',
          fontWeight: 600,
          fontSize: 24,
          marginTop: 6,
          lineHeight: 1.05,
          letterSpacing: '-.005em',
          textTransform: 'uppercase',
        }}
      >
        All-time bests by distance
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          marginTop: 14,
        }}
      >
        {data.lifetimePrs.map((p) => <LifetimePrRow key={p.label} pr={p} />)}
      </div>

      <CardFoot
        left={data.hasPrThisYear ? `${data.newPrCount} PR${data.newPrCount === 1 ? '' : 's'} set this year` : 'No new PRs this year'}
        right={data.hasPrThisYear ? <span style={{ color: 'var(--good)' }}>▲ FITNESS PEAKING</span> : null}
      />
    </Card>
  );
}

function LifetimePrRow({ pr }: { pr: LifetimePr }) {
  const accent = pr.accent === 'good' ? 'var(--good)' : 'var(--t3)';
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '3px 70px 1fr auto',
        gap: 14,
        alignItems: 'center',
        padding: '11px 14px 11px 0',
        background: 'var(--l2)',
        borderRadius: 8,
        opacity: pr.isEmpty ? 0.7 : 1,
      }}
    >
      <div
        style={{
          background: accent,
          height: '100%',
          borderRadius: '8px 0 0 8px',
          alignSelf: 'stretch',
        }}
      />
      <div
        className="mono-sm"
        style={{ fontSize: 11, letterSpacing: '1.2px', color: 'var(--t2)', fontWeight: 700 }}
      >
        {pr.label}
      </div>
      <div>
        <div
          style={{
            fontFamily: 'var(--f-display)',
            fontSize: 24,
            fontWeight: 600,
            letterSpacing: '-.02em',
            lineHeight: 1,
            fontVariantNumeric: 'tabular-nums',
            color: pr.isEmpty ? 'var(--t2)' : 'var(--t0)',
          }}
        >
          {pr.timeDisplay ?? '—'}
        </div>
        <div
          className="mono-sm"
          style={{ fontSize: 10, letterSpacing: '.12em', color: 'var(--t3)', marginTop: 4 }}
        >
          {pr.detail ?? ''}
        </div>
      </div>
      {pr.isNew ? (
        <CardPin variant="green">NEW PR</CardPin>
      ) : pr.ageLabel ? (
        <CardPin variant="muted">{pr.ageLabel}</CardPin>
      ) : (
        <CardPin variant="muted">—</CardPin>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// ROW 2 · Personal Goals (span 12)
// ─────────────────────────────────────────────────────────────────────

function PersonalGoalsCard({ data, onRefresh }: { data: ProfileData; onRefresh: () => void }) {
  const [addingGoal, setAddingGoal] = useState(false);
  return (
    <Card span={12} padding="22px 26px">
      <CardHeader>
        <div>
          <CardLabel>PERSONAL GOALS · COACH READS THESE</CardLabel>
          <div
            style={{
              fontFamily: 'var(--f-display)',
              fontSize: 22,
              fontWeight: 600,
              marginTop: 4,
              lineHeight: 1.05,
              letterSpacing: '-.005em',
              textTransform: 'uppercase',
            }}
          >
            What you want · what the plan respects
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <CardPin variant="coach">{data.goalsActive} ACTIVE</CardPin>
          <button
            type="button"
            className="card-pin muted"
            style={{ border: 0, cursor: 'pointer' }}
            onClick={() => setAddingGoal(true)}
          >
            + ADD GOAL
          </button>
        </div>
      </CardHeader>
      <div
        style={{
          fontFamily: 'var(--f-body)',
          fontSize: 15,
          color: 'var(--t2)',
          marginTop: 8,
          maxWidth: 720,
          lineHeight: 1.6,
        }}
      >
        Set what you actually want and the Coach builds the plan around it. Each goal explains how it changes your training.
      </div>

      {data.goals.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 10,
            marginTop: 18,
          }}
        >
          {data.goals.map((g) => <GoalTile key={g.id} goal={g} />)}
        </div>
      )}

      {data.goals.length === 0 && (
        <div
          className="mono-sm"
          style={{
            marginTop: 18,
            padding: '20px 22px',
            border: '1px dashed var(--l4)',
            borderRadius: 8,
            fontSize: 11,
            letterSpacing: '1.2px',
            color: 'var(--t3)',
            fontWeight: 700,
            textAlign: 'center',
          }}
        >
          NO GOALS LOGGED YET — TAP + ADD GOAL TO START
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 10,
          marginTop: 10,
        }}
      >
        {[0, 1, 2].map((i) => (
          <button
            key={i}
            type="button"
            style={{
              padding: '16px 18px',
              background: 'transparent',
              border: '1px dashed var(--l4)',
              borderRadius: 8,
              cursor: 'pointer',
              fontFamily: 'var(--f-data)',
              fontSize: 11,
              letterSpacing: '1.2px',
              color: 'var(--t3)',
              fontWeight: 700,
              textTransform: 'uppercase',
              textAlign: 'center',
            }}
            onClick={() => setAddingGoal(true)}
          >
            + ADD GOAL
          </button>
        ))}
      </div>

      <CardFoot
        left="Goals shape the plan. Coach reads each one — volume sets weekly ramps, sleep floor gates quality sessions, strength caps stacking."
      />
      <AddGoalModal
        open={addingGoal}
        onClose={() => setAddingGoal(false)}
        onSaved={() => { setAddingGoal(false); onRefresh(); }}
      />
    </Card>
  );
}

function GoalTile({ goal }: { goal: Goal }) {
  const accent = accentVar(goal.accent);
  const statusColor = accentVar(goal.statusTone === 'good' ? 'good' : goal.statusTone === 'coach' ? 'coach' : goal.statusTone === 'amber' ? 'amber' : 'warn');
  return (
    <div
      style={{
        padding: '16px 18px',
        background: 'var(--l2)',
        borderLeft: `3px solid ${accent}`,
        borderRadius: 8,
        // overflow:hidden clips the in-tile progress bar to the
        // rounded corners — without it, the colored fill bleeds past
        // the right edge of the border-radius, showing as a weird
        // accent-color sliver on the top-right and bottom-right.
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div
          className="mono-sm"
          style={{
            fontSize: 11,
            letterSpacing: '.12em',
            color: accent,
            fontWeight: 700,
            textTransform: 'uppercase',
          }}
        >
          {goal.category}
        </div>
        <div
          className="mono-sm"
          style={{
            fontSize: 10.5,
            letterSpacing: '.12em',
            color: statusColor,
            fontWeight: 700,
            textTransform: 'uppercase',
          }}
        >
          {goal.statusLabel}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span
          style={{
            fontFamily: 'var(--f-display)',
            fontSize: goal.hasArrow ? 18 : 22,
            fontWeight: 600,
            color: goal.hasArrow ? 'var(--t3)' : accent,
            letterSpacing: '-.01em',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {goal.currentValue}
          {goal.currentUnit && (
            <small
              style={{
                fontFamily: 'var(--f-data)',
                fontSize: '.5em',
                opacity: 0.55,
                fontWeight: 700,
                marginLeft: 3,
              }}
            >
              {goal.currentUnit}
            </small>
          )}
        </span>
        {goal.hasArrow && (
          <>
            <span
              style={{
                fontFamily: 'var(--f-data)',
                fontSize: 14,
                color: accent,
                fontWeight: 700,
              }}
            >
              →
            </span>
            <span
              style={{
                fontFamily: 'var(--f-display)',
                fontSize: 22,
                fontWeight: 600,
                color: accent,
                letterSpacing: '-.01em',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {goal.targetValue}
              {goal.targetUnit && (
                <small
                  style={{
                    fontFamily: 'var(--f-data)',
                    fontSize: '.4em',
                    opacity: 0.55,
                    fontWeight: 700,
                    marginLeft: 3,
                  }}
                >
                  {goal.targetUnit}
                </small>
              )}
            </span>
          </>
        )}
        {!goal.hasArrow && goal.targetValue && (
          <span
            className="mono-sm"
            style={{
              fontSize: 11,
              color: 'var(--t3)',
              fontWeight: 700,
              marginLeft: 'auto',
              letterSpacing: '.5px',
            }}
          >
            {goal.targetValue}
          </span>
        )}
      </div>
      <div
        style={{
          height: 5,
          background: 'var(--l3)',
          borderRadius: 3,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'block',
            height: '100%',
            width: `${Math.min(100, Math.max(0, goal.progress * 100))}%`,
            background: accent,
          }}
        />
      </div>
      <div
        style={{
          fontFamily: 'var(--f-body)',
          fontSize: 13,
          color: 'var(--t2)',
          marginTop: 4,
          lineHeight: 1.5,
        }}
      >
        {goal.rationale}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// ROW 3 · VDOT (span 3)
// ─────────────────────────────────────────────────────────────────────

function VdotCard({ data }: { data: ProfileData }) {
  const hasVdot = data.vdot.value != null;
  return (
    <Card
      span={3}
      padding="18px 20px"
      style={{
        background: hasVdot
          ? 'linear-gradient(135deg, var(--corp) 0%, var(--xp) 100%)'
          : 'var(--l1)',
        border: hasVdot ? 0 : undefined,
        minHeight: 200,
      }}
    >
      <CardHeader>
        <CardLabel color={hasVdot ? 'rgba(255,255,255,.78)' : undefined}>
          VDOT · AGE-GRADED
        </CardLabel>
        <span
          className="card-pin"
          style={
            hasVdot
              ? { background: 'rgba(255,255,255,.16)', color: '#fff' }
              : undefined
          }
        >
          {hasVdot ? 'FRESH' : 'NO DATA'}
        </span>
      </CardHeader>
      <div
        style={{
          fontFamily: 'var(--f-display)',
          fontWeight: 700,
          fontSize: hasVdot ? 96 : 24,
          letterSpacing: '-.03em',
          lineHeight: 0.9,
          color: hasVdot ? '#fff' : 'var(--t2)',
          fontVariantNumeric: 'tabular-nums',
          marginTop: 8,
        }}
      >
        {data.vdot.value ?? 'NO DATA YET'}
      </div>
      <div
        style={{
          fontFamily: 'var(--f-data)',
          fontSize: 9.5,
          color: hasVdot ? 'rgba(255,255,255,.78)' : 'var(--t3)',
          fontWeight: 700,
          letterSpacing: '.5px',
        }}
      >
        {data.vdot.detail ?? 'Log a race to unlock VDOT'}
      </div>
      <div
        style={{
          marginTop: 'auto',
          paddingTop: 10,
          borderTop: hasVdot
            ? '1px solid rgba(255,255,255,.18)'
            : '1px solid var(--l4)',
          fontFamily: 'var(--f-data)',
          fontSize: 9.5,
          color: hasVdot ? 'rgba(255,255,255,.85)' : 'var(--t3)',
          fontWeight: 700,
          letterSpacing: '1.2px',
        }}
      >
        {data.vdot.source ?? '—'}
      </div>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────
// ROW 3 · HR 5-zone (span 3)
// ─────────────────────────────────────────────────────────────────────

function HrCard({ data }: { data: ProfileData }) {
  const hr = data.hrBlock;
  const measured = hr.hrMaxMeasured;
  const estimate = hr.hrMaxEstimate;
  const displayHrMax = measured ?? estimate;
  const hrPinTone = measured != null ? 'green' : estimate != null ? 'muted' : 'muted';
  const hrPinText = measured != null ? 'MEASURED' : estimate != null ? 'ESTIMATE' : 'NO DATA';
  return (
    <Card span={3}>
      <CardHeader>
        <CardLabel>HEART RATE · 5-ZONE</CardLabel>
        <CardPin variant={hrPinTone}>{hrPinText}</CardPin>
      </CardHeader>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 8,
          marginTop: 6,
        }}
      >
        <div>
          <div className="mono-sm" style={{ fontSize: 10, letterSpacing: '1.2px', color: 'var(--t3)' }}>
            HRMAX{estimate != null && measured == null ? ' · EST' : ''}
          </div>
          <div
            style={{
              fontFamily: 'var(--f-display)',
              fontWeight: 700,
              fontSize: displayHrMax != null ? 30 : 14,
              letterSpacing: '-.015em',
              lineHeight: 0.95,
              fontVariantNumeric: 'tabular-nums',
              color: displayHrMax != null ? 'var(--t0)' : 'var(--t3)',
            }}
          >
            {displayHrMax ?? 'NO DATA YET'}
            {displayHrMax != null && (
              <small style={{ fontSize: '.32em', opacity: 0.5, fontWeight: 700, marginLeft: 3 }}>bpm</small>
            )}
          </div>
        </div>
        <div>
          <div className="mono-sm" style={{ fontSize: 10, letterSpacing: '1.2px', color: 'var(--t3)' }}>
            RHR
          </div>
          <div
            style={{
              fontFamily: 'var(--f-display)',
              fontWeight: 700,
              fontSize: hr.rhr != null ? 30 : 14,
              letterSpacing: '-.015em',
              lineHeight: 0.95,
              fontVariantNumeric: 'tabular-nums',
              color: hr.rhr != null ? 'var(--t0)' : 'var(--t3)',
            }}
          >
            {hr.rhr ?? 'NO DATA YET'}
            {hr.rhr != null && (
              <small style={{ fontSize: '.32em', opacity: 0.5, fontWeight: 700, marginLeft: 3 }}>bpm</small>
            )}
          </div>
        </div>
      </div>
      {hr.zones.length > 0 ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
            marginTop: 'auto',
            paddingTop: 10,
            borderTop: '1px solid var(--l4)',
          }}
        >
          {hr.zones.map((z) => <HrZoneRow key={z.letter} zone={z} />)}
        </div>
      ) : (
        <div
          className="mono-sm"
          style={{
            marginTop: 'auto',
            paddingTop: 10,
            borderTop: '1px solid var(--l4)',
            fontSize: 10,
            letterSpacing: '1.2px',
            color: 'var(--t3)',
            fontWeight: 700,
          }}
        >
          5-ZONE BANDS · NO DATA YET
        </div>
      )}
    </Card>
  );
}

function HrZoneRow({ zone }: { zone: HrZone }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '30px 1fr auto',
        gap: 8,
        alignItems: 'center',
        fontSize: 11,
      }}
    >
      <span
        className="mono-sm"
        style={{
          fontSize: 10,
          letterSpacing: '1.2px',
          color: accentVar(zone.accent),
          fontWeight: 700,
        }}
      >
        {zone.letter}
      </span>
      <span style={{ color: 'var(--t2)', fontFamily: 'var(--f-body)', fontSize: 11 }}>
        {zone.label}
      </span>
      <span
        style={{
          fontFamily: 'var(--f-data)',
          fontSize: 11.5,
          color: 'var(--t1)',
          fontWeight: 600,
          letterSpacing: '.6px',
        }}
      >
        {zone.range}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// ROW 3 · Mileage tier (span 3)
// ─────────────────────────────────────────────────────────────────────

function TierCard({ data }: { data: ProfileData }) {
  const t = data.tier;
  const hasCurrent = t.currentMi != null;
  return (
    <Card span={3}>
      <CardHeader>
        <CardLabel>MILEAGE TIER · CURRENT</CardLabel>
        <CardPin variant={hasCurrent ? 'coach' : 'muted'}>
          {hasCurrent ? 'CLIMBING' : 'NO DATA'}
        </CardPin>
      </CardHeader>
      <div
        style={{
          fontFamily: 'var(--f-display)',
          fontWeight: 700,
          fontSize: hasCurrent ? 36 : 18,
          letterSpacing: '-.015em',
          lineHeight: 0.95,
          fontVariantNumeric: 'tabular-nums',
          color: hasCurrent ? 'var(--t0)' : 'var(--t3)',
        }}
      >
        {t.currentMi ?? 'NO DATA YET'}
        {hasCurrent && (
          <small style={{ fontSize: '.3em', opacity: 0.5, fontWeight: 700, marginLeft: 4 }}>mi/wk</small>
        )}
      </div>
      <div
        className="mono-sm"
        style={{ fontSize: 10, letterSpacing: '1.2px', color: 'var(--t3)', fontWeight: 700 }}
      >
        {t.bandLabel}
      </div>
      {hasCurrent && <TierBand position={t.position} />}
      <CardFoot
        left={t.peakLabel}
        right={t.trendLabel ? <span className={`delta ${t.trendLabel.startsWith('▲') ? 'up' : 'dn'}`}>{t.trendLabel}</span> : null}
      />
    </Card>
  );
}

function TierBand({ position }: { position: number }) {
  const pct = Math.max(0, Math.min(100, position * 100));
  return (
    <>
      <div
        style={{
          position: 'relative',
          height: 6,
          background: 'var(--l3)',
          borderRadius: 3,
          marginTop: 10,
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: `${pct}%`,
            background: 'linear-gradient(90deg, var(--good), var(--coach))',
            borderRadius: 3,
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: `calc(${pct}% - 7px)`,
            top: -4,
            width: 14,
            height: 14,
            borderRadius: 7,
            background: 'var(--coach)',
            border: '2px solid var(--l0)',
          }}
        />
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontFamily: 'var(--f-data)',
          fontSize: 9,
          letterSpacing: '.6px',
          color: 'var(--t3)',
          fontWeight: 700,
          marginTop: 6,
        }}
      >
        <span>20</span>
        <span>30</span>
        <span>40 → MID</span>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// ROW 3 · Training prefs (span 3)
// ─────────────────────────────────────────────────────────────────────

function PrefsCard({ data }: { data: ProfileData }) {
  return (
    <Card span={3}>
      <CardHeader>
        <CardLabel>TRAINING PREFERENCES</CardLabel>
        <CardPin variant={data.prefsAreDefaults ? 'muted' : 'muted'}>
          {data.prefsAreDefaults ? 'DEFAULTS' : 'EDIT →'}
        </CardPin>
      </CardHeader>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
        {data.prefs.map((p) => <PrefRow key={p.label} pref={p} />)}
      </div>
      {data.prefsAreDefaults && (
        <div
          className="mono-sm"
          style={{
            marginTop: 10,
            fontSize: 10,
            letterSpacing: '1.2px',
            color: 'var(--t3)',
            fontWeight: 700,
          }}
        >
          USING DEFAULTS — SET YOURS
        </div>
      )}
    </Card>
  );
}

function PrefRow({ pref }: { pref: Pref }) {
  return (
    <div style={{ padding: '8px 10px', background: 'var(--l2)', borderRadius: 6 }}>
      <div
        className="mono-sm"
        style={{ fontSize: 8.5, letterSpacing: '1.2px', color: 'var(--t3)', fontWeight: 700 }}
      >
        {pref.label}
      </div>
      <div
        style={{
          fontFamily: 'var(--f-display)',
          fontWeight: 600,
          fontSize: 14,
          marginTop: 3,
          lineHeight: 1.05,
          textTransform: 'uppercase',
          letterSpacing: '-.005em',
          color: pref.value ? 'var(--t0)' : 'var(--t3)',
        }}
      >
        {pref.value ?? 'NO DATA YET'}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// ROW 4 · Connections (span 4)
// ─────────────────────────────────────────────────────────────────────

function ConnectionsCard({ data }: { data: ProfileData }) {
  const live = data.connections.filter((c) => c.pinLabel === 'LIVE').length;
  const total = data.connections.length;
  return (
    <Card span={4}>
      <CardHeader>
        <CardLabel>CONNECTIONS</CardLabel>
        <CardPin variant={live > 0 ? 'green' : 'muted'}>
          {live}/{total} LIVE
        </CardPin>
      </CardHeader>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
        {data.connections.map((c) => <ConnectionRow key={c.id} conn={c} />)}
      </div>
    </Card>
  );
}

function ConnectionRow({ conn }: { conn: Connection }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '32px 1fr auto',
        gap: 12,
        alignItems: 'center',
        padding: '10px 12px',
        background: 'var(--l2)',
        borderRadius: 6,
        opacity: conn.pinLabel === 'SOON' ? 0.7 : 1,
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          background: conn.pinLabel === 'SOON' ? 'var(--l3)' : conn.brandColor,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'var(--f-display)',
          fontWeight: 700,
          color: conn.pinLabel === 'SOON' ? 'var(--t2)' : '#fff',
        }}
      >
        {conn.letter}
      </div>
      <div>
        <div
          style={{
            fontFamily: 'var(--f-display)',
            fontWeight: 600,
            fontSize: 14,
            lineHeight: 1.05,
            textTransform: 'uppercase',
            letterSpacing: '-.005em',
          }}
        >
          {conn.name}
        </div>
        <div
          className="mono-sm"
          style={{
            fontSize: 9,
            letterSpacing: '1.2px',
            color: 'var(--t3)',
            fontWeight: 700,
            marginTop: 2,
          }}
        >
          {conn.statusLine}
        </div>
      </div>
      <CardPin variant={conn.pinTone}>{conn.pinLabel}</CardPin>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// ROW 4 · Shoe rotation (span 8)
// ─────────────────────────────────────────────────────────────────────

function ShoeRotationCard({ data }: { data: ProfileData }) {
  const hasShoes = data.shoes.length > 0;
  return (
    <Card span={8}>
      <CardHeader>
        <CardLabel>SHOE ROTATION · {data.shoes.length} ACTIVE</CardLabel>
        {!hasShoes ? (
          <CardPin variant="muted">NO DATA</CardPin>
        ) : data.shoeWarnLabel ? (
          <CardPin variant="warn">{data.shoeWarnLabel}</CardPin>
        ) : (
          <CardPin variant="green">ALL HEALTHY</CardPin>
        )}
      </CardHeader>
      {hasShoes ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
          {data.shoes.map((s) => <ShoeRotationRow key={s.id} shoe={s} />)}
        </div>
      ) : (
        <div
          className="mono-sm"
          style={{
            marginTop: 10,
            padding: '20px 22px',
            border: '1px dashed var(--l4)',
            borderRadius: 8,
            fontSize: 11,
            letterSpacing: '1.2px',
            color: 'var(--t3)',
            fontWeight: 700,
            textAlign: 'center',
          }}
        >
          NO SHOES LOGGED — ADD YOUR FIRST
        </div>
      )}
      <CardFoot
        left="+ ADD SHOE · MANAGE RETIRED"
        right={
          hasShoes ? (
            <span style={{ color: 'var(--good)' }}>
              {data.shoes.length} IN ROTATION · TARGET 3-5
            </span>
          ) : null
        }
      />
    </Card>
  );
}

function ShoeRotationRow({ shoe }: { shoe: ShoeRow }) {
  const accent = accentVar(shoe.accent);
  const filledPct = Math.min(100, shoe.fraction * 100);
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '3px 1.6fr 90px 1fr 110px',
        gap: 14,
        alignItems: 'center',
        padding: '11px 14px 11px 0',
        background: shoe.isRetiring ? 'rgba(252,77,100,.04)' : 'var(--l2)',
        borderRadius: 8,
      }}
    >
      <div
        style={{
          background: accent,
          height: '100%',
          borderRadius: '8px 0 0 8px',
          alignSelf: 'stretch',
        }}
      />
      <div>
        <div
          style={{
            fontFamily: 'var(--f-display)',
            fontWeight: 600,
            fontSize: 16,
            letterSpacing: '-.01em',
            textTransform: 'uppercase',
            lineHeight: 1,
          }}
        >
          {shoe.name}
        </div>
        <div
          className="mono-sm"
          style={{ fontSize: 11, letterSpacing: '.12em', color: 'var(--t3)', marginTop: 4 }}
        >
          {shoe.role}
        </div>
      </div>
      <div
        style={{
          fontFamily: 'var(--f-display)',
          fontWeight: 600,
          fontSize: 22,
          lineHeight: 1,
          letterSpacing: '-.01em',
          fontVariantNumeric: 'tabular-nums',
          color: shoe.isRetiring ? 'var(--warn)' : 'var(--t0)',
        }}
      >
        {shoe.mileage}
        <small
          style={{
            fontFamily: 'var(--f-data)',
            fontSize: '.4em',
            opacity: 0.55,
            fontWeight: 700,
            marginLeft: 4,
          }}
        >
          mi
        </small>
      </div>
      <div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            marginBottom: 3,
          }}
        >
          <span
            className="mono-sm"
            style={{ fontSize: 11, letterSpacing: '.12em', color: 'var(--t3)' }}
          >
            / {shoe.cap} CAP
          </span>
          <span
            className="mono-sm"
            style={{
              fontSize: 11,
              letterSpacing: '.12em',
              color: accent,
            }}
          >
            {Math.round(shoe.fraction * 100)}%
          </span>
        </div>
        <div
          style={{
            height: 5,
            borderRadius: 3,
            background: 'var(--l3)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              display: 'block',
              height: '100%',
              background: accent,
              width: `${filledPct}%`,
            }}
          />
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <CardPin variant={shoe.pinTone}>{shoe.statusPin}</CardPin>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// ROW 5 · Coach engine details (span 12)
// ─────────────────────────────────────────────────────────────────────

function CoachEngineCard({ data }: { data: ProfileData }) {
  const e = data.engine;
  return (
    <Card span={12} padding="22px 26px">
      <CardHeader>
        <div>
          <CardLabel>COACH DETAILS · WHAT THE ENGINE IS USING</CardLabel>
          <div
            style={{
              fontFamily: 'var(--f-display)',
              fontSize: 22,
              fontWeight: 600,
              marginTop: 4,
              lineHeight: 1.05,
              letterSpacing: '-.005em',
              textTransform: 'uppercase',
            }}
          >
            Every input the Coach reads to make decisions
          </div>
        </div>
        <CardPin variant="muted">EXPAND ↓</CardPin>
      </CardHeader>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 10,
          marginTop: 14,
        }}
      >
        {/* Tile 0 — Pace zones (special: renders the 5-band table) */}
        <EnginePaceZonesTile engine={e} />
        {/* Tiles 1–3 — Hero values */}
        {e.tiles.slice(1).map((t, i) => <EngineDetailTile key={i} detail={t} />)}
      </div>

      {e.integrity ? (
        <div
          style={{
            marginTop: 14,
            padding: '14px 18px',
            background: 'rgba(62,189,65,.06)',
            border: '1px solid rgba(62,189,65,.20)',
            borderRadius: 8,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div>
            <div
              className="mono-sm"
              style={{ fontSize: 10, letterSpacing: '1.2px', color: 'var(--good)', fontWeight: 700 }}
            >
              {e.integrity.headline}
            </div>
            <div
              style={{
                fontFamily: 'var(--f-body)',
                fontSize: 13,
                color: 'var(--t1)',
                marginTop: 4,
                lineHeight: 1.5,
              }}
            >
              {e.integrity.body}
            </div>
          </div>
          <CardPin variant="green">
            {e.integrity.passed}/{e.integrity.total} RULES OK
          </CardPin>
        </div>
      ) : (
        <div
          style={{
            marginTop: 14,
            padding: '14px 18px',
            background: 'var(--l2)',
            border: '1px solid var(--bd)',
            borderRadius: 8,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div>
            <div
              className="mono-sm"
              style={{ fontSize: 10, letterSpacing: '1.2px', color: 'var(--t3)', fontWeight: 700 }}
            >
              PLAN INTEGRITY · NO DATA YET
            </div>
            <div
              style={{
                fontFamily: 'var(--f-body)',
                fontSize: 13,
                color: 'var(--t2)',
                marginTop: 4,
                lineHeight: 1.5,
              }}
            >
              Engine doesn&apos;t expose a validation surface yet — plan-integrity reads will land with Wave K coach validation.
            </div>
          </div>
          <CardPin variant="muted">PENDING</CardPin>
        </div>
      )}
    </Card>
  );
}

function EnginePaceZonesTile({ engine }: { engine: EngineBlock }) {
  const tile = engine.tiles[0];
  return (
    <div
      style={{
        padding: '18px 20px',
        background: 'var(--l2)',
        borderRadius: 8,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        className="mono-sm"
        style={{ fontSize: 11, letterSpacing: '.12em', color: 'var(--t2)', fontWeight: 500 }}
      >
        {tile.eyebrow}
      </div>
      <div
        style={{
          fontFamily: 'var(--f-display)',
          fontSize: 18,
          fontWeight: 600,
          letterSpacing: '-.01em',
          lineHeight: 1,
          textTransform: 'uppercase',
          marginTop: 8,
        }}
      >
        {tile.value}
      </div>
      <div
        style={{
          fontFamily: 'var(--f-body)',
          fontSize: 13,
          color: 'var(--t2)',
          marginTop: 6,
          lineHeight: 1.5,
        }}
      >
        {tile.lead}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
        {engine.paceZones.length > 0 ? (
          engine.paceZones.map((z) => (
            <div
              key={z.label}
              style={{
                display: 'grid',
                gridTemplateColumns: '80px 1fr',
                gap: 10,
                alignItems: 'baseline',
              }}
            >
              <span
                style={{
                  fontFamily: 'var(--f-data)',
                  fontSize: 11,
                  color: z.accent,
                  fontWeight: 700,
                  letterSpacing: '1.2px',
                }}
              >
                {z.label}
              </span>
              <span
                style={{
                  fontFamily: 'var(--f-display)',
                  fontSize: 16,
                  fontWeight: 600,
                  letterSpacing: '-.01em',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {z.value}
                <small
                  style={{
                    fontFamily: 'var(--f-data)',
                    fontSize: '.55em',
                    opacity: 0.55,
                    fontWeight: 700,
                    marginLeft: 5,
                    letterSpacing: '.5px',
                  }}
                >
                  /MI
                </small>
              </span>
            </div>
          ))
        ) : (
          <div
            className="mono-sm"
            style={{
              fontSize: 10,
              letterSpacing: '1.2px',
              color: 'var(--t3)',
              fontWeight: 700,
            }}
          >
            PACE TABLE · NO DATA YET
          </div>
        )}
      </div>
    </div>
  );
}

function EngineDetailTile({ detail }: { detail: ProfileData['engine']['tiles'][number] }) {
  return (
    <div
      style={{
        padding: '18px 20px',
        background: 'var(--l2)',
        borderRadius: 8,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        className="mono-sm"
        style={{ fontSize: 11, letterSpacing: '.12em', color: 'var(--t2)', fontWeight: 500 }}
      >
        {detail.eyebrow}
      </div>
      <div
        style={{
          fontFamily: 'var(--f-display)',
          fontSize: 42,
          fontWeight: 600,
          letterSpacing: '-.02em',
          lineHeight: 1,
          marginTop: 10,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {detail.value}
        {detail.unit && (
          <small
            style={{
              fontFamily: 'var(--f-data)',
              fontSize: '.32em',
              opacity: 0.55,
              fontWeight: 700,
              marginLeft: 6,
            }}
          >
            {detail.unit}
          </small>
        )}
      </div>
      <div
        style={{
          fontFamily: 'var(--f-body)',
          fontSize: 14,
          color: 'var(--t1)',
          marginTop: 10,
          lineHeight: 1.55,
        }}
      >
        {detail.lead}
      </div>
      {detail.footEyebrow && (
        <div
          style={{
            marginTop: 'auto',
            paddingTop: 14,
            borderTop: '1px solid var(--l4)',
          }}
        >
          <div
            className="mono-sm"
            style={{ fontSize: 11, letterSpacing: '.12em', color: 'var(--t2)', fontWeight: 500 }}
          >
            {detail.footEyebrow}
          </div>
          <div
            style={{
              fontFamily: 'var(--f-body)',
              fontSize: 13,
              color: 'var(--t2)',
              marginTop: 4,
              lineHeight: 1.5,
            }}
          >
            {detail.footBody}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Skeleton
// ─────────────────────────────────────────────────────────────────────

function ProfileSkeleton() {
  return (
    <>
      <Row>
        <Card span={7} style={{ minHeight: 280 }}><Skeleton height={220} /></Card>
        <Card span={5} style={{ minHeight: 280 }}><Skeleton height={220} /></Card>
      </Row>
      <Row>
        <Card span={12} style={{ minHeight: 320 }}><Skeleton height={260} /></Card>
      </Row>
      <Row>
        <Card span={3}><Skeleton height={180} /></Card>
        <Card span={3}><Skeleton height={180} /></Card>
        <Card span={3}><Skeleton height={180} /></Card>
        <Card span={3}><Skeleton height={180} /></Card>
      </Row>
      <Row>
        <Card span={4}><Skeleton height={220} /></Card>
        <Card span={8}><Skeleton height={220} /></Card>
      </Row>
      <Row>
        <Card span={12}><Skeleton height={300} /></Card>
      </Row>
    </>
  );
}
