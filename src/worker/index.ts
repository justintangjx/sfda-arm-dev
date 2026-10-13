import type { ApiError, HealthResponse } from '../domain/configuration'
import { passwordLinkKinds, passwordLinkPage } from '../domain/accounts'
import { accountRoute, handleAccountRequest } from './accounts'
import {
  isAppEnvironment,
  isReleaseId,
  readConfiguration,
  type ConfigurationBindings,
} from './configuration'
import type { AccountBindings } from './release'

interface WorkerBindings extends ConfigurationBindings, AccountBindings {
  ASSETS: Fetcher
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}
const linkPages: readonly string[] = passwordLinkKinds.map(passwordLinkPage)

export default {
  async fetch(
    request,
    env,
    context?: Pick<ExecutionContext, 'waitUntil'>,
  ): Promise<Response> {
    const path = new URL(request.url).pathname
    if (path !== '/api' && !path.startsWith('/api/')) {
      if (linkPages.includes(path)) {
        const assetUrl = new URL(request.url)
        assetUrl.search = ''
        const asset = await env.ASSETS.fetch(new Request(assetUrl, request))
        const secured = new Response(asset.body, asset)
        secured.headers.set('Cache-Control', 'no-store')
        secured.headers.set('Referrer-Policy', 'no-referrer')
        return secured
      }
      return env.ASSETS.fetch(request)
    }

    const started = performance.now()
    const requestId = crypto.randomUUID()
    const account = accountRoute(request.method, path)
    const route =
      request.method === 'GET' && path === '/api/health'
        ? 'health'
        : request.method === 'GET' && path === '/api/config'
          ? 'config'
          : (account ?? 'unmatched_route')
    let response: Response

    if (route === 'unmatched_route') {
      response = json({ code: 'NOT_FOUND', requestId } satisfies ApiError, 404)
    } else {
      const config = readConfiguration(env)
      if (!config) {
        response = json(
          { code: 'CONFIG_INVALID', requestId } satisfies ApiError,
          503,
        )
      } else if (account) {
        response = await handleAccountRequest(
          request,
          config,
          env,
          requestId,
          (work) => context?.waitUntil(work),
        )
      } else if (route === 'config') {
        response = json(config)
      } else {
        response = json({
          service: 'sfda-arm',
          appEnv: config.appEnv,
          releaseId: config.releaseId,
          status: 'ok',
        } satisfies HealthResponse)
      }
    }

    console.log(
      JSON.stringify({
        requestId,
        route,
        status: response.status,
        elapsedMs: Math.round(performance.now() - started),
        appEnv: isAppEnvironment(env.APP_ENV) ? env.APP_ENV : 'unknown',
        releaseId: isReleaseId(env.RELEASE_ID) ? env.RELEASE_ID : 'unknown',
      }),
    )
    return response
  },
} satisfies ExportedHandler<WorkerBindings>
