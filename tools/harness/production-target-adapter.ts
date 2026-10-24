import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ProductionTargetAdapter } from './future-adapters.js'
import {
  migrationReaderFromFile,
  parseProductionTargetFile,
  validateHostingProductionTarget,
} from './production-target.js'
import * as v from './validation.js'

export const loadProductionTargetManifest = async (
  root: string,
): Promise<ReturnType<typeof parseProductionTargetFile>> => {
  try {
    const bytes = await readFile(
      join(root, 'verification/production-target.json'),
      'utf8',
    )
    return parseProductionTargetFile(JSON.parse(bytes))
  } catch {
    return undefined
  }
}

export const createProductionTargetAdapter = (
  root: string,
): ProductionTargetAdapter => ({
  async currentState() {
    const empty = {
      deployedSha: null,
      currentActivations: [] as const,
      verifiedDeactivations: [] as const,
      voiceEnabled: false,
      configurationFingerprint: '',
    }
    const manifest = await loadProductionTargetManifest(root)
    if (!manifest) return empty
    validateHostingProductionTarget(manifest)
    const releaseId = process.env.RELEASE_ID
    const origin = process.env.APP_ORIGIN
    const fingerprint = process.env.VOICE_CONFIG_FINGERPRINT
    if (
      typeof releaseId !== 'string' ||
      !/^[a-f0-9]{40}$/.test(releaseId) ||
      typeof origin !== 'string' ||
      origin !== manifest.appOrigin ||
      releaseId === 'local'
    )
      return empty
    const voiceEnabled = process.env.VOICE_ENABLED === 'true'
    return {
      deployedSha: releaseId,
      currentActivations: voiceEnabled ? (['voice'] as const) : ([] as const),
      verifiedDeactivations: [] as const,
      voiceEnabled,
      configurationFingerprint:
        typeof fingerprint === 'string' && /^[a-f0-9]{64}$/.test(fingerprint)
          ? fingerprint
          : '',
    }
  },
  async smoke(signal) {
    signal.throwIfAborted()
    const manifest = await loadProductionTargetManifest(root)
    if (!manifest) v.invalid()
    const migrationReader = migrationReaderFromFile(manifest)
    if (!migrationReader) v.invalid()
    throw new Error('SMOKE_ADAPTER_UNAVAILABLE')
  },
})
