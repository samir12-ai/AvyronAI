import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'shared'),
      '@': path.resolve(__dirname),
    },
  },
  test: {
    include: ['server/tests/**/*.test.ts'],
  },
});
