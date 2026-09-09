import { randomUUID } from 'node:crypto'

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'

import { extractBearerToken, tokensMatch } from './auth.js'
import { getSessionId, readJsonBody, sendJson } from './http.js'
import { createMiteClient } from './miteClient.js'
import { createMcpApp } from './mcpServer.js'

// Split out of server.js so the routing, the auth checks and the session lookup can be
// exercised without binding a port or reaching the Mite API. server.js used to build this
// closure inline, next to a top-level `loadConfig()` and `listen()`, which meant importing
// it started a real server — a test could not touch any of the branches below.
//
// Every collaborator is injectable and defaults to the real one, so production wiring is
// unchanged: server.js passes nothing but the config.
//
// The work is split across small named functions rather than one handler. As a single
// function it measured a cognitive complexity of 24 against SonarCloud's limit of 15
// (javascript:S3776) — the nesting was the routing, the two session paths and the error
// funnel all sharing one scope.
export function createRequestHandler(config, deps = {}) {
  const {
    sessions = new Map(),
    makeMiteClient = createMiteClient,
    makeMcpApp = createMcpApp,
    makeTransport = (options) => new StreamableHTTPServerTransport(options),
    isInitialize = isInitializeRequest,
  } = deps

  // Every 401 carries the challenge, so a client knows to retry with a bearer token
  // instead of treating it as a hard failure.
  function unauthorized(res, error) {
    res.setHeader('WWW-Authenticate', 'Bearer realm="mcp"')
    return sendJson(res, 401, { error })
  }

  async function reuseSession(req, res, body, sessionId, apiKey) {
    const existingSession = sessions.get(sessionId)

    if (!existingSession) {
      return sendJson(res, 404, { error: 'Unknown MCP session' })
    }

    // A session id is not a credential — it travels in a plain header and is handed back
    // to the client. Without this the first caller's Mite key would serve anyone who
    // learned the id.
    if (!tokensMatch(apiKey, existingSession.apiKey)) {
      return unauthorized(res, 'Unauthorized for this MCP session.')
    }

    return existingSession.transport.handleRequest(req, res, body)
  }

  async function openSession(req, res, body, apiKey) {
    // Calling Mite first is what authenticates the key: a session is only created once
    // the key has proved it can read its own user.
    const miteClient = makeMiteClient(config, apiKey)
    const user = await miteClient.getCurrentUser()
    const session = {
      apiKey,
      user,
      miteBaseUrl: config.miteBaseUrl,
      miteClient,
      transport: null,
    }

    const transport = makeTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (newSessionId) => {
        sessions.set(newSessionId, { ...session, transport })
      },
    })

    // Without this the map grows for the life of the process, holding one Mite key per
    // disconnected client.
    transport.onclose = () => {
      if (transport.sessionId) {
        sessions.delete(transport.sessionId)
      }
    }

    const mcpServer = makeMcpApp(session)
    await mcpServer.connect(transport)
    return transport.handleRequest(req, res, body)
  }

  async function route(req, res) {
    if (req.url === '/health' && req.method === 'GET') {
      return sendJson(res, 200, { ok: true })
    }

    if (req.url !== config.mcpPath) {
      return sendJson(res, 404, { error: 'Not found' })
    }

    // The token check precedes the method check on purpose: an unauthenticated caller
    // should not be able to probe which methods the endpoint accepts.
    const apiKey = extractBearerToken(req.headers.authorization)
    if (!apiKey) {
      return unauthorized(res, 'Unauthorized. Use a Mite API key as the bearer token.')
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST')
      return sendJson(res, 405, { error: 'Method not allowed' })
    }

    const body = await readJsonBody(req)
    const sessionId = getSessionId(req.headers['mcp-session-id'])

    if (sessionId) {
      return reuseSession(req, res, body, sessionId, apiKey)
    }

    if (!isInitialize(body)) {
      return sendJson(res, 400, {
        error: 'Missing MCP session. Start with an initialize request.',
      })
    }

    return openSession(req, res, body, apiKey)
  }

  function reportError(res, error) {
    console.error(error)

    // Once the transport has started streaming, a second writeHead throws and masks the
    // original failure. Closing the response is all that is left.
    if (res.headersSent) {
      return res.end()
    }

    // An error with no statusCode is a bug in this server, not a client mistake.
    const statusCode = typeof error?.statusCode === 'number' ? error.statusCode : 500
    const message = error instanceof Error ? error.message : 'Internal server error'

    if (statusCode === 401) {
      return unauthorized(res, message)
    }

    return sendJson(res, statusCode, { error: message })
  }

  return async function handleRequest(req, res) {
    try {
      await route(req, res)
    } catch (error) {
      reportError(res, error)
    }
  }
}
