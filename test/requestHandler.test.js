import { jest } from '@jest/globals'

import { createRequestHandler } from '../src/requestHandler.js'
import { fakeReq, fakeRes, jsonReq } from './helpers.js'

const config = {
  mcpPath: '/mcp',
  miteBaseUrl: 'https://team.mite.de',
  miteUserAgent: 'mite-assistant-mcp/test',
}

const user = { id: 1, name: 'Ada', email: 'ada@example.com', role: 'admin' }
const initializeBody = { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }

function setup(deps = {}) {
  const sessions = deps.sessions ?? new Map()
  const transport = deps.transport ?? {
    sessionId: 'generated-session',
    handleRequest: jest.fn(async () => {}),
  }
  const handler = createRequestHandler(config, {
    sessions,
    makeMiteClient: jest.fn(() => ({ getCurrentUser: jest.fn(async () => user) })),
    makeMcpApp: jest.fn(() => ({ connect: jest.fn(async () => {}) })),
    makeTransport: jest.fn((options) => Object.assign(transport, options)),
    isInitialize: (body) => body?.method === 'initialize',
    ...deps,
  })
  return { handler, sessions, transport }
}

let consoleError

beforeEach(() => {
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  consoleError.mockRestore()
})

describe('routing', () => {
  test('answers the health probe without requiring a token', async () => {
    const { handler } = setup()
    const res = fakeRes()

    await handler(fakeReq({ url: '/health', method: 'GET' }), res)

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
  })

  // /health is GET-only; a POST to it must fall through to the MCP path comparison and
  // 404, not be treated as a probe.
  test('does not treat a POST to /health as a probe', async () => {
    const { handler } = setup()
    const res = fakeRes()

    await handler(fakeReq({ url: '/health', method: 'POST' }), res)

    expect(res.statusCode).toBe(404)
  })

  test('404s any path that is not the configured MCP path', async () => {
    const { handler } = setup()
    const res = fakeRes()

    await handler(fakeReq({ url: '/nope' }), res)

    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'Not found' })
  })

  test('honours a non-default MCP path from the config', async () => {
    const handler = createRequestHandler({ ...config, mcpPath: '/rpc' }, {})
    const res = fakeRes()

    await handler(fakeReq({ url: '/mcp' }), res)

    expect(res.statusCode).toBe(404)
  })
})

describe('authentication', () => {
  test('401s with a challenge when the bearer token is missing', async () => {
    const { handler } = setup()
    const res = fakeRes()

    await handler(fakeReq({ headers: {} }), res)

    expect(res.statusCode).toBe(401)
    expect(res.headers['WWW-Authenticate']).toBe('Bearer realm="mcp"')
    expect(res.json().error).toMatch(/Unauthorized/)
  })

  // The token check comes before the method check on purpose: an unauthenticated caller
  // should not be able to probe which methods the endpoint accepts.
  test('405s an authenticated non-POST and advertises Allow', async () => {
    const { handler } = setup()
    const res = fakeRes()

    await handler(fakeReq({ method: 'GET', headers: { authorization: 'Bearer k' } }), res)

    expect(res.statusCode).toBe(405)
    expect(res.headers.Allow).toBe('POST')
  })
})

describe('existing sessions', () => {
  test('404s a session id that is not known', async () => {
    const { handler } = setup()
    const res = fakeRes()

    await handler(
      jsonReq({}, { headers: { authorization: 'Bearer k', 'mcp-session-id': 'ghost' } }),
      res
    )

    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'Unknown MCP session' })
  })

  // The session id travels in a plain header and is handed back to the client, so it is
  // not a credential. Without this check, anyone who learned an id would inherit the
  // owner's Mite key.
  test('401s when the token does not match the session that owns it', async () => {
    const sessions = new Map([
      ['sess-1', { apiKey: 'owner-key', transport: { handleRequest: jest.fn() } }],
    ])
    const { handler } = setup({ sessions })
    const res = fakeRes()

    await handler(
      jsonReq(
        {},
        { headers: { authorization: 'Bearer attacker-key', 'mcp-session-id': 'sess-1' } }
      ),
      res
    )

    expect(res.statusCode).toBe(401)
    expect(res.headers['WWW-Authenticate']).toBe('Bearer realm="mcp"')
    expect(sessions.get('sess-1').transport.handleRequest).not.toHaveBeenCalled()
  })

  test('hands a matching request to the session transport with the parsed body', async () => {
    const handleRequest = jest.fn(async () => {})
    const sessions = new Map([['sess-1', { apiKey: 'k', transport: { handleRequest } }]])
    const { handler } = setup({ sessions })
    const res = fakeRes()

    await handler(
      jsonReq(
        { method: 'tools/list' },
        { headers: { authorization: 'Bearer k', 'mcp-session-id': 'sess-1' } }
      ),
      res
    )

    expect(handleRequest).toHaveBeenCalledTimes(1)
    expect(handleRequest.mock.calls[0][2]).toEqual({ method: 'tools/list' })
  })

  // A repeated Mcp-Session-Id header arrives as an array and would never match a Map key.
  test('resolves a repeated session-id header to its first value', async () => {
    const handleRequest = jest.fn(async () => {})
    const sessions = new Map([['sess-1', { apiKey: 'k', transport: { handleRequest } }]])
    const { handler } = setup({ sessions })

    await handler(
      jsonReq(
        {},
        { headers: { authorization: 'Bearer k', 'mcp-session-id': ['sess-1', 'sess-2'] } }
      ),
      fakeRes()
    )

    expect(handleRequest).toHaveBeenCalledTimes(1)
  })
})

describe('session creation', () => {
  test('400s a first request that is not an initialize', async () => {
    const { handler } = setup()
    const res = fakeRes()

    await handler(
      jsonReq({ method: 'tools/list' }, { headers: { authorization: 'Bearer k' } }),
      res
    )

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/Start with an initialize request/)
  })

  test('verifies the key against Mite before opening a session', async () => {
    const getCurrentUser = jest.fn(async () => user)
    const makeMiteClient = jest.fn(() => ({ getCurrentUser }))
    const { handler } = setup({ makeMiteClient })

    await handler(
      jsonReq(initializeBody, { headers: { authorization: 'Bearer k' } }),
      fakeRes()
    )

    expect(makeMiteClient).toHaveBeenCalledWith(config, 'k')
    expect(getCurrentUser).toHaveBeenCalledTimes(1)
  })

  test('stores the session under the id the transport reports', async () => {
    const { handler, sessions, transport } = setup()

    await handler(
      jsonReq(initializeBody, { headers: { authorization: 'Bearer k' } }),
      fakeRes()
    )
    transport.onsessioninitialized('new-session')

    expect(sessions.get('new-session')).toMatchObject({
      apiKey: 'k',
      user,
      miteBaseUrl: config.miteBaseUrl,
    })
    expect(sessions.get('new-session').transport).toBe(transport)
  })

  test('generates a distinct session id per call', async () => {
    const { handler, transport } = setup()

    await handler(
      jsonReq(initializeBody, { headers: { authorization: 'Bearer k' } }),
      fakeRes()
    )

    expect(transport.sessionIdGenerator()).not.toBe(transport.sessionIdGenerator())
  })

  // Without this the map grows for the life of the process, holding a Mite key per
  // disconnected client.
  test('drops the session from the map when the transport closes', async () => {
    const { handler, sessions, transport } = setup()

    await handler(
      jsonReq(initializeBody, { headers: { authorization: 'Bearer k' } }),
      fakeRes()
    )
    transport.onsessioninitialized('new-session')
    transport.sessionId = 'new-session'
    transport.onclose()

    expect(sessions.has('new-session')).toBe(false)
  })

  test('ignores a close on a transport that never got an id', async () => {
    const transport = { sessionId: undefined, handleRequest: jest.fn(async () => {}) }
    const { handler, sessions } = setup({ transport })

    await handler(
      jsonReq(initializeBody, { headers: { authorization: 'Bearer k' } }),
      fakeRes()
    )
    sessions.set('unrelated', { apiKey: 'k' })
    transport.onclose()

    expect(sessions.has('unrelated')).toBe(true)
  })

  test('connects the MCP app to the transport and forwards the initialize body', async () => {
    const connect = jest.fn(async () => {})
    const { handler, transport } = setup({ makeMcpApp: jest.fn(() => ({ connect })) })

    await handler(
      jsonReq(initializeBody, { headers: { authorization: 'Bearer k' } }),
      fakeRes()
    )

    expect(connect).toHaveBeenCalledWith(transport)
    expect(transport.handleRequest.mock.calls[0][2]).toEqual(initializeBody)
  })
})

describe('error handling', () => {
  test('reports a rejected Mite key as 401 with a challenge', async () => {
    const error = Object.assign(new Error('Unauthorized Mite API key.'), {
      statusCode: 401,
    })
    const { handler } = setup({
      makeMiteClient: jest.fn(() => ({
        getCurrentUser: jest.fn(async () => {
          throw error
        }),
      })),
    })
    const res = fakeRes()

    await handler(
      jsonReq(initializeBody, { headers: { authorization: 'Bearer bad' } }),
      res
    )

    expect(res.statusCode).toBe(401)
    expect(res.headers['WWW-Authenticate']).toBe('Bearer realm="mcp"')
    expect(res.json()).toEqual({ error: 'Unauthorized Mite API key.' })
  })

  test('passes an upstream 502 through unchanged', async () => {
    const error = Object.assign(new Error('Mite API request failed with status 500.'), {
      statusCode: 502,
    })
    const { handler } = setup({
      makeMiteClient: jest.fn(() => ({
        getCurrentUser: jest.fn(async () => {
          throw error
        }),
      })),
    })
    const res = fakeRes()

    await handler(
      jsonReq(initializeBody, { headers: { authorization: 'Bearer k' } }),
      res
    )

    expect(res.statusCode).toBe(502)
    expect(res.headers['WWW-Authenticate']).toBeUndefined()
  })

  // An error with no statusCode is a bug in this server, not a client mistake.
  test('falls back to 500 for an error carrying no status code', async () => {
    const { handler } = setup({
      makeMcpApp: jest.fn(() => {
        throw new Error('boom')
      }),
    })
    const res = fakeRes()

    await handler(
      jsonReq(initializeBody, { headers: { authorization: 'Bearer k' } }),
      res
    )

    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ error: 'boom' })
  })

  test('does not leak a non-Error throw into the response body', async () => {
    const { handler } = setup({
      makeMcpApp: jest.fn(() => {
        throw 'a bare string'
      }),
    })
    const res = fakeRes()

    await handler(
      jsonReq(initializeBody, { headers: { authorization: 'Bearer k' } }),
      res
    )

    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ error: 'Internal server error' })
  })

  test('surfaces a malformed JSON body as a 500 with the parser message', async () => {
    const { handler } = setup()
    const res = fakeRes()

    await handler(
      fakeReq({ headers: { authorization: 'Bearer k' }, chunks: [Buffer.from('{oops')] }),
      res
    )

    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ error: 'Request body must be valid JSON.' })
  })

  // Once the transport has started streaming, a second writeHead throws and would mask
  // the original failure. The handler has to close the response instead.
  test('ends the response without rewriting headers once they are sent', async () => {
    const transport = {
      sessionId: 's',
      handleRequest: jest.fn(async (_req, res) => {
        res.writeHead(200, {})
        throw new Error('mid-stream failure')
      }),
    }
    const sessions = new Map([['sess-1', { apiKey: 'k', transport }]])
    const { handler } = setup({ sessions })
    const res = fakeRes()

    await handler(
      jsonReq({}, { headers: { authorization: 'Bearer k', 'mcp-session-id': 'sess-1' } }),
      res
    )

    expect(res.statusCode).toBe(200)
    expect(res.body).toBeNull()
  })

  test('logs every failure it swallows', async () => {
    const { handler } = setup({
      makeMcpApp: jest.fn(() => {
        throw new Error('boom')
      }),
    })

    await handler(
      jsonReq(initializeBody, { headers: { authorization: 'Bearer k' } }),
      fakeRes()
    )

    expect(consoleError).toHaveBeenCalledTimes(1)
  })
})
