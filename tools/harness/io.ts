import { createHash, randomUUID } from 'node:crypto'
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  writeFile,
} from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { invalid, relativePath } from './validation.js'

export const hash = (value: string | Uint8Array) =>
  createHash('sha256').update(value).digest('hex')
export const json = async (path: string): Promise<unknown> =>
  JSON.parse(await readFile(path, 'utf8'))
export const atomicJson = async (path: string, value: unknown) => {
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  })
  await rename(temporary, path)
}
const inside = (root: string, path: string) => {
  const tail = relative(root, path)
  return (
    tail !== '' &&
    !tail.startsWith(`..${sep}`) &&
    tail !== '..' &&
    !isAbsolute(tail)
  )
}
export const safeRunDirectory = async (
  root: string,
  runId: string,
  output: string | undefined,
) => {
  const physicalRoot = await realpath(root)
  const artifactRoot = resolve(physicalRoot, '.verification')
  const existing = await lstat(artifactRoot).catch(() => undefined)
  if (existing?.isSymbolicLink()) invalid()
  await mkdir(artifactRoot, { recursive: true, mode: 0o700 })
  if ((await realpath(artifactRoot)) !== artifactRoot) invalid()
  const parent =
    output === undefined
      ? join(artifactRoot, 'runs')
      : resolve(physicalRoot, output)
  if (!inside(artifactRoot, parent)) invalid()
  // Check each existing ancestor before creating anything through it.
  let cursor = artifactRoot
  for (const component of relative(artifactRoot, parent).split(sep)) {
    cursor = join(cursor, component)
    const entry = await lstat(cursor).catch(() => undefined)
    if (entry?.isSymbolicLink() || (entry && !entry.isDirectory())) invalid()
    if (!entry) await mkdir(cursor, { mode: 0o700 })
    if ((await realpath(cursor)) !== cursor) invalid()
  }
  const path = join(parent, runId)
  await mkdir(path, { mode: 0o700 })
  return path
}
export const inputFiles = async (
  root: string,
  paths: readonly string[],
): Promise<readonly string[]> => {
  const walk = async (path: string): Promise<readonly string[]> => {
    const entry = await lstat(join(root, path)).catch(() => undefined)
    if (!entry || entry.isSymbolicLink()) invalid()
    if (entry.isFile()) return [path]
    if (!entry.isDirectory()) invalid()
    const children = await readdir(join(root, path))
    const nested = await Promise.all(
      children
        .filter(
          (name) =>
            ![
              'node_modules',
              '.git',
              '.verification',
              'dist',
              '.temp',
              '.branches',
            ].includes(name),
        )
        .map((name) => walk(`${path}/${name}`)),
    )
    return nested.flat()
  }
  const files: string[] = []
  for (const path of paths) {
    relativePath(path)
    const matches = await walk(path)
    if (!matches.length) invalid()
    files.push(...matches)
  }
  return [...new Set(files)].sort()
}
export const fingerprint = async (root: string, paths: readonly string[]) => {
  const files = await inputFiles(root, paths)
  const pairs = await Promise.all(
    files.map(async (path) => [path, hash(await readFile(join(root, path)))]),
  )
  return hash(JSON.stringify(pairs))
}
export const checkoutIdentity = (
  root: string,
): Readonly<{ codeSha: string | null; dirty: boolean }> => {
  const git = (args: readonly string[]) =>
    spawnSync('git', [...args], { cwd: root, encoding: 'utf8', timeout: 10000 })
  const head = git(['rev-parse', 'HEAD'])
  const status = git(['status', '--porcelain'])
  const codeSha =
    head.status === 0 && /^[a-f0-9]{40}\n?$/.test(head.stdout)
      ? head.stdout.trim()
      : null
  return { codeSha, dirty: status.status !== 0 || status.stdout.length > 0 }
}
