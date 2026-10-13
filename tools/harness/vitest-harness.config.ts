import { join, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { defineConfig, mergeConfig } from 'vitest/config'

export default defineConfig(async () => {
  const name =
    process.env.HARNESS_DATABASE === 'true'
      ? 'vitest.database.config.ts'
      : 'vitest.config.ts'
  const base = await import(pathToFileURL(join(process.cwd(), name)).href)
  return mergeConfig(base.default, {
    test: {
      includeTaskLocation: true,
      setupFiles: [
        join(
          dirname(fileURLToPath(import.meta.url)),
          'vitest-attempt-setup.js',
        ),
      ],
    },
  })
})
