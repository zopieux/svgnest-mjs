import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    exclude: ['**/node_modules/**', '**/dist/**', '**/.direnv/**'],
    include: ['tests/**/*.{test,spec}.js']
  },
});