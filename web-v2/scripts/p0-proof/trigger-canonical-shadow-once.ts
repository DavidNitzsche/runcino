// One-off, authorized production trigger for the canonical Adaptation
// Engine's live shadow evaluation, run once to confirm migration 164's
// first successful shadow record per David's 2026-09-03 authorization.
// Deliberately NOT run under vitest/FAFF_VERIFICATION — this is a real
// production write through the app's own writable pool, exactly as the
// run-adaptations cron performs it, not a verification-process read.
import { runAndPersistCanonicalShadowEvaluation } from '../../lib/adaptation/canonical-shadow/run-live-shadow-evaluation';

async function main() {
  const userUuid = process.argv[2];
  if (!userUuid) throw new Error('usage: tsx trigger-canonical-shadow-once.ts <user_uuid>');
  const result = await runAndPersistCanonicalShadowEvaluation(userUuid);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ran ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
