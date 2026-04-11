import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'tests/**/*.test.ts',
      'server/**/*.test.ts',
      'server/tests/**/*.test.ts',
      'server/__tests__/**/*.test.ts',
      'server/**/__tests__/**/*.test.ts',
    ],
    exclude: ['node_modules', 'dist'],
    testTimeout: 30000,
    hookTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules', 'tests', '**/*.config.*']
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
      '@shared': path.resolve(__dirname, './shared'),
      // Workaround: gpt-tokenizer CJS sub-path not resolvable under Vite ESM
      'gpt-tokenizer/cjs/encoding/o200k_base': path.resolve(__dirname, './server/__tests__/mocks/gptTokenizerStub.ts'),
    }
  }
});
