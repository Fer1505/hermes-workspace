import {
  ensureDiscovery,
  getDiscoveredModels,
  getLocalProviderDef,
} from '../../server/local-provider-discovery'
import type {
  DiscoveredModel,
  LocalProviderDef,
} from '../../server/local-provider-discovery'

type LocalDiscoveryDependencies = {
  ensureDiscovery: () => Promise<void>
  getDiscoveredModels: () => Array<DiscoveredModel>
  getLocalProviderDef: (id: string) => LocalProviderDef | undefined
}

const defaultDependencies: LocalDiscoveryDependencies = {
  ensureDiscovery,
  getDiscoveredModels,
  getLocalProviderDef,
}

export async function resolveLocalProviderBaseUrl(
  requestModel: string,
  dependencies: LocalDiscoveryDependencies = defaultDependencies,
): Promise<string | undefined> {
  const normalizedModel = requestModel.trim()
  if (!normalizedModel) return undefined

  await dependencies.ensureDiscovery()
  const bareModel = normalizedModel.includes('/')
    ? normalizedModel.split('/').slice(1).join('/')
    : normalizedModel
  const localMatch = dependencies
    .getDiscoveredModels()
    .find((model) => model.id === normalizedModel || model.id === bareModel)
  if (!localMatch) return undefined
  return dependencies.getLocalProviderDef(localMatch.provider)?.baseUrl
}
