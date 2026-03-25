// SPDX-License-Identifier: Apache-2.0

/**
 * Proxy support for Discord bot connections (REST API + WebSocket Gateway).
 *
 * Discord.js uses two separate networking stacks:
 *   1. REST API  → @discordjs/rest (undici-based) → accepts `rest.agent` (undici Dispatcher)
 *   2. Gateway WS → @discordjs/ws → ws package    → needs `createConnection` override
 *
 * For REST, we create an undici Dispatcher and pass it via `rest: { agent }`.
 *
 * For WebSocket, we patch `ws.WebSocket` to inject a custom `createConnection`
 * function.  Why `createConnection` instead of `agent`?
 *
 *   ws 8.x `initAsClient` does:
 *     `opts.createConnection = opts.createConnection || (isSecure ? tlsConnect : netConnect)`
 *
 *   This overwrites any agent-based connection logic.  By providing our own
 *   `createConnection`, we bypass the default `tlsConnect` and tunnel through
 *   the proxy instead.
 *
 * IMPORTANT: `patchWsForProxy()` MUST be called BEFORE discord.js is first
 * imported — the module captures `ws.WebSocket` at load time.
 */

import * as tls from 'tls'
import * as http from 'http'
import * as net from 'net'
import { SocksClient } from 'socks'
import { ProxyAgent as UndiciProxyAgent, Agent as UndiciAgent, Pool } from 'undici'
import type { Dispatcher } from 'undici'
import type buildConnector from 'undici/types/connector'
import type { ClientOptions as WsClientOptions } from 'ws'
import { createLogger } from '../../platform/logger'

const log = createLogger('DiscordProxy')

// ── REST Proxy (undici Dispatcher for @discordjs/rest) ───────────────────────

/**
 * Create an undici Dispatcher for the given proxy URL.
 * Supports http://, https://, socks5://, socks4://.
 */
export function createRestProxyDispatcher(proxyUrl: string): Dispatcher {
  const url = new URL(proxyUrl)
  switch (url.protocol) {
    case 'http:':
    case 'https:':
      return new UndiciProxyAgent(proxyUrl)
    case 'socks5:':
    case 'socks:':
      return buildSocksUndiciDispatcher(url.hostname, parseInt(url.port || '1080'), 5)
    case 'socks4:':
      return buildSocksUndiciDispatcher(url.hostname, parseInt(url.port || '1080'), 4)
    default:
      throw new Error(`Unsupported proxy protocol "${url.protocol}" for Discord REST`)
  }
}

function buildSocksUndiciDispatcher(host: string, port: number, type: 4 | 5): Dispatcher {
  return new UndiciAgent({
    factory: (origin: URL, opts: Record<string, unknown>): Dispatcher =>
      new Pool(origin, {
        ...opts,
        connect: (connectOpts: buildConnector.Options, callback: buildConnector.Callback) => {
          SocksClient.createConnection({
            proxy: { host, port, type },
            command: 'connect',
            destination: {
              host: connectOpts.hostname ?? connectOpts.host ?? '',
              port: Number(connectOpts.port),
            },
          })
            .then(({ socket }) => {
              if (connectOpts.protocol === 'https:') {
                const tlsSocket = tls.connect({
                  socket,
                  servername: connectOpts.servername ?? connectOpts.hostname,
                  ALPNProtocols: ['http/1.1'],
                  rejectUnauthorized: true,
                })
                tlsSocket.once('secureConnect', () => callback(null, tlsSocket))
                tlsSocket.once('error', (err) => callback(err, null))
              } else {
                callback(null, socket)
              }
            })
            .catch((err) => callback(err instanceof Error ? err : new Error(String(err)), null))
        },
      }),
  })
}

// ── WebSocket Proxy (createConnection for ws package) ────────────────────────
//
// ws 8.x `initAsClient` forcibly sets:
//   opts.createConnection = opts.createConnection || (isSecure ? tlsConnect : netConnect)
//
// The `||` means: if we provide `createConnection` in the options, ws won't
// overwrite it.  Node.js http.Agent._createSocket also respects
// options.createConnection, calling it with (options, oncreate).
//
// So we inject a `createConnection` that:
//   1. Opens a TCP tunnel through the proxy (HTTP CONNECT or SOCKS)
//   2. Wraps the tunnel with TLS (for wss://)
//   3. Calls the oncreate callback with the TLS socket

/** Callback-style createConnection compatible with Node.js http module. */
type CreateConnectionFn = (options: Record<string, any>, oncreate: (err: Error | null, socket?: net.Socket) => void) => void

/**
 * Build a `createConnection` function that tunnels through an HTTP proxy
 * using the CONNECT method.
 */
function buildHttpConnectCreator(proxy: URL): CreateConnectionFn {
  return (options, oncreate) => {
    const targetHost = options.host ?? options.hostname ?? 'localhost'
    const targetPort = options.port ?? 443

    const authHeader = proxy.username
      ? { 'Proxy-Authorization': 'Basic ' + Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password || '')}`).toString('base64') }
      : undefined

    const connectReq = http.request({
      host: proxy.hostname,
      port: parseInt(proxy.port || '8080'),
      method: 'CONNECT',
      path: `${targetHost}:${targetPort}`,
      headers: authHeader,
    })

    connectReq.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy()
        oncreate(new Error(`Proxy CONNECT failed with status ${res.statusCode}`))
        return
      }
      // Wrap the raw TCP tunnel with TLS for wss://
      const tlsSocket = tls.connect({ socket, servername: targetHost })
      tlsSocket.once('secureConnect', () => oncreate(null, tlsSocket as unknown as net.Socket))
      tlsSocket.once('error', (err) => oncreate(err))
    })

    connectReq.on('error', (err) => oncreate(err))
    connectReq.end()
  }
}

/**
 * Build a `createConnection` function that tunnels through a SOCKS4/5 proxy.
 */
function buildSocksConnectCreator(proxy: URL, type: 4 | 5): CreateConnectionFn {
  return (options, oncreate) => {
    const targetHost = options.host ?? options.hostname ?? 'localhost'
    const targetPort = parseInt(String(options.port ?? 443))

    SocksClient.createConnection({
      proxy: {
        host: proxy.hostname,
        port: parseInt(proxy.port || '1080'),
        type,
      },
      command: 'connect',
      destination: { host: targetHost, port: targetPort },
    })
      .then(({ socket }) => {
        // Wrap the SOCKS tunnel with TLS for wss://
        const tlsSocket = tls.connect({ socket, servername: targetHost })
        tlsSocket.once('secureConnect', () => oncreate(null, tlsSocket as unknown as net.Socket))
        tlsSocket.once('error', (err) => oncreate(err))
      })
      .catch((err) => oncreate(err))
  }
}

/**
 * Create a `createConnection` function for the given proxy URL.
 * The returned function is compatible with both ws and Node.js http module.
 */
export function createWsProxyConnection(proxyUrl: string): CreateConnectionFn {
  const proxy = new URL(proxyUrl)
  switch (proxy.protocol) {
    case 'http:':
    case 'https:':
      return buildHttpConnectCreator(proxy)
    case 'socks5:':
    case 'socks:':
      return buildSocksConnectCreator(proxy, 5)
    case 'socks4:':
      return buildSocksConnectCreator(proxy, 4)
    default:
      throw new Error(`Unsupported proxy protocol "${proxy.protocol}" for Discord WebSocket`)
  }
}

// ── ws.WebSocket Monkey-Patch ────────────────────────────────────────────────

/**
 * Mutable createConnection function — read by the patched WebSocket constructor
 * on each new connection.  Allows changing proxy at runtime without re-patching.
 */
let _wsProxyCreateConnection: CreateConnectionFn | undefined

/**
 * Set (or clear) the proxy createConnection for ALL future ws.WebSocket connections.
 * Pass `undefined` to disable proxying.
 */
export function setWsProxyCreateConnection(fn: CreateConnectionFn | undefined): void {
  _wsProxyCreateConnection = fn
}

let _patched = false

/**
 * Monkey-patch `require('ws').WebSocket` to inject proxy `createConnection`.
 *
 * MUST be called BEFORE `import('discord.js')` — @discordjs/ws captures
 * `ws.WebSocket` at module evaluation time.  Safe to call multiple times.
 *
 * How it works:
 *   1. `ws` is loaded early (hoisted require in the Electron main bundle).
 *   2. We replace `ws.WebSocket` with a thin subclass that prepends
 *      `createConnection` into the options.
 *   3. When discord.js is later dynamically imported, @discordjs/ws does
 *      `require('ws')`, gets the cached module, and captures our patched class.
 *   4. ws `initAsClient` sees `opts.createConnection` already set and skips
 *      its default `tlsConnect`, so the tunnel goes through the proxy.
 */
export function patchWsForProxy(): void {
  if (_patched) return
  _patched = true

  try {
     
    const wsModule = require('ws')
    const OriginalWebSocket = wsModule.WebSocket

    if (!OriginalWebSocket) {
      log.warn('ws.WebSocket not found — skipping proxy patch')
      return
    }

    // Thin subclass: injects `createConnection` when a proxy is active.
    class ProxiedWebSocket extends OriginalWebSocket {
      constructor(address: string | URL, protocols: string | string[] | undefined, options: WsClientOptions | undefined) {
        if (_wsProxyCreateConnection) {
          super(address, protocols, { ...options, createConnection: _wsProxyCreateConnection })
        } else {
          super(address, protocols, options)
        }
      }
    }

    // Preserve prototype chain and static properties (OPEN, CLOSED, etc.)
    Object.defineProperty(ProxiedWebSocket, 'name', { value: 'WebSocket' })

    wsModule.WebSocket = ProxiedWebSocket
    log.info('ws.WebSocket patched for proxy support')
  } catch (err) {
    log.warn('Failed to patch ws.WebSocket for proxy', err instanceof Error ? err.message : String(err))
  }
}
