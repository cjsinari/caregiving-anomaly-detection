import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/*
 * The dev server proxies /api to the auth service rather than the browser
 * calling it directly on port 3000.
 *
 * Two reasons, and neither is convenience. The requests become same-origin, so
 * development does not depend on a CORS configuration that production will not
 * use — the service's allowed origins are set for the deployed dashboard, and a
 * dev setup that needed them widened would push a permanent hole into
 * production config. And the dashboard's own code holds one relative base path,
 * so nothing has to know which host the API is on.
 */

/*
 * The content security policy.
 *
 * Applied to builds only. The dev server injects an inline module script for
 * react-refresh, so a policy with `script-src 'self'` would break every reload
 * — and the alternative, allowing inline scripts so that development works,
 * would ship the one directive that matters most in a weakened state. Separate
 * treatment is the honest answer: development gets no policy, production gets a
 * strict one.
 *
 * Directive by directive:
 *
 *   default-src 'self'      nothing loads from anywhere else unless named below
 *   script-src 'self'       the build emits no inline script, so no 'unsafe-inline'
 *   style-src + 'unsafe-inline'
 *                           React style props, Recharts and Leaflet all set
 *                           inline style attributes. There is no way to avoid
 *                           it short of dropping the chart and map libraries,
 *                           and an inline style cannot execute code — this is
 *                           the directive it is reasonable to relax, and
 *                           script-src is the one it is not.
 *   img-src + OSM + data:   the map's tiles, and the data: URIs Leaflet uses
 *                           for its marker shadows
 *   connect-src 'self'      the API is same-origin, through the proxy in
 *                           development and behind the same host in
 *                           production. A deployment serving the API from
 *                           another origin must add it here AND to the
 *                           service's CORS_ORIGINS; the two have to agree.
 *   object-src / base-uri / form-action 'none'
 *                           this application embeds nothing, has no <base>,
 *                           and posts no HTML form, so all three are shut.
 *
 * frame-ancestors and HSTS are deliberately absent: a meta-tag policy cannot
 * express frame-ancestors, and HSTS is not a CSP directive at all. Both have to
 * be real response headers from whatever serves the built files — see the
 * nginx snippet in SECURITY.md.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://*.tile.openstreetmap.org",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  'upgrade-insecure-requests',
].join('; ');

const contentSecurityPolicy = () => ({
  name: 'content-security-policy',
  apply: 'build',
  transformIndexHtml(html) {
    return {
      html,
      tags: [{
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
        injectTo: 'head-prepend',
      }],
    };
  },
});

export default defineConfig({
  plugins: [react(), contentSecurityPolicy()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.AUTH_SERVICE_URL || 'http://127.0.0.1:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    // No inline module-preload polyfill, so the built page has no inline
    // script at all and script-src can stay 'self' with nothing added.
    modulePreload: { polyfill: false },
  },
});
