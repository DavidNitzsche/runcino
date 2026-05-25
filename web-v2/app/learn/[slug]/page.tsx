import { TopNav } from '@/components/layout/TopNav';
import { pool } from '@/lib/db/pool';

export const dynamic = 'force-dynamic';

interface Article {
  slug: string;
  title: string;
  eyebrow: string | null;
  body_md: string;
  citations_json: Array<{ author: string; year: number; title: string; journal?: string; doi?: string; url?: string }>;
  related_slugs: string[];
}

const SEED: Record<string, Article> = {
  'why-rest-works': {
    slug: 'why-rest-works',
    title: 'Why rest works.',
    eyebrow: 'RECOVERY',
    body_md: [
      "Training doesn't make you fitter. Recovering from training does. The work tears the system down; the rest builds it back, stronger.",
      'Inside a single rest day, three things land: glycogen restocks, muscle micro-tears repair, and the nervous system that fired hard yesterday resets. Skip the rest and you skip the adaptation.',
      'The classic mistake: counting workouts, not adaptations. A week with two hard days plus rest produces more fitness than a week of seven moderate days.',
    ].join('\n\n'),
    citations_json: [
      { author: 'Seiler', year: 2010, title: "What is best practice for training intensity and duration distribution in endurance athletes?", journal: 'International Journal of Sports Physiology and Performance' },
      { author: 'Mujika', year: 2017, title: 'Endurance training: science and practice.', journal: 'Iñigo Mujika Editorial' },
    ],
    related_slugs: ['hrv', 'rhr'],
  },
  'hrv': {
    slug: 'hrv',
    title: 'HRV · What it is, why we watch it.',
    eyebrow: 'PHYSIOLOGY',
    body_md: [
      'Heart rate variability is the time variation between consecutive heartbeats, measured overnight. It is a window into your autonomic nervous system — sympathetic (fight/flight) vs parasympathetic (rest/digest).',
      "Higher HRV generally means your nervous system is recovered and ready for hard training. Lower HRV can signal fatigue, stress, illness brewing, or accumulating training load. It's one of the best early-warning signals we have for overtraining — dips in HRV often predict bad workouts before the legs do.",
      "We track YOUR baseline, not population norms. A 60ms reading is 'high' for some runners and 'low' for others. What matters is your trend versus your 30-day average.",
    ].join('\n\n'),
    citations_json: [
      { author: 'Plews et al.', year: 2013, title: 'Training adaptation and heart rate variability in elite endurance athletes.', journal: 'European Journal of Applied Physiology' },
      { author: 'Stanley et al.', year: 2013, title: 'Cardiac parasympathetic reactivation following exercise.', journal: 'Sports Medicine' },
    ],
    related_slugs: ['rhr', 'why-rest-works'],
  },
  'rhr': {
    slug: 'rhr',
    title: 'Resting heart rate.',
    eyebrow: 'PHYSIOLOGY',
    body_md: [
      'Resting heart rate trends downward as aerobic fitness improves. A sub-50 RHR is common in trained runners; sub-40 in elite endurance athletes.',
      'It elevates 3-5 bpm during volume jumps, illness brewing, dehydration, or sleep deficit. A sustained +5 bpm bump that doesn\'t resolve in a few days is the flag to take seriously.',
      "On its own, one elevated reading means nothing. The pattern across days is the signal. We watch the 7-day rolling average against your 60-day baseline.",
    ].join('\n\n'),
    citations_json: [
      { author: 'Buchheit', year: 2014, title: 'Monitoring training status with HR measures.', journal: 'Frontiers in Physiology' },
    ],
    related_slugs: ['hrv', 'vo2-max'],
  },
  'vo2-max': {
    slug: 'vo2-max',
    title: 'VO2 max.',
    eyebrow: 'PHYSIOLOGY',
    body_md: [
      'VO2 max is the peak oxygen your body can use per minute. It is the single best lab predictor of endurance ceiling. Higher VO2 max → faster aerobic running.',
      "Apple's watch estimate isn't lab-grade — it's modeled from heart rate and pace, plus your demographics. It's directionally honest, but absolute numbers should be taken with salt. Month-over-month moves in Apple's number are real signal.",
      'Trained endurance runners typically score 55-75 ml/kg/min for men, 50-65 for women. Elite is 80+.',
    ].join('\n\n'),
    citations_json: [
      { author: 'Bassett & Howley', year: 2000, title: 'Limiting factors for maximum oxygen uptake.', journal: 'Medicine & Science in Sports & Exercise' },
    ],
    related_slugs: ['hrv', 'rhr'],
  },
};

export default async function LearnPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let article: Article | null = null;

  // Try DB first; fall back to seed.
  try {
    const r = (await pool.query(
      `SELECT slug, title, eyebrow, body_md, citations_json, related_slugs
         FROM learn_articles WHERE slug = $1`,
      [slug]
    )).rows[0];
    if (r) {
      article = {
        slug: r.slug, title: r.title, eyebrow: r.eyebrow, body_md: r.body_md,
        citations_json: r.citations_json ?? [],
        related_slugs: r.related_slugs ?? [],
      };
    }
  } catch { /* table may be empty — fall through to seed */ }

  if (!article) article = SEED[slug] ?? null;

  if (!article) {
    return (
      <main>
        <TopNav />
        <div style={{ padding: '40px 40px', maxWidth: 880, margin: '0 auto' }}>
          <a href="/health" style={{ color: 'var(--mute)', fontFamily: 'var(--f-display)', fontSize: 14 }}>← BACK</a>
          <h1 style={{ fontFamily: 'var(--f-display)', fontSize: 56, marginTop: 20 }}>Article not found</h1>
          <p style={{ color: 'var(--mute)' }}>Slug: {slug}</p>
        </div>
      </main>
    );
  }

  return (
    <main>
      <TopNav />
      <div style={{ padding: '40px 40px 80px', maxWidth: 720, margin: '0 auto' }}>
        <a href="/health" style={{ color: 'var(--mute)', fontFamily: 'var(--f-display)', fontSize: 14, letterSpacing: '1.2px' }}>← BACK</a>
        <div style={{ color: 'var(--learn)', fontSize: 11, letterSpacing: '1.6px', textTransform: 'uppercase', fontWeight: 700, marginTop: 20 }}>
          LEARN{article.eyebrow ? ` · ${article.eyebrow}` : ''}
        </div>
        <h1 style={{ fontFamily: 'var(--f-display)', fontSize: 56, letterSpacing: '0.5px', margin: '8px 0 24px', lineHeight: 1.05 }}>
          {article.title}
        </h1>
        {article.body_md.split('\n\n').map((p, i) => (
          <p key={i} style={{ fontFamily: 'var(--f-body)', fontSize: 16, lineHeight: 1.7, color: 'rgba(246,247,248,0.86)', margin: '0 0 14px' }}>
            {p}
          </p>
        ))}

        {article.citations_json.length > 0 && (
          <>
            <div style={{ fontFamily: 'var(--f-body)', fontSize: 11, color: 'var(--mute)', letterSpacing: '1.4px', textTransform: 'uppercase', fontWeight: 700, marginTop: 24, marginBottom: 10 }}>
              WHAT THE RESEARCH SAYS
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {article.citations_json.map((c, i) => (
                <div key={i} style={{ borderLeft: '2px solid var(--learn)', paddingLeft: 12, fontSize: 13, lineHeight: 1.55, color: 'rgba(246,247,248,0.85)' }}>
                  <span style={{ color: 'var(--learn)', fontWeight: 600 }}>{c.author}, {c.year} →</span>{' '}
                  {c.title}
                  {c.journal ? <span style={{ color: 'var(--mute)' }}>{' '}({c.journal})</span> : null}
                </div>
              ))}
            </div>
          </>
        )}

        {article.related_slugs.length > 0 && (
          <>
            <div style={{ fontFamily: 'var(--f-body)', fontSize: 11, color: 'var(--mute)', letterSpacing: '1.4px', textTransform: 'uppercase', fontWeight: 700, marginTop: 32, marginBottom: 10 }}>
              RELATED
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {article.related_slugs.map((s) => (
                <a key={s} href={`/learn/${s}`} className="card" style={{ padding: '10px 16px', fontFamily: 'var(--f-display)', fontSize: 12, letterSpacing: '1px', color: 'var(--learn)' }}>
                  {s.replace(/-/g, ' ').toUpperCase()} →
                </a>
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
