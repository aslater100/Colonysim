import { defineConfig } from 'vite';

// Relative base so the built bundle loads from file:// inside the desktop app.
export default defineConfig({
  base: './',
});
