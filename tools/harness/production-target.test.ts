import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import {
  parseProductionTargetFile,
  validateHostingProductionTarget,
} from './production-target.js'

it('validates the example production target manifest', async () => {
  const example = JSON.parse(
    await readFile('verification/production-target.example.json', 'utf8'),
  )
  const parsed = parseProductionTargetFile(example)
  expect(parsed).toBeDefined()
  validateHostingProductionTarget(parsed)
  expect(parsed?.migrationReader?.appOrigin).toBe(parsed?.appOrigin)
})
