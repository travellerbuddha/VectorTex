import type { NextConfig } from 'next';
import { withPayload } from '@payloadcms/next/withPayload';

// Tag hosts (ADR-0018): Google Tag Manager/GA4/Google Ads and the Meta and Yandex tags managed inside GTM. They only
// load after the visitor's consent (or, in ADVANCED consent mode, in the denied state).
const tagScripts = 'https://www.googletagmanager.com https://*.googletagmanager.com https://www.google-analytics.com https://www.googleadservices.com https://googleads.g.doubleclick.net https://www.google.com https://connect.facebook.net https://mc.yandex.ru https://mc.yandex.com https://yastatic.net';
const tagConnect = 'https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com https://*.g.doubleclick.net https://*.doubleclick.net https://www.google.com https://www.google.com.tr https://pagead2.googlesyndication.com https://www.googleadservices.com https://*.facebook.com https://connect.facebook.net https://mc.yandex.ru https://mc.yandex.com';
const tagFrames = 'https://www.googletagmanager.com https://td.doubleclick.net https://*.doubleclick.net https://www.facebook.com https://mc.yandex.ru https://mc.yandex.com';

/**
 * Content Security Policy. The Nuitee payment component (payment-wrapper.liteapi.travel) renders a Stripe-based
 * form, so its script/frame/connect hosts are allowed; everything else stays on our origin.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' https://payment-wrapper.liteapi.travel https://js.stripe.com ${tagScripts}`,
  `frame-src https://js.stripe.com https://hooks.stripe.com https://*.liteapi.travel ${tagFrames}`,
  `connect-src 'self' https://api.stripe.com https://*.liteapi.travel https://*.stripe.com ${tagConnect}`,
  "img-src 'self' data: https:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
].join('; ');

const config: NextConfig = {
  // Workspace packages ship TypeScript sources.
  transpilePackages: ['@texholiday/admin', '@texholiday/booking', '@texholiday/config', '@texholiday/connectors', '@texholiday/contracts', '@texholiday/db', '@texholiday/domain', '@texholiday/pricing'],
  serverExternalPackages: ['pg'],
  poweredByHeader: false,
  // Trailing slashes are handled in src/proxy.ts after the old-site redirect map (P17), so "/old-address/" reaches its
  // new page in a single redirect; other "/path/" requests still get 308 to "/path".
  skipTrailingSlashRedirect: true,
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

// Payload CMS (P06): admin at /yonetim/icerik, REST API at /api/cms.
export default withPayload(config);
