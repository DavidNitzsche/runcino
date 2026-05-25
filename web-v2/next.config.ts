import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    // Server actions used for closed-loop writes (check-ins, profile gap input)
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
};

export default nextConfig;
