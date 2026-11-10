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
export default defineConfig({
  plugins: [react()],
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
  },
});
