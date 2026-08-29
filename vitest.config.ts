import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // domain/ is pure TypeScript with zero DOM and zero I/O.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
