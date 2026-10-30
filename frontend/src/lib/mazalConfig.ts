import type { AppSettings, CustomProviderDefinition } from '../types'
import { createDefaultOpenAIProfile, normalizeSettings } from './apiProfiles'
import { getMazalKey, MAZAL_PROFILE, MAZAL_PROVIDER } from './mazalSession'
import { siteConfig } from './siteConfig'

export const mazalProvider: CustomProviderDefinition = {
  id: MAZAL_PROVIDER,
  name: siteConfig.name,
  template: 'http-image',
  submit: { path: 'api/image-tasks/generations', method: 'POST', contentType: 'json', body: {}, taskIdPath: 'id' },
  editSubmit: { path: 'api/image-tasks/edits', method: 'POST', contentType: 'multipart', body: {}, taskIdPath: 'id' },
  poll: { path: 'api/image-tasks', method: 'GET', statusPath: 'status', successValues: ['success'], failureValues: ['error'], result: { imageUrlPaths: ['data.*.url'], b64JsonPaths: ['data.*.b64_json'] } },
}

export function createMazalSettings(settings: AppSettings): AppSettings {
  return normalizeSettings({
    ...settings,
    customProviders: [mazalProvider],
    activeProfileId: MAZAL_PROFILE,
    profiles: [createDefaultOpenAIProfile({
      id: MAZAL_PROFILE,
      name: siteConfig.name,
      provider: MAZAL_PROVIDER,
      baseUrl: window.location.origin + '/',
      apiKey: getMazalKey(),
      model: 'gpt-image-2',
      imageGenerationModel: 'gpt-image-2',
      timeout: 1800,
      apiMode: 'images',
      streamImages: false,
      apiProxy: false,
      codexCli: false,
      transparentBackgroundMethod: 'local',
    })],
    autoCheckUpdate: false,
    uiFont: 'system',
    monoFont: 'system',
    retryMode: 'new',
    batchPromptMode: 'queue',
    batchPromptConcurrencyLimited: true,
    batchPromptConcurrency: 1,
    agentWebSearch: false,
  })
}
