import { randomUUID } from 'node:crypto'
import type {
  FullConfig,
  Reporter,
  TestCase,
  TestResult,
} from '@playwright/test/reporter'
import { atomicJson, hash } from './io.js'
import type { Attempt } from './contracts.js'

export default function safeReporter(): Reporter {
  const attempts: Attempt[] = []
  let projects: string[] = []
  return {
    onBegin(config: FullConfig) {
      projects = config.projects.map((project) => project.name)
    },
    onTestEnd(test: TestCase, result: TestResult) {
      const passed =
        result.status === 'passed' && test.expectedStatus === 'passed'
      attempts.push({
        id: randomUUID(),
        subjectId: hash(test.id),
        index: result.retry,
        startedAt: result.startTime.toISOString(),
        durationMs: Math.round(result.duration),
        outcome: passed
          ? 'passed'
          : result.status === 'skipped'
            ? 'skipped'
            : result.status === 'interrupted'
              ? 'cancelled'
              : 'failed',
        reasonCode: passed
          ? 'ASSERTIONS_PASSED'
          : result.status === 'timedOut'
            ? 'PROCESS_TIMEOUT'
            : 'ASSERTIONS_FAILED',
        integrityFindings: [],
      })
    },
    onError() {
      attempts.push({
        id: randomUUID(),
        subjectId: hash('browser_runner_error'),
        index: 0,
        startedAt: new Date().toISOString(),
        durationMs: 0,
        outcome: 'failed',
        reasonCode: 'RUNNER_ERROR',
        integrityFindings: [],
      })
    },
    async onEnd() {
      const path = process.env.HARNESS_ATTEMPTS_FILE
      if (path)
        await atomicJson(path, {
          schemaVersion: 1,
          attempts,
          browserProjects: projects,
        })
    },
  }
}
