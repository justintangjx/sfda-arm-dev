export type AppEnvironment = 'local' | 'preview' | 'production'

export interface PublicConfiguration {
  appEnv: AppEnvironment
  appOrigin: string
  releaseId: string
  supabaseUrl: string | null
  supabasePublicKey: string | null
  voiceEnabled: boolean
}

export interface HealthResponse {
  service: 'sfda-arm'
  appEnv: AppEnvironment
  releaseId: string
  status: 'ok'
}

export interface ApiError {
  code: 'CONFIG_INVALID' | 'NOT_FOUND'
  requestId: string
}
