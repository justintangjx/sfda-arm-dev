import { describe, expect, it } from 'vitest'
import { normalizeEmail, readSetupProof, validPassword } from './accounts'

describe('account boundary validation', () => {
  it('normalizes the one reserved email identity without accepting control characters', () => {
    expect(normalizeEmail('  Synthetic@Example.Invalid ')).toBe(
      'synthetic@example.invalid',
    )
    expect(normalizeEmail('synthetic\u0000@example.invalid')).toBeUndefined()
    expect(normalizeEmail('synthetic@example.invalid\nother')).toBeUndefined()
  })
  it('counts Unicode characters, preserves spaces, and enforces the provider byte bound', () => {
    expect(validPassword(' '.repeat(12))).toBe(true)
    expect(validPassword('a'.repeat(11))).toBe(false)
    expect(validPassword('a'.repeat(64))).toBe(true)
    expect(validPassword('a'.repeat(65))).toBe(false)
    expect(validPassword('😀'.repeat(16))).toBe(true)
    expect(validPassword('😀'.repeat(17))).toBe(false)
    expect(validPassword('a'.repeat(12) + '\n')).toBe(false)
  })
  it('requires a canonical capability rather than just a numeric link generation', () => {
    const proof = {
      operationId: crypto.randomUUID(),
      generation: 2,
      setupCapability: 'A'.repeat(43),
      tokenHash: 'synthetic-proof',
      type: 'invite',
    }
    expect(readSetupProof(proof)).toBeDefined()
    expect(
      readSetupProof({ ...proof, setupCapability: 'A'.repeat(42) + 'B' }),
    ).toBeUndefined()
    expect(
      readSetupProof({ ...proof, setupCapability: undefined }),
    ).toBeUndefined()
    expect(readSetupProof({ ...proof, generation: 0 })).toBeUndefined()
  })
})
