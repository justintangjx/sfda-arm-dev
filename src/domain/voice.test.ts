import { describe, expect, it } from 'vitest'
import { finishMessage, parseToolArguments, proposalToolName } from './voice.js'

describe('voice domain', () => {
  it('parses tool arguments with limits and unknown key rejection', () => {
    expect(parseToolArguments({ observations: '  hello  ' })).toEqual({
      ok: true,
      value: {
        observations: 'hello',
        strengths: null,
        developmentFocus: null,
      },
    })
    expect(parseToolArguments({ extra: 'x' })).toEqual({
      ok: false,
      code: 'INVALID_PROPOSAL',
    })
    expect(
      parseToolArguments({
        development_focus: 'a'.repeat(5_001),
      }),
    ).toEqual({ ok: false, code: 'INVALID_PROPOSAL' })
  })

  it('keeps the grafted finish message and tool name stable', () => {
    expect(proposalToolName).toBe('prepare_feedback_proposal')
    expect(finishMessage).toContain('prepare_feedback_proposal')
    expect(finishMessage).toContain('empty')
  })
})
