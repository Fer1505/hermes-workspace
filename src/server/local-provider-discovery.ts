/**
 * Local Provider Auto-Discovery
 *
 * Probes well-known local ports for OpenAI-compatible backends (Ollama, Atomic Chat, etc.)
 * and exposes their models to the workspace model picker.
 *
 * - Probes only when an owning request explicitly invokes discovery
 * - Re-probes every 30s after the first owned request
 * - Merges discovered models into /api/models response
 * - Auto-writes custom_providers to ~/.hermes/config.yaml if not already configured
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import YAML from 'yaml'

// -------------------------------------------------------------------
// Well-known local providers
// -------------------------------------------------------------------

export type LocalProviderDef = {
  id: string
  name: string
  port: number
  /** Path appended to http://127.0.0.1:{port} for the models endpoint */
  modelsPath: string
  /** Base URL for the provider (written to custom_providers) */
  baseUrl: string
  apiKey: string
  apiMode: string
}

const LOCAL_PROVIDERS: ReadonlyArray<LocalProviderDef> = [
  {
    id: 'ollama',
    name: 'Ollama',
    port: 11434,
    modelsPath: '/v1/models',
    baseUrl: 'http://127.0.0.1:11434/v1',
    apiKey: 'ollama',
    apiMode: 'chat_completions',
  },
  {
    id: 'atomic-chat',
    name: 'Atomic Chat',
    port: 1337,
    modelsPath: '/v1/models',
    baseUrl: 'http://127.0.0.1:1337/v1',
    apiKey: 'atomic-chat',
    apiMode: 'chat_completions',
  },
]

// -------------------------------------------------------------------
// Types
// -------------------------------------------------------------------

export type DiscoveredModel = {
  id: string
  name: string
  provider: string
  source: 'local-discovery'
  size?: number | null
}

export type DiscoveredProvider = {
  def: LocalProviderDef
  online: boolean
  models: DiscoveredModel[]
  lastProbe: number
}

export type LocalProviderDiscoveryTransport = (
  url: string,
  init: RequestInit,
) => Promise<Pick<Response, 'ok' | 'json'>>

export type LocalProviderDiscovery = {
  ensureDiscovery: () => Promise<void>
  forceDiscovery: () => Promise<void>
  getDiscoveredModels: () => DiscoveredModel[]
  getDiscoveryStatus: () => Array<{
    id: string
    name: string
    online: boolean
    modelCount: number
    port: number
    lastProbe: number
  }>
}

// -------------------------------------------------------------------
// State
// -------------------------------------------------------------------

const PROBE_TTL_MS = 30_000 // re-probe every 30s
const PROBE_TIMEOUT_MS = 800 // 800ms timeout per probe — local servers respond fast

function cleanModelName(id: string): string {
  // Ollama models often have :latest suffix, keep it for ID but clean for display
  return id.replace(/:latest$/, '')
}

export function createLocalProviderDiscovery({
  transport = (url, init) => fetch(url, init),
  now = () => Date.now(),
  providers = LOCAL_PROVIDERS,
  probeTtlMs = PROBE_TTL_MS,
  probeTimeoutMs = PROBE_TIMEOUT_MS,
}: {
  transport?: LocalProviderDiscoveryTransport
  now?: () => number
  providers?: ReadonlyArray<LocalProviderDef>
  probeTtlMs?: number
  probeTimeoutMs?: number
} = {}): LocalProviderDiscovery {
  const discoveryState: Map<string, DiscoveredProvider> = new Map()
  let lastProbeAll: number | null = null
  let probePromise: Promise<void> | null = null

  const probeProvider = async (
    def: LocalProviderDef,
  ): Promise<DiscoveredProvider> => {
    const url = `http://127.0.0.1:${def.port}${def.modelsPath}`
    try {
      const response = await transport(url, {
        signal: AbortSignal.timeout(probeTimeoutMs),
        headers: { Accept: 'application/json' },
      })
      if (!response.ok) {
        return { def, online: false, models: [], lastProbe: now() }
      }
      const payload = (await response.json()) as Record<string, unknown>
      const rawModels = Array.isArray(payload.data)
        ? payload.data
        : Array.isArray(payload.models)
          ? payload.models
          : []

      const models: DiscoveredModel[] = rawModels.flatMap(
        (entry: Record<string, unknown>) => {
          const id =
            typeof entry.id === 'string'
              ? entry.id
              : typeof entry.name === 'string'
                ? entry.name
                : ''
          if (!id) return []
          return [
            {
              id,
              name: cleanModelName(id),
              provider: def.id,
              source: 'local-discovery' as const,
              size:
                typeof entry.size === 'number'
                  ? Math.round(entry.size / 1024 / 1024 / 1024)
                  : null,
            },
          ]
        },
      )

      return { def, online: true, models, lastProbe: now() }
    } catch {
      return { def, online: false, models: [], lastProbe: now() }
    }
  }

  const probeAll = async (): Promise<void> => {
    const results = await Promise.allSettled(
      providers.map((def) => probeProvider(def)),
    )
    for (const result of results) {
      if (result.status === 'fulfilled') {
        const previous = discoveryState.get(result.value.def.id)
        discoveryState.set(result.value.def.id, result.value)

        if (result.value.online && !previous?.online) {
          console.log(
            `[local-discovery] ${result.value.def.name} detected on :${result.value.def.port} — ${result.value.models.length} model(s)`,
          )
        } else if (!result.value.online && previous?.online) {
          console.log(
            `[local-discovery] ${result.value.def.name} went offline on :${result.value.def.port}`,
          )
        }
      }
    }
    lastProbeAll = now()
  }

  const ensureRecentlyDiscovered = async (): Promise<void> => {
    if (
      lastProbeAll !== null &&
      now() - lastProbeAll < probeTtlMs
    )
      return
    if (probePromise) return probePromise
    probePromise = probeAll().finally(() => {
      probePromise = null
    })
    return probePromise
  }

  return {
    ensureDiscovery: ensureRecentlyDiscovered,
    async forceDiscovery(): Promise<void> {
      lastProbeAll = null
      return ensureRecentlyDiscovered()
    },
    getDiscoveredModels(): DiscoveredModel[] {
      const models: DiscoveredModel[] = []
      for (const provider of discoveryState.values()) {
        if (provider.online) models.push(...provider.models)
      }
      return models
    },
    getDiscoveryStatus() {
      return providers.map((def) => {
        const state = discoveryState.get(def.id)
        return {
          id: def.id,
          name: def.name,
          online: state?.online ?? false,
          modelCount: state?.models.length ?? 0,
          port: def.port,
          lastProbe: state?.lastProbe ?? 0,
        }
      })
    },
  }
}

const defaultDiscovery = createLocalProviderDiscovery()

// -------------------------------------------------------------------
// Public API
// -------------------------------------------------------------------

/**
 * Ensure discovery has run recently. Call before reading results.
 * Deduplicates concurrent probes.
 */
export async function ensureDiscovery(): Promise<void> {
  return defaultDiscovery.ensureDiscovery()
}

/**
 * Force a re-probe immediately (e.g. after config change).
 */
export async function forceDiscovery(): Promise<void> {
  return defaultDiscovery.forceDiscovery()
}

/**
 * Get all discovered models across all local providers.
 */
export function getDiscoveredModels(): DiscoveredModel[] {
  return defaultDiscovery.getDiscoveredModels()
}

/**
 * Get discovery status for all known local providers.
 */
export function getDiscoveryStatus(): Array<{
  id: string
  name: string
  online: boolean
  modelCount: number
  port: number
  lastProbe: number
}> {
  return defaultDiscovery.getDiscoveryStatus()
}

/**
 * Get the provider definition for a given ID.
 */
export function getLocalProviderDef(
  id: string,
): LocalProviderDef | undefined {
  return LOCAL_PROVIDERS.find((def) => def.id === id)
}

/**
 * List of all well-known local provider IDs.
 */
export const LOCAL_PROVIDER_IDS = LOCAL_PROVIDERS.map((p) => p.id)

// -------------------------------------------------------------------
// Config auto-writer
// -------------------------------------------------------------------

function getConfigPath(): string {
  return path.join(
    process.env.HERMES_HOME ??
      process.env.CLAUDE_HOME ??
      path.join(os.homedir(), '.hermes'),
    'config.yaml',
  )
}

const loggedWarnings = new Set<string>()

function readYamlConfig(): Record<string, unknown> {
  try {
    const raw = fs.readFileSync(getConfigPath(), 'utf-8')
    const parsed = YAML.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {}
  return {}
}

/**
 * Check if a provider is already in custom_providers config.
 * Reads the active profile config using a YAML parser.
 */
export function isProviderConfigured(providerId: string): boolean {
  try {
    const config = readYamlConfig()
    const customProviders = config.custom_providers
    if (!Array.isArray(customProviders)) return false
    return customProviders.some(
      (entry: unknown) =>
        entry &&
        typeof entry === 'object' &&
        (entry as Record<string, unknown>).name === providerId,
    )
  } catch {
    return false
  }
}

/**
 * Ensure a discovered provider has a custom_providers entry in config.yaml.
 * Returns true if config was modified (gateway restart needed).
 *
 * NOTE: This does NOT auto-write anymore to avoid corrupting config.yaml.
 * The config should be managed through the gateway's /api/config endpoint
 * or manually by the user. This function only returns whether a write
 * would be needed.
 */
export function ensureProviderInConfig(providerId: string): boolean {
  if (isProviderConfigured(providerId)) return false
  const def = LOCAL_PROVIDERS.find((p) => p.id === providerId)
  if (!def) return false
  // Don't auto-write — just signal that config is needed
  if (!loggedWarnings.has(providerId)) {
    loggedWarnings.add(providerId)
    console.log(
      `[local-discovery] ${def.name} detected but not in custom_providers. Gateway restart needed after adding it.`,
    )
  }
  return false
}
