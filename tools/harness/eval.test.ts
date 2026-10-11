import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { hash } from './io.js'
import { fresh, scoreVoice, validateCorpus, validateReview } from './eval.js'
import type { CaseResult, HumanReview, TrustedReview } from './eval.js'

const bytes = await readFile('verification/cases/voice-text.json')
const corpus = validateCorpus(JSON.parse(bytes.toString('utf8')))
const corpusDigest = hash(bytes)
const now = '2026-10-11T00:00:00.000Z'
const fingerprint = hash('fixture input')
const results: readonly CaseResult[] = corpus.cases.map((item) => {
  const output = {
    observations: 'Synthetic output for manual review.',
    strengths: null,
    developmentFocus: null,
    observedOn: null,
    playerContextId: item.playerContextId,
    submitted: false,
  }
  const attemptId = randomUUID()
  return {
    id: randomUUID(),
    caseId: item.id,
    version: item.version,
    inputContextId: item.playerContextId,
    essentialFactIds: item.essentialFacts.map((fact) => fact.id),
    modality: 'text',
    corpusDigest,
    finalAttemptId: attemptId,
    attempts: [
      {
        id: attemptId,
        output,
        outputDigest: hash(JSON.stringify(output)),
        followUpTurns: [],
        integrityFindings: [],
        reasonCode: 'PROPOSED_TEXT',
      },
    ],
  }
})
const reviews: readonly TrustedReview[] = results.flatMap((result) =>
  ['owner', 'pilot_coach'].map((role) => {
    const review: HumanReview = {
      schemaVersion: 1,
      reviewId: randomUUID(),
      reportDigest: fingerprint,
      caseResultId: result.id,
      reviewerRole: role as 'owner' | 'pilot_coach',
      inputFingerprint: fingerprint,
      runtimeFingerprint: fingerprint,
      providerFingerprint: null,
      corpusDigest,
      reviewedAt: now,
      attemptIntegrity: result.attempts.map((attempt) => ({
        attemptId: attempt.id,
        outputDigest: attempt.outputDigest!,
        findings: [],
      })),
      finalFacts: result.essentialFactIds.map((factId) => ({
        factId,
        preserved: true,
      })),
      score: 4,
      note: null,
    }
    return {
      review,
      digest: hash(JSON.stringify(review)),
      account: role === 'owner' ? 'fixture-owner' : 'fixture-coach',
    }
  }),
)
const input = {
  corpus,
  corpusDigest,
  results,
  reviews,
  now,
  reportDigest: fingerprint,
  inputFingerprint: fingerprint,
  runtimeFingerprint: fingerprint,
  providerFingerprint: null,
}

it('requires nine of ten cases from both reviewers with no rounded denominator', () => {
  expect(scoreVoice(input).status).toBe('passed')
  const lowScores = (count: number) =>
    reviews.map((item, index) =>
      index < count * 2
        ? { ...item, review: { ...item.review, score: 3 } }
        : item,
    )
  expect(scoreVoice({ ...input, reviews: lowScores(1) })).toMatchObject({
    status: 'passed',
    qualifiedCases: 9,
    fraction: 0.9,
  })
  expect(scoreVoice({ ...input, reviews: lowScores(2) })).toMatchObject({
    status: 'failed',
    qualifiedCases: 8,
  })
  expect(scoreVoice({ ...input, results: results.slice(1) }).status).toBe(
    'missing',
  )
  expect(scoreVoice({ ...input, reviews: reviews.slice(1) }).status).toBe(
    'missing',
  )
})
it('blocks on a missing fact, changed fingerprint, same reviewer or future review', () => {
  const changed = (change: Partial<HumanReview>) => [
    { ...reviews[0]!, review: { ...reviews[0]!.review, ...change } },
    ...reviews.slice(1),
  ]
  expect(
    scoreVoice({
      ...input,
      reviews: changed({
        finalFacts: reviews[0]!.review.finalFacts.map((fact) => ({
          ...fact,
          preserved: false,
        })),
      }),
    }).status,
  ).toBe('failed')
  expect(
    scoreVoice({
      ...input,
      reviews: changed({ inputFingerprint: hash('changed') }),
    }).status,
  ).toBe('missing')
  expect(
    scoreVoice({
      ...input,
      reviews: reviews.map((item) => ({ ...item, account: 'same-account' })),
    }).status,
  ).toBe('missing')
  expect(
    scoreVoice({
      ...input,
      reviews: changed({ reviewedAt: '2026-10-12T00:00:00.000Z' }),
    }).status,
  ).toBe('missing')
})
it('retains an earlier critical attempt even after a later passing proposal', () => {
  const first = results[0]!
  const earlier = {
    ...first.attempts[0]!,
    id: randomUUID(),
    integrityFindings: ['invented_observation'],
  }
  const retried = { ...first, attempts: [earlier, ...first.attempts] }
  expect(
    scoreVoice({ ...input, results: [retried, ...results.slice(1)] }).status,
  ).toBe('failed')
  expect(
    scoreVoice({
      ...input,
      results: [
        {
          ...retried,
          attempts: [{ ...earlier, integrityFindings: [] }, ...first.attempts],
        },
        ...results.slice(1),
      ],
    }).status,
  ).toBe('missing')
})
it('blocks player mixing and a submitted output without a human vote', () => {
  const first = results[0]!
  const output = { ...first.attempts[0]!.output!, submitted: true }
  const attempt = {
    ...first.attempts[0]!,
    output,
    outputDigest: hash(JSON.stringify(output)),
  }
  expect(
    scoreVoice({
      ...input,
      results: [{ ...first, attempts: [attempt] }, ...results.slice(1)],
      reviews: reviews.map((item) =>
        item.review.caseResultId === first.id
          ? {
              ...item,
              review: {
                ...item.review,
                attemptIntegrity: [
                  {
                    attemptId: attempt.id,
                    outputDigest: attempt.outputDigest!,
                    findings: [],
                  },
                ],
              },
            }
          : item,
      ),
    }).status,
  ).toBe('failed')
})
it('expires at the seven day boundary and rejects invalid records', () => {
  expect(fresh('2026-10-04T00:00:00.001Z', now)).toBe(true)
  expect(fresh('2026-10-04T00:00:00.000Z', now)).toBe(false)
  expect(fresh('2026-10-12T00:00:00.000Z', now)).toBe(false)
  expect(() =>
    validateReview({ ...reviews[0]!.review, approval: 'claimed' }),
  ).toThrow()
  expect(() =>
    validateCorpus({ ...corpus, cases: corpus.cases.slice(1) }),
  ).toThrow()
})
