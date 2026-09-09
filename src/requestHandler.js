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
export function createRequestHandler(config, deps = {}) {
  const {
    sessions = new Map(),
    makeMiteClient = createMiteClient,
    makeMcpApp = createMcpApp,
    makeTransport = (options) => new StreamableHTTPServerTransport(options),
    isInitialize = isInitializeRequest,
  } = deps

  return async function handleRequest(req, res) {
    try {
      if (req.url === '/health' && req.method === 'GET') {
        return sendJson(res, 200, { ok: true })
      }

      if (req.url !== config.mcpPath) {
        return sendJson(res, 404, { error: 'Not found' })
      }

      const apiKey = extractBearerToken(req.headers.authorization)
      if (!apiKey) {
        res.setHeader('WWW-Authenticate', 'Bearer realm="mcp"')
        return sendJson(res, 401, {
          error: 'Unauthorized. Use a Mite API key as the bearer token.',
        })
      }

      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST')
        return sendJson(res, 405, { error: 'Method not allowed' })
      }

      const body = await readJsonBody(req)
      const sessionId = getSessionId(req.headers['mcp-session-id'])

      if (sessionId) {
        const existingSession = sessions.get(sessionId)

        if (!existingSession) {
          return sendJson(res, 404, { error: 'Unknown MCP session' })
        }

        // A session id is not a credential — it travels in a plain header and is handed
        // back to the client. Without this the first caller's Mite key would serve anyone
        // who learned the id.
        if (!tokensMatch(apiKey, existingSession.apiKey)) {
          res.setHeader('WWW-Authenticate', 'Bearer realm="mcp"')
          return sendJson(res, 401, { error: 'Unauthorized for this MCP session.' })
        }

        await existingSession.transport.handleRequest(req, res, body)
        return
      }

      if (!isInitialize(body)) {
        return sendJson(res, 400, {
          error: 'Missing MCP session. Start with an initialize request.',
        })
      }

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

      transport.onclose = () => {
        if (transport.sessionId) {
          sessions.delete(transport.sessionId)
        }
      }

      const mcpServer = makeMcpApp(session)
      await mcpServer.connect(transport)
      await transport.handleRequest(req, res, body)
    } catch (error) {
      console.error(error)

      if (!res.headersSent) {
        const statusCode = typeof error?.statusCode === 'number' ? error.statusCode : 500

        if (statusCode === 401) {
          res.setHeader('WWW-Authenticate', 'Bearer realm="mcp"')
        }

        sendJson(res, statusCode, {
          error: error instanceof Error ? error.message : 'Internal server error',
        })
      } else {
        res.end()
      }
    }
  }
}
