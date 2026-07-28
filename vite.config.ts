import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/nextvrapp/',
  build: {
    chunkSizeWarningLimit: 750,
  },
  test: {
    environment: 'node',
  },
});
