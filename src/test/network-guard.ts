import { AsyncLocalStorage } from 'node:async_hooks'
import dgram from 'node:dgram'
import dns from 'node:dns'
import dnsPromises from 'node:dns/promises'
import http from 'node:http'
import http2 from 'node:http2'
import https from 'node:https'
import net from 'node:net'
import { syncBuiltinESMExports } from 'node:module'
import tls from 'node:tls'
import type { AddressInfo } from 'node:net'

import { afterEach, beforeEach } from 'vitest'

type HarnessRegistration = {
  server: net.Server
  host: string
  port: number
  closeListener: () => void
}

type NetworkGuardState = {
  registrations: Set<HarnessRegistration>
  originalFetch: typeof globalThis.fetch
  originalWebSocket: typeof globalThis.WebSocket | undefined
  originalDgramConnect: typeof dgram.Socket.prototype.connect
  originalDgramSend: typeof dgram.Socket.prototype.send
  originalDnsLookup: typeof dns.lookup
  originalHttpRequest: typeof http.request
  originalHttpGet: typeof http.get
  originalHttpsRequest: typeof https.request
  originalHttpsGet: typeof https.get
  originalHttp2Connect: typeof http2.connect
  originalNetConnect: typeof net.connect
  originalNetCreateConnection: typeof net.createConnection
  originalSocketConnect: typeof net.Socket.prototype.connect
  originalTlsConnect: typeof tls.connect
}

const stateKey = Symbol.for('hermes-workspace.test-network-guard')
const guardedGlobal = globalThis as typeof globalThis & {
  [stateKey]?: NetworkGuardState
}

const state =
  guardedGlobal[stateKey] ??
  {
    registrations: new Set<HarnessRegistration>(),
    originalFetch: globalThis.fetch,
    originalWebSocket: globalThis.WebSocket,
    originalDgramConnect: dgram.Socket.prototype.connect,
    originalDgramSend: dgram.Socket.prototype.send,
    originalDnsLookup: dns.lookup,
    originalHttpRequest: http.request,
    originalHttpGet: http.get,
    originalHttpsRequest: https.request,
    originalHttpsGet: https.get,
    originalHttp2Connect: http2.connect,
    originalNetConnect: net.connect,
    originalNetCreateConnection: net.createConnection,
    originalSocketConnect: net.Socket.prototype.connect,
    originalTlsConnect: tls.connect,
  }

guardedGlobal[stateKey] = state

const harnessDnsContext = new AsyncLocalStorage<boolean>()

function normalizeHost(host: string | undefined): string {
  const normalized = (host || '127.0.0.1').toLowerCase()
  if (normalized.startsWith('[') && normalized.endsWith(']')) {
    return normalized.slice(1, -1)
  }
  return normalized === 'localhost' ? '127.0.0.1' : normalized
}

function isAllowed(host: string | undefined, port: number): boolean {
  const normalizedHost = normalizeHost(host)
  for (const registration of state.registrations) {
    if (
      registration.server.listening &&
      registration.port === port &&
      normalizeHost(registration.host) === normalizedHost
    ) {
      return true
    }
  }
  return false
}

function assertAllowed(
  host: string | undefined,
  rawPort: string | number | undefined,
  protocol: string,
): void {
  const port = Number(rawPort)
  if (!Number.isInteger(port) || port <= 0 || !isAllowed(host, port)) {
    throw new Error(
      `[test-network-guard] blocked unowned ${protocol} request to ${normalizeHost(host)}:${Number.isFinite(port) ? port : 'unknown'}`,
    )
  }
}

function urlTarget(
  input: string | URL | http.RequestOptions,
  defaultPort: number,
): { host?: string; port: string | number } {
  if (typeof input === 'string' || input instanceof URL) {
    const url = new URL(input)
    return {
      host: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : defaultPort),
    }
  }
  if (input.socketPath) {
    return { host: String(input.socketPath), port: Number.NaN }
  }
  return {
    host: input.hostname ?? input.host ?? undefined,
    port: input.port ?? defaultPort,
  }
}

function optionsTarget(
  input: http.RequestOptions,
  defaultPort: number,
  fallback: { host?: string; port: string | number } = { port: defaultPort },
): { host?: string; port: string | number } {
  if (input.socketPath) {
    return { host: String(input.socketPath), port: Number.NaN }
  }

  let host = fallback.host
  let port: string | number = input.port ?? fallback.port
  if (input.hostname) {
    host = input.hostname
  } else if (input.host) {
    const parsedHost = new URL(`http://${input.host}`)
    host = parsedHost.hostname
    if (input.port === undefined && parsedHost.port) port = parsedHost.port
  }
  return { host, port }
}

function requestTarget(
  args: Array<unknown>,
  defaultPort: number,
): { host?: string; port: string | number } {
  const first = args[0] as string | URL | http.RequestOptions
  const base = urlTarget(first, defaultPort)
  if (
    (typeof first === 'string' || first instanceof URL) &&
    args[1] &&
    typeof args[1] === 'object'
  ) {
    return optionsTarget(args[1] as http.RequestOptions, defaultPort, base)
  }
  return base
}

function socketTarget(args: Array<unknown>): {
  host?: string
  port: string | number | undefined
} {
  const first = args[0]
  if (Array.isArray(first)) return socketTarget(first)
  if (typeof first === 'number') {
    return {
      port: first,
      host: typeof args[1] === 'string' ? args[1] : undefined,
    }
  }
  if (first && typeof first === 'object') {
    const options = first as net.NetConnectOpts
    if (
      'path' in options &&
      typeof options.path === 'string' &&
      options.path.length > 0
    ) {
      return { host: options.path, port: Number.NaN }
    }
    return {
      host: 'host' in options ? options.host : undefined,
      port: 'port' in options ? options.port : undefined,
    }
  }
  return { host: String(first), port: Number.NaN }
}

function installNetworkGuard(): void {
  globalThis.fetch = (async (input, init) => {
    const url = new URL(
      input instanceof Request ? input.url : input instanceof URL ? input : input,
    )
    assertAllowed(
      url.hostname,
      url.port || (url.protocol === 'https:' ? 443 : 80),
      'fetch',
    )
    return state.originalFetch(input, init)
  }) as typeof globalThis.fetch

  if (state.originalWebSocket) {
    globalThis.WebSocket = new Proxy(state.originalWebSocket, {
      construct(target, args, newTarget) {
        const url = new URL(String(args[0]))
        assertAllowed(
          url.hostname,
          url.port || (url.protocol === 'wss:' ? 443 : 80),
          'WebSocket',
        )
        return Reflect.construct(target, args, newTarget)
      },
    })
  }

  Object.defineProperty(http, 'request', {
    configurable: true,
    writable: true,
    value: function guardedHttpRequest(...args: Array<unknown>) {
      const target = requestTarget(args, 80)
      assertAllowed(target.host, target.port, 'http')
      return Reflect.apply(state.originalHttpRequest, http, args)
    },
  })
  Object.defineProperty(http, 'get', {
    configurable: true,
    writable: true,
    value: function guardedHttpGet(...args: Array<unknown>) {
      const target = requestTarget(args, 80)
      assertAllowed(target.host, target.port, 'http')
      return Reflect.apply(state.originalHttpGet, http, args)
    },
  })
  Object.defineProperty(https, 'request', {
    configurable: true,
    writable: true,
    value: function guardedHttpsRequest(...args: Array<unknown>) {
      const target = requestTarget(args, 443)
      assertAllowed(target.host, target.port, 'https')
      return Reflect.apply(state.originalHttpsRequest, https, args)
    },
  })
  Object.defineProperty(https, 'get', {
    configurable: true,
    writable: true,
    value: function guardedHttpsGet(...args: Array<unknown>) {
      const target = requestTarget(args, 443)
      assertAllowed(target.host, target.port, 'https')
      return Reflect.apply(state.originalHttpsGet, https, args)
    },
  })

  const guardSocket =
    (protocol: string, original: unknown) =>
    (...args: Array<unknown>) => {
      const target = socketTarget(args)
      assertAllowed(target.host, target.port, protocol)
      return Reflect.apply(
        original as (...values: Array<unknown>) => unknown,
        net,
        args,
      )
    }

  Object.defineProperty(net, 'connect', {
    configurable: true,
    writable: true,
    value: guardSocket('net', state.originalNetConnect),
  })
  Object.defineProperty(net, 'createConnection', {
    configurable: true,
    writable: true,
    value: guardSocket('net', state.originalNetCreateConnection),
  })
  Object.defineProperty(net.Socket.prototype, 'connect', {
    configurable: true,
    writable: true,
    value: function guardedSocketConnect(
      this: net.Socket,
      ...args: Array<unknown>
    ) {
      const target = socketTarget(args)
      assertAllowed(target.host, target.port, 'net.Socket')
      return Reflect.apply(
        state.originalSocketConnect as (...values: Array<unknown>) => unknown,
        this,
        args,
      )
    },
  })
  Object.defineProperty(tls, 'connect', {
    configurable: true,
    writable: true,
    value: function guardedTlsConnect(...args: Array<unknown>) {
      const target = socketTarget(args)
      assertAllowed(target.host, target.port, 'tls')
      return Reflect.apply(
        state.originalTlsConnect as (...values: Array<unknown>) => unknown,
        tls,
        args,
      )
    },
  })
  Object.defineProperty(http2, 'connect', {
    configurable: true,
    writable: true,
    value: function guardedHttp2Connect(...args: Array<unknown>) {
      const url = new URL(String(args[0]))
      assertAllowed(
        url.hostname,
        url.port || (url.protocol === 'https:' ? 443 : 80),
        'http2',
      )
      return Reflect.apply(
        state.originalHttp2Connect as (...values: Array<unknown>) => unknown,
        http2,
        args,
      )
    },
  })
  const denyDatagram = (operation: string) =>
    function guardedDatagramOperation() {
      throw new Error(
        `[test-network-guard] blocked unowned dgram.${operation} request`,
      )
    }
  Object.defineProperty(dgram.Socket.prototype, 'connect', {
    configurable: true,
    writable: true,
    value: denyDatagram('connect'),
  })
  Object.defineProperty(dgram.Socket.prototype, 'send', {
    configurable: true,
    writable: true,
    value: denyDatagram('send'),
  })

  const dnsOperations = [
    'lookup',
    'lookupService',
    'resolve',
    'resolve4',
    'resolve6',
    'resolveAny',
    'resolveCaa',
    'resolveCname',
    'resolveMx',
    'resolveNaptr',
    'resolveNs',
    'resolvePtr',
    'resolveSoa',
    'resolveSrv',
    'resolveTxt',
    'reverse',
  ] as const
  const guardDnsSurface = (surface: object, label: string): void => {
    for (const operation of dnsOperations) {
      if (typeof Reflect.get(surface, operation) !== 'function') continue
      Object.defineProperty(surface, operation, {
        configurable: true,
        writable: true,
        value: function guardedDnsOperation(...args: Array<unknown>) {
          if (
            label === 'dns' &&
            operation === 'lookup' &&
            harnessDnsContext.getStore() === true &&
            args[0] === '127.0.0.1'
          ) {
            return Reflect.apply(
              state.originalDnsLookup as (...values: Array<unknown>) => unknown,
              dns,
              args,
            )
          }
          throw new Error(
            `[test-network-guard] blocked unowned ${label}.${operation} request`,
          )
        },
      })
    }
  }
  guardDnsSurface(dns, 'dns')
  guardDnsSurface(dns.Resolver.prototype, 'dns.Resolver')
  guardDnsSurface(dnsPromises, 'dns.promises')
  guardDnsSurface(dnsPromises.Resolver.prototype, 'dns.promises.Resolver')
  syncBuiltinESMExports()
}

async function closeRegistration(
  registration: HarnessRegistration,
): Promise<void> {
  state.registrations.delete(registration)
  registration.server.off('close', registration.closeListener)
  if (!registration.server.listening) return
  await new Promise<void>((resolve, reject) => {
    registration.server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

export async function listenOnHarnessLoopback(
  server: net.Server,
): Promise<{ origin: string; close: () => Promise<void> }> {
  if (server.listening) {
    throw new Error('Harness server must not already be listening')
  }

  const configuredPort = process.env.HERMES_WORKSPACE_TEST_HARNESS_PORT
  const requestedPort = configuredPort === undefined ? 0 : Number(configuredPort)
  if (
    !Number.isInteger(requestedPort) ||
    requestedPort < 0 ||
    requestedPort > 65_535
  ) {
    throw new Error('Invalid HERMES_WORKSPACE_TEST_HARNESS_PORT')
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    harnessDnsContext.run(true, () => {
      server.listen({ host: '127.0.0.1', port: requestedPort }, () => {
        server.off('error', reject)
        resolve()
      })
    })
  })
  const address = server.address() as AddressInfo | null
  if (!address || address.port <= 0 || address.address !== '127.0.0.1') {
    server.close()
    throw new Error('Harness listener did not acquire an owned loopback port')
  }

  const registration: HarnessRegistration = {
    server,
    host: address.address,
    port: address.port,
    closeListener: () => state.registrations.delete(registration),
  }
  state.registrations.add(registration)
  server.once('close', registration.closeListener)

  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => closeRegistration(registration),
  }
}

async function closeAllHarnessServers(): Promise<void> {
  await Promise.all([...state.registrations].map(closeRegistration))
  state.registrations.clear()
}

installNetworkGuard()

beforeEach(async () => {
  await closeAllHarnessServers()
  installNetworkGuard()
})

afterEach(async () => {
  await closeAllHarnessServers()
  installNetworkGuard()
})
