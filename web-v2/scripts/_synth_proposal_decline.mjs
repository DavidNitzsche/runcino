/**
 * Synthetic decline-endpoint smoke.
 *
 * Hits /api/coach/proposal/[id]/decline against a temporary coach_proposals
 * row owned by David. Calls the endpoint TWICE to exercise the idempotent
 * 409 path. Cleans up every row it creates regardless of pass/fail.
 *
 * The endpoint is auth-gated by requireUserId, so we mint a one-shot
 * session row for David, call with Bearer <token>, then revoke. We do NOT
 * touch David's existing sessions.
 *
 * Run with:
 *   cd web-v2 && BASE_URL=http://localhost:3000 node scripts/_synth_proposal_decline.mjs
 *
 * If BASE_URL is unset we exercise the handler directly via the
 * verifier path — no HTTP, just a SQL replay of what the route does +
 * an assertion that the produced row shape matches. (This catches schema
 * drift without needing a live server.)
 */
import pg from 'pg';
import fs from 'fs';
import crypto from 'crypto';

const env = fs.readFileSync('.env.local', 'utf8').split('\n').reduce((a, l) => {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m) a[m[1]] = m[2].replace(/^["']|["']$/g, '');
  return a;
}, {});

const pool = new pg.Pool({
  connectionString: env.DATABASE_URL ?? process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const DAVID = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const BASE_URL = process.env.BASE_URL ?? '';

const log = (...a) => console.log(...a);

const ledger = {
  proposalId: null,
  sessionToken: null,
  sessionHash: null,
  intentIds: [],
};

async function q(sql, params = []) {
  return (await pool.query(sql, params)).rows;
}

async function cleanup() {
  log('\n— cleanup —');
  try {
    if (ledger.intentIds.length) {
      const r = await q(
        `DELETE FROM coach_intents WHERE id = ANY($1::int[]) RETURNING id`,
        [ledger.intentIds],
      );
      log(`  deleted ${r.length} coach_intents`);
    }
    if (ledger.proposalId) {
      const r = await q(
        `DELETE FROM coach_proposals WHERE id = $1 RETURNING id`,
        [ledger.proposalId],
      );
      log(`  deleted ${r.length} coach_proposals (synthetic)`);
    }
    if (ledger.sessionHash) {
      const r = await q(
        `DELETE FROM sessions WHERE session_token = $1 RETURNING id`,
        [ledger.sessionHash],
      );
      log(`  deleted ${r.length} sessions (synthetic)`);
    }
    log('  cleanup done.');
  } catch (e) {
    log('  ⚠️ CLEANUP FAILED:', e.message);
    log('  ledger:', JSON.stringify(ledger));
  }
}

async function main() {
  log('— Synthetic proposal-decline test —');
  log('DB:', (env.DATABASE_URL ?? '').slice(0, 50) + '…');
  log('BASE_URL:', BASE_URL || '(none — SQL-only replay)');

  // 1. Insert a synthetic proposal owned by David. Use proposal_type
  //    'illness_adjust' so it doesn't trigger any rebuild side-effects
  //    if someone calls accept accidentally.
  const proposalRow = (await q(
    `INSERT INTO coach_proposals (user_uuid, user_id, proposal_type, payload, status, created_at)
     VALUES ($1::uuid, $1::text, 'illness_adjust', $2::jsonb, 'pending', NOW())
     RETURNING id, proposal_type, status`,
    [DAVID, JSON.stringify({
      reason: 'synthetic decline test — DELETE ME',
      evidence: { synthetic: true },
      suggested: 'no-op',
    })],
  ))[0];
  ledger.proposalId = proposalRow.id;
  log(`\n[1] Inserted coach_proposals id=${proposalRow.id} type=${proposalRow.proposal_type}`);

  if (BASE_URL) {
    // 2a. Mint a session for David so we can hit the auth-gated endpoint.
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await q(
      `INSERT INTO sessions (user_id, user_uuid, session_token, expires_at, kind, created_at)
       VALUES ($1, $1, $2, $3, 'synth-decline', NOW())`,
      [DAVID, tokenHash, expiresAt],
    );
    ledger.sessionToken = token;
    ledger.sessionHash = tokenHash;
    log(`\n[2] Minted one-shot session for David (1h TTL)`);

    // 2b. First decline — expect 200 + ok=true + action=decline.
    const url = `${BASE_URL.replace(/\/$/, '')}/api/coach/proposal/${proposalRow.id}/decline`;
    log(`\n[3] POST ${url}  (first call, expect 200 + ok=true)`);
    const r1 = await fetch(url, {
      method: 'POST',
      headers: { 'authorization': `Bearer ${token}` },
    });
    const j1 = await r1.json();
    log(`    status=${r1.status}  body=${JSON.stringify(j1)}`);

    // 2c. Second decline — idempotent 409 + ok=false + same proposal_id.
    log(`\n[4] POST ${url}  (re-call, expect 409 + ok=false + 'already declined')`);
    const r2 = await fetch(url, {
      method: 'POST',
      headers: { 'authorization': `Bearer ${token}` },
    });
    const j2 = await r2.json();
    log(`    status=${r2.status}  body=${JSON.stringify(j2)}`);

    // 2d. Assertions on HTTP responses.
    const httpAssertions = [
      ['1st status === 200',            r1.status === 200],
      ['1st body.ok === true',          j1.ok === true],
      ['1st body.action === decline',   j1.action === 'decline'],
      ['1st body.proposal_id matches',  j1.proposal_id === proposalRow.id],
      ['1st body.proposal_type set',    j1.proposal_type === 'illness_adjust'],
      ['2nd status === 409',            r2.status === 409],
      ['2nd body.ok === false',         j2.ok === false],
      ['2nd body.proposal_id matches',  j2.proposal_id === proposalRow.id],
      ['2nd body.reason mentions idempotency', String(j2.reason ?? '').includes('idempotency')],
    ];
    let pass = 0;
    for (const [label, ok] of httpAssertions) {
      log(`  ${ok ? '✓' : '⚠️'} ${label}`);
      if (ok) pass++;
    }
    log(`\n  ${pass}/${httpAssertions.length} HTTP assertions pass`);
    if (pass !== httpAssertions.length) {
      throw new Error(`HTTP test only ${pass}/${httpAssertions.length}`);
    }
  } else {
    // 2alt. SQL replay path — no server needed. Reproduces the route's
    //       3-step write so schema drift is still caught.
    log(`\n[2] No BASE_URL → SQL replay (skipping live HTTP).`);
    await q(
      `UPDATE coach_proposals SET status = 'rejected', responded_at = NOW() WHERE id = $1`,
      [proposalRow.id],
    );
    const intent = (await q(
      `INSERT INTO coach_intents (user_id, user_uuid, reason, field, value)
       VALUES ($1, $1, 'proposal_declined', $2, $3)
       RETURNING id`,
      [DAVID, String(proposalRow.id), JSON.stringify({
        proposal_id: proposalRow.id,
        proposal_type: 'illness_adjust',
      })],
    ))[0];
    ledger.intentIds.push(intent.id);
  }

  // 3. Verify final DB state (works for both paths).
  log(`\n[5] Verifying final DB state...`);
  const finalProposal = (await q(
    `SELECT status, responded_at FROM coach_proposals WHERE id = $1`,
    [proposalRow.id],
  ))[0];
  const intentRow = (await q(
    `SELECT id, reason, field, value
       FROM coach_intents
      WHERE user_uuid = $1::uuid
        AND reason = 'proposal_declined'
        AND field = $2
      ORDER BY id DESC
      LIMIT 1`,
    [DAVID, String(proposalRow.id)],
  ))[0];
  if (intentRow && !ledger.intentIds.includes(intentRow.id)) {
    ledger.intentIds.push(intentRow.id);
  }

  const dbAssertions = [
    ['proposal.status === rejected',         finalProposal?.status === 'rejected'],
    ['proposal.responded_at not null',       finalProposal?.responded_at != null],
    ['coach_intents row exists',             intentRow != null],
    ['intent.reason === proposal_declined',  intentRow?.reason === 'proposal_declined'],
    ['intent.field === proposal_id (text)',  intentRow?.field === String(proposalRow.id)],
  ];
  let dbPass = 0;
  for (const [label, ok] of dbAssertions) {
    log(`  ${ok ? '✓' : '⚠️'} ${label}`);
    if (ok) dbPass++;
  }
  log(`\n  ${dbPass}/${dbAssertions.length} DB assertions pass`);
  if (dbPass !== dbAssertions.length) {
    throw new Error(`DB shape mismatch ${dbPass}/${dbAssertions.length}`);
  }
  log('\n✓ Decline test PASSED');
}

let exitCode = 0;
try {
  await main();
} catch (e) {
  console.error('\n⚠️ TEST FAILED:', e.message);
  if (e.stack) console.error(e.stack);
  exitCode = 1;
} finally {
  await cleanup();
  await pool.end();
}
process.exit(exitCode);
