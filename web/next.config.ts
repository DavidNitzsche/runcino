import type { NextConfig } from 'next';
import { resolve } from 'path';

const nextConfig: NextConfig = {
  // Pin the file-tracing root to web/ — the repo has a thin
  // wrapper package.json at the root for Railway's nixpacks build
  // (and its own lockfile), but everything Next.js needs lives in
  // ./web. Without this, Next prints a "multiple lockfiles detected"
  // warning on every build and may grab the wrong root.
  outputFileTracingRoot: resolve(__dirname),
};

export default nextConfig;
