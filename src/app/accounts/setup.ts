import { readSetupProof } from '../../domain/accounts'

const captureSetupProof = () => {
  if (
    typeof window === 'undefined' ||
    window.location.pathname !== '/auth/setup'
  )
    return undefined
  const url = new URL(window.location.href)
  const proof = readSetupProof({
    operationId: url.searchParams.get('operationId'),
    generation: Number(url.searchParams.get('generation')),
    setupCapability: url.searchParams.get('setupCapability'),
    tokenHash: url.searchParams.get('token_hash'),
    type: url.searchParams.get('type'),
  })
  window.history.replaceState(null, '', '/auth/setup')
  return proof
}
// Capture before creating the router. The proof exists only in this page's memory.
export const setupProof = captureSetupProof()
