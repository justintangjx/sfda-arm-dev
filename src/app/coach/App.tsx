import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router'
import type { PublicConfiguration } from '../../domain/configuration'
import { isObject } from '../../domain/feedback'
import { AsyncState } from './components'
import { createCoachController } from './controller'
import { createFixtureAdapter, sampleActor } from './fixtures'
import { RuntimeContext, type Runtime } from './runtime'
import {
  CampaignList,
  CampaignRoute,
  CoachShell,
  Login,
  PlayerRoute,
  RequireCoach,
} from './screens'
import styles from './coach.module.css'
import { validatePublicConfiguration } from './configuration'
import { readAccess, type Access, type SetupProof } from '../../domain/accounts'
import { createDataClient } from '../data/client'
import { createLiveCoachAdapter } from '../data/coach'
import type { DataResult } from './contracts'
import { AdminSetup, AccountStatus, SetupPassword } from '../accounts/screens'
import '../accounts/setup'

const router = createBrowserRouter([
  {
    element: <CoachShell />,
    errorElement: (
      <main className={styles.container}>
        <AsyncState title="This workspace is unavailable">
          You can reload the page to try again.
        </AsyncState>
      </main>
    ),
    children: [
      { path: '/login', element: <Login /> },
      { path: '/auth/setup', element: <SetupPassword /> },
      { path: '/admin/setup', element: <AdminSetup /> },
      { path: '/account', element: <AccountStatus /> },
      {
        element: <RequireCoach />,
        children: [
          { path: '/coach', element: <CampaignList /> },
          {
            path: '/coach/campaigns/:campaignId',
            element: <CampaignRoute />,
            children: [{ path: 'players/:playerId', element: <PlayerRoute /> }],
          },
        ],
      },
      { path: '/', element: <Navigate to="/coach" replace /> },
      {
        path: '*',
        element: (
          <AsyncState title="This page is unavailable">
            You can choose a campaign from the SFDA Coaches link.
          </AsyncState>
        ),
      },
    ],
  },
])
type Session = Readonly<{
  actor: typeof sampleActor
  adapter: ReturnType<typeof createFixtureAdapter>['adapter']
  controller: ReturnType<typeof createCoachController>
  access: Access | undefined
  dataClient: ReturnType<typeof createDataClient>
}>
const previewSession = (): Session => {
  const { adapter } = createFixtureAdapter()
  return {
    actor: sampleActor,
    adapter,
    controller: createCoachController(sampleActor, adapter),
    access: undefined,
    dataClient: undefined,
  }
}

export function App({
  setupProof,
}: Readonly<{ setupProof: SetupProof | undefined }>) {
  const loginAttempt = useRef(0)
  const [configuration, setConfiguration] = useState<
    PublicConfiguration | undefined
  >(undefined)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [session, setSession] = useState<Session | undefined>(undefined)
  const [revision, setRevision] = useState(0)
  const [networkUnavailable, reportNetwork] = useState(false)
  useEffect(() => {
    const abort = new AbortController()
    void fetch('/api/config', { cache: 'no-store', signal: abort.signal })
      .then(async (response) => {
        const body: unknown = await response.json()
        if (abort.signal.aborted) return
        const value = response.ok
          ? validatePublicConfiguration(body)
          : undefined
        if (!value) {
          setError(
            isObject(body) && typeof body.requestId === 'string'
              ? `Configuration unavailable. Request ${body.requestId}`
              : 'Configuration unavailable.',
          )
          return
        }
        setConfiguration(value)
        setError('')
        if (value.appEnv === 'preview') setSession(previewSession())
      })
      .catch(() => {
        if (!abort.signal.aborted)
          setError(
            'Configuration could not be loaded. Check your connection and retry.',
          )
      })
    return () => abort.abort()
  }, [retry])
  const signOut = useCallback(() => {
    loginAttempt.current++
    session?.controller.dispose()
    setSession((current) => (current === session ? undefined : current))
    void session?.adapter.signOut().catch(() => {})
  }, [session])
  const login = useCallback(
    async (email: string, password: string): Promise<DataResult<Access>> => {
      const requestId = crypto.randomUUID()
      const attempt = ++loginAttempt.current
      if (!configuration || configuration.appEnv === 'preview')
        return { ok: false, code: 'FORBIDDEN', requestId }
      const dataClient = createDataClient(configuration)
      if (!dataClient) return { ok: false, code: 'FORBIDDEN', requestId }
      try {
        const signedIn = await dataClient.auth.signInWithPassword({
          email,
          password,
        })
        if (signedIn.error || !signedIn.data.user)
          return { ok: false, code: 'AUTH_REQUIRED', requestId }
        const result = await dataClient.rpc('get_my_access')
        const access = readAccess(result.data)
        if (
          attempt !== loginAttempt.current ||
          !access?.enabled ||
          access.id !== signedIn.data.user.id
        ) {
          await dataClient.auth.signOut({ scope: 'local' })
          return { ok: false, code: 'FORBIDDEN', requestId }
        }
        const actor = {
          id: access.id,
          displayName: access.displayName,
          accessVersion: access.version,
        }
        const adapter = createLiveCoachAdapter(dataClient)
        session?.controller.dispose()
        setSession({
          actor,
          adapter,
          controller: createCoachController(actor, adapter),
          access,
          dataClient,
        })
        reportNetwork(false)
        return { ok: true, value: access }
      } catch {
        return { ok: false, code: 'NETWORK_ERROR', requestId }
      }
    },
    [configuration, session],
  )
  const refreshAccess = useCallback(async () => {
    if (!session) return false
    try {
      const result = await session.adapter.getAccess(session.actor)
      if (!result.ok) {
        if (['FORBIDDEN', 'AUTH_REQUIRED', 'NOT_FOUND'].includes(result.code))
          signOut()
        return false
      }
      if (
        result.value.id !== session.actor.id ||
        result.value.accessVersion !== session.actor.accessVersion
      ) {
        signOut()
        return false
      }
      reportNetwork(false)
      return true
    } catch {
      reportNetwork(true)
      return false
    }
  }, [session, signOut])
  const refresh = useCallback(() => setRevision((value) => value + 1), [])
  const enterPreview = useCallback(() => {
    if (configuration?.appEnv === 'preview') {
      session?.controller.dispose()
      setSession(previewSession())
    }
  }, [configuration, session])
  const runtime = useMemo<Runtime | undefined>(
    () =>
      configuration
        ? {
            configuration,
            actor: session?.actor,
            adapter: session?.adapter,
            controller: session?.controller,
            enterPreview,
            signOut,
            revision,
            networkUnavailable,
            reportNetwork,
            refresh,
            refreshAccess,
            access: session?.access,
            dataClient: session?.dataClient,
            login,
            setupProof,
          }
        : undefined,
    [
      configuration,
      session,
      enterPreview,
      signOut,
      revision,
      networkUnavailable,
      refresh,
      refreshAccess,
      login,
      setupProof,
    ],
  )
  if (!configuration)
    return (
      <main className={styles.container}>
        <h1>SFDA Coaches</h1>
        {error ? (
          <AsyncState
            title="Workspace unavailable"
            retry={() => {
              setError('')
              setRetry((value) => value + 1)
            }}
          >
            {error}
          </AsyncState>
        ) : (
          <p role="status">Loading workspace configuration…</p>
        )}
      </main>
    )
  return (
    <RuntimeContext value={runtime}>
      <RouterProvider router={router} />
    </RuntimeContext>
  )
}
