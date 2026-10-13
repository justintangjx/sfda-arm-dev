import { expect, it } from 'vitest'
import { attemptFor } from './adapters.js'
import { failureSummary } from './failure-summary.js'
import { hash } from './io.js'

it('identifies nonpassing attempts while keeping metadata on one log line', () => {
  const failed = attemptFor(
    'synthetic test',
    'failed',
    'ASSERTIONS_FAILED',
    '2026-10-13T00:00:00.000Z',
    1,
  )
  const output = failureSummary(
    [failed, { ...failed, index: 1, outcome: 'passed' }],
    new Map([
      [
        hash('synthetic test'),
        {
          title: 'Synthetic failure\n::error::unexpected command',
          file: 'e2e/synthetic.spec.ts',
          line: 12,
          project: 'webkit_mobile',
        },
      ],
    ]),
  )
  expect(output).toContain('e2e/synthetic.spec.ts:12')
  expect(output).toContain('webkit_mobile')
  expect(output).toContain('attempt 1, ASSERTIONS_FAILED')
  expect(output).not.toContain('attempt 2')
  expect(output.trim().split('\n')).toHaveLength(1)
  expect(output).toContain('Synthetic failure\\n::error::unexpected command')
})

it('reports runner failures and does not hide skipped or cancelled attempts', () => {
  const attempt = attemptFor(
    'runner',
    'failed',
    'RUNNER_ERROR',
    '2026-10-13T00:00:00.000Z',
    0,
  )
  const output = failureSummary(
    [
      attempt,
      { ...attempt, outcome: 'skipped', reasonCode: 'TEST_SKIPPED' },
      { ...attempt, outcome: 'cancelled', reasonCode: 'PROCESS_CANCELLED' },
    ],
    new Map(),
  )
  expect(output).toContain('FAILED runner subject')
  expect(output).toContain('RUNNER_ERROR')
  expect(output).toContain('SKIPPED runner subject')
  expect(output).toContain('CANCELLED runner subject')
  expect(failureSummary([], new Map())).toContain('No failed')
})
