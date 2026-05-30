import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
async function q(sql, params=[]) { return (await pool.query(sql, params)).rows; }
try {
  // pgvector
  const ext = await q(`SELECT extname FROM pg_extension WHERE extname IN ('pgvector','vector','pgcrypto','citext') ORDER BY extname`);
  console.log('EXTENSIONS:', ext);

  // sample briefing payload
  const b = await q(`SELECT id, surface, mode, signature, payload FROM briefings ORDER BY generated_at DESC LIMIT 1`);
  console.log('\nLATEST BRIEFING:'); console.log('id:', b[0]?.id, 'surface:', b[0]?.surface, 'mode:', b[0]?.mode);
  console.log('payload keys:', Object.keys(b[0]?.payload || {}));
  console.log('payload preview:'); console.log(JSON.stringify(b[0]?.payload, null, 2).slice(0, 3000));

  // coach_usage modes
  const modes = await q(`SELECT DISTINCT mode, surface, COUNT(*)::int AS n FROM coach_usage GROUP BY mode, surface ORDER BY n DESC LIMIT 20`);
  console.log('\nCOACH MODES seen (top 20):', JSON.stringify(modes, null, 2));

  // check if any RAG/embedding-related tables exist
  const rag = await q(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND (table_name ILIKE '%chunk%' OR table_name ILIKE '%embedding%' OR table_name ILIKE '%conversation%' OR table_name ILIKE '%retrieval%' OR table_name ILIKE '%tool_call%')`);
  console.log('\nRAG/CHAT-shaped tables:', rag);

  // any conversation surfaces? check for chat threads
  const t = await q(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND (table_name ILIKE '%chat%' OR table_name ILIKE '%message%' OR table_name ILIKE '%thread%')`);
  console.log('Chat-shaped tables:', t);
} catch (e) { console.error(e); } finally { await pool.end(); }
