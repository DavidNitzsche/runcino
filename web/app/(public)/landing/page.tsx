import type { Metadata } from 'next';
import Link from 'next/link';
import '../public.css';
import './landing.css';

export const metadata: Metadata = {
  title: 'faff.run · A coach that reads the work',
  description: 'A self-contained running coach. Bring your runs from anywhere — Strava, your watch, or manual. faff.run builds the plan, watches every workout, and adapts in real time.',
};

export default function LandingPage() {
  return (
    <div className="faff-public-body">

      <nav className="faff-pub-nav">
        <div className="faff-pub-nav-inner">
          <Link className="faff-logo" href="/landing">faff.run</Link>
          <div className="faff-pub-actions">
            <Link className="faff-btn-link" href="/login">Sign in</Link>
            <Link className="faff-btn-primary" href="/signup">Sign up — free</Link>
          </div>
        </div>
      </nav>

      <div className="faff-land-page">

        {/* ══ HERO ══ */}
        <section className="faff-land-hero">
          <div className="faff-land-hero-left">
            <div className="faff-land-eyebrow">A self-contained running coach</div>
            <h1 className="faff-land-headline">
              A coach that<br />
              <em>reads the</em><br />
              <em>work.</em>
            </h1>
            <p className="faff-land-sub">
              Bring your runs from <strong>Strava, your watch, or just log them yourself</strong>.
              faff.run builds a 14-week plan toward your A-race, watches every workout,
              and adapts the loads in real time.
            </p>
            <div className="faff-land-cta-row">
              <Link className="faff-land-btn-primary" href="/signup">Sign up — free</Link>
              <Link className="faff-land-btn-secondary" href="/login">or sign in →</Link>
            </div>
            <div className="faff-land-trust">Free forever · No credit card · No tracking lock-in</div>
          </div>

          {/* Sample coach card — generic voice, not personal */}
          <div className="faff-land-sample">
            <div className="faff-land-sample-label">
              <span className="faff-land-dot"></span>Coach · the daily briefing
            </div>
            <div className="faff-land-sample-text">
              Three quality sessions stacked this week — body absorbing the load.
              Today is rest; tomorrow&apos;s long closes the block.
              <strong> The coach reads the data, not the calendar.</strong>
            </div>
            <div className="faff-land-sample-divider"></div>
            <div className="faff-land-sample-stats">
              <div>
                <div className="faff-land-sample-stat-label">Readiness</div>
                <div className="faff-land-sample-stat-value green">90</div>
              </div>
              <div>
                <div className="faff-land-sample-stat-label">Form</div>
                <div className="faff-land-sample-stat-value">+8</div>
              </div>
              <div>
                <div className="faff-land-sample-stat-label">Race in</div>
                <div className="faff-land-sample-stat-value orange">78<span className="faff-land-sample-stat-suffix">d</span></div>
              </div>
            </div>
          </div>
        </section>

        {/* ══ WHAT IT DOES ══ */}
        <section className="faff-land-section">
          <div className="faff-land-eyebrow">What it does</div>
          <h2 className="faff-land-section-title">A coach. A plan. Honest training.</h2>
          <p className="faff-land-section-sub">
            Three things, done well. Every recommendation is grounded in your data and in
            established training research — no vibes, no buzzwords.
          </p>
          <div className="faff-land-feature-grid">
            <div className="faff-land-feature">
              <div className="faff-land-feature-num">01</div>
              <div className="faff-land-feature-title">Reads your runs</div>
              <div className="faff-land-feature-body">
                Connect Strava, sync your watch, or log manually. faff.run pulls every
                activity into one stream — pace, heart rate, route, elevation, perceived
                effort. <strong>The data is yours, not locked to a platform.</strong>
              </div>
            </div>
            <div className="faff-land-feature">
              <div className="faff-land-feature-num">02</div>
              <div className="faff-land-feature-title">Builds the plan</div>
              <div className="faff-land-feature-body">
                Pick your A-race. faff.run generates a <strong>14-week periodized plan</strong>
                — Base, Build, Peak, Taper, Race — sized to your level and shaped by your
                schedule. Long-run day, quality days, rest days: all yours to set.
              </div>
            </div>
            <div className="faff-land-feature">
              <div className="faff-land-feature-num">03</div>
              <div className="faff-land-feature-title">Adapts as you go</div>
              <div className="faff-land-feature-body">
                Bad week? The plan absorbs it. Crushed a workout? The cap lifts. Daily
                check-ins (energy, soreness, stress) feed the readiness model.
                <strong> The coach watches the data, not the calendar.</strong>
              </div>
            </div>
          </div>
        </section>

        {/* ══ CONNECTORS ══ */}
        <section className="faff-land-section">
          <div className="faff-land-eyebrow">Bring your data</div>
          <h2 className="faff-land-section-title">From anywhere.</h2>
          <p className="faff-land-section-sub">
            Connect any source. Disconnect any source. Your runs aren&apos;t locked to one platform —
            they live in faff.run, where your coach can read them.
          </p>

          <div className="faff-land-connectors">
            <div className="faff-land-conn-cat">Activity sources</div>
            <div className="faff-land-conn-grid">
              {[
                ['strava', 'S', 'Strava', 'live', 'Live'],
                ['manual', '✎', 'Manual entry', 'live', 'Live'],
                ['gpx', 'GPX', 'GPX / FIT upload', 'soon', 'Soon'],
                ['apple', '♥', 'Apple Health', 'soon', 'Soon · iOS'],
                ['garmin', 'G', 'Garmin Connect', 'soon', 'Soon'],
                ['coros', 'C', 'Coros', 'planned', 'Planned'],
                ['polar', 'P', 'Polar Flow', 'planned', 'Planned'],
                ['suunto', 'S', 'Suunto App', 'planned', 'Planned'],
                ['wahoo', 'W', 'Wahoo Fitness', 'planned', 'Planned'],
                ['googlefit', 'GF', 'Google Fit', 'planned', 'Planned'],
              ].map(([key, glyph, name, status, statusLabel]) => (
                <div key={key} className="faff-land-conn">
                  <div className={`faff-land-conn-icon faff-land-conn-${key}`}>{glyph}</div>
                  <div className="faff-land-conn-name">{name}</div>
                  <div className={`faff-land-conn-meta ${status}`}>{statusLabel}</div>
                </div>
              ))}
            </div>

            <div className="faff-land-conn-cat">Coach platforms · plan-source mode</div>
            <div className="faff-land-conn-grid">
              <div className="faff-land-conn"><div className="faff-land-conn-icon faff-land-conn-finalsurge">F</div><div className="faff-land-conn-name">Final Surge</div><div className="faff-land-conn-meta planned">Planned</div></div>
              <div className="faff-land-conn"><div className="faff-land-conn-icon faff-land-conn-trainingpeaks">TP</div><div className="faff-land-conn-name">TrainingPeaks</div><div className="faff-land-conn-meta planned">Planned</div></div>
            </div>

            <div className="faff-land-conn-cat">Recovery + sleep signal</div>
            <div className="faff-land-conn-grid">
              <div className="faff-land-conn"><div className="faff-land-conn-icon faff-land-conn-whoop">W</div><div className="faff-land-conn-name">Whoop</div><div className="faff-land-conn-meta planned">Planned</div></div>
              <div className="faff-land-conn"><div className="faff-land-conn-icon faff-land-conn-oura">O</div><div className="faff-land-conn-name">Oura Ring</div><div className="faff-land-conn-meta planned">Planned</div></div>
            </div>
          </div>
        </section>

        {/* ══ FINAL CTA ══ */}
        <section>
          <div className="faff-land-final-cta">
            <div className="faff-land-final-eyebrow">Start training</div>
            <h2 className="faff-land-final-headline">
              Run with a coach<br />
              <em>who reads the work.</em>
            </h2>
            <p className="faff-land-final-sub">
              Sign up in 30 seconds. Connect Strava, pick your A-race, get your plan.
              Then go run.
            </p>
            <Link className="faff-land-btn-primary white" href="/signup">Sign up — free</Link>
            <div className="faff-land-final-trust">Free forever · No credit card · No tracking lock-in</div>
          </div>
        </section>

        <footer className="faff-land-footer">
          <div>
            <div className="faff-logo" style={{ fontSize: '18px' }}>faff.run</div>
            <div className="faff-land-footer-meta">A self-contained running coach · 2026</div>
          </div>
        </footer>

      </div>
    </div>
  );
}
