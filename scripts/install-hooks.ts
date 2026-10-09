import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const hooksPath = '.githooks'

function git(args: readonly string[]) {
  return spawnSync('git', args, { cwd: projectRoot, encoding: 'utf8' })
}

function installHooks(): number {
  if (!existsSync(join(projectRoot, '.git'))) {
    console.log(
      'Git hooks skipped. You can run pnpm prepare after creating a Git repository.',
    )
    return 0
  }

  const configuredPath = git(['config', '--get', 'core.hooksPath'])
  if (configuredPath.status !== 0 && configuredPath.status !== 1) {
    console.error('Git hook configuration could not be read.')
    return 1
  }

  if (
    configuredPath.status === 0 &&
    configuredPath.stdout.trim() !== hooksPath
  ) {
    console.log(
      'Git hooks skipped to preserve your existing core.hooksPath setting.',
    )
    return 0
  }

  if (configuredPath.status === 1) {
    const defaultPath = git(['rev-parse', '--git-path', 'hooks'])
    if (defaultPath.status !== 0) {
      console.error('The Git hooks directory could not be read.')
      return 1
    }

    const defaultHooksDirectory = resolve(
      projectRoot,
      defaultPath.stdout.trim(),
    )
    if (
      existsSync(defaultHooksDirectory) &&
      readdirSync(defaultHooksDirectory).some(
        (name) => !name.endsWith('.sample'),
      )
    ) {
      console.log(
        'Git hooks skipped to preserve hooks already in your Git hooks directory.',
      )
      return 0
    }
  }

  chmodSync(join(projectRoot, hooksPath, 'pre-commit'), 0o755)
  const installation = git(['config', '--local', 'core.hooksPath', hooksPath])
  if (installation.status !== 0) {
    console.error('Git hooks could not be installed.')
    return 1
  }

  console.log(
    'Git hooks installed. Your commits now run lint, format checks and type checks.',
  )
  return 0
}

process.exitCode = installHooks()
