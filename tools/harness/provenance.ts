import * as v from './validation.js'
import { hash } from './io.js'

export type Owners = Readonly<{
  schemaVersion: 1
  repository: string
  owner: readonly string[]
  pilot_coach: readonly string[]
  trustedWorkflowPath: string
}>
export const ownersRule = v.exact({
  schemaVersion: v.oneOf([1]),
  repository: v.match(/^[\w.-]+\/[\w.-]+$/),
  owner: v.list(v.match(/^[a-zA-Z0-9-]{1,39}$/)),
  pilot_coach: v.list(v.match(/^[a-zA-Z0-9-]{1,39}$/)),
  trustedWorkflowPath: v.relativePath,
})
export const validateOwners = (value: unknown) => {
  const owners = v.parse<Owners>(value, ownersRule)
  v.unique(owners.owner.map((name) => name.toLowerCase()))
  v.unique(owners.pilot_coach.map((name) => name.toLowerCase()))
  if (
    owners.owner.some((name) =>
      owners.pilot_coach.some(
        (coach) => coach.toLowerCase() === name.toLowerCase(),
      ),
    )
  )
    v.invalid()
  return owners
}
export type ApprovalRef = Readonly<{
  repository: string
  pullRequest: number
  reviewId: number
  role: 'owner' | 'pilot_coach'
  reviewedCommit: string
  payloadPath: string
  payloadDigest: string
  reviewBodyDigest: string
}>
export const approvalRule = v.exact({
  repository: v.match(/^[\w.-]+\/[\w.-]+$/),
  pullRequest: v.integer(1, 10000000),
  reviewId: v.integer(1, Number.MAX_SAFE_INTEGER),
  role: v.oneOf(['owner', 'pilot_coach']),
  reviewedCommit: v.sha,
  payloadPath: v.relativePath,
  payloadDigest: v.digest,
  reviewBodyDigest: v.digest,
})
type Signoff = Readonly<{
  schemaVersion: 1
  decision: 'approve' | 'revoke'
  reviewedCommit: string
  payloadPath: string
  payloadDigest: string
}>
const signoffRule = v.exact({
  schemaVersion: v.oneOf([1]),
  decision: v.oneOf(['approve', 'revoke']),
  reviewedCommit: v.sha,
  payloadPath: v.relativePath,
  payloadDigest: v.digest,
})
export type GitHubReader = (path: string) => Promise<unknown>
export const githubReader = (
  token: string | undefined,
): GitHubReader | undefined =>
  token
    ? async (path) => {
        if (!/^\/repos\/[\w.-]+\/[\w.-]+\//.test(path)) v.invalid()
        const response = await fetch(`https://api.github.com${path}`, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
          signal: AbortSignal.timeout(15000),
          redirect: 'error',
        })
        if (!response.ok) throw new Error('PROVENANCE_UNAVAILABLE')
        return response.json()
      }
    : undefined
export const verifyWorkflow = async (
  reader: GitHubReader,
  owners: Owners,
  runId: string,
  candidate: string,
  now: string,
) => {
  v.match(/^\d+$/)(runId)
  v.sha(candidate)
  const run = v.record(
    await reader(`/repos/${owners.repository}/actions/runs/${runId}`),
  )
  const repository = v.record(run.repository)
  const created =
    typeof run.created_at === 'string' ? Date.parse(run.created_at) : NaN
  return (
    run.id === Number(runId) &&
    repository.full_name === owners.repository &&
    run.head_sha === candidate &&
    run.path === owners.trustedWorkflowPath &&
    run.status === 'completed' &&
    run.conclusion === 'success' &&
    Number.isFinite(created) &&
    created <= Date.parse(now) &&
    ['pull_request', 'push', 'workflow_dispatch'].includes(String(run.event))
  )
}
export const verifyApproval = async (
  reader: GitHubReader,
  owners: Owners,
  value: unknown,
): Promise<
  | Readonly<{ account: string; payload: Uint8Array; signedAt: string }>
  | undefined
> => {
  const reference = v.parse<ApprovalRef>(value, approvalRule)
  if (reference.repository !== owners.repository) v.invalid()
  const reviews: Record<string, unknown>[] = []
  for (let page = 1; page <= 100; page++) {
    const batch = await reader(
      `/repos/${owners.repository}/pulls/${reference.pullRequest}/reviews?per_page=100&page=${page}`,
    )
    if (!Array.isArray(batch)) v.invalid()
    reviews.push(...batch.map(v.record))
    if (batch.length < 100) break
    if (page === 100) return undefined
  }
  const review = reviews.find((review) => review.id === reference.reviewId)
  if (
    !review ||
    !['APPROVED', 'COMMENTED'].includes(String(review.state)) ||
    review.commit_id !== reference.reviewedCommit ||
    typeof review.body !== 'string' ||
    hash(review.body) !== reference.reviewBodyDigest
  )
    return undefined
  const account = v.record(review.user).login
  if (
    typeof account !== 'string' ||
    !owners[reference.role].some(
      (owner) => owner.toLowerCase() === account.toLowerCase(),
    )
  )
    return undefined
  const parseSignoff = (body: unknown): Signoff | undefined => {
    try {
      return v.parse<Signoff>(JSON.parse(String(body)), signoffRule)
    } catch {
      return undefined
    }
  }
  const signoff = parseSignoff(review.body)
  if (
    !signoff ||
    signoff.decision !== 'approve' ||
    signoff.payloadDigest !== reference.payloadDigest ||
    signoff.payloadPath !== reference.payloadPath ||
    signoff.reviewedCommit !== reference.reviewedCommit
  )
    return undefined
  for (const later of reviews) {
    const laterSignoff = parseSignoff(later.body)
    if (
      laterSignoff?.decision === 'revoke' &&
      laterSignoff.payloadPath === signoff.payloadPath &&
      laterSignoff.payloadDigest === signoff.payloadDigest &&
      String(v.record(later.user).login).toLowerCase() ===
        account.toLowerCase() &&
      Date.parse(String(later.submitted_at)) >=
        Date.parse(String(review.submitted_at))
    )
      return undefined
  }
  const encodedPath = reference.payloadPath
    .split('/')
    .map(encodeURIComponent)
    .join('/')
  const file = v.record(
    await reader(
      `/repos/${owners.repository}/contents/${encodedPath}?ref=${reference.reviewedCommit}`,
    ),
  )
  if (file.encoding !== 'base64' || typeof file.content !== 'string')
    return undefined
  const payload = Buffer.from(file.content, 'base64')
  const signedTime = Date.parse(String(review.submitted_at))
  if (!Number.isFinite(signedTime)) return undefined
  return hash(payload) === reference.payloadDigest
    ? { account, payload, signedAt: new Date(signedTime).toISOString() }
    : undefined
}
