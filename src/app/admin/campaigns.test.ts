import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AdminAction } from './actions'
import { Roster } from './campaigns'

const action: AdminAction = {
  busy: false,
  locked: false,
  error: '',
  notice: '',
  code: undefined,
  unknown: undefined,
  run: async () => true,
  check: async () => {},
  discard: () => {},
}
const roster = (role: 'coach' | 'player', stage: string) =>
  renderToStaticMarkup(
    createElement(Roster, {
      role,
      stage,
      members: [
        {
          id: '00000000-0000-4000-8000-000000000001',
          name: 'Synthetic removed member',
          active: false,
          version: 2,
          createdAt: '2026-10-13T00:00:00Z',
        },
      ],
      candidates: [],
      action,
      admit: () => {},
      change: () => {},
    }),
  )

describe('roster stage controls (spec 0006, AC-4)', () => {
  it.each(['setup', 'preparation'])(
    'permits admission and restoration for both roles during %s',
    (stage) => {
      for (const role of ['coach', 'player'] as const) {
        expect(roster(role, stage)).toContain('<select')
        expect(roster(role, stage)).toContain('>Restore</button>')
      }
    },
  )
  it.each(['competition', 'final_feedback'])(
    'hides new admission during %s while keeping coach restoration',
    (stage) => {
      expect(roster('coach', stage)).not.toContain('<select')
      expect(roster('player', stage)).not.toContain('<select')
      expect(roster('coach', stage)).toContain('>Restore</button>')
      expect(roster('player', stage)).not.toContain('>Restore</button>')
    },
  )
  it('permits no admission or restoration after closure', () => {
    for (const role of ['coach', 'player'] as const) {
      expect(roster(role, 'closed')).not.toContain('<select')
      expect(roster(role, 'closed')).not.toContain('>Restore</button>')
    }
  })
})
import { createElement } from 'react'
