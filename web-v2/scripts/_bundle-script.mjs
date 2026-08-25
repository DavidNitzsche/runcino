/**
 * _bundle-script.mjs · run a one-off TypeScript script that needs the app's
 * own modules.
 *
 * The `.mjs` scripts in this directory talk to the database directly and
 * re-implement whatever arithmetic they need, which is fine for a query and
 * wrong for a migration: a migration that re-implements the engine can
 * disagree with it, and then the rows it writes are not the rows the app
 * would have written. This bundles a `.ts` entry with the `@` alias resolved,
 * so the script runs the ACTUAL engine functions, and hands the bundle to
 * node.
 *
 *   node scripts/_bundle-script.mjs scripts/recompute-hr-zones.ts -- --apply
 *
 * Everything after `--` is passed through to the script.
 */
import { build } from 'vite';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const entry = process.argv[2];
if (!entry) {
  console.error('usage: node scripts/_bundle-script.mjs <entry.ts> [-- <args…>]');
  process.exit(2);
}
const dashdash = process.argv.indexOf('--');
const passthrough = dashdash === -1 ? [] : process.argv.slice(dashdash + 1);

// Inside the project, not the system temp dir · the bundle keeps `pg` and
// other native deps external, so it has to sit where node can resolve them
// from `node_modules`. Gitignored.
const outDir = fs.mkdtempSync(path.join(ROOT, '.script-bundle-'));
await build({
  root: ROOT,
  configFile: false,
  logLevel: 'warn',
  resolve: { alias: { '@': ROOT } },
  build: {
    ssr: true,
    outDir,
    emptyOutDir: true,
    target: `node${process.versions.node.split('.')[0]}`,
    rollupOptions: {
      input: path.resolve(ROOT, entry),
      output: { entryFileNames: 'script.mjs', format: 'esm' },
      // Anything with native bindings or a node builtin stays external.
      external: [/^node:/, 'pg', 'bcrypt'],
    },
  },
});

const r = spawnSync(process.execPath, [path.join(outDir, 'script.mjs'), ...passthrough], {
  stdio: 'inherit',
  cwd: ROOT,
  env: process.env,
});
fs.rmSync(outDir, { recursive: true, force: true });
process.exit(r.status ?? 1);
