/**
 * _backfill_canonical_runs.mjs · one-time canonical-model backfill.
 *
 * Walks every dedup-loser row (mergedIntoId set, absorbed_into_canonical_at
 * NULL) and pulls its unique non-null fields into the canonical row per
 * the source-tier doctrine. Stamps absorbed_into_canonical_at on the
 * loser when done.
 *
 * Idempotent: safe to re-run. Already-absorbed rows are skipped.
 *
 * Run: node web-v2/scripts/_backfill_canonical_runs.mjs
 */
import pg from 'pg';
import fs from 'fs';

const env = fs.readFileSync('.env.local','utf8').split('\n')
  .reduce((a,l)=>{const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)a[m[1]]=m[2].replace(/^["']|["']$/g,'');return a;},{});

const pool = new pg.Pool({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Inline the source-tier ladder. lib/runs/canonical.ts has the
// authoritative version · this mirrors it so the script can run without
// the TS build.
const SOURCE_TIER = {
  watch:          5,
  manual:         4,
  apple_watch:    3,
  apple_health:   2,
  strava:         1,
  strava_webhook: 1,
};
const tierFor = (s) => SOURCE_TIER[s ?? ''] ?? 0;

const NEVER_COPY = new Set([
  'id', 'activityId', 'source', 'ingestedAt', 'mergedIntoId',
  'client_workout_id', 'absorbed_into_canonical_at',
]);
const SPECIAL_ROUTE = new Set([
  'gear', 'gear_id', 'perceived_exertion', 'rpe',
]);

async function tryAttributeShoe({ userUuid, gear, gearId }) {
  let brand = '';
  let model = '';
  if (gear && typeof gear === 'object') {
    brand = String(gear.brand_name ?? gear.brand ?? '').trim();
    model = String(gear.model_name ?? gear.model ?? gear.name ?? '').trim();
  }
  if (!brand && !model) return null;

  if (brand && model) {
    let r = await pool.query(
      `SELECT id FROM shoes WHERE user_uuid = $1 AND retired = false
        AND LOWER(brand) = LOWER($2) AND LOWER(model) = LOWER($3) LIMIT 1`,
      [userUuid, brand, model],
    );
    if (r.rows[0]) return r.rows[0].id;

    r = await pool.query(
      `SELECT id FROM shoes WHERE user_uuid = $1 AND retired = false
        AND LOWER(brand) = LOWER($2)
        AND (LOWER(model) LIKE '%' || LOWER($3) || '%' OR LOWER($3) LIKE '%' || LOWER(model) || '%')
        LIMIT 1`,
      [userUuid, brand, model],
    );
    if (r.rows[0]) return r.rows[0].id;
  }
  return null;
}

async function processOneAbsorbed(absorbed, canonical) {
  const incomingSource = String(absorbed.data?.source ?? '');
  const incomingTier = tierFor(incomingSource);
  const incomingData = absorbed.data ?? {};

  const canonicalData = canonical.data ?? {};
  const canonicalProv = canonical.provenance ?? {};

  const fieldsAdded = [];
  const fieldsSkipped = [];

  const updatedData = { ...canonicalData };
  const updatedProv = { ...canonicalProv };

  for (const key of Object.keys(incomingData)) {
    if (NEVER_COPY.has(key)) continue;
    if (SPECIAL_ROUTE.has(key)) continue;
    const incomingVal = incomingData[key];
    if (incomingVal == null || incomingVal === '' ||
        (Array.isArray(incomingVal) && incomingVal.length === 0)) continue;

    const canonicalVal = canonicalData[key];
    const existingTier = tierFor(canonicalProv[key]);

    if (canonicalVal == null || canonicalVal === '' ||
        (Array.isArray(canonicalVal) && canonicalVal.length === 0)) {
      updatedData[key] = incomingVal;
      updatedProv[key] = incomingSource;
      fieldsAdded.push(key);
    } else if (incomingTier > existingTier) {
      updatedData[key] = incomingVal;
      updatedProv[key] = incomingSource;
      fieldsAdded.push(`${key}*`);
    } else {
      fieldsSkipped.push(key);
    }
  }

  // Special: gear → shoe_id
  let shoeAttributed = null;
  if (canonical.shoe_id == null) {
    const gear = incomingData.gear;
    const gearId = typeof incomingData.gear_id === 'string' ? incomingData.gear_id : null;
    const shoeId = await tryAttributeShoe({
      userUuid: absorbed.user_uuid,
      gear,
      gearId,
    });
    if (shoeId != null) {
      await pool.query(
        `UPDATE strava_activities SET shoe_id = $1 WHERE id = $2::BIGINT AND shoe_id IS NULL`,
        [shoeId, canonical.id],
      );
      shoeAttributed = shoeId;
      fieldsAdded.push('shoe_id');
    }
  }

  // Special: perceived_exertion → post_run_rpe
  let rpeWritten = null;
  const rpeRaw = incomingData.perceived_exertion ?? incomingData.rpe;
  if (typeof rpeRaw === 'number' && rpeRaw >= 1 && rpeRaw <= 10) {
    const existing = (await pool.query(
      `SELECT id FROM post_run_rpe WHERE user_uuid = $1 AND activity_id = $2 LIMIT 1`,
      [absorbed.user_uuid, String(canonical.id)],
    )).rows[0];
    if (!existing) {
      await pool.query(
        `INSERT INTO post_run_rpe (user_id, user_uuid, activity_id, rpe, notes, logged_at)
         VALUES ($1, $1, $2, $3, $4, NOW())`,
        [absorbed.user_uuid, String(canonical.id), Math.round(rpeRaw),
         `auto-imported from ${incomingSource}`],
      );
      rpeWritten = Math.round(rpeRaw);
      fieldsAdded.push('post_run_rpe');
    }
  }

  // Commit data + provenance update
  if (fieldsAdded.some(f => f !== 'shoe_id' && f !== 'post_run_rpe')) {
    await pool.query(
      `UPDATE strava_activities SET data = $1::jsonb, provenance = $2::jsonb
        WHERE id = $3::BIGINT`,
      [JSON.stringify(updatedData), JSON.stringify(updatedProv), canonical.id],
    );
  }

  // Stamp absorbed
  await pool.query(
    `UPDATE strava_activities SET absorbed_into_canonical_at = NOW()
      WHERE id = $1::BIGINT AND absorbed_into_canonical_at IS NULL`,
    [absorbed.id],
  );

  return { fieldsAdded, fieldsSkipped, shoeAttributed, rpeWritten };
}

async function main() {
  console.log('Walking dedup-loser rows…');

  // Pull all not-yet-absorbed mergedIntoId rows
  const losers = (await pool.query(
    `SELECT id::text AS id, user_uuid, data
       FROM strava_activities
      WHERE data ? 'mergedIntoId'
        AND absorbed_into_canonical_at IS NULL`,
  )).rows;

  console.log(`Found ${losers.length} dedup-loser rows to process.`);

  let processed = 0;
  let totalFieldsAdded = 0;
  let totalShoes = 0;
  let totalRPE = 0;
  const skippedNoCanonical = [];

  for (const loser of losers) {
    const canonicalId = String(loser.data?.mergedIntoId ?? '').trim();
    if (!canonicalId) continue;

    const canonical = (await pool.query(
      `SELECT id::text AS id, user_uuid, data, provenance, shoe_id
         FROM strava_activities
        WHERE id = $1::BIGINT`,
      [canonicalId],
    )).rows[0];

    if (!canonical) {
      skippedNoCanonical.push(loser.id + ' → ' + canonicalId);
      continue;
    }

    const result = await processOneAbsorbed(loser, canonical);
    processed++;
    totalFieldsAdded += result.fieldsAdded.length;
    if (result.shoeAttributed != null) totalShoes++;
    if (result.rpeWritten != null) totalRPE++;
  }

  console.log(`\nProcessed: ${processed}/${losers.length}`);
  console.log(`Total fields added to canonical rows: ${totalFieldsAdded}`);
  console.log(`Shoe attributions made: ${totalShoes}`);
  console.log(`RPE rows written: ${totalRPE}`);
  if (skippedNoCanonical.length > 0) {
    console.log(`\nSkipped (canonical not found):`);
    for (const s of skippedNoCanonical.slice(0, 5)) console.log('  ' + s);
    if (skippedNoCanonical.length > 5) console.log(`  + ${skippedNoCanonical.length - 5} more`);
  }

  console.log('\nDone.');
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
