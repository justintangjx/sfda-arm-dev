import { isObject } from '../domain/feedback'
import { canonicalVoiceJson, type VoiceManifest } from './voice-configuration'

export type ProviderObservation =
  | Readonly<{
      kind: 'observed'
      conversationId: string
      agentId: string
      versionId: string
      status: 'initiated' | 'in-progress' | 'processing' | 'done' | 'failed'
      durationSeconds: number | null
    }>
  | Readonly<{ kind: 'missing' | 'unavailable' }>
export type Issuance =
  | Readonly<{ outcome: 'issued'; token: string; conversationId: string }>
  | Readonly<{ outcome: 'unknown' }>

export const boundedProviderJson = async (
  response: Response,
): Promise<unknown> => {
  const reader = response.body?.getReader()
  if (!reader) return undefined
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > 1_048_576) {
        await reader.cancel()
        return undefined
      }
      chunks.push(chunk.value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return JSON.parse(
      new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes),
    ) as unknown
  } catch {
    return undefined
  }
}
const providerRead = (path: string, key: string, fetcher: typeof fetch) =>
  fetcher(`https://api.elevenlabs.io/v1/convai/${path}`, {
    headers: { 'xi-api-key': key },
    signal: AbortSignal.timeout(10_000),
    redirect: 'error',
  })
const providerId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)

// This projection includes the prompt and tool configuration only for a transient comparison.
// It never enters responses, session rows, or logs.
export const projectProviderConfiguration = (value: unknown) => {
  if (
    !isObject(value) ||
    !isObject(value.conversation_config) ||
    !isObject(value.platform_settings)
  )
    return undefined
  const config = value.conversation_config
  const platform = value.platform_settings
  if (
    !isObject(platform.auth) ||
    platform.auth.enable_auth !== true ||
    (platform.auth.allowlist !== undefined &&
      (!Array.isArray(platform.auth.allowlist) ||
        platform.auth.allowlist.length !== 0)) ||
    (value.workflow !== undefined &&
      value.workflow !== null &&
      (!isObject(value.workflow) || Object.keys(value.workflow).length !== 0))
  )
    return undefined
  if (
    !isObject(config.conversation) ||
    config.conversation.max_duration_seconds !== 300 ||
    !isObject(platform.privacy) ||
    platform.privacy.record_voice !== false ||
    platform.privacy.retention_days !== 0 ||
    !isObject(config.agent) ||
    config.agent.language !== 'en' ||
    !isObject(config.agent.prompt) ||
    !isObject(config.tts) ||
    !providerId(config.tts.voice_id) ||
    typeof config.agent.prompt.prompt !== 'string' ||
    typeof config.agent.prompt.llm !== 'string'
  )
    return undefined
  return {
    agent: config.agent,
    tts: config.tts,
    conversation: config.conversation,
    platform,
  }
}
export const verifyProviderConfiguration = async (
  manifest: VoiceManifest,
  key: string,
  fetcher: typeof fetch = fetch,
) => {
  try {
    const response = await providerRead(
      `agents/${manifest.agentId}?version_id=${encodeURIComponent(manifest.agentVersionId)}`,
      key,
      fetcher,
    )
    if (!response.ok) {
      await response.body?.cancel()
      return false
    }
    const projection = projectProviderConfiguration(
      await boundedProviderJson(response),
    )
    if (
      projection === undefined ||
      canonicalVoiceJson(projection) !==
        canonicalVoiceJson(manifest.providerConfiguration)
    )
      return false
    const prompt =
      isObject(projection.agent) && isObject(projection.agent.prompt)
        ? projection.agent.prompt
        : undefined
    if (
      !prompt ||
      !Array.isArray(prompt.tool_ids) ||
      prompt.tool_ids.length !== 1 ||
      !Array.isArray(prompt.knowledge_base) ||
      prompt.knowledge_base.length !== 0
    )
      return false
    const toolId = prompt.tool_ids[0]
    if (
      !providerId(toolId) ||
      !Object.hasOwn(manifest.toolConfigurations, toolId)
    )
      return false
    const toolResponse = await providerRead(`tools/${toolId}`, key, fetcher)
    if (!toolResponse.ok) {
      await toolResponse.body?.cancel()
      return false
    }
    const tool = await boundedProviderJson(toolResponse)
    if (
      !isObject(tool) ||
      !isObject(tool.tool_config) ||
      tool.tool_config.type !== 'client' ||
      tool.tool_config.name !== 'prepare_feedback_proposal' ||
      tool.tool_config.expects_response !== true
    )
      return false
    return (
      canonicalVoiceJson(tool.tool_config) ===
      canonicalVoiceJson(manifest.toolConfigurations[toolId])
    )
  } catch {
    return false
  }
}
export const issueVoiceCredential = async (
  manifest: VoiceManifest,
  key: string,
  fetcher: typeof fetch = fetch,
): Promise<Issuance> => {
  try {
    const response = await providerRead(
      `conversation/token?agent_id=${encodeURIComponent(manifest.agentId)}&version_id=${encodeURIComponent(manifest.agentVersionId)}`,
      key,
      fetcher,
    )
    if (!response.ok) {
      await response.body?.cancel()
      return { outcome: 'unknown' }
    }
    const value = await boundedProviderJson(response)
    if (
      !isObject(value) ||
      typeof value.token !== 'string' ||
      !value.token ||
      value.token.length > 16_384 ||
      !providerId(value.conversation_id)
    )
      return { outcome: 'unknown' }
    return {
      outcome: 'issued',
      token: value.token,
      conversationId: value.conversation_id,
    }
  } catch {
    return { outcome: 'unknown' }
  }
}
export const observeVoiceProvider = async (
  conversationId: string,
  key: string,
  fetcher: typeof fetch = fetch,
): Promise<ProviderObservation> => {
  if (!providerId(conversationId)) return { kind: 'unavailable' }
  try {
    const response = await providerRead(
      `conversations/${conversationId}`,
      key,
      fetcher,
    )
    if (!response.ok) {
      await response.body?.cancel()
      return { kind: response.status === 404 ? 'missing' : 'unavailable' }
    }
    const value = await boundedProviderJson(response)
    if (
      !isObject(value) ||
      value.conversation_id !== conversationId ||
      !providerId(value.agent_id) ||
      !providerId(value.version_id)
    )
      return { kind: 'unavailable' }
    const status = (
      ['initiated', 'in-progress', 'processing', 'done', 'failed'] as const
    ).find((s) => s === value.status)
    if (!status) return { kind: 'unavailable' }
    const duration = isObject(value.metadata)
      ? value.metadata.call_duration_secs
      : undefined
    return {
      kind: 'observed',
      conversationId,
      agentId: value.agent_id,
      versionId: value.version_id,
      status,
      durationSeconds:
        typeof duration === 'number' &&
        Number.isSafeInteger(duration) &&
        duration >= 0 &&
        duration <= 600
          ? duration
          : null,
    }
  } catch {
    return { kind: 'unavailable' }
  }
}
