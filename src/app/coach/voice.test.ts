import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { VoicePanel, type VoiceState } from './components'
import { bindingFor, newEditor } from './editor'
import {
  createFixtureAdapter,
  sampleActor,
  sampleCampaignId,
  samplePlayerId,
} from './fixtures'

it('renders every simulated voice state with explicit fixture evidence and no capture side effect', async () => {
  const { adapter } = createFixtureAdapter({ wait: async () => {} })
  const result = await adapter.loadWorkspace(
    sampleActor,
    sampleCampaignId,
    samplePlayerId,
    'preparation',
    new AbortController().signal,
  )
  if (!result.ok) throw new Error(result.code)
  const editor = newEditor(sampleActor, result.value, 'preparation')
  const states: readonly VoiceState[] = [
    'idle',
    'requesting_microphone',
    'listening',
    'assistant_speaking',
    'processing',
    'proposal_ready',
    'cancelled',
    'failed',
  ]
  let captureCalled = false
  for (const state of states) {
    const html = renderToStaticMarkup(
      createElement(VoicePanel, {
        adapter: {
          evidence: 'fixture',
          state,
          proposal: undefined,
          start: () => {
            captureCalled = true
          },
          stop: () => {},
          cancel: () => {},
        },
        editor,
        locked: false,
        apply: () => {},
      }),
    )
    expect(html).toContain('Simulated voice, fixture evidence only.')
    expect(html).toContain('role="status"')
    expect(html).toContain('Cancel conversation')
  }
  expect(captureCalled).toBe(false)
  const proposal = {
    id: 'sample-proposal',
    binding: bindingFor(sampleActor, result.value, 'preparation'),
    fields: {
      observations: '<script>sample</script>',
      strengths: 'Sample strength',
      developmentFocus: 'Sample focus',
    },
  }
  const review = renderToStaticMarkup(
    createElement(VoicePanel, {
      adapter: {
        evidence: 'fixture',
        state: 'proposal_ready',
        proposal,
        start: () => {},
        stop: () => {},
        cancel: () => {},
      },
      editor,
      locked: true,
      apply: () => {},
    }),
  )
  expect(review).toContain('&lt;script&gt;sample&lt;/script&gt;')
  expect(review).not.toContain('<script>')
  expect(review).not.toContain(' checked')
  expect(review).toContain('<fieldset disabled="">')
  expect(review).toContain('Your observation date stays the same.')
})
