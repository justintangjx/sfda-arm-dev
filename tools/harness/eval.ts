import * as v from './validation.js'
import { hash } from './io.js'

export const criticalFindings = [
  'invented_observation',
  'mixed_player_identity',
  'approval_bypass',
] as const
export type VoiceCase = Readonly<{
  id: string
  version: number
  synthetic: true
  modality: 'text'
  playerContextId: string
  coachTurns: readonly string[]
  essentialFacts: readonly Readonly<{ id: string; text: string }>[]
  forbiddenOutcomes: readonly string[]
  expectedFollowUp: string
}>
const caseRule = v.exact({
  id: v.id,
  version: v.integer(1, 1000),
  synthetic: (value) => {
    if (value !== true) v.invalid()
  },
  modality: v.oneOf(['text']),
  playerContextId: v.id,
  coachTurns: v.list(v.string, 1),
  essentialFacts: v.list(v.exact({ id: v.id, text: v.string }), 1),
  forbiddenOutcomes: v.list(v.oneOf(criticalFindings), 3, 3),
  expectedFollowUp: v.string,
})
export type Corpus = Readonly<{ schemaVersion: 1; cases: readonly VoiceCase[] }>
export const validateCorpus = (value: unknown): Corpus => {
  const corpus = v.parse<Corpus>(
    value,
    v.exact({ schemaVersion: v.oneOf([1]), cases: v.list(caseRule, 10, 10) }),
  )
  v.unique(corpus.cases.map((item) => item.id))
  for (const item of corpus.cases) {
    v.unique(item.essentialFacts.map((fact) => fact.id))
    v.unique(item.forbiddenOutcomes)
  }
  return corpus
}
export type ProposedOutput = Readonly<{
  observations: string | null
  strengths: string | null
  developmentFocus: string | null
  observedOn: string | null
  playerContextId: string
  submitted: boolean
}>
const outputRule = v.exact({
  observations: v.nullable(v.string),
  strengths: v.nullable(v.string),
  developmentFocus: v.nullable(v.string),
  observedOn: v.nullable(v.match(/^\d{4}-\d\d-\d\d$/)),
  playerContextId: v.id,
  submitted: v.boolean,
})
export type EvalAttempt = Readonly<{
  id: string
  output: ProposedOutput | null
  outputDigest: string | null
  followUpTurns: readonly string[]
  integrityFindings: readonly string[]
  reasonCode: string
}>
export type CaseResult = Readonly<{
  id: string
  caseId: string
  version: number
  inputContextId: string
  essentialFactIds: readonly string[]
  modality: 'text' | 'audio'
  corpusDigest: string
  finalAttemptId: string | null
  attempts: readonly EvalAttempt[]
}>
const evalAttemptRule = v.exact({
  id: v.uuid,
  output: v.nullable(outputRule),
  outputDigest: v.nullable(v.digest),
  followUpTurns: v.list(v.string),
  integrityFindings: v.list(v.oneOf(criticalFindings)),
  reasonCode: v.match(/^[A-Z][A-Z0-9_]+$/),
})
export const caseResultRule = v.exact({
  id: v.uuid,
  caseId: v.id,
  version: v.integer(1, 1000),
  inputContextId: v.id,
  essentialFactIds: v.list(v.id, 1),
  modality: v.oneOf(['text', 'audio']),
  corpusDigest: v.digest,
  finalAttemptId: v.nullable(v.uuid),
  attempts: v.list(evalAttemptRule),
})
export const validateCaseResult = (
  value: unknown,
  corpus: Corpus,
  corpusDigest: string,
): CaseResult => {
  const result = v.parse<CaseResult>(value, caseResultRule)
  const item = corpus.cases.find((item) => item.id === result.caseId)
  if (
    !item ||
    result.version !== item.version ||
    result.corpusDigest !== corpusDigest ||
    result.modality !== item.modality ||
    result.inputContextId !== item.playerContextId ||
    JSON.stringify(result.essentialFactIds) !==
      JSON.stringify(item.essentialFacts.map((fact) => fact.id))
  )
    v.invalid()
  v.unique(result.attempts.map((attempt) => attempt.id))
  if (
    result.finalAttemptId !== null &&
    !result.attempts.some(
      (attempt) =>
        attempt.id === result.finalAttemptId && attempt.output !== null,
    )
  )
    v.invalid()
  for (const attempt of result.attempts) {
    if (
      attempt.output === null
        ? attempt.outputDigest !== null
        : hash(JSON.stringify(attempt.output)) !== attempt.outputDigest
    )
      v.invalid()
  }
  return result
}
export type HumanReview = Readonly<{
  schemaVersion: 1
  reviewId: string
  reportDigest: string
  caseResultId: string
  reviewerRole: 'owner' | 'pilot_coach'
  inputFingerprint: string
  runtimeFingerprint: string
  providerFingerprint: string | null
  corpusDigest: string
  reviewedAt: string
  attemptIntegrity: readonly Readonly<{
    attemptId: string
    outputDigest: string
    findings: readonly string[]
  }>[]
  finalFacts: readonly Readonly<{ factId: string; preserved: boolean }>[]
  score: number
  note: string | null
}>
export const reviewRule = v.exact({
  schemaVersion: v.oneOf([1]),
  reviewId: v.uuid,
  reportDigest: v.digest,
  caseResultId: v.uuid,
  reviewerRole: v.oneOf(['owner', 'pilot_coach']),
  inputFingerprint: v.digest,
  runtimeFingerprint: v.digest,
  providerFingerprint: v.nullable(v.digest),
  corpusDigest: v.digest,
  reviewedAt: v.utc,
  attemptIntegrity: v.list(
    v.exact({
      attemptId: v.uuid,
      outputDigest: v.digest,
      findings: v.list(v.oneOf(criticalFindings)),
    }),
  ),
  finalFacts: v.list(v.exact({ factId: v.id, preserved: v.boolean }), 1),
  score: v.integer(1, 5),
  note: v.nullable(v.string),
})
export const validateReview = (value: unknown): HumanReview => {
  const review = v.parse<HumanReview>(value, reviewRule)
  v.unique(review.attemptIntegrity.map((attempt) => attempt.attemptId))
  v.unique(review.finalFacts.map((fact) => fact.factId))
  return review
}
export const fresh = (createdAt: string, now: string) => {
  const age = Date.parse(now) - Date.parse(createdAt)
  return Number.isFinite(age) && age >= 0 && age < 604800000
}
export type TrustedReview = Readonly<{
  review: HumanReview
  digest: string
  account: string
}>
export const scoreVoice = (
  input: Readonly<{
    corpus: Corpus
    corpusDigest: string
    results: readonly CaseResult[]
    reviews: readonly TrustedReview[]
    now: string
    reportDigest: string
    inputFingerprint: string
    runtimeFingerprint: string
    providerFingerprint: string | null
  }>,
) => {
  let qualifiedCases = 0
  let missing = false
  let failed = false
  v.unique(input.results.map((result) => result.caseId))
  for (const item of input.corpus.cases) {
    const result = input.results.find((result) => result.caseId === item.id)
    if (!result) {
      missing = true
      continue
    }
    validateCaseResult(result, input.corpus, input.corpusDigest)
    if (
      result.attempts.some(
        (attempt) =>
          attempt.integrityFindings.length ||
          (attempt.output &&
            (attempt.output.playerContextId !== item.playerContextId ||
              attempt.output.submitted)),
      )
    )
      failed = true
    const final = result.attempts.find(
      (attempt) => attempt.id === result.finalAttemptId,
    )
    if (!final?.output) {
      missing = true
      continue
    }
    const roleReviews = ['owner', 'pilot_coach'].map((role) =>
      input.reviews.filter(
        ({ review }) =>
          review.caseResultId === result.id && review.reviewerRole === role,
      ),
    )
    if (roleReviews.some((reviews) => reviews.length !== 1)) {
      missing = true
      continue
    }
    const reviews = roleReviews.flat()
    if (reviews[0]?.account === reviews[1]?.account) {
      missing = true
      continue
    }
    let caseMissing = false
    for (const { review } of reviews) {
      validateReview(review)
      if (
        !fresh(review.reviewedAt, input.now) ||
        review.reportDigest !== input.reportDigest ||
        review.inputFingerprint !== input.inputFingerprint ||
        review.runtimeFingerprint !== input.runtimeFingerprint ||
        review.providerFingerprint !== input.providerFingerprint ||
        review.corpusDigest !== input.corpusDigest
      )
        caseMissing = true
      for (const attempt of result.attempts.filter(
        (attempt) => attempt.output !== null,
      )) {
        const integrity = review.attemptIntegrity.find(
          (integrity) => integrity.attemptId === attempt.id,
        )
        if (!integrity || integrity.outputDigest !== attempt.outputDigest)
          caseMissing = true
        if (integrity?.findings.length) failed = true
      }
      if (
        review.attemptIntegrity.some(
          (assessment) =>
            !result.attempts.some(
              (attempt) =>
                attempt.id === assessment.attemptId &&
                attempt.outputDigest === assessment.outputDigest,
            ),
        )
      )
        v.invalid()
      if (
        review.finalFacts.length !== item.essentialFacts.length ||
        item.essentialFacts.some(
          (fact) =>
            !review.finalFacts.some(
              (assessment) => assessment.factId === fact.id,
            ),
        )
      )
        caseMissing = true
      if (review.finalFacts.some((fact) => !fact.preserved)) failed = true
    }
    if (caseMissing) missing = true
    else if (reviews.every(({ review }) => review.score >= 4)) qualifiedCases++
  }
  const fraction = qualifiedCases / input.corpus.cases.length
  return {
    status: failed
      ? 'failed'
      : missing
        ? 'missing'
        : fraction >= 0.9
          ? 'passed'
          : 'failed',
    qualifiedCases,
    totalCases: input.corpus.cases.length,
    fraction,
  } as const
}
