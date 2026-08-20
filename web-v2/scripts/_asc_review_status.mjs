// Read-only: query App Store Connect for the TestFlight build's beta-review
// state. No deps — Node built-in crypto signs the ES256 JWT; the .p8 stays
// on disk (path from legacy/native/.asc.env), never printed.
//
//   node web-v2/scripts/_asc_review_status.mjs [buildVersion]
//
import crypto from 'node:crypto';
import fs from 'node:fs';

const ENV_PATH = '/Volumes/WP/06 Claude Code/Runcino/legacy/native/.asc.env';
const BUILD_VERSION = process.argv[2] || '212';
const API = 'https://api.appstoreconnect.apple.com';

// ── parse .asc.env ──────────────────────────────────────────────────────
const env = {};
for (const line of fs.readFileSync(ENV_PATH, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const { ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH } = env;
if (!ASC_KEY_ID || !ASC_ISSUER_ID || !ASC_KEY_PATH) { console.error('missing ASC_* in .asc.env'); process.exit(1); }

let pem;
try { pem = fs.readFileSync(ASC_KEY_PATH, 'utf8'); }
catch (e) { console.error(`cannot read .p8 (${ASC_KEY_PATH}): ${e.message}`); process.exit(1); }

// ── mint ES256 JWT (R||S / JOSE encoding, 10-min exp) ───────────────────
const b64url = (b) => Buffer.from(b).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
const now = Math.floor(Date.now() / 1000);
const header = b64url(JSON.stringify({ alg: 'ES256', kid: ASC_KEY_ID, typ: 'JWT' }));
const payload = b64url(JSON.stringify({ iss: ASC_ISSUER_ID, iat: now, exp: now + 600, aud: 'appstoreconnect-v1' }));
const signingInput = `${header}.${payload}`;
const sig = crypto.sign('sha256', Buffer.from(signingInput), { key: pem, dsaEncoding: 'ieee-p1363' });
const jwt = `${signingInput}.${b64url(sig)}`;

async function asc(path) {
  const r = await fetch(API + path, { headers: { authorization: `Bearer ${jwt}` } });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  if (!r.ok) { console.error(`ASC ${r.status} on ${path}:`, text.slice(0, 400)); process.exit(1); }
  return json;
}
// Non-fatal: optional to-one relationships (buildBetaDetail /
// betaAppReviewSubmission) 404 or return data:null when absent.
async function ascSoft(path) {
  try {
    const r = await fetch(API + path, { headers: { authorization: `Bearer ${jwt}` } });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// ── find the app ────────────────────────────────────────────────────────
const apps = await asc('/v1/apps?limit=200&fields[apps]=name,bundleId');
const app = apps.data.find((a) => /faff/i.test(a.attributes.name) || /faff/i.test(a.attributes.bundleId)) || apps.data[0];
console.log(`app: ${app.attributes.name} (${app.attributes.bundleId}) id=${app.id}`);
if (apps.data.length > 1) console.log('  (all apps:', apps.data.map((a) => a.attributes.name).join(', ') + ')');

// ── find the build + its beta-review state ──────────────────────────────
const byVersion = process.argv[2] ? `&filter[version]=${BUILD_VERSION}` : '';
const q = `/v1/builds?filter[app]=${app.id}${byVersion}&sort=-uploadedDate&limit=10`
  + `&fields[builds]=version,uploadedDate,processingState,expired`;
const builds = await asc(q);
if (!builds.data.length) { console.log(`\nNo builds found${byVersion ? ` for version ${BUILD_VERSION}` : ''} yet (still processing?).`); process.exit(0); }

// Direct relationship fetches for the latest 3 builds (include= was not
// resolving the related resources reliably).
for (const b of builds.data.slice(0, 3)) {
  const [bbd, bar] = await Promise.all([
    ascSoft(`/v1/builds/${b.id}/buildBetaDetail?fields[buildBetaDetails]=externalBuildState,internalBuildState`),
    ascSoft(`/v1/builds/${b.id}/betaAppReviewSubmission?fields[betaAppReviewSubmissions]=betaReviewState`),
  ]);
  console.log(`\nbuild ${b.attributes.version}  ·  uploaded ${b.attributes.uploadedDate}`);
  console.log(`  processing       : ${b.attributes.processingState}  ·  expired=${b.attributes.expired}`);
  console.log(`  external state   : ${bbd?.data?.attributes?.externalBuildState ?? 'n/a'}`);
  console.log(`  internal state   : ${bbd?.data?.attributes?.internalBuildState ?? 'n/a'}`);
  console.log(`  beta review      : ${bar?.data?.attributes?.betaReviewState ?? '(no external submission)'}`);
}
