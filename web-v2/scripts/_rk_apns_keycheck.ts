/**
 * 2026-06-09 · APNs key validation — zero-side-effect probe.
 *
 * Sends one push to a syntactically-valid but FAKE device token through
 * the production lib (lib/notifications/apns.ts) against production
 * APNs. Outcome decodes the key's validity:
 *   · 400 BadDeviceToken      → auth JWT ACCEPTED → this IS an APNs key
 *   · 403 InvalidProviderToken→ key is not valid for APNs (wrong key)
 * Nothing can be delivered — the token doesn't exist.
 *
 *   APNS_KEY_ID=XXXX APNS_TEAM_ID=YYYY APNS_KEY_PATH=/path.p8 \
 *   APNS_PRODUCTION=1 npx tsx scripts/_rk_apns_keycheck.ts
 */
import { sendPush } from '../lib/notifications/apns';

async function main() {
  const fake = 'f'.repeat(64);
  const r = await sendPush({
    device_token: fake,
    category: 'weekly_checkin',
    title: 'keycheck',
    body: 'keycheck',
    sound: null,
  });
  console.log(JSON.stringify(r));
  if (!r.ok && r.reason === 'apns_rejected' && /BadDeviceToken/i.test(r.detail ?? '')) {
    console.log('VERDICT: KEY VALID for APNs (auth accepted; token correctly rejected)');
  } else if (!r.ok && /InvalidProviderToken|403/i.test(`${r.status} ${r.detail ?? ''}`)) {
    console.log('VERDICT: KEY INVALID for APNs');
  } else {
    console.log('VERDICT: INCONCLUSIVE — inspect result above');
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
