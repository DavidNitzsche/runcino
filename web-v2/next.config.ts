import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  /**
   * 2026-08-17 · The goal surface answered to three different names: the
   * sidebar said "Goal", the page H1 said "Targets", and the URL said
   * /races. One surface, three words, so nothing the runner reads matches
   * anything else they can point at. Settled on GOAL everywhere (see
   * app/goal/page.tsx). These are permanent redirects so any link, history
   * entry or bookmark on the old path still lands.
   */
  async redirects() {
    return [
      { source: '/races', destination: '/goal', permanent: true },
      { source: '/races/:slug', destination: '/goal/:slug', permanent: true },
    ];
  },
  experimental: {
    // Server actions used for closed-loop writes (check-ins, profile gap input)
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
};

export default nextConfig;
