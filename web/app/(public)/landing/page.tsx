import type { Metadata } from 'next';
import Link from 'next/link';
import '../public.css';
import './landing.css';
import { LandingMotion } from './LandingMotion';

export const metadata: Metadata = {
  title: 'faff.run · Fast as FAFF',
  description:
    'A self-contained running coach. It reads every run, builds a 14-week plan to your A-race, and re-paces you hill-by-hill on race day — with cues on your wrist. Fast as faff.',
};

function WatchFace() {
  return (
    <div className="fr-watch-screen">
      <div className="fr-cycle" data-interval="2600">
        <div className="fr-wscreen active">
          <div><div className="wtop-k">Phase 3 · mi 10.8</div><div className="wtop-v">Hurricane climb</div></div>
          <div className="wmid"><div className="k">Target</div><div className="big">9:55</div><div className="u">/ mile</div></div>
          <div className="fr-wbot">
            <div><div className="live-k">LIVE</div><div className="live">9:52</div></div>
            <div style={{ textAlign: 'right' }}><div className="hr">168 <span className="z">Z4</span></div><div className="onpace">ON PACE</div></div>
          </div>
        </div>
        <div className="fr-wscreen alert fuel">
          <div className="wglyph" style={{ color: '#ff7a3d' }}>⌯</div>
          <div><div className="wlabel" style={{ color: '#ff7a3d' }}>Fuel</div><div className="wbig">Gel 2 + water</div><div className="wsmall">Before the Hurricane aid station</div></div>
          <div style={{ width: '100%' }}><div className="fr-wprog"><span style={{ width: '60%', background: '#ff7a3d' }} /></div></div>
        </div>
        <div className="fr-wscreen alert land">
          <div className="wglyph" style={{ color: '#7ea35a' }}>◆</div>
          <div><div className="wlabel" style={{ color: '#aebaa3' }}>Landmark</div><div className="wbig">Bixby Bridge<br />0.3 mi ahead</div><div className="wsmall">Halfway point</div></div>
          <div style={{ width: '100%' }}><div className="fr-wprog"><span style={{ width: '40%', background: '#7ea35a' }} /></div></div>
        </div>
      </div>
    </div>
  );
}

const MARQUEE = [
  ['Fast as FAFF', true], ['9:55 / mi', false], ['Hurricane Point', false],
  ['Fitness 52', true], ['Base · Build · Peak · Taper · Race', false], ['Grade-adjusted', true],
  ['Hill by hill', false], ['Readiness 88', true],
] as const;

export default function LandingPage() {
  return (
    <div className="faff-public-body fr">
      <div className="fr-grain" />
      <div className="fr-vignette" />

      <nav className="faff-pub-nav">
        <div className="faff-pub-nav-inner">
          <Link className="faff-logo" href="/landing">faff.run</Link>
          <div className="faff-pub-actions">
            <Link className="faff-btn-link" href="/login">Sign in</Link>
            <Link className="faff-btn-primary" href="/signup">Sign up — free</Link>
          </div>
        </div>
      </nav>

      {/* ══════════════ HERO ══════════════ */}
      <header className="fr-hero">
        <div className="fr-hero-bg" />
        <svg className="fr-topo" viewBox="0 0 1200 760" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <g className="fr-topo">
            {[60, 130, 210, 300, 400, 510, 630].map((r, i) => (
              <ellipse key={i} cx="940" cy="170" rx={r} ry={r * 0.74} fill="none" stroke="#FF5E1F" strokeWidth="1" />
            ))}
          </g>
        </svg>

        <div className="fr-wrap fr-hero-grid">
          <div>
            <div className="fr-hero-eyebrow"><span className="fr-kicker">A self-contained running coach</span></div>
            <h1 className="fr-hero-h1">
              <span className="l1">Fast as</span>
              <span className="l2">FAFF.</span>
            </h1>
            <p className="fr-lead fr-hero-lead">
              It reads every run, builds the plan, and paces you <b>hill-by-hill on race day</b>.
              No dashboards to babysit — just the work, done fast.
            </p>
            <div className="fr-cta-row fr-hero-cta">
              <Link className="fr-btn" href="/signup">Start free →</Link>
              <Link className="fr-btn-ghost" href="/login">Sign in</Link>
            </div>
            <div className="fr-note fr-hero-note">Free forever · No credit card · No tracking lock-in</div>
          </div>

          <div className="fr-hero-ring">
            <div className="fr-ring-obj">
              <svg viewBox="0 0 320 320">
                <circle className="fr-ring-track" cx="160" cy="160" r="132" fill="none" strokeWidth="16"
                  strokeDasharray="622 829" strokeLinecap="round" transform="rotate(135 160 160)" />
                <circle className="fr-ring-fill" cx="160" cy="160" r="132" fill="none" strokeWidth="16"
                  strokeDasharray="547 829" strokeLinecap="round" transform="rotate(135 160 160)" />
                <text className="fr-ring-num" x="160" y="186" fontSize="128" textAnchor="middle" data-countup="88">0</text>
                <text className="fr-ring-cap" x="160" y="224" fontSize="13" textAnchor="middle">READY</text>
              </svg>
            </div>
            <div className="fr-ring-meta"><b>Readiness 88</b> · green to push today</div>
          </div>
        </div>

        <div className="fr-scrollcue">Scroll<span /></div>
      </header>

      {/* ══════════════ MARQUEE ══════════════ */}
      <div className="fr-marquee">
        <div className="fr-marquee-track">
          {[0, 1].map((dup) => (
            <span key={dup} style={{ display: 'inline-flex' }}>
              {MARQUEE.map(([txt, orange], i) => (
                <span key={i} className={`fr-marq-item ${orange ? 'o' : ''}`}>{txt}<span className="star"> ✳ </span></span>
              ))}
            </span>
          ))}
        </div>
      </div>

      {/* ══════════════ COCKPIT (real dashboard) ══════════════ */}
      <section className="fr-section">
        <div className="fr-wrap fr-cockpit">
          <div className="fr-reveal">
            <div className="fr-eyebrow-block"><span className="fr-kicker">The cockpit</span></div>
            <h2 className="fr-h2">One <em>honest</em> view.</h2>
            <p className="fr-lead" style={{ marginTop: 22 }}>
              Open the app and the coach has already done the thinking — today&apos;s session, why it
              matters, your readiness, and where the week stands. <b>This is the real thing, live.</b>
            </p>
          </div>
          <div className="fr-reveal" data-delay="1">
            <div className="fr-device">
              <div className="fr-device-bar"><div className="tl"><span /><span /><span /></div><div className="u"><b>faff.run</b>/overview</div></div>
              <div className="fr-shot-wrap">
                <iframe className="fr-shot" src="/_app/overview-v4.html" data-w={1280} data-h={820} style={{ height: 820 }} title="faff.run overview" loading="lazy" scrolling="no" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════ THE PLAN · phases ══════════════ */}
      <section className="fr-section">
        <div className="fr-wrap">
          <div className="fr-reveal" style={{ maxWidth: '20ch' }}>
            <div className="fr-eyebrow-block"><span className="fr-kicker">The plan</span></div>
            <h2 className="fr-h2">Fourteen weeks. <span className="out">One arc.</span></h2>
          </div>
          <p className="fr-lead fr-reveal" data-delay="1" style={{ marginTop: 22 }}>
            Base, Build, Peak, Taper, Race — real periodization, not the same week on repeat. Pace
            zones tuned to your fitness, reshaped every time it moves.
          </p>

          <div className="fr-phases fr-reveal" data-delay="1">
            <div className="fr-phasebar">
              <div className="fr-phase p1"><span className="pw">WK 1–4</span><span className="pl">Base</span></div>
              <div className="fr-phase p2"><span className="pw">WK 5–8</span><span className="pl">Build</span></div>
              <div className="fr-phase p3"><span className="pw">WK 9–12</span><span className="pl">Peak</span></div>
              <div className="fr-phase p4"><span className="pw">WK 13</span><span className="pl">Taper</span></div>
              <div className="fr-phase p5"><span className="pw">WK 14</span><span className="pl">Race</span></div>
            </div>
            <div className="fr-zones">
              {[['E', '9:05', 'Easy'], ['M', '7:55', 'Marathon'], ['T', '7:10', 'Threshold'], ['I', '6:35', 'Interval'], ['R', '6:05', 'Rep']].map(([z, p, n]) => (
                <span className="fr-zone" key={z}><span className="zl">{z}</span>{n} <b>{p}</b>/mi</span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════ RACE DAY (climax + elevation route) ══════════════ */}
      <section className="fr-raceday fr-section fr-reveal">
        <svg className="fr-route" viewBox="0 0 1440 600" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <defs>
            <linearGradient id="frArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(255,94,31,.18)" /><stop offset="100%" stopColor="rgba(255,94,31,0)" />
            </linearGradient>
          </defs>
          <path className="area" d="M0,440 L120,420 L260,360 L380,250 L470,150 L560,250 L700,360 L820,300 L960,400 L1100,330 L1260,420 L1440,380 L1440,600 L0,600 Z" />
          <path className="line" d="M0,440 L120,420 L260,360 L380,250 L470,150 L560,250 L700,360 L820,300 L960,400 L1100,330 L1260,420 L1440,380" />
          <circle className="dot" cx="470" cy="150" r="7" />
        </svg>

        <div className="fr-wrap fr-raceday-grid">
          <div className="fr-watch-stage"><div className="fr-watch"><WatchFace /></div></div>
          <div>
            <div className="fr-eyebrow-block"><span className="fr-kicker">Race day</span></div>
            <h2 className="fr-h2">Dialed to the <em>mile.</em></h2>
            <p className="fr-lead" style={{ marginTop: 22 }}>
              Your race compiles to a native Apple Watch workout — no phone, no extra app. The watch
              walks you through every pace, fuel, and landmark, buzzing at each one.
            </p>
            <div className="fr-cues">
              <div className="fr-cue"><div className="pace">9:55<span className="s">/ MI · UP</span></div><div><div className="t">Grade-adjusted pace</div><div className="d">Targets shift on every climb and descent — even effort, not even clock.</div></div></div>
              <div className="fr-cue"><div className="pace">GEL<span className="s">MILE 8</span></div><div><div className="t">Fueling cues</div><div className="d">Gels and water buzz in at the right mile, anchored to the race phases.</div></div></div>
              <div className="fr-cue"><div className="pace">◆<span className="s">BIXBY</span></div><div><div className="t">Landmark pings</div><div className="d">Hand-curated cues so you know what&apos;s coming around the bend.</div></div></div>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════ DATA ══════════════ */}
      <section className="fr-section">
        <div className="fr-wrap">
          <div className="fr-reveal">
            <div className="fr-eyebrow-block"><span className="fr-kicker">Bring it all</span></div>
            <h2 className="fr-h2">Your data. <em>Yours to keep.</em></h2>
            <p className="fr-lead" style={{ marginTop: 22 }}>
              Connect any source, disconnect any source. Your runs aren&apos;t held hostage by one
              platform — they live in faff.run, where your coach can read them.
            </p>
          </div>
          <div className="fr-data-list fr-reveal" data-delay="1">
            {([
              ['Strava', 'live', 'Live'], ['Manual entry', 'live', 'Live'],
              ['GPX / FIT', 'soon', 'Soon'], ['Apple Health', 'soon', 'Soon'], ['Garmin', 'soon', 'Soon'],
              ['Coros', 'planned', 'Planned'], ['Polar', 'planned', 'Planned'], ['Suunto', 'planned', 'Planned'],
              ['Wahoo', 'planned', 'Planned'], ['Google Fit', 'planned', 'Planned'],
              ['TrainingPeaks', 'planned', 'Planned'], ['Whoop', 'planned', 'Planned'], ['Oura', 'planned', 'Planned'],
            ] as [string, string, string][]).map(([name, st, label], i) => (
              <span key={i} className={`fr-tag ${st === 'live' ? 'live' : ''}`}>{name}<span className={`st ${st}`}>{label}</span></span>
            ))}
          </div>

          <div className="fr-stats">
            <div className="fr-stat fr-reveal"><div className="n" data-countup="14">0</div><div className="l">Week plans</div></div>
            <div className="fr-stat fr-reveal" data-delay="1"><div className="n" data-countup="5">0</div><div className="l">Phases · Base→Race</div></div>
            <div className="fr-stat fr-reveal" data-delay="2"><div className="n" data-countup="30" data-suffix="+">0</div><div className="l">Watch cues / race</div></div>
            <div className="fr-stat fr-reveal" data-delay="3"><div className="n">$0</div><div className="l">Free forever</div></div>
          </div>
        </div>
      </section>

      {/* ══════════════ CTA ══════════════ */}
      <section className="fr-cta">
        <div className="fr-cta-bg" />
        <div className="fr-wrap">
          <h2 className="fr-cta-h">Run<br /><em>fast as faff.</em></h2>
          <div className="fr-cta-row">
            <Link className="fr-btn" href="/signup">Start free →</Link>
            <Link className="fr-btn-ghost" href="/login">Sign in</Link>
          </div>
          <div className="fr-note">Connect Strava, pick your A-race, get your plan. Then go run.</div>
        </div>
      </section>

      <footer className="fr-wrap fr-footer">
        <div className="fr-footer-brand">faff.run</div>
        <div className="fr-footer-meta">FAST AS FAFF · A SELF-CONTAINED RUNNING COACH · 2026</div>
      </footer>

      <LandingMotion />
    </div>
  );
}
