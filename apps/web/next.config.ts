import type { NextConfig } from 'next';

/**
 * Content Security Policy. The Nuitee payment component (payment-wrapper.liteapi.travel) renders a Stripe-based
 * form, so its script/frame/connect hosts are allowed; everything else stays on our origin.
 */
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://payment-wrapper.liteapi.travel https://js.stripe.com",
  "frame-src https://js.stripe.com https://hooks.stripe.com https://*.liteapi.travel",
  "connect-src 'self' https://api.stripe.com https://*.liteapi.travel https://*.stripe.com",
  "img-src 'self' data: https:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
].join('; ');

const config: NextConfig = {
  // Workspace packages ship TypeScript sources.
  transpilePackages: ['@texholiday/booking', '@texholiday/config', '@texholiday/connectors', '@texholiday/contracts', '@texholiday/db', '@texholiday/domain', '@texholiday/pricing'],
  serverExternalPackages: ['pg'],
  poweredByHeader: false,
  async redirects() {
    return [{ source: '/', destination: '/tr', permanent: false }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default config;
