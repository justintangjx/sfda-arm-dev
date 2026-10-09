import { describe, expectTypeOf, it } from 'vitest'
import type { ApplicationDatabase } from './database'

type Functions = ApplicationDatabase['public']['Functions']
describe('database input types (covers: AC-5, AC-12)', () => {
  it('accepts explicit null dates and optional draft identities', () => {
    expectTypeOf<
      Functions['create_competition']['Args']['starts_on']
    >().toEqualTypeOf<string | null>()
    expectTypeOf<
      Functions['create_competition']['Args']['ends_on']
    >().toEqualTypeOf<string | null>()
    expectTypeOf<
      Functions['create_campaign']['Args']['planned_preparation_start_on']
    >().toEqualTypeOf<string | null>()
    expectTypeOf<
      Functions['submit_feedback']['Args']['draft_id']
    >().toEqualTypeOf<string | null>()
    expectTypeOf<
      Functions['save_feedback_draft']['Args']['expected_version']
    >().toEqualTypeOf<number | null>()
    expectTypeOf<
      Functions['set_campaign_coach']['Args']['expected_version']
    >().toEqualTypeOf<number | null>()
    expectTypeOf<
      Functions['set_campaign_player']['Args']['expected_version']
    >().toEqualTypeOf<number | null>()
  })
  it('keeps mutation identities required and permits null paging filters', () => {
    expectTypeOf<
      Functions['submit_feedback']['Args']['mutation_id']
    >().toEqualTypeOf<string>()
    expectTypeOf<
      Functions['admin_list_profiles']['Args']['role_filter']
    >().toEqualTypeOf<'admin' | 'coach' | 'player' | null | undefined>()
    expectTypeOf<
      Functions['list_final_obligations']['Args']['status_filter']
    >().toEqualTypeOf<string | null | undefined>()
  })
})
