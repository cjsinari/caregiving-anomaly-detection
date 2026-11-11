import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    include: ['src/**/*.test.{js,jsx}'],
    // Each file gets a fresh module registry, which matters here: the API
    // client keeps its tokens in module scope, so state would otherwise leak
    // between files and a later test could inherit an earlier one's session.
    isolate: true,
    restoreMocks: true,
    /*
     * 5 seconds is Vitest's default and is too tight here. These tests render
     * real charts in jsdom — hundreds of modules, an SVG tree per chart — and
     * the files run concurrently, so a test that takes 150 ms alone can take
     * several seconds under contention. Timing out then reports a slow machine
     * as a broken dashboard, which is the least useful failure a suite can give.
     */
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
