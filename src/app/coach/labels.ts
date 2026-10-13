import type { TextField } from './editor'
export const fieldLabels: Readonly<Record<TextField, string>> = {
  observations: 'Observations',
  strengths: 'Strengths',
  developmentFocus: 'Development focus',
}
export const stageLabels = {
  setup: 'Setup',
  preparation: 'Preparation',
  competition: 'Competition pause',
  final_feedback: 'Final feedback',
  closed: 'Closed',
} as const
export const campaignPath = (id: string) => `/coach/campaigns/${id}`
export const playerPath = (campaignId: string, playerId: string) =>
  `${campaignPath(campaignId)}/players/${playerId}`
