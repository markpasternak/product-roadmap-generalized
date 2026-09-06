import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  // Matches the vite `define` in astro.config.mjs; a fixed non-'dev' value lets
  // version.test.ts exercise the "deployed differs / matches" branches directly.
  define: { __BUILD_COMMIT__: JSON.stringify('vitest-build-commit') },
  test: {
    environment: 'happy-dom',
    // Snapshot HTML embeds raw CSS; keep those imports real in renderer tests.
    css: { include: [/\.css\?raw$/] },
    globals: true,
    include: ['src/**/*.test.ts'],
  },
});
