import { defineConfig } from 'vite';
import pkg from './package.json' with { type: 'json' };

// Relative base so the built bundle loads from file:// inside the desktop app.
export default defineConfig({
  base: './',
  // Inject the real package version at build time so the UI never goes stale.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
});
