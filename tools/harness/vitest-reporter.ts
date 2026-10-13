import { randomUUID } from 'node:crypto'
import { relative } from 'node:path'
import type { Reporter, TestCase } from 'vitest/node'
import { atomicJson, hash } from './io.js'
import { attemptRule, type Attempt } from './contracts.js'
import * as v from './validation.js'
import { writeFailureSummary, type TestIdentity } from './failure-summary.js'

export default function safeReporter(): Reporter {
  const attempts: Attempt[] = []
  const tests = new Map<string, TestIdentity>()
  const result = (test: TestCase) => {
    tests.set(hash(test.id), {
      title: test.fullName,
      file: relative(process.cwd(), test.module.moduleId),
      line: test.location?.line,
      project: test.project.name || undefined,
    })
    const captured = test.meta().harnessAttempts
    if (captured !== undefined) {
      const history = v.parse<readonly Attempt[]>(
        captured,
        v.list(attemptRule, 1),
      )
      attempts.push(
        ...history.filter(
          (attempt) => !attempts.some((earlier) => earlier.id === attempt.id),
        ),
      )
      return
    }
    const diagnostic = test.diagnostic()
    const subjectId = hash(test.id)
    const index = diagnostic?.retryCount ?? 0
    if (
      attempts.some(
        (attempt) => attempt.subjectId === subjectId && attempt.index === index,
      )
    )
      return
    const state = test.result().state
    attempts.push({
      id: randomUUID(),
      subjectId,
      index,
      startedAt: new Date(diagnostic?.startTime ?? Date.now()).toISOString(),
      durationMs: Math.round(diagnostic?.duration ?? 0),
      outcome:
        state === 'passed'
          ? 'passed'
          : state === 'skipped'
            ? 'skipped'
            : 'failed',
      reasonCode:
        state === 'passed'
          ? 'ASSERTIONS_PASSED'
          : state === 'skipped'
            ? 'TEST_SKIPPED'
            : 'ASSERTIONS_FAILED',
      integrityFindings: [],
    })
  }
  return {
    onTestCaseResult: result,
    async onTestRunEnd(_modules, errors) {
      if (errors.length)
        attempts.push({
          id: randomUUID(),
          subjectId: hash('unhandled_runner_error'),
          index: 0,
          startedAt: new Date().toISOString(),
          durationMs: 0,
          outcome: 'failed',
          reasonCode: 'RUNNER_ERROR',
          integrityFindings: [],
        })
      const path = process.env.HARNESS_ATTEMPTS_FILE
      if (path) {
        await atomicJson(path, {
          schemaVersion: 1,
          attempts,
          browserProjects: [],
        })
        await writeFailureSummary(path, attempts, tests)
      }
    },
  }
}
