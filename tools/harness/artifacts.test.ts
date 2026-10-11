import { randomUUID } from 'node:crypto'
import { deflateRawSync } from 'node:zlib'
import { expect, it } from 'vitest'
import { reportFromZip } from './artifacts.js'

const archive = (name: string, contents: string) => {
  const filename = Buffer.from(name)
  const data = Buffer.from(contents)
  const compressed = deflateRawSync(data)
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50)
  local.writeUInt16LE(8, 8)
  local.writeUInt32LE(compressed.length, 18)
  local.writeUInt32LE(data.length, 22)
  local.writeUInt16LE(filename.length, 26)
  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50)
  central.writeUInt16LE(8, 10)
  central.writeUInt32LE(compressed.length, 20)
  central.writeUInt32LE(data.length, 24)
  central.writeUInt16LE(filename.length, 28)
  const directory = Buffer.concat([central, filename])
  const start = Buffer.concat([local, filename, compressed])
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50)
  end.writeUInt16LE(1, 8)
  end.writeUInt16LE(1, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(start.length, 16)
  return Buffer.concat([start, directory, end])
}
it('extracts only the expected immutable report from an authenticated archive', () => {
  const runId = randomUUID()
  const report = '{"synthetic":true}'
  expect(
    reportFromZip(archive(`${runId}/report.json`, report), runId).toString(),
  ).toBe(report)
})
it('rejects traversal, malformed archives, excessive expanded output and a different run', () => {
  const runId = randomUUID()
  expect(() => reportFromZip(archive('../report.json', '{}'), runId)).toThrow()
  expect(() => reportFromZip(Buffer.from('invalid'), runId)).toThrow()
  expect(() =>
    reportFromZip(archive(`${randomUUID()}/report.json`, '{}'), runId),
  ).toThrow()
  expect(() =>
    reportFromZip(
      archive('report.json', 'a'.repeat(16 * 1024 * 1024 + 1)),
      runId,
    ),
  ).toThrow()
})
