import { defineConfig } from 'vitest/config'; import react from '@vitejs/plugin-react'; import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    testTimeout: 15000,
    setupFiles: ['./client/src/test/setup.ts'],
    include: ['client/src/**/*.test.{ts,tsx}', 'client/src/**/__tests__/*.{ts,tsx}'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['client/src/**/*.{ts,tsx}'],
      exclude: ['client/src/**/*.test.{ts,tsx}', 'client/src/test/**'],
       thresholds: {
         lines: 30,
         functions: 30,
         branches: 20,
         statements: 30,
      
      },
    },
    alias: {
      '@': path.resolve(__dirname, './client/src'),
      '@shared': path.resolve(__dirname, './shared'),
    },
  },
});
