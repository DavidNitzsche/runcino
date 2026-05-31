import pg from 'pg';
import fs from 'fs';
const env = fs.readFileSync('.env.local','utf8').split('\n').reduce((a,l)=>{const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)a[m[1]]=m[2].replace(/^["']|["']$/g,'');return a;},{});
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Simulate pickWorkout({ family: 'vo2max', distance: '5k', phase: 'race_specific', level: 'advanced' })
async function pick(family, distance, phase, level) {
  const r = await pool.query(
    `SELECT slug, prescription_text, citation
       FROM workout_library
      WHERE active AND family = $1
        AND ($2 = ANY(distance_focus) OR 'all' = ANY(distance_focus))
        AND ($3 = ANY(phase_fit))
        AND (level_fit = '{}' OR $4 = ANY(level_fit))
      ORDER BY id ASC LIMIT 1`,
    [family, distance, phase, level]
  );
  return r.rows[0] || null;
}

const tests = [
  ['vo2max',    '5k',  'race_specific', 'advanced'],
  ['threshold', '5k',  'quality',       'intermediate'],
  ['vo2max',    '10k', 'quality',       'intermediate'],
  ['vo2max',    'hm',  'quality',       'advanced'],
  ['threshold', 'm',   'race_specific', 'advanced'],
  ['vo2max',    'm',   'race_specific', 'advanced'],
  ['hills',     'all', 'base',          'intermediate'],
  ['fartlek',   '5k',  'build',         'intermediate'],
  ['long',      'm',   'race_specific', 'advanced'],
  ['speed',     'all', 'base',          'intermediate'],
  ['walk_run',  'all', 'base',          'beginner'],
];

for (const [f, d, p, l] of tests) {
  const w = await pick(f, d, p, l);
  console.log(`${f.padEnd(20)} ${d.padEnd(4)} ${p.padEnd(14)} ${l.padEnd(12)} → ${w ? w.slug + ' · ' + w.prescription_text : 'NO MATCH (would fall back to inline)'}`);
}
await pool.end();
