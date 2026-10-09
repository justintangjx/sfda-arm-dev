import type { Database } from './database.types.ts'

// PostgreSQL function parameters accept explicit null. The generator records their
// base types, so this boundary adds the nullable inputs specified in 0002.
type NullableInput =
  | 'starts_on'
  | 'ends_on'
  | 'planned_preparation_start_on'
  | 'draft_id'
  | 'expected_version'
  | 'role_filter'
  | 'page_cursor'
  | 'status_filter'
type Functions = Database['public']['Functions']
type NullableArguments<Arguments> = {
  [Key in keyof Arguments]: Key extends NullableInput
    ? Arguments[Key] | null
    : Arguments[Key]
}
export type ApplicationDatabase = Omit<Database, 'public'> & {
  public: Omit<Database['public'], 'Functions'> & {
    Functions: {
      [Name in keyof Functions]: Omit<Functions[Name], 'Args'> & {
        Args: NullableArguments<Functions[Name]['Args']>
      }
    }
  }
}
