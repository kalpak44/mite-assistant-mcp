import { loadConfig } from '../src/config.js'

describe('loadConfig', () => {
  const original = process.env

  beforeEach(() => {
    process.env = { ...original }
  })

  afterAll(() => {
    process.env = original
  })

  test('applies defaults when only the required variable is set', () => {
    process.env = { MITE_BASE_URL: 'https://example.mite.de' }

    expect(loadConfig()).toEqual({
      port: 3000,
      host: '0.0.0.0',
      mcpPath: '/mcp',
      miteBaseUrl: 'https://example.mite.de',
      miteUserAgent: expect.stringContaining('mite-assistant-mcp'),
    })
  })

  test('reads every override from the environment', () => {
    process.env = {
      MITE_BASE_URL: 'https://team.mite.de',
      PORT: '8080',
      HOST: '127.0.0.1',
      MCP_PATH: '/rpc',
      MITE_USER_AGENT: 'custom-agent/1.0',
    }

    expect(loadConfig()).toEqual({
      port: 8080,
      host: '127.0.0.1',
      mcpPath: '/rpc',
      miteBaseUrl: 'https://team.mite.de',
      miteUserAgent: 'custom-agent/1.0',
    })
  })

  // PORT arrives as a string from the environment; passing it to listen() unparsed makes
  // Node bind a path-shaped socket instead of a TCP port.
  test('parses PORT to a number', () => {
    process.env = { MITE_BASE_URL: 'https://example.mite.de', PORT: '9000' }

    expect(loadConfig().port).toBe(9000)
  })

  test('throws when MITE_BASE_URL is missing', () => {
    process.env = {}

    expect(() => loadConfig()).toThrow(/Missing MITE_BASE_URL/)
  })
})
