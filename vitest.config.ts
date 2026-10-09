import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'src/worker/**/*.test.ts',
      'src/domain/**/*.test.ts',
      'src/app/**/*.test.ts',
    ],
    clearMocks: true,
  },
})
