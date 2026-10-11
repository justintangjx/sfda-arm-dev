export type Rule = (value: unknown) => void
export function invalid(): never {
  throw new Error('INVALID_CONTRACT')
}
export const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
  return value as Record<string, unknown>
}
export const string: Rule = (value) => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 8192)
    invalid()
}
export const boolean: Rule = (value) => {
  if (typeof value !== 'boolean') invalid()
}
export const integer =
  (min: number, max: number): Rule =>
  (value) => {
    if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      value < min ||
      value > max
    )
      invalid()
  }
export const oneOf =
  (values: readonly (string | number)[]): Rule =>
  (value) => {
    if (!values.includes(value as string | number)) invalid()
  }
export const match =
  (pattern: RegExp): Rule =>
  (value) => {
    string(value)
    if (!pattern.test(value as string)) invalid()
  }
export const id = match(/^[a-z][a-z0-9_]{0,79}$/)
export const digest = match(/^[a-f0-9]{64}$/)
export const sha = match(/^[a-f0-9]{40}$/)
export const uuid = match(
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
)
export const utc: Rule = (value) => {
  string(value)
  if (
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value as string) ||
    !Number.isFinite(Date.parse(value as string)) ||
    new Date(value as string).toISOString() !== value
  )
    invalid()
}
export const relativePath: Rule = (value) => {
  string(value)
  if (
    !/^[a-zA-Z0-9_.\-/]+$/.test(value as string) ||
    (value as string).startsWith('/') ||
    (value as string)
      .split('/')
      .some((part) => part === '..' || part === '.' || part === '')
  )
    invalid()
}
export const nullable =
  (rule: Rule): Rule =>
  (value) => {
    if (value !== null) rule(value)
  }
export const list =
  (rule: Rule, min = 0, max = 10000): Rule =>
  (value) => {
    if (!Array.isArray(value) || value.length < min || value.length > max)
      invalid()
    for (const item of value) rule(item)
  }
export const exact =
  (fields: Readonly<Record<string, Rule>>): Rule =>
  (value) => {
    const object = record(value)
    if (Object.keys(object).length !== Object.keys(fields).length) invalid()
    for (const [key, rule] of Object.entries(fields)) {
      if (!Object.hasOwn(object, key)) invalid()
      rule(object[key])
    }
  }
export const unique = (values: readonly string[]) => {
  if (new Set(values).size !== values.length) invalid()
}
export const parse = <T>(value: unknown, rule: Rule): T => {
  rule(value)
  return value as T
}
