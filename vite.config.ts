import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import pkg from './package.json' with { type: 'json' };

// Relative base so the built bundle loads from file:// inside the desktop app.
export default defineConfig({
  base: './',
  // Inject the real package version at build time so the UI never goes stale.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  // Two entries: the live game (index.html) + the TownCore play-test (core.html).
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        core: resolve(__dirname, 'core.html'),
      },
    },
  },
});
