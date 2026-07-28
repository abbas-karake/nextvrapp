import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/nextvrapp/',
  build: {
    chunkSizeWarningLimit: 600,
  },
  test: {
    environment: 'node',
  },
});
