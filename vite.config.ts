import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { thirdPartyLicenses } from './tools/licenses.mjs';

// The notices MIT, ISC and Apache ask to travel with a copy: minifying strips the banners from the bundle.
const licences = (): Plugin => ({
  name: 'third-party-licences',
  apply: 'build',
  generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: 'THIRD-PARTY-LICENSES.txt',
      source: thirdPartyLicenses(),
    });
  },
});

export default defineConfig({
  base: './',
  // The one polyfill Vite would add (for the modulepreload links) needs its own MIT notice, and every browser the app
  // supports has the feature, so it is left out.
  build: { modulePreload: { polyfill: false } },
  plugins: [react(), licences()],
  // An 'iife' worker inlines the dynamic import of the kernel, so its cold start would read 0.
  worker: { format: 'es' },
  test: {
    environment: 'jsdom',
    maxWorkers: 2,
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test-setup.ts'],
  },
});
