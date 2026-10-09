import type { ApiError, HealthResponse } from '../domain/configuration'
import {
  isAppEnvironment,
  isReleaseId,
  readConfiguration,
  type ConfigurationBindings,
} from './configuration'

interface WorkerBindings extends ConfigurationBindings {
  ASSETS: Fetcher
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}

export default {
  async fetch(request, env): Promise<Response> {
    const path = new URL(request.url).pathname
    if (path !== '/api' && !path.startsWith('/api/')) {
      return env.ASSETS.fetch(request)
    }

    const started = performance.now()
    const requestId = crypto.randomUUID()
    const route =
      request.method === 'GET' && path === '/api/health'
        ? 'health'
        : request.method === 'GET' && path === '/api/config'
          ? 'config'
          : 'unmatched'
    let response: Response

    if (route === 'unmatched') {
      response = json({ code: 'NOT_FOUND', requestId } satisfies ApiError, 404)
    } else {
      const config = readConfiguration(env)
      if (!config) {
        response = json(
          { code: 'CONFIG_INVALID', requestId } satisfies ApiError,
          503,
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
