const DEFAULT_EXTERNAL_URL_HOSTS = Object.freeze([
  'aistudio.google.com',
  'apps.apple.com',
  'atomic.chat',
  'auth.openai.com',
  'chatgpt.com',
  'claude.ai',
  'console.anthropic.com',
  'discord.com',
  'discord.gg',
  'github.com',
  'hermes-world.ai',
  'hermes-workspace.com',
  'karpathy.ai',
  'minimax.io',
  'nodejs.org',
  'nousresearch.com',
  'ollama.com',
  'openrouter.ai',
  'platform.openai.com',
  'play.google.com',
  'tailscale.com',
  'twitter.com',
  'x.com',
])

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

function normalizeHostname(value) {
  let normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\.$/, '')

  if (normalized.startsWith('[') && normalized.endsWith(']')) {
    normalized = normalized.slice(1, -1)
  }

  return normalized
}

function normalizeAllowedHost(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''

  try {
    if (raw.includes('://')) return normalizeHostname(new URL(raw).hostname)
  } catch {
    return ''
  }

  return normalizeHostname(raw.split('/')[0])
}

function parseAllowedHosts(value) {
  if (!value) return []
  return String(value)
    .split(',')
    .map(normalizeAllowedHost)
    .filter(Boolean)
}

function allowedHostsFromEnv(env = process.env) {
  return [
    ...DEFAULT_EXTERNAL_URL_HOSTS,
    ...parseAllowedHosts(
      env.HERMES_EXTERNAL_URL_ALLOWLIST ||
        env.HERMES_EXTERNAL_URL_ALLOWED_HOSTS,
    ),
  ]
}

function hostnameMatchesAllowedHost(hostname, allowedHost) {
  const normalizedHost = normalizeHostname(hostname)
  const normalizedAllowed = normalizeAllowedHost(allowedHost)
  if (!normalizedHost || !normalizedAllowed) return false
  return (
    normalizedHost === normalizedAllowed ||
    normalizedHost.endsWith(`.${normalizedAllowed}`)
  )
}

function isLoopbackHostname(hostname) {
  return LOOPBACK_HOSTS.has(normalizeHostname(hostname))
}

function isAllowedExternalUrl(rawUrl, options = {}) {
  if (typeof rawUrl !== 'string' || rawUrl.length > 2048) return false

  let parsed
  try {
    parsed = new URL(rawUrl)
  } catch {
    return false
  }

  if (parsed.username || parsed.password) return false

  if (parsed.protocol === 'http:') {
    return isLoopbackHostname(parsed.hostname)
  }

  if (parsed.protocol !== 'https:') return false

  const allowedHosts =
    options.allowedHosts || allowedHostsFromEnv(options.env || process.env)
  return allowedHosts.some((host) =>
    hostnameMatchesAllowedHost(parsed.hostname, host),
  )
}

module.exports = {
  DEFAULT_EXTERNAL_URL_HOSTS,
  isAllowedExternalUrl,
}
