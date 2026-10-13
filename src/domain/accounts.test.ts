import { describe, expect, it } from 'vitest'
import {
  normalizeEmail,
  passwordLinkBody,
  passwordLinkUrl,
  readPasswordLinkBody,
  readPasswordLinkUrl,
  validPassword,
} from './accounts'

const password = 'Synthetic password 1'
const setupBody = () => ({
  operationId: crypto.randomUUID(),
  generation: 2,
  setupCapability: 'A'.repeat(43),
  tokenHash: 'synthetic-proof',
  type: 'invite',
  password,
})

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
    const body = setupBody()
    expect(readPasswordLinkBody('setup', body)).toBeDefined()
    expect(
      readPasswordLinkBody('setup', {
        ...body,
        setupCapability: 'A'.repeat(42) + 'B',
      }),
    ).toBeUndefined()
    expect(
      readPasswordLinkBody('setup', { ...body, setupCapability: undefined }),
    ).toBeUndefined()
    expect(
      readPasswordLinkBody('setup', { ...body, generation: 0 }),
    ).toBeUndefined()
  })
})

describe('password link wire contract (spec 0006, AC-7, AC-8)', () => {
  it.each(['setup', 'recovery'] as const)(
    'round trips a %s link from email URL to completion body',
    (kind) => {
      const operationId = crypto.randomUUID()
      const url = passwordLinkUrl(
        'http://127.0.0.1:5173',
        kind,
        operationId,
        7,
        `${'B'.repeat(42)}A`,
      )
      url.searchParams.set('token_hash', 'synthetic-proof')
      url.searchParams.set('type', 'recovery')
      const link = readPasswordLinkUrl(url)
      expect(link).toEqual({
        kind,
        operationId,
        sequence: 7,
        capability: `${'B'.repeat(42)}A`,
        tokenHash: 'synthetic-proof',
        type: 'recovery',
      })
      expect(
        readPasswordLinkBody(kind, passwordLinkBody(link!, password)),
      ).toEqual({ link, password })
    },
  )
  it('keeps the two kinds and their provider proof types separate', () => {
    const recovery = passwordLinkUrl(
      'http://127.0.0.1:5173',
      'recovery',
      crypto.randomUUID(),
      3,
      'C'.repeat(43),
    )
    recovery.searchParams.set('token_hash', 'synthetic-proof')
    recovery.searchParams.set('type', 'invite')
    expect(readPasswordLinkUrl(recovery)).toBeUndefined()
    expect(readPasswordLinkBody('recovery', setupBody())).toBeUndefined()
    expect(
      readPasswordLinkBody('setup', { ...setupBody(), extra: true }),
    ).toBeUndefined()
    expect(
      readPasswordLinkUrl(new URL('http://127.0.0.1:5173/auth/elsewhere')),
    ).toBeUndefined()
  })
})
