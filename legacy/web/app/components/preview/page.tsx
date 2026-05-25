/**
 * Preview gallery, visual QA harness for the May 2026 component library.
 *
 * Renders every component from `app/components/` in a single page at
 * `/components/preview`. This is purely for visual inspection during
 * the design-system migration. Not linked from anywhere in the app.
 *
 * Layout: each section is a Card, with the component(s) inside.
 */

'use client';

import { useState } from 'react';
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
  ModalOverlay,
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Field,
  Input,
  Textarea,
  InputWithUnit,
  ChipPick,
  ChipGroup,
  RadioRow,
  RadioList,
  Dropdown,
  DropdownItem,
  DropdownGroup,
  DropdownSeparator,
  DatePicker,
  TimePicker,
  FileDrop,
  EmptyState,
  Skeleton,
  MileChip,
  RouteMap,
  ElevationGradient,
  CoachRead,
} from '..';

export default function PreviewGalleryPage() {
  const [modal, setModal] = useState<null | 'edit' | 'action' | 'confirm' | 'modal-confirm'>(null);
  const [chip, setChip] = useState('weekly');
  const [radio, setRadio] = useState('saturday');
  const [priority, setPriority] = useState('A');
  const [distance, setDistance] = useState('HALF');
  const [raceDate, setRaceDate] = useState('2026-08-16');
  const [goalTime, setGoalTime] = useState('1:35');
  const [splitTime, setSplitTime] = useState('7:15');
  const [gpxName, setGpxName] = useState<string | null>(null);

  return (
    <Stage>
      <Topbar
        activeTab={null}
        back={{ href: '/', label: 'BACK TO APP' }}
        clock={
          <>
            FRI · MAY 9 · <b>4:42 PM</b>
          </>
        }
      />

      {/* ─── Greet ─── */}
      <SectionHeading label="GREET BAND · run-detail variant" />
      <Greet>
        <GreetId eyebrow="RUN DETAIL · WED MAY 6" title="Easy 6.7 mi" />
        <GreetState>
          <GreetTile
            eyebrow="DISTANCE"
            value="6.7"
            unit="MI"
            delta="+4.7 VS PLAN"
            deltaColor="var(--corp)"
          />
          <GreetTile eyebrow="TIME" value="59:18" delta="1:02 ELAPSED" />
          <GreetTile
            variant="good"
            eyebrow="AVG PACE"
            value="8:50"
            unit="/MI"
            delta="EASY · DANIELS E"
            deltaColor="var(--good)"
          />
          <GreetTile eyebrow="AVG HR" value="142" unit="BPM" delta="76% MAX · Z1-Z2" />
          <GreetTile eyebrow="ELEVATION" value="182" unit="FT" delta="ROLLING · NEUTRAL" />
        </GreetState>
      </Greet>

      <SectionHeading label="GREET BAND · overview-page variant (5 state tiles)" />
      <Greet>
        <GreetId eyebrow="GOOD MORNING · DAVID" title="Friday 5/9" />
        <GreetState>
          <GreetTile variant="good" eyebrow="PHASE" value="REC 2/2" delta="DAY 6 POST-SOMBRERO" />
          <GreetTile variant="race" eyebrow="A-RACE" value="98" unit="D" delta="AFC HALF" />
          <GreetTile variant="amber" eyebrow="WEEK" value="22" unit="MI" delta="+8.1 OVER" />
          <GreetTile variant="good" eyebrow="READINESS" value="88" unit="/100" delta="BUILDING +0.30" />
          <GreetTile variant="amber" eyebrow="TODAY" value="3.0" unit="MI" delta="RECOVERY JOG" />
        </GreetState>
      </Greet>

      {/* ─── Card variants ─── */}
      <SectionHeading label="CARDS · base + 6 wash variants" />
      <Row>
        <Card span={4}>
          <CardHeader>
            <CardLabel>WEEKLY MILES</CardLabel>
            <CardPin variant="green">+12% V8W</CardPin>
          </CardHeader>
          <div className="card-num" style={{ fontSize: 48 }}>
            22<small>MI</small>
          </div>
          <CardFoot left="PEAK APR 13–19" right="42 MI" />
        </Card>
        <Card span={4} wash="coach">
          <CardHeader>
            <CardLabel color="var(--coach)">▸ PLAN ADAPTED</CardLabel>
            <CardPin variant="coach">+12%</CardPin>
          </CardHeader>
          <div className="t-section" style={{ fontSize: 20, marginTop: 4 }}>
            Coach lifted long-run cap
          </div>
          <CardFoot left="VOL 14→17" right="LONG 7.4→8.2" />
        </Card>
        <Card span={4} wash="race">
          <CardHeader>
            <CardLabel color="var(--race)">A-RACE · 98 D</CardLabel>
            <CardPin variant="race">AFC HALF</CardPin>
          </CardHeader>
          <div className="card-num" style={{ fontSize: 64, color: 'var(--race)' }}>
            98<small>DAYS</small>
          </div>
          <CardFoot left="BUILD STARTS 14D" right="GOAL 1:35" />
        </Card>
      </Row>
      <Row>
        <Card span={3} wash="amber">
          <CardHeader>
            <CardLabel>TODAY</CardLabel>
            <CardPin variant="amber">REC</CardPin>
          </CardHeader>
          <div className="card-num" style={{ fontSize: 32 }}>
            3.0<small>MI</small>
          </div>
        </Card>
        <Card span={3} wash="good">
          <CardHeader>
            <CardLabel>READINESS</CardLabel>
            <CardPin variant="green">88</CardPin>
          </CardHeader>
          <div className="card-num" style={{ fontSize: 32 }}>
            BUILDING
          </div>
        </Card>
        <Card span={3} wash="warn">
          <CardHeader>
            <CardLabel>OVERREACH</CardLabel>
            <CardPin variant="warn">ALERT</CardPin>
          </CardHeader>
          <div className="card-num" style={{ fontSize: 32 }}>
            1.34
          </div>
        </Card>
        <Card span={3} wash="xp">
          <CardHeader>
            <CardLabel>MILESTONE</CardLabel>
            <CardPin variant="purple">YEAR</CardPin>
          </CardHeader>
          <div className="card-num" style={{ fontSize: 32 }}>
            503<small>MI YTD</small>
          </div>
        </Card>
      </Row>

      {/* ─── Coach Read ─── */}
      <SectionHeading label="COACH READ · with decision deltas" />
      <Row>
        <CoachRead
          pin="+12% BASELINE UNLOCKED"
          title="Recovery run, but you absorbed more."
          deltas={[
            { label: 'VOL / WK', before: '14', after: '17', unit: 'mi' },
            { label: 'LONG RUN CAP', before: '7.4', after: '8.2', unit: 'mi' },
          ]}
          span={12}
        >
          Ran <b style={{ color: 'var(--t0)', fontWeight: 600 }}>+4.7 mi over plan</b> at{' '}
          <b style={{ color: 'var(--t0)', fontWeight: 600 }}>RPE −0.4</b>. HR stayed Z1–Z2 the
          whole way. Coach bumped baseline +12%, lifted long-run cap to 8.2 mi.
        </CoachRead>
      </Row>

      {/* ─── Mile chips + elevation ─── */}
      <SectionHeading label="MILE-BY-MILE · elevation gradient + 7 chips" />
      <Row>
        <Card span={12}>
          <CardHeader>
            <div>
              <CardLabel>MILE-BY-MILE · 7 SPLITS</CardLabel>
              <div className="h-mid" style={{ fontSize: 16, marginTop: 3 }}>
                Elevation by grade <span style={{ color: 'var(--t3)', fontWeight: 400 }}>·</span> pace, HR per mile below
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <CardPin variant="green">▼ NEGATIVE SPLIT</CardPin>
              <CardPin variant="amber">CLIMB AT MI 3</CardPin>
            </div>
          </CardHeader>

          {/* Grade legend strip · explains the colored elevation band below */}
          <div
            style={{
              display: 'flex',
              gap: 14,
              marginTop: 10,
              fontFamily: 'var(--f-data)',
              fontSize: 9,
              letterSpacing: '.8px',
              fontWeight: 700,
              color: 'var(--t3)',
              alignItems: 'center',
            }}
          >
            <span className="t-eyebrow" style={{ color: 'var(--t2)' }}>ELEVATION</span>
            <span>
              <span style={{ display: 'inline-block', width: 8, height: 8, background: '#FC4D64', borderRadius: 2, verticalAlign: 'middle', marginRight: 5 }} />
              STEEP ≥4%
            </span>
            <span>
              <span style={{ display: 'inline-block', width: 8, height: 8, background: '#F3AD38', borderRadius: 2, verticalAlign: 'middle', marginRight: 5 }} />
              UP 1–4%
            </span>
            <span>
              <span style={{ display: 'inline-block', width: 8, height: 8, background: 'rgba(244,246,248,.35)', borderRadius: 2, verticalAlign: 'middle', marginRight: 5 }} />
              FLAT ±1%
            </span>
            <span>
              <span style={{ display: 'inline-block', width: 8, height: 8, background: '#3EBD41', borderRadius: 2, verticalAlign: 'middle', marginRight: 5 }} />
              DESCENT
            </span>
            <span style={{ marginLeft: 'auto', color: 'var(--att)' }}>▲ PEAK 528 FT · MI 3</span>
          </div>

          <ElevationGradient
            points={[
              { mile: 0, elev: 200, grade: 1.6 },
              { mile: 1, elev: 240, grade: 1.6 },
              { mile: 2, elev: 280, grade: 1.4 },
              { mile: 3, elev: 528, grade: 4.8 },
              { mile: 4, elev: 470, grade: -2.1 },
              { mile: 5, elev: 415, grade: -1.6 },
              { mile: 6, elev: 405, grade: -0.2 },
              { mile: 6.7, elev: 400, grade: -0.2 },
            ]}
            peak={{ mile: 3, elev: 528 }}
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6, marginTop: 8 }}>
            <MileChip label="M1" pace="8:55" hr="138 BPM · Z1" grade="+1.6%" gradeKind="up" />
            <MileChip label="M2" pace="8:50" hr="141 BPM · Z1-2" grade="+1.4%" gradeKind="up" />
            <MileChip
              label="M3"
              pace="8:45"
              hr="148 BPM · Z2"
              grade="+4.8%"
              gradeKind="steep"
              variant="att"
            />
            <MileChip label="M4" pace="8:52" hr="142 BPM · Z2" grade="−2.1%" gradeKind="down" />
            <MileChip label="M5" pace="8:55" hr="140 BPM · Z1-2" grade="−1.6%" gradeKind="down" />
            <MileChip label="M6" pace="8:50" hr="143 BPM · Z2" grade="−0.2%" gradeKind="flat" />
            <MileChip label="KICK 0.7" pace="8:42" hr="152 BPM · Z2+" grade="−0.2%" gradeKind="flat" />
          </div>
          <CardFoot
            left="SLOWEST M1/M5 · 8:55 · FASTEST KICK · 8:42"
            right="▲ +6 SPM ON KICK · POLARIZED"
          />
        </Card>
      </Row>

      {/* ─── Route map ─── */}
      <SectionHeading label="ROUTE MAP" />
      <Row>
        <Card span={6} style={{ padding: 0 }}>
          <div style={{ padding: '14px 18px 0 18px' }}>
            <CardHeader>
              <CardLabel>ROUTE · LIBERTY STATION</CardLabel>
              <CardPin variant="muted">SAN DIEGO</CardPin>
            </CardHeader>
          </div>
          <RouteMap
            bayHint
            start={{ x: 60, y: 190 }}
            finish={{ x: 95, y: 200 }}
            miles={[
              { x: 135, y: 140, n: 1 },
              { x: 215, y: 80, n: 2 },
              { x: 340, y: 52, n: 3, emphasize: true },
              { x: 450, y: 100, n: 4 },
              { x: 510, y: 180, n: 5 },
              { x: 395, y: 237, n: 6 },
            ]}
            points={[
              { x: 60, y: 190 },
              { x: 100, y: 165 },
              { x: 140, y: 145 },
              { x: 170, y: 115 },
              { x: 240, y: 55 },
              { x: 320, y: 50 },
              { x: 440, y: 70 },
              { x: 485, y: 115 },
              { x: 535, y: 185 },
              { x: 510, y: 215 },
              { x: 410, y: 240 },
              { x: 320, y: 235 },
              { x: 140, y: 220 },
              { x: 60, y: 190 },
            ]}
            startTime="▶ 8:42 AM"
            routeLabel="LOOP · 6.7 MI"
            finishLabel="OPEN →"
          />
        </Card>
        <Card span={6}>
          <CardHeader>
            <CardLabel>EMPTY ROUTE STATE</CardLabel>
            <CardPin variant="muted">PLACEHOLDER</CardPin>
          </CardHeader>
          <RouteMap bayHint />
          <CardFoot left="NO GPX UPLOADED" right="DRAG-DROP TO POPULATE" />
        </Card>
      </Row>

      {/* ─── Form fields ─── */}
      <SectionHeading label="FORM FIELDS · field + input + select + textarea + unit + help" />
      <Row>
        <Card span={6}>
          <CardHeader>
            <CardLabel>FIELDS</CardLabel>
          </CardHeader>
          <Field label="Race name" help="The pretty name. Coach uses this in plan emails.">
            <Input defaultValue="Americas Finest City Half" />
          </Field>
          <Field label="Goal time" help={<>Target finish, pace zones derive from this.</>}>
            <Input type="text" className="num" defaultValue="1:35:00" placeholder="HH:MM:SS" />
          </Field>
          <Field label="Distance">
            <InputWithUnit type="number" defaultValue={13.1} unit="MI" />
          </Field>
          <Field label="Priority" help="Custom Dropdown, Radix-powered, no native popup.">
            <Dropdown value={priority} onValueChange={setPriority} ariaLabel="Race priority">
              <DropdownItem value="A">A · season anchor</DropdownItem>
              <DropdownItem value="B">B · tune-up</DropdownItem>
              <DropdownItem value="C">C · social / sentimental</DropdownItem>
            </Dropdown>
          </Field>
          <Field label="Distance preset">
            <Dropdown value={distance} onValueChange={setDistance} ariaLabel="Race distance">
              <DropdownGroup label="Road">
                <DropdownItem value="5K">5K</DropdownItem>
                <DropdownItem value="10K">10K</DropdownItem>
                <DropdownItem value="HALF">Half marathon</DropdownItem>
                <DropdownItem value="FULL">Marathon</DropdownItem>
              </DropdownGroup>
              <DropdownSeparator />
              <DropdownGroup label="Trail / ultra">
                <DropdownItem value="50K">50K</DropdownItem>
                <DropdownItem value="50M">50 miler</DropdownItem>
                <DropdownItem value="100K">100K</DropdownItem>
              </DropdownGroup>
            </Dropdown>
          </Field>
          <Field label="Notes" help={<><b>Optional.</b> Sentimental context that doesn't fit elsewhere.</>}>
            <Textarea rows={3} placeholder="First half since the calf rebuild..." />
          </Field>
        </Card>

        <Card span={6}>
          <CardHeader>
            <CardLabel>CHIP-PICK · single-select</CardLabel>
          </CardHeader>
          <ChipGroup>
            {['weekly', 'monthly', 'season', 'year'].map((id) => (
              <ChipPick key={id} active={chip === id} onClick={() => setChip(id)}>
                {id.toUpperCase()}
              </ChipPick>
            ))}
          </ChipGroup>
          <div style={{ marginTop: 16 }}>
            <CardLabel>CHIP-PICK · active variants</CardLabel>
          </div>
          <ChipGroup>
            <ChipPick active variant="corp">CORP</ChipPick>
            <ChipPick active variant="race">RACE</ChipPick>
            <ChipPick active variant="coach">COACH</ChipPick>
            <ChipPick active variant="good">GOOD</ChipPick>
            <ChipPick active variant="amber">AMBER</ChipPick>
            <ChipPick active variant="warn">WARN</ChipPick>
            <ChipPick active variant="purple">PURPLE</ChipPick>
          </ChipGroup>

          <div style={{ marginTop: 20 }}>
            <CardLabel>RADIO ROW · long-run day</CardLabel>
          </div>
          <RadioList>
            {[
              { id: 'saturday', label: 'Saturday', meta: 'Default · weekend long run', aux: 'PREFERRED' },
              { id: 'sunday', label: 'Sunday', meta: 'Recovery-day swap' },
              { id: 'weekday', label: 'Weekday', meta: 'Off-schedule (vacation, race)', aux: 'RARE' },
            ].map((r) => (
              <RadioRow
                key={r.id}
                active={radio === r.id}
                onSelect={() => setRadio(r.id)}
                label={r.label}
                meta={r.meta}
                aux={r.aux}
              />
            ))}
          </RadioList>
        </Card>
      </Row>

      {/* ─── Custom-painted controls (Dropdown / DatePicker / TimePicker / FileDrop) ─── */}
      <SectionHeading label="CUSTOM CONTROLS · no native browser chrome" />
      <Row>
        <Card span={6}>
          <CardHeader>
            <CardLabel>DROPDOWN · radix-portal popup</CardLabel>
            <CardPin variant="muted">REPLACES &lt;SELECT&gt;</CardPin>
          </CardHeader>
          <Field label="Priority" help="Selected = corp left-rail + check glyph on the right.">
            <Dropdown value={priority} onValueChange={setPriority} ariaLabel="Priority demo">
              <DropdownItem value="A">A · season anchor</DropdownItem>
              <DropdownItem value="B">B · tune-up</DropdownItem>
              <DropdownItem value="C">C · social / sentimental</DropdownItem>
            </Dropdown>
          </Field>
          <Field label="Grouped + separated">
            <Dropdown value={distance} onValueChange={setDistance} ariaLabel="Distance demo">
              <DropdownGroup label="Road">
                <DropdownItem value="5K">5K</DropdownItem>
                <DropdownItem value="10K">10K</DropdownItem>
                <DropdownItem value="HALF">Half marathon</DropdownItem>
                <DropdownItem value="FULL">Marathon</DropdownItem>
              </DropdownGroup>
              <DropdownSeparator />
              <DropdownGroup label="Trail / ultra">
                <DropdownItem value="50K">50K</DropdownItem>
                <DropdownItem value="50M">50 miler</DropdownItem>
                <DropdownItem value="100K">100K</DropdownItem>
              </DropdownGroup>
            </Dropdown>
          </Field>
        </Card>
        <Card span={6}>
          <CardHeader>
            <CardLabel>DATE / TIME · custom calendar + masked input</CardLabel>
            <CardPin variant="muted">REPLACES NATIVE</CardPin>
          </CardHeader>
          <Field label="Race date" help="React-day-picker themed for the dark system.">
            <DatePicker value={raceDate} onValueChange={setRaceDate} min="2026-01-01" />
          </Field>
          <Field label="Goal time" help="Type `1:35` (1h 35m) or `1:35:42` for second-precision. No leading zero on hours.">
            <TimePicker value={goalTime} onValueChange={setGoalTime} format="auto" />
          </Field>
          <Field label="Mile split" help="MM:SS format for short durations (paces, intervals).">
            <TimePicker value={splitTime} onValueChange={setSplitTime} format="MM:SS" />
          </Field>
        </Card>
      </Row>
      <Row>
        <Card span={6}>
          <CardHeader>
            <CardLabel>FILEDROP · drag or click</CardLabel>
            <CardPin variant="muted">REPLACES &lt;INPUT TYPE=FILE&gt;</CardPin>
          </CardHeader>
          <Field label="GPX upload">
            <FileDrop
              accept=".gpx,.tcx"
              hint="GPX or TCX up to 10 MB"
              onFile={(_text, file) => setGpxName(file.name)}
            />
          </Field>
          {gpxName && (
            <div className="field-help" style={{ marginTop: -8 }}>
              Loaded: <b>{gpxName}</b>
            </div>
          )}
        </Card>
        <Card span={6}>
          <CardHeader>
            <CardLabel>MODAL CONFIRM · replaces window.confirm()</CardLabel>
            <CardPin variant="warn">PATTERN</CardPin>
          </CardHeader>
          <p className="field-help">
            Native <code>confirm()</code> dialogs are OS-themed and block the JS thread. Use the
            existing <b>&lt;Modal&gt;</b> primitives with a danger button instead, same focus
            management, no chrome leak.
          </p>
          <div style={{ marginTop: 12 }}>
            <button
              className="btn-flat btn-danger"
              onClick={() => setModal('modal-confirm')}
            >
              TRIGGER CONFIRM
            </button>
          </div>
        </Card>
      </Row>

      {/* ─── States ─── */}
      <SectionHeading label="STATE ATOMS · empty / error / success / skeleton" />
      <Row>
        <Card span={3}>
          <EmptyState
            variant="empty"
            title="No runs yet"
            body="Connect Strava or drop a GPX to seed the log."
            cta={<button className="btn-flat btn-primary">CONNECT STRAVA</button>}
          />
        </Card>
        <Card span={3}>
          <EmptyState
            variant="error"
            title="Couldn't load"
            body="Something went sideways. Check the network and retry."
            cta={<button className="btn-flat btn-secondary">RETRY</button>}
          />
        </Card>
        <Card span={3}>
          <EmptyState
            variant="success"
            title="All caught up"
            body="Every workout in the last 30 days has a verdict."
          />
        </Card>
        <Card span={3}>
          <CardHeader>
            <CardLabel>SKELETON · loading</CardLabel>
          </CardHeader>
          <Skeleton height={18} width="55%" />
          <Skeleton height={36} />
          <Skeleton height={14} width="80%" />
          <Skeleton height={14} width="45%" />
          <Skeleton height={60} borderRadius={8} />
        </Card>
      </Row>

      {/* ─── Modal triggers ─── */}
      <SectionHeading label="MODALS · click a button to see overlay" />
      <Row>
        <Card span={12}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn-flat btn-primary" onClick={() => setModal('edit')}>
              OPEN EDIT MODAL
            </button>
            <button className="btn-flat btn-coach" onClick={() => setModal('action')}>
              OPEN ACTION MODAL
            </button>
            <button className="btn-flat btn-danger" onClick={() => setModal('confirm')}>
              OPEN CONFIRM MODAL
            </button>
          </div>
        </Card>
      </Row>

      {modal === 'edit' && (
        <ModalOverlay onClose={() => setModal(null)}>
          <Modal>
            <ModalHeader
              eyebrow="EDIT"
              title="A-RACE GOAL"
              onClose={() => setModal(null)}
            />
            <ModalBody>
              <Field label="Goal time" help="Coach derives pace zones from this.">
                <Input className="num" defaultValue="1:35:00" />
              </Field>
              <Field label="Confidence">
                <ChipGroup>
                  <ChipPick active>HIGH</ChipPick>
                  <ChipPick>MEDIUM</ChipPick>
                  <ChipPick>STRETCH</ChipPick>
                </ChipGroup>
              </Field>
            </ModalBody>
            <ModalFooter split>
              <span className="foot-meta">Coach predicts 1:32 from current fitness.</span>
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn-flat btn-secondary" onClick={() => setModal(null)}>
                  CANCEL
                </button>
                <button className="btn-flat btn-primary" onClick={() => setModal(null)}>
                  SAVE
                </button>
              </div>
            </ModalFooter>
          </Modal>
        </ModalOverlay>
      )}

      {modal === 'action' && (
        <ModalOverlay onClose={() => setModal(null)}>
          <Modal size="wide">
            <ModalHeader
              eyebrow="ADD"
              title="PERSONAL GOAL"
              onClose={() => setModal(null)}
            />
            <ModalBody>
              <Field label="Goal type">
                <ChipGroup>
                  <ChipPick active variant="corp">VOLUME</ChipPick>
                  <ChipPick>SPEED</ChipPick>
                  <ChipPick>DISTANCE</ChipPick>
                  <ChipPick>HABIT</ChipPick>
                  <ChipPick>STRENGTH</ChipPick>
                  <ChipPick>HEALTH</ChipPick>
                </ChipGroup>
              </Field>
              <Field
                label="Target"
                help={<><b>Volume.</b> Coach respects this when ramping weekly mileage.</>}
              >
                <InputWithUnit type="number" defaultValue={1800} unit="MI / YEAR" />
              </Field>
            </ModalBody>
            <ModalFooter split>
              <span className="foot-meta">▸ Coach will bump +12% absorbed weeks.</span>
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn-flat btn-secondary" onClick={() => setModal(null)}>
                  CANCEL
                </button>
                <button className="btn-flat btn-coach" onClick={() => setModal(null)}>
                  ADD GOAL
                </button>
              </div>
            </ModalFooter>
          </Modal>
        </ModalOverlay>
      )}

      {modal === 'confirm' && (
        <ModalOverlay onClose={() => setModal(null)}>
          <Modal size="narrow">
            <ModalHeader
              eyebrow="CONFIRM"
              title="RETIRE SHOE"
              onClose={() => setModal(null)}
            />
            <ModalBody>
              <Field label="Shoe">
                <div
                  style={{
                    padding: '12px 14px',
                    background: 'var(--l2)',
                    border: '1px solid var(--l4)',
                    borderRadius: 8,
                  }}
                >
                  <div className="t-section" style={{ fontSize: 18 }}>Speedgoat 5</div>
                  <div className="mono-sm" style={{ color: 'var(--t3)', marginTop: 4 }}>
                    287 / 400 MI · 6 MO
                  </div>
                </div>
              </Field>
              <p className="field-help">
                Retired shoes stay in your log but are removed from rotation. This can't be undone.
              </p>
            </ModalBody>
            <ModalFooter>
              <button className="btn-flat btn-secondary" onClick={() => setModal(null)}>
                CANCEL
              </button>
              <button className="btn-flat btn-danger" onClick={() => setModal(null)}>
                RETIRE
              </button>
            </ModalFooter>
          </Modal>
        </ModalOverlay>
      )}

      {modal === 'modal-confirm' && (
        <ModalOverlay onClose={() => setModal(null)}>
          <Modal size="narrow">
            <ModalHeader
              eyebrow="CONFIRM"
              title="DISCARD CHANGES?"
              onClose={() => setModal(null)}
            />
            <ModalBody>
              <p className="field-help">
                You have unsaved edits to the race goal. Closing now will lose them. This
                replaces <code>window.confirm()</code>, same blocking-intent, no OS chrome.
              </p>
            </ModalBody>
            <ModalFooter>
              <button className="btn-flat btn-secondary" onClick={() => setModal(null)}>
                KEEP EDITING
              </button>
              <button className="btn-flat btn-danger" onClick={() => setModal(null)}>
                DISCARD
              </button>
            </ModalFooter>
          </Modal>
        </ModalOverlay>
      )}

      <div className="footnote">
        <span>
          <b>/components/preview</b>, visual QA harness · May 2026 design system
        </span>
        <span>Last updated 2026-05-11</span>
      </div>
    </Stage>
  );
}

function SectionHeading({ label }: { label: string }) {
  return (
    <div style={{ margin: '28px 4px 8px' }}>
      <div className="t-eyebrow">{label}</div>
    </div>
  );
}
