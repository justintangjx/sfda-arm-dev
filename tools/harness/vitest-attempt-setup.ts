import { randomUUID } from 'node:crypto'
import { aroundEach } from 'vitest'
import { hash } from './io.js'
import type { Attempt } from './contracts.js'

aroundEach(async (run, context) => {
  const started = Date.now()
  await run()
  const state = context.task.result?.state
  const attempt: Attempt = {
    id: randomUUID(),
    subjectId: hash(context.task.id),
    index: context.task.result?.retryCount ?? 0,
    startedAt: new Date(started).toISOString(),
    durationMs: Date.now() - started,
    outcome:
      state === 'pass' ? 'passed' : state === 'skip' ? 'skipped' : 'failed',
    reasonCode:
      state === 'pass'
        ? 'ASSERTIONS_PASSED'
        : state === 'skip'
          ? 'TEST_SKIPPED'
          : 'ASSERTIONS_FAILED',
    integrityFindings: [],
  }
  const earlier = context.task.meta.harnessAttempts
  context.task.meta.harnessAttempts = [
    ...(Array.isArray(earlier) ? earlier : []),
    attempt,
  ]
})
