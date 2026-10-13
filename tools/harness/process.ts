import { spawn } from 'node:child_process'

export type ProcessResult = Readonly<{
  exitCode: number | null
  reasonCode:
    | 'PROCESS_OK'
    | 'PROCESS_FAILED'
    | 'PROCESS_TIMEOUT'
    | 'PROCESS_CANCELLED'
    | 'PROCESS_UNAVAILABLE'
    | 'OUTPUT_LIMIT'
  stdout: string
  durationMs: number
}>
export const subprocess = (
  input: Readonly<{
    command: string
    args: readonly string[]
    cwd: string
    env: NodeJS.ProcessEnv
    timeoutMs: number
    signal: AbortSignal
    capture?: boolean
  }>,
): Promise<ProcessResult> =>
  new Promise((resolve) => {
    const started = Date.now()
    let reason: ProcessResult['reasonCode'] | undefined
    let stdout = ''
    let bytes = 0
    let killTimer: ReturnType<typeof setTimeout> | undefined
    const child = spawn(input.command, [...input.args], {
      cwd: input.cwd,
      env: input.env,
      shell: false,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const terminate = (code: ProcessResult['reasonCode']) => {
      if (reason) return
      reason = code
      const kill = (signal: NodeJS.Signals) => {
        try {
          if (process.platform !== 'win32' && child.pid)
            process.kill(-child.pid, signal)
          else child.kill(signal)
        } catch {
          /* The owned process already exited. */
        }
      }
      kill('SIGTERM')
      killTimer = setTimeout(() => kill('SIGKILL'), 1000)
    }
    const abort = () => terminate('PROCESS_CANCELLED')
    input.signal.addEventListener('abort', abort, { once: true })
    const timeout = setTimeout(
      () => terminate('PROCESS_TIMEOUT'),
      input.timeoutMs,
    )
    for (const stream of [child.stdout, child.stderr])
      stream.on('data', (data: Buffer) => {
        bytes += data.length
        if (bytes > 16 * 1024 * 1024) terminate('OUTPUT_LIMIT')
        if (
          stream === child.stdout &&
          input.capture &&
          bytes <= 16 * 1024 * 1024
        )
          stdout += data.toString('utf8')
      })
    child.on('error', () => {
      reason = 'PROCESS_UNAVAILABLE'
    })
    child.on('close', (exitCode) => {
      clearTimeout(timeout)
      // A timed out shell can leave descendants. Give the group its final kill.
      if (killTimer) {
        clearTimeout(killTimer)
        try {
          if (process.platform !== 'win32' && child.pid)
            process.kill(-child.pid, 'SIGKILL')
        } catch {
          /* Already gone. */
        }
      }
      input.signal.removeEventListener('abort', abort)
      resolve({
        exitCode,
        reasonCode:
          reason ?? (exitCode === 0 ? 'PROCESS_OK' : 'PROCESS_FAILED'),
        stdout,
        durationMs: Date.now() - started,
      })
    })
    if (input.signal.aborted) abort()
  })
export const safeEnvironment = (
  source: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv => {
  const names = [
    'PATH',
    'HOME',
    'TMPDIR',
    'TEMP',
    'SystemRoot',
    'CI',
    'PLAYWRIGHT_BROWSER_CHANNEL',
  ]
  return {
    ...Object.fromEntries(
      names.flatMap((name) =>
        source[name] === undefined ? [] : [[name, source[name]]],
      ),
    ),
    WRANGLER_SEND_METRICS: 'false',
    NO_COLOR: '1',
  }
}
export const forbiddenCredentials = (env: NodeJS.ProcessEnv) =>
  Object.entries(env).some(
    ([name, value]) =>
      value &&
      /^(MIGRATION_READ_|PRODUCTION_|ELEVENLABS_|SFDA_TEST_SUPABASE_|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_ADMIN_KEY|SUPABASE_ACCESS_TOKEN|CLOUDFLARE_API_TOKEN)/.test(
        name,
      ),
  )
