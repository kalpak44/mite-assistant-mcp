import { jest } from '@jest/globals'

// A stand-in for http.ServerResponse recording what the handler wrote. `headersSent`
// flips on writeHead so the error path's `!res.headersSent` branch is reachable.
export function fakeRes() {
  return {
    statusCode: null,
    headers: {},
    sentHeaders: {},
    body: null,
    headersSent: false,
    setHeader(name, value) {
      this.headers[name] = value
    },
    writeHead(statusCode, headers) {
      this.statusCode = statusCode
      this.sentHeaders = headers
      this.headersSent = true
    },
    end(body) {
      if (body !== undefined) this.body = body
    },
    json() {
      return JSON.parse(this.body)
    },
  }
}

// readJsonBody consumes the request with `for await`, so a request has to be async
// iterable rather than an object with a body property.
export function fakeReq({
  url = '/mcp',
  method = 'POST',
  headers = {},
  chunks = [],
} = {}) {
  return {
    url,
    method,
    headers,
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  }
}

export function jsonReq(payload, overrides = {}) {
  return fakeReq({ chunks: [Buffer.from(JSON.stringify(payload))], ...overrides })
}

// Captures what register*Tool() hands to the SDK, so a tool's handler can be invoked
// directly. Using the real McpServer here would test the SDK, not the tool.
export function fakeServer() {
  const tools = new Map()
  return {
    tools,
    registerTool: jest.fn((name, meta, handler) => {
      tools.set(name, { meta, handler })
    }),
    handler(name) {
      const tool = tools.get(name)
      if (!tool) throw new Error(`tool ${name} was never registered`)
      return tool.handler
    },
  }
}

export function fetchReturning({ status = 200, json = {}, headers = {} } = {}) {
  return jest.fn(async () => ({
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => headers[name] ?? null },
    json: async () => json,
  }))
}
