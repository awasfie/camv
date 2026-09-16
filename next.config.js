/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output for a lean Docker build (Coolify deploy, TW-T7).
  output: 'standalone',
  reactStrictMode: false,
  // RA-T5 (Bible v11.5): shipping source maps to production browsers means
  // anyone can reconstruct readable original source (route logic, comments,
  // internal reasoning like the hostProof/rate-limit notes) from the deployed
  // bundle. Disabled -- no legitimate reason for public source maps here.
  productionBrowserSourceMaps: false,
  images: {
    formats: ['image/webp'],
  },
  webpack: (config, { buildId, dev, isServer, defaultLoaders, nextRuntime, webpack }) => {
    // Important: return the modified config
    config.module.rules.push({
      test: /\.mjs$/,
      enforce: 'pre',
      use: ['source-map-loader'],
    });

    return config;
  },
  headers: async () => {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin',
          },
          {
            key: 'Cross-Origin-Embedder-Policy',
            value: 'credentialless',
          },
        ],
      },
      {
        // RA-T5: explicit CORS policy on the API routes instead of relying
        // on the framework/browser default (same-origin only, effectively,
        // but undocumented). These endpoints are only ever called from
        // camv.co's own pages (PageClientImpl.tsx) or server-to-server
        // (Timeway -> Camv), never from a third-party origin in a browser.
        source: '/api/:path*',
        headers: [
          {
            key: 'Access-Control-Allow-Origin',
            value: 'https://camv.co',
          },
          {
            key: 'Access-Control-Allow-Methods',
            value: 'GET, POST, OPTIONS',
          },
          {
            key: 'Access-Control-Allow-Headers',
            value: 'Content-Type, x-camv-host-proof, x-camv-internal-secret',
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
