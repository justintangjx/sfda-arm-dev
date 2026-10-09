import { describe, expect, it } from 'vitest'
import {
  validateFeedbackText,
  feedbackRpcContent,
  validateMutationResult,
  validateVoiceContextBinding,
  voiceContextMatches,
  type VoiceContextBinding,
} from './feedback'

describe('reviewed text and future voice contracts (synthetic)', () => {
  const text = {
    observations: ' Coach reviewed text. ',
    strengths: ' ',
    developmentFocus: null,
    observedOn: '2026-01-01',
  }
  it('normalises optional text and counts Unicode characters consistently with PostgreSQL (covers: AC-5)', () => {
    expect(validateFeedbackText(text, true)).toEqual({
      ok: true,
      value: { ...text, observations: 'Coach reviewed text.', strengths: null },
    })
    expect(
      validateFeedbackText({ ...text, observations: '🟢'.repeat(10000) }, true)
        .ok,
    ).toBe(true)
    expect(
      validateFeedbackText({ ...text, observations: '🟢'.repeat(10001) }, true)
        .ok,
    ).toBe(false)
  })
  it('allows incomplete drafts and rejects invalid submitted dates and extra media fields (covers: AC-4, AC-5, AC-13)', () => {
    expect(
      validateFeedbackText(
        { ...text, observations: null, observedOn: null },
        false,
      ).ok,
    ).toBe(true)
    expect(validateFeedbackText({ ...text, observations: null }, true).ok).toBe(
      false,
    )
    expect(
      validateFeedbackText({ ...text, observedOn: '2026-02-30' }, true).ok,
    ).toBe(false)
    expect(
      validateFeedbackText(
        { ...text, transcript: 'Synthetic provider text.' },
        true,
      ).ok,
    ).toBe(false)
  })
  const started: VoiceContextBinding = {
    callerId: '00000000-0000-4000-8000-000000000001',
    campaignId: '00000000-0000-4000-8000-000000000002',
    playerId: '00000000-0000-4000-8000-000000000003',
    kind: 'preparation',
    campaignVersion: 2,
    callerAccessVersion: 2,
    coachMembershipVersion: 1,
    playerMembershipVersion: 1,
  }
  it('discards proposals after any identity, stage or permission revision change, including restoration (covers: AC-13)', () => {
    expect(voiceContextMatches(started, started, true)).toBe(true)
    expect(voiceContextMatches(started, started, false)).toBe(false)
    for (const key of [
      'campaignVersion',
      'callerAccessVersion',
      'coachMembershipVersion',
      'playerMembershipVersion',
    ] as const)
      expect(
        voiceContextMatches(
          started,
          { ...started, [key]: started[key] + 2 },
          true,
        ),
      ).toBe(false)
    expect(
      voiceContextMatches(started, { ...started, kind: 'final' }, true),
    ).toBe(false)
    expect(
      voiceContextMatches(
        started,
        { ...started, callerId: started.playerId },
        true,
      ),
    ).toBe(false)
  })
})

describe('feedback input boundary (covers: AC-5, AC-13)', () => {
  const valid = {
    observations: 'Synthetic text',
    strengths: null,
    developmentFocus: null,
    observedOn: '2024-02-29',
  }
  it.each([
    null,
    undefined,
    [],
    'text',
    {},
    { ...valid, observations: 1 },
    { ...valid, strengths: false },
    { ...valid, developmentFocus: [] },
    { ...valid, observedOn: 1 },
  ])('rejects malformed content %#', (value) => {
    expect(validateFeedbackText(value, false)).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    })
  })
  it.each([
    '0000-01-01',
    '2025-02-29',
    '2026-04-31',
    '2026-13-01',
    '2026-00-01',
    '2026-01-00',
    '2026-1-01',
    '2026-01-01T00:00:00Z',
    '',
  ])('rejects invalid calendar date %s', (observedOn) => {
    expect(validateFeedbackText({ ...valid, observedOn }, true).ok).toBe(false)
  })
  it('accepts leap dates and leaves the current date check to the database', () => {
    expect(validateFeedbackText(valid, true).ok).toBe(true)
    expect(
      validateFeedbackText({ ...valid, observedOn: '2099-01-01' }, true).ok,
    ).toBe(true)
  })
  it.each(['strengths', 'developmentFocus'] as const)(
    'enforces the Unicode limit for %s',
    (field) => {
      expect(
        validateFeedbackText({ ...valid, [field]: '🟢'.repeat(5000) }, true).ok,
      ).toBe(true)
      expect(
        validateFeedbackText({ ...valid, [field]: '🟢'.repeat(5001) }, false)
          .ok,
      ).toBe(false)
    },
  )
  it('requires both reviewed observations and a date for a submission', () => {
    expect(
      validateFeedbackText({ ...valid, observations: '\n\t ' }, true).ok,
    ).toBe(false)
    expect(validateFeedbackText({ ...valid, observedOn: null }, true).ok).toBe(
      false,
    )
    expect(
      validateFeedbackText(
        { ...valid, observations: null, observedOn: null },
        false,
      ).ok,
    ).toBe(true)
  })
  it('sends only the reviewed content fields to the database', () => {
    expect(feedbackRpcContent(valid)).toEqual({
      observations: valid.observations,
      strengths: null,
      development_focus: null,
      observed_on: valid.observedOn,
    })
  })
})

describe('mutation response boundary (covers: AC-12, AC-15)', () => {
  const id = '00000000-0000-4000-8000-000000000001'
  const envelope = { outcome: 'committed', mutationId: id }
  const common = { version: 1, exists: true, metadata: {} }
  it.each([
    'profile',
    'competition',
    'campaign',
    'feedback_entry',
    'final_waiver',
    'feedback_correction',
  ])('accepts a %s reference', (type) => {
    const response = { ...envelope, result: { ...common, type, id } }
    expect(validateMutationResult(response)).toEqual({
      ok: true,
      value: response,
    })
  })
  it.each(['campaign_coach', 'campaign_player'] as const)(
    'preserves both identities in a deleted %s reference',
    (type) => {
      const response = {
        ...envelope,
        outcome: 'already_committed',
        result: {
          ...common,
          exists: false,
          type,
          campaignId: id,
          [type === 'campaign_coach' ? 'coachId' : 'playerId']: id,
        },
      }
      expect(validateMutationResult(response)).toEqual({
        ok: true,
        value: response,
      })
      expect(
        validateMutationResult({ ...response, result: { ...common, type, id } })
          .ok,
      ).toBe(false)
    },
  )
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1', null])(
    'rejects an invalid version %#',
    (version) => {
      expect(
        validateMutationResult({
          ...envelope,
          result: { ...common, type: 'profile', id, version },
        }).ok,
      ).toBe(false)
    },
  )
  it.each([
    null,
    [],
    {},
    {
      ...envelope,
      mutationId: 'bad',
      result: { ...common, type: 'profile', id },
    },
    {
      ...envelope,
      outcome: 'pending',
      result: { ...common, type: 'profile', id },
    },
    { ...envelope, result: { ...common, type: 'unknown', id } },
    { ...envelope, result: { ...common, type: 'profile', id: 'bad' } },
    { ...envelope, result: { ...common, type: 'profile', id, metadata: [] } },
    { ...envelope, result: { ...common, type: 'profile', id, exists: 'true' } },
  ])('rejects a malformed response %#', (value) => {
    expect(validateMutationResult(value)).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    })
  })
})

describe('voice context input boundary (covers: AC-13)', () => {
  const binding: VoiceContextBinding = {
    callerId: '00000000-0000-4000-8000-000000000001',
    campaignId: '00000000-0000-4000-8000-000000000002',
    playerId: '00000000-0000-4000-8000-000000000003',
    kind: 'final',
    campaignVersion: 1,
    callerAccessVersion: 2,
    coachMembershipVersion: 3,
    playerMembershipVersion: 4,
  }
  it('accepts a complete binding and rejects extra proposal fields', () => {
    expect(validateVoiceContextBinding(binding)).toEqual({
      ok: true,
      value: binding,
    })
    expect(
      validateVoiceContextBinding({ ...binding, transcript: 'Synthetic text' })
        .ok,
    ).toBe(false)
  })
  it.each([
    'callerId',
    'campaignId',
    'playerId',
    'kind',
    'campaignVersion',
    'callerAccessVersion',
    'coachMembershipVersion',
    'playerMembershipVersion',
  ] as const)('rejects missing or malformed %s', (key) => {
    const missing = Object.fromEntries(
      Object.entries(binding).filter(([name]) => name !== key),
    )
    expect(validateVoiceContextBinding(missing).ok).toBe(false)
    expect(validateVoiceContextBinding({ ...binding, [key]: null }).ok).toBe(
      false,
    )
    expect(
      voiceContextMatches(
        binding,
        { ...binding, [key]: key.endsWith('Version') ? 10 : 'changed' },
        true,
      ),
    ).toBe(false)
  })
})
