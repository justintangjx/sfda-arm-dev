import { useCallback, useEffect, useRef, useState } from 'react'
import type { DataResult, Page } from './contracts'
import { useRuntime } from './runtime'

export type LoadState<T> = Readonly<{
  value: T | undefined
  loading: boolean
  error: Readonly<{ code: string; requestId: string }> | undefined
}>
const safeFailure = () => ({
  code: 'NETWORK_ERROR',
  requestId: crypto.randomUUID(),
})
export function useRead<T>(
  load: (signal: AbortSignal) => Promise<DataResult<T>>,
  refreshRevision = 0,
) {
  const { reportNetwork } = useRuntime()
  const [state, setState] = useState<LoadState<T>>({
    value: undefined,
    loading: true,
    error: undefined,
  })
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    // This effect synchronises a new external read and clears the old context.
    // oxlint-disable-next-line react/set-state-in-effect
    setState({ value: undefined, loading: true, error: undefined })
    void load(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          if (!result.ok && result.code === 'NETWORK_ERROR') reportNetwork(true)
          setState(
            result.ok
              ? { value: result.value, loading: false, error: undefined }
              : { value: undefined, loading: false, error: result },
          )
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          reportNetwork(true)
          setState({ value: undefined, loading: false, error: safeFailure() })
        }
      })
    return () => controller.abort()
  }, [load, revision, refreshRevision, reportNetwork])
  return {
    ...state,
    retry: useCallback(() => setRevision((value) => value + 1), []),
  }
}
export function usePages<T extends { id: string }>(
  load: (
    cursor: string | undefined,
    signal: AbortSignal,
  ) => Promise<DataResult<Page<T>>>,
  refreshRevision = 0,
) {
  const { reportNetwork } = useRuntime()
  const [state, setState] = useState<
    Readonly<{
      rows: readonly T[]
      cursor: string | undefined
      queryFingerprint: string | undefined
      loading: boolean
      error: LoadState<T>['error']
      loaded: boolean
    }>
  >({
    rows: [],
    cursor: undefined,
    queryFingerprint: undefined,
    loading: true,
    error: undefined,
    loaded: false,
  })
  const generation = useRef(0)
  const pending = useRef(false)
  const abort = useRef<AbortController | undefined>(undefined)
  const fetchPage = useCallback(
    async (cursor: string | undefined, replace: boolean, current: number) => {
      if (pending.current) return
      pending.current = true
      const controller = new AbortController()
      abort.current = controller
      setState((value) => ({ ...value, loading: true, error: undefined }))
      try {
        const result = await load(cursor, controller.signal)
        if (controller.signal.aborted || generation.current !== current) return
        if (!result.ok && result.code === 'NETWORK_ERROR') reportNetwork(true)
        setState((value) =>
          result.ok
            ? {
                rows: replace
                  ? result.value.rows
                  : [
                      ...value.rows,
                      ...result.value.rows.filter(
                        (row) => !value.rows.some((old) => old.id === row.id),
                      ),
                    ],
                cursor: result.value.nextCursor,
                queryFingerprint:
                  result.value.queryFingerprint ?? value.queryFingerprint,
                loading: false,
                error: undefined,
                loaded: true,
              }
            : { ...value, loading: false, error: result },
        )
      } catch {
        if (!controller.signal.aborted && generation.current === current) {
          reportNetwork(true)
          setState((value) => ({
            ...value,
            loading: false,
            error: safeFailure(),
          }))
        }
      } finally {
        if (generation.current === current) pending.current = false
      }
    },
    [load, reportNetwork],
  )
  useEffect(() => {
    const current = ++generation.current
    pending.current = false
    // This reset follows an external read generation, never a derived UI value.
    // oxlint-disable-next-line react/set-state-in-effect
    setState({
      rows: [],
      cursor: undefined,
      queryFingerprint: undefined,
      loading: true,
      error: undefined,
      loaded: false,
    })
    void fetchPage(undefined, true, current)
    const currentAbort = abort.current
    return () => {
      currentAbort?.abort()
      generation.current = current + 1
    }
  }, [fetchPage, refreshRevision])
  return {
    ...state,
    more: () => {
      void fetchPage(
        state.loaded ? state.cursor : undefined,
        !state.loaded,
        generation.current,
      )
    },
  }
}
export function useConnectivity() {
  const { networkUnavailable } = useRuntime()
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])
  return online && !networkUnavailable
}
