import { inflateRawSync } from 'node:zlib'
import { hash } from './io.js'
import type { GitHubReader, Owners } from './provenance.js'
import * as v from './validation.js'

export const reportFromZip = (bytes: Uint8Array, runId: string): Buffer => {
  v.uuid(runId)
  const archive = Buffer.from(bytes)
  if (archive.length > 32 * 1024 * 1024 || archive.length < 22) v.invalid()
  let end = -1
  for (
    let index = archive.length - 22;
    index >= Math.max(0, archive.length - 65557);
    index--
  ) {
    if (archive.readUInt32LE(index) === 0x06054b50) {
      end = index
      break
    }
  }
  if (
    end === -1 ||
    archive.readUInt16LE(end + 4) !== 0 ||
    archive.readUInt16LE(end + 6) !== 0
  )
    v.invalid()
  const count = archive.readUInt16LE(end + 10)
  let cursor = archive.readUInt32LE(end + 16)
  const names: string[] = []
  let report: Buffer | undefined
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || archive.readUInt32LE(cursor) !== 0x02014b50)
      v.invalid()
    const flags = archive.readUInt16LE(cursor + 8)
    const method = archive.readUInt16LE(cursor + 10)
    const compressedSize = archive.readUInt32LE(cursor + 20)
    const size = archive.readUInt32LE(cursor + 24)
    const nameLength = archive.readUInt16LE(cursor + 28)
    const extraLength = archive.readUInt16LE(cursor + 30)
    const commentLength = archive.readUInt16LE(cursor + 32)
    const attributes = archive.readUInt32LE(cursor + 38)
    const local = archive.readUInt32LE(cursor + 42)
    const name = archive
      .subarray(cursor + 46, cursor + 46 + nameLength)
      .toString('utf8')
    if (
      cursor + 46 + nameLength + extraLength + commentLength > end ||
      flags & 1 ||
      ![0, 8].includes(method) ||
      size > 16 * 1024 * 1024 ||
      ((attributes >>> 16) & 0xf000) === 0xa000
    )
      v.invalid()
    v.relativePath(name.endsWith('/') ? name.slice(0, -1) : name)
    names.push(name)
    if (
      local + 30 > archive.length ||
      archive.readUInt32LE(local) !== 0x04034b50
    )
      v.invalid()
    const dataStart =
      local +
      30 +
      archive.readUInt16LE(local + 26) +
      archive.readUInt16LE(local + 28)
    if (dataStart + compressedSize > archive.length) v.invalid()
    if (name === `${runId}/report.json` || name === 'report.json') {
      if (report) v.invalid()
      const data = archive.subarray(dataStart, dataStart + compressedSize)
      report =
        method === 0
          ? Buffer.from(data)
          : inflateRawSync(data, { maxOutputLength: 16 * 1024 * 1024 })
      if (report.length !== size) v.invalid()
    }
    cursor += 46 + nameLength + extraLength + commentLength
  }
  v.unique(names)
  if (!report) v.invalid()
  return report
}
export const verifyArtifactReport = async (
  input: Readonly<{
    reader: GitHubReader
    token: string
    owners: Owners
    workflowRunId: string
    artifactId: number
    candidate: string
    runId: string
    reportDigest: string
  }>,
): Promise<boolean> => {
  const metadata = v.record(
    await input.reader(
      `/repos/${input.owners.repository}/actions/artifacts/${input.artifactId}`,
    ),
  )
  const workflow = v.record(metadata.workflow_run)
  const repository = v.record(
    await input.reader(`/repos/${input.owners.repository}/`),
  )
  if (
    metadata.expired !== false ||
    workflow.id !== Number(input.workflowRunId) ||
    workflow.head_sha !== input.candidate ||
    workflow.repository_id !== repository.id ||
    workflow.head_repository_id !== repository.id ||
    typeof metadata.digest !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/.test(metadata.digest)
  )
    return false
  const redirect = await fetch(
    `https://api.github.com/repos/${input.owners.repository}/actions/artifacts/${input.artifactId}/zip`,
    {
      headers: {
        Authorization: `Bearer ${input.token}`,
        Accept: 'application/vnd.github+json',
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    },
  )
  const location = redirect.headers.get('location')
  if (redirect.status !== 302 || !location) return false
  const url = new URL(location)
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    !(
      url.hostname.endsWith('.blob.core.windows.net') ||
      url.hostname.endsWith('.actions.githubusercontent.com')
    )
  )
    return false
  const response = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  })
  if (
    !response.ok ||
    Number(response.headers.get('content-length')) > 32 * 1024 * 1024 ||
    !response.body
  )
    return false
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.length
    if (size > 32 * 1024 * 1024) {
      await response.body.cancel().catch(() => undefined)
      return false
    }
    chunks.push(chunk)
  }
  const archive = Buffer.concat(chunks)
  if (`sha256:${hash(archive)}` !== metadata.digest) return false
  return hash(reportFromZip(archive, input.runId)) === input.reportDigest
}
