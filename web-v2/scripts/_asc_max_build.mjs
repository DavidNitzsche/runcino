/**
 * scripts/_asc_max_build.mjs · print the highest build number that already
 * exists on App Store Connect for run.faff.app, and nothing else.
 *
 * SHIPCOUNTER-1 (2026-09-04) · exists because `.asc.build` is a per-checkout
 * file and the checkouts had already diverged: the root checkout held 276 while
 * TestFlight held 278. A ship from the root would have reserved 277, a number
 * that already exists, and Apple would have rejected it or the wrong binary
 * would have taken the name.
 *
 * Prints one integer on stdout. Exits non-zero and prints nothing on stdout if
 * it cannot read App Store Connect, so a caller cannot mistake a failed read
 * for a low number (Rule 11).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';

const ENV_PATH = process.env.ASC_ENV_PATH
  || '/Volumes/WP/06 Claude Code/Runcino/legacy/native/.asc.env';
const API = 'https://api.appstoreconnect.apple.com';

const env = {};
for (const line of fs.readFileSync(ENV_PATH, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const { ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH } = env;
if (!ASC_KEY_ID || !ASC_ISSUER_ID || !ASC_KEY_PATH) {
  console.error('asc-max-build: credentials missing from .asc.env');
  process.exit(2);
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const header = b64({ alg: 'ES256', kid: ASC_KEY_ID, typ: 'JWT' });
const now = Math.floor(Date.now() / 1000);
const payload = b64({ iss: ASC_ISSUER_ID, iat: now, exp: now + 900, aud: 'appstoreconnect-v1' });
const signer = crypto.createSign('SHA256');
signer.update(`${header}.${payload}`);
const der = signer.sign(fs.readFileSync(ASC_KEY_PATH, 'utf8'));
// ES256 wants a raw r||s pair, not the DER the signer produces.
const sig = (() => {
  let off = 2;
  if (der[1] & 0x80) off += der[1] & 0x7f;
  const rLen = der[off + 1]; const r = der.subarray(off + 2, off + 2 + rLen);
  const sOff = off + 2 + rLen; const sLen = der[sOff + 1];
  const s = der.subarray(sOff + 2, sOff + 2 + sLen);
  const pad = (buf) => {
    const out = Buffer.alloc(32);
    buf.subarray(Math.max(0, buf.length - 32)).copy(out, Math.max(0, 32 - buf.length));
    return out;
  };
  return Buffer.concat([pad(r), pad(s)]).toString('base64url');
})();
const jwt = `${header}.${payload}.${sig}`;

const get = async (path) => {
  const r = await fetch(API + path, { headers: { Authorization: `Bearer ${jwt}` } });
  if (!r.ok) { console.error(`asc-max-build: ${r.status} on ${path}`); process.exit(3); }
  return r.json();
};

const apps = await get('/v1/apps?filter[bundleId]=run.faff.app&limit=1');
const appId = apps?.data?.[0]?.id;
if (!appId) { console.error('asc-max-build: app not found'); process.exit(4); }

const builds = await get(`/v1/builds?filter[app]=${appId}&sort=-version&limit=20`);
const nums = (builds?.data ?? [])
  .map((b) => Number(b?.attributes?.version))
  .filter((n) => Number.isFinite(n));
if (nums.length === 0) { console.error('asc-max-build: no builds returned'); process.exit(5); }

process.stdout.write(String(Math.max(...nums)));
