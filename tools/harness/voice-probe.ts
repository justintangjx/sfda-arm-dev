import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { readFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { hash, atomicJson } from './io.js'
import { safeEnvironment } from './process.js'
import { withVoiceProbeLock, type VoiceLocalRequest } from './voice-local.js'
import * as v from './validation.js'

const canonical = (value: unknown): string =>
  Array.isArray(value)
    ? `[${value.map(canonical).join(',')}]`
    : value !== null && typeof value === 'object'
      ? `{${Object.keys(value)
          .sort()
          .map(
            (key) =>
              `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`,
          )
          .join(',')}}`
      : JSON.stringify(value)
const read = async (path: string, key: string, signal: AbortSignal) => {
  const response = await fetch(`https://api.elevenlabs.io/v1/convai/${path}`, {
    headers: { 'xi-api-key': key },
    signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    redirect: 'error',
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error('PROVIDER_UNAVAILABLE')
  }
  const reader = response.body?.getReader()
  if (!reader) v.invalid()
  const bytes: Uint8Array[] = []
  let size = 0
  while (true) {
    const next = await reader.read()
    if (next.done) break
    size += next.value.byteLength
    if (size > 1_048_576) {
      await reader.cancel()
      throw new Error('PROVIDER_RESPONSE_LIMIT')
    }
    bytes.push(next.value)
  }
  return v.record(JSON.parse(Buffer.concat(bytes).toString('utf8')))
}
export const runVoiceCompatibilityProbe = async (
  input: Readonly<{
    root: string
    request: VoiceLocalRequest
    manifest: Record<string, unknown>
    key: string
    signal: AbortSignal
    env: NodeJS.ProcessEnv
  }>,
) => {
  const { request, manifest } = input
  if (
    request.mode !== 'compatibility' ||
    !request.audioAssetPath ||
    !request.audioAssetDigest ||
    !input.key ||
    manifest.agentId !== request.agentId ||
    typeof manifest.agentVersionId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(manifest.agentVersionId)
  )
    v.invalid()
  const audioPath = join(input.root, request.audioAssetPath)
  if (
    (await realpath(audioPath)) !== audioPath ||
    hash(await readFile(audioPath)) !== request.audioAssetDigest
  )
    v.invalid()
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(900_000)])
  // Configuration reads are permitted before credential dispatch. A private reviewed snapshot is mandatory.
  const raw = await read(
    `agents/${request.agentId}?version_id=${manifest.agentVersionId}`,
    input.key,
    signal,
  )
  const conversation = v.record(raw.conversation_config)
  const platform = v.record(raw.platform_settings)
  const privacy = v.record(platform.privacy)
  const auth = v.record(platform.auth)
  if (
    privacy.record_voice !== false ||
    privacy.retention_days !== 0 ||
    auth.enable_auth !== true ||
    v.record(conversation.conversation).max_duration_seconds !== 300 ||
    v.record(conversation.agent).language !== 'en' ||
    canonical({
      agent: conversation.agent,
      tts: conversation.tts,
      conversation: conversation.conversation,
      platform,
    }) !== canonical(manifest.providerConfiguration)
  )
    throw new Error('VOICE_CONFIG_CHANGED')
  if (
    raw.workflow !== undefined &&
    raw.workflow !== null &&
    Object.keys(v.record(raw.workflow)).length !== 0
  )
    throw new Error('VOICE_CONFIG_CHANGED')
  const prompt = v.record(v.record(conversation.agent).prompt)
  const toolIds = prompt.tool_ids
  if (
    !Array.isArray(toolIds) ||
    toolIds.length !== 1 ||
    typeof toolIds[0] !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(toolIds[0]) ||
    !Array.isArray(prompt.knowledge_base) ||
    prompt.knowledge_base.length !== 0
  )
    throw new Error('VOICE_CONFIG_CHANGED')
  const tools = v.record(manifest.toolConfigurations)
  const tool = v.record(
    (await read(`tools/${toolIds[0]}`, input.key, signal)).tool_config,
  )
  if (
    tool.type !== 'client' ||
    tool.name !== 'prepare_feedback_proposal' ||
    tool.expects_response !== true ||
    canonical(tool) !== canonical(tools[toolIds[0]])
  )
    throw new Error('VOICE_CONFIG_CHANGED')
  return withVoiceProbeLock(
    input.root,
    request.agentId,
    async (checkpointPath) => {
      const dispatchedAt = Date.now()
      let dispatchStarted = false
      let conversationId: string | undefined
      let server: ReturnType<typeof spawn> | undefined
      let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
      try {
        // Own the local Vite process. Port collisions fail; no arbitrary existing server is trusted.
        server = spawn('pnpm', ['dev'], {
          cwd: input.root,
          env: { ...safeEnvironment(input.env), CLOUDFLARE_ENV: 'preview' },
          stdio: 'ignore',
          detached: process.platform !== 'win32',
        })
        let ready = false
        for (let attempt = 0; attempt < 80 && !signal.aborted; attempt++) {
          if (server.exitCode !== null) break
          try {
            const response = await fetch(
              'http://127.0.0.1:5173/verification/voice-compatibility.html',
              { signal: AbortSignal.timeout(1000) },
            )
            const content = await response.text()
            if (
              response.ok &&
              content.includes('/src/app/voice/compatibility.tsx')
            ) {
              ready = true
              break
            }
          } catch {
            /* Await the owned development server. */
          }
          await new Promise((done) => setTimeout(done, 250))
        }
        if (!ready || signal.aborted)
          throw new Error('VOICE_PROBE_RUNTIME_UNAVAILABLE')
        browser = await chromium.launch({
          channel: input.env.PLAYWRIGHT_BROWSER_CHANNEL,
          args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            `--use-file-for-fake-audio-capture=${audioPath}`,
          ],
        })
        const page = await browser.newPage({ permissions: ['microphone'] })
        // Exactly one issuance, after the local runtime is ready. No credentials are persisted.
        dispatchStarted = true
        const credential = await read(
          `conversation/token?agent_id=${request.agentId}&version_id=${manifest.agentVersionId}`,
          input.key,
          signal,
        )
        if (
          typeof credential.token !== 'string' ||
          credential.token.length > 16_384 ||
          typeof credential.conversation_id !== 'string' ||
          !/^[A-Za-z0-9_-]{1,128}$/.test(credential.conversation_id)
        )
          throw new Error('VOICE_ISSUANCE_UNKNOWN')
        conversationId = credential.conversation_id
        await atomicJson(checkpointPath, {
          schemaVersion: 1,
          closed: false,
          dispatchAt: new Date(dispatchedAt).toISOString(),
          conversationId,
          outcome: 'ISSUED',
        })
        const abort = () => {
          void browser?.close()
        }
        signal.addEventListener('abort', abort, { once: true })
        try {
          await page.goto(
            'http://127.0.0.1:5173/verification/voice-compatibility.html',
          )
          await page.waitForFunction(
            'Boolean(window.voiceCompatibility)',
            undefined,
            { timeout: 15_000 },
          )
          await page.evaluate((token) => {
            const api = (
              globalThis as unknown as {
                voiceCompatibility: { start: (token: string) => void }
              }
            ).voiceCompatibility
            api.start(token)
          }, credential.token)
          await page.waitForFunction(
            'window.voiceCompatibility.snapshot().connected || window.voiceCompatibility.snapshot().failed',
            undefined,
            { timeout: 40_000 },
          )
          const first = v.record(
            await page.evaluate('window.voiceCompatibility.snapshot()'),
          )
          if (
            first.conversationId !== conversationId ||
            first.connected !== true
          )
            throw new Error('EXECUTION_IDENTITY_UNAVAILABLE')
          const details = await read(
            `conversations/${conversationId}`,
            input.key,
            signal,
          )
          const identityVerified =
            details.conversation_id === conversationId &&
            details.agent_id === request.agentId &&
            details.version_id === manifest.agentVersionId &&
            ['initiated', 'in-progress'].includes(String(details.status))
          await page.evaluate('window.voiceCompatibility.finish()')
          await page.waitForTimeout(1000)
          const muted = v.record(
            await page.evaluate('window.voiceCompatibility.snapshot()'),
          )
          try {
            await page.waitForFunction(
              'window.voiceCompatibility.snapshot().proposalReceived',
              undefined,
              { timeout: 19_000 },
            )
          } catch {
            /* Missing delivery is evidence. */
          }
          const finished = v.record(
            await page.evaluate('window.voiceCompatibility.snapshot()'),
          )
          await page.evaluate('window.voiceCompatibility.end()')
          await page.waitForTimeout(1000)
          const ended = v.record(
            await page.evaluate('window.voiceCompatibility.snapshot()'),
          )
          let replayConnected: boolean | null = null
          if (request.connectionAttempts === 2) {
            await page.evaluate(
              (token) =>
                (
                  globalThis as unknown as {
                    voiceCompatibility: { start: (token: string) => void }
                  }
                ).voiceCompatibility.start(token),
              credential.token,
            )
            try {
              await page.waitForFunction(
                'window.voiceCompatibility.snapshot().connected || window.voiceCompatibility.snapshot().failed',
                undefined,
                { timeout: 40_000 },
              )
            } catch {
              /* Uncertain replay is retained. */
            }
            const replay = v.record(
              await page.evaluate('window.voiceCompatibility.snapshot()'),
            )
            replayConnected =
              replay.connected === true
                ? true
                : replay.failed === true
                  ? false
                  : null
            await page.evaluate('window.voiceCompatibility.end()')
          }
          const final = await read(
            `conversations/${conversationId}`,
            input.key,
            signal,
          ).catch(() => undefined)
          // Samples never establish a complete credential/issuance bound. Safe closure still needs the reviewed contract.
          const terminalConsumes =
            manifest.credentialRule === 'terminal_consumes' &&
            identityVerified &&
            final?.conversation_id === conversationId &&
            final.agent_id === request.agentId &&
            final.version_id === manifest.agentVersionId &&
            ['done', 'failed'].includes(String(final.status))
          await atomicJson(checkpointPath, {
            schemaVersion: 1,
            closed: terminalConsumes,
            closedAt: terminalConsumes ? new Date().toISOString() : null,
            dispatchAt: new Date(dispatchedAt).toISOString(),
            conversationId,
            outcome: terminalConsumes ? 'CLOSED' : 'PROVIDER_STATUS_UNKNOWN',
          })
          return {
            identityVerified,
            captureReleasedOnFinish:
              Number(muted.trackCount) > 0 && muted.liveTracks === 0,
            proposalReceived: finished.proposalReceived === true,
            captureReleasedOnEnd:
              Number(ended.trackCount) > 0 && ended.liveTracks === 0,
            replayConnected,
            issuanceObservedMs: Date.now() - dispatchedAt,
            completeBoundsProven: false as const,
            deviceEvidence: 'synthetic_chromium' as const,
            configurationFingerprint: request.configurationFingerprint,
            conversationReferenceDigest: hash(conversationId),
            observedAt: new Date().toISOString(),
          }
        } finally {
          signal.removeEventListener('abort', abort)
        }
      } finally {
        if (!dispatchStarted)
          await atomicJson(checkpointPath, {
            schemaVersion: 1,
            closed: true,
            closedAt: new Date().toISOString(),
            dispatchAt: new Date(dispatchedAt).toISOString(),
            conversationId: null,
            outcome: 'NOT_DISPATCHED',
          })
        await browser?.close().catch(() => {})
        if (server?.pid) {
          try {
            if (process.platform !== 'win32')
              process.kill(-server.pid, 'SIGTERM')
            else server.kill('SIGTERM')
          } catch {
            /* Already ended. */
          }
        }
      }
    },
  )
}
