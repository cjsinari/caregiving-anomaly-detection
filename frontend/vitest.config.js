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
  },
});
