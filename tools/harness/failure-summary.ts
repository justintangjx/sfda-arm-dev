import { writeFile } from 'node:fs/promises'
import type { Attempt } from './contracts.js'

export type TestIdentity = Readonly<{
  title: string
  file: string
  line: number | undefined
  project: string | undefined
}>

export const failureSummary = (
  attempts: readonly Attempt[],
  tests: ReadonlyMap<string, TestIdentity>,
): string => {
  const failures = attempts.filter((attempt) => attempt.outcome !== 'passed')
  if (!failures.length)
    return 'No failed, skipped or cancelled test attempts.\n'
  return `${failures
    .map((attempt) => {
      const test = tests.get(attempt.subjectId)
      const identity = test
        ? `${JSON.stringify(`${test.file}${test.line === undefined ? '' : `:${test.line}`}`)} ${JSON.stringify(test.title)}${test.project ? ` [${JSON.stringify(test.project)}]` : ''}`
        : `runner subject ${attempt.subjectId}`
      return `${attempt.outcome.toUpperCase()} ${identity} (attempt ${attempt.index + 1}, ${attempt.reasonCode})`
    })
    .join('\n')}\n`
}

export const writeFailureSummary = (
  attemptsPath: string,
  attempts: readonly Attempt[],
  tests: ReadonlyMap<string, TestIdentity>,
) =>
  writeFile(
    `${attemptsPath}.failure-summary.txt`,
    failureSummary(attempts, tests),
    { mode: 0o600 },
  )
