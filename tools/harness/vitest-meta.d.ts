import 'vitest'

declare module 'vitest' {
  interface TaskMeta {
    harnessAttempts?: unknown
  }
}
