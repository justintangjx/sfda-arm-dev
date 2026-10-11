import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Registry, Result } from './contracts.js'
import { validateReport } from './contracts.js'
import { resultFor, attemptFor } from './adapters.js'
import { hash, json } from './io.js'
import {
  scoreVoice,
  validateCaseResult,
  validateReview,
  type Corpus,
  type TrustedReview,
} from './eval.js'
import {
  validateCompact,
  matchingCandidateReport,
  reusableCompactResults,
} from './readiness.js'
import { approvalRule, verifyApproval, verifyWorkflow } from './provenance.js'
import type { ApprovalRef, GitHubReader, Owners } from './provenance.js'
import { verifyArtifactReport } from './artifacts.js'
import * as v from './validation.js'

export type Evidence = Readonly<{
  schemaVersion: 1
  reports: readonly Readonly<{
    path: string
    digest: string
    artifactId: number
    workflowRunId: string
  }>[]
  retained: readonly Readonly<{
    summaryPath: string
    summaryDigest: string
    attestation: ApprovalRef
  }>[]
  approvals: readonly ApprovalRef[]
}>
export const evidenceRule = v.exact({
  schemaVersion: v.oneOf([1]),
  reports: v.list(
    v.exact({
      path: v.relativePath,
      digest: v.digest,
      artifactId: v.integer(1, Number.MAX_SAFE_INTEGER),
      workflowRunId: v.match(/^\d+$/),
    }),
  ),
  retained: v.list(
    v.exact({
      summaryPath: v.relativePath,
      summaryDigest: v.digest,
      attestation: approvalRule,
    }),
  ),
  approvals: v.list(approvalRule),
})
const attestationRule = v.exact({
  schemaVersion: v.oneOf([1]),
  sourceReportDigest: v.digest,
  summaryDigest: v.digest,
  workflowRunId: v.match(/^\d+$/),
  candidate: v.sha,
  attestedAt: v.utc,
  originalReportAvailable: v.boolean,
})
export const loadTrustedResults = async (
  input: Readonly<{
    evidence: Evidence
    root: string
    registry: Registry
    corpus: Corpus
    corpusDigest: string
    candidate: Readonly<{
      sha: string
      registryDigest: string
      manifestDigest: string
      inputFingerprint: string
      runtimeFingerprint: string
    }>
    now: string
    owners: Owners
    reader: GitHubReader | undefined
    token: string | undefined
  }>,
): Promise<readonly Result[]> => {
  v.parse<Evidence>(input.evidence, evidenceRule)
  if (!input.reader || !input.token) return []
  const results: Result[] = []
  const approvedPayloads: Readonly<{
    reference: ApprovalRef
    account: string
    payload: Uint8Array
    signedAt: string
  }>[] = []
  for (const reference of input.evidence.approvals) {
    const approved = await verifyApproval(input.reader, input.owners, reference)
    if (approved && Date.parse(approved.signedAt) <= Date.parse(input.now))
      approvedPayloads.push({ reference, ...approved })
  }
  const corpusApprovals = approvedPayloads.filter(
    ({ reference }) =>
      reference.payloadPath === 'verification/cases/voice-text.json' &&
      reference.payloadDigest === input.corpusDigest,
  )
  const corpusApproved =
    corpusApprovals.some(({ reference }) => reference.role === 'owner') &&
    corpusApprovals.some(({ reference }) => reference.role === 'pilot_coach')
  for (const reference of input.evidence.reports) {
    let bytes: Buffer
    try {
      bytes = await readFile(join(input.root, reference.path))
    } catch {
      continue
    }
    if (hash(bytes) !== reference.digest) v.invalid()
    const report = validateReport(
      JSON.parse(bytes.toString('utf8')),
      input.registry,
    )
    if (
      !matchingCandidateReport(report, input.candidate) ||
      report.environment.workflowRunId !== reference.workflowRunId ||
      Date.parse(report.finishedAt) > Date.parse(input.now)
    )
      continue
    if (
      !(await verifyWorkflow(
        input.reader,
        input.owners,
        reference.workflowRunId,
        input.candidate.sha,
        input.now,
      ))
    )
      continue
    if (
      !(await verifyArtifactReport({
        reader: input.reader,
        token: input.token,
        owners: input.owners,
        workflowRunId: reference.workflowRunId,
        artifactId: reference.artifactId,
        candidate: input.candidate.sha,
        runId: report.runId,
        reportDigest: reference.digest,
      }))
    )
      continue
    results.push(...report.results)
    if (report.caseResults.length) {
      for (const result of report.caseResults)
        validateCaseResult(result, input.corpus, input.corpusDigest)
      const trustedReviews: TrustedReview[] = approvedPayloads
        .filter(({ reference }) =>
          reference.payloadPath.startsWith('verification/reviews/'),
        )
        .map(({ reference, account, payload }) => {
          const review = validateReview(
            JSON.parse(Buffer.from(payload).toString('utf8')),
          )
          if (review.reviewerRole !== reference.role) v.invalid()
          return { review, digest: reference.payloadDigest, account }
        })
      const quality = scoreVoice({
        corpus: input.corpus,
        corpusDigest: input.corpusDigest,
        results: report.caseResults,
        reviews: trustedReviews,
        now: input.now,
        reportDigest: reference.digest,
        inputFingerprint: input.candidate.inputFingerprint,
        runtimeFingerprint: input.candidate.runtimeFingerprint,
        providerFingerprint: report.agentSnapshotDigest,
      })
      const status =
        quality.status === 'failed'
          ? 'failed'
          : corpusApproved
            ? quality.status
            : 'missing'
      const check = input.registry.checks.find(
        (check) => check.id === 'voice_quality',
      )!
      results.push(
        resultFor(
          check,
          status,
          status === 'missing'
            ? 'VOICE_REVIEW_MISSING'
            : status === 'failed'
              ? 'VOICE_INTEGRITY_OR_QUALITY_FAILED'
              : 'VOICE_QUALITY_APPROVED',
          status === 'missing'
            ? []
            : [
                attemptFor(
                  check.id,
                  status === 'passed' ? 'passed' : 'failed',
                  'VOICE_REVIEW_ASSESSED',
                  input.now,
                  0,
                ),
              ],
        ),
      )
    }
  }
  for (const reference of input.evidence.retained) {
    let bytes: Buffer
    try {
      bytes = await readFile(join(input.root, reference.summaryPath))
    } catch {
      continue
    }
    if (
      hash(bytes) !== reference.summaryDigest ||
      reference.attestation.role !== 'owner'
    )
      v.invalid()
    const summary = validateCompact(
      await json(join(input.root, reference.summaryPath)),
      input.registry,
      input.corpus,
      input.corpusDigest,
    )
    if (
      !matchingCandidateReport(summary.report, input.candidate) ||
      !summary.sourceWorkflowRunId
    )
      continue
    const approved = await verifyApproval(
      input.reader,
      input.owners,
      reference.attestation,
    )
    if (!approved) continue
    const attestation = v.record(
      JSON.parse(Buffer.from(approved.payload).toString('utf8')),
    )
    attestationRule(attestation)
    if (
      attestation.originalReportAvailable !== true ||
      attestation.sourceReportDigest !== summary.sourceReportDigest ||
      attestation.summaryDigest !== reference.summaryDigest ||
      attestation.workflowRunId !== summary.sourceWorkflowRunId ||
      attestation.candidate !== input.candidate.sha ||
      Date.parse(String(attestation.attestedAt)) <
        Date.parse(summary.createdAt) ||
      Date.parse(String(attestation.attestedAt)) > Date.parse(input.now) ||
      Date.parse(approved.signedAt) <
        Date.parse(String(attestation.attestedAt)) ||
      Date.parse(approved.signedAt) >
        Date.parse(summary.createdAt) + 30 * 86400000 ||
      Date.parse(String(attestation.attestedAt)) -
        Date.parse(summary.createdAt) >
        30 * 86400000
    )
      continue
    if (
      !(await verifyWorkflow(
        input.reader,
        input.owners,
        summary.sourceWorkflowRunId,
        input.candidate.sha,
        input.now,
      ))
    )
      continue
    results.push(...reusableCompactResults(summary))
  }
  // Never let another supplied run erase a recorded failure.
  return input.registry.checks.flatMap((check) => {
    const matching = results.filter((result) => result.checkId === check.id)
    const result =
      matching.find((result) => result.status === 'failed') ??
      matching.find(
        (result) => result.status === 'passed' || result.status === 'flaky',
      ) ??
      matching[0]
    return result ? [result] : []
  })
}
