import { jest } from '@jest/globals'

import { createMiteClient } from '../src/miteClient.js'

const config = {
  miteBaseUrl: 'https://team.mite.de',
  miteUserAgent: 'mite-assistant-mcp/test',
}

function mockFetch({ status = 200, json = {}, headers = {} } = {}) {
  const fn = jest.fn(async () => ({
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => headers[name] ?? null },
    json: async () => json,
  }))
  global.fetch = fn
  return fn
}

afterEach(() => {
  delete global.fetch
})

describe('request construction', () => {
  test('sends the API key and user agent on every read', async () => {
    const fetchMock = mockFetch({ json: { user: { id: 1 } } })

    await createMiteClient(config, 'key-123').getCurrentUser()

    const [, init] = fetchMock.mock.calls[0]
    expect(init.method).toBe('GET')
    expect(init.headers['X-MiteApiKey']).toBe('key-123')
    expect(init.headers['User-Agent']).toBe('mite-assistant-mcp/test')
    expect(init.headers.Accept).toBe('application/json')
  })

  // The path is resolved against the base URL, and `new URL('/x', 'https://h/y')` would
  // drop a path segment from a base without a trailing slash.
  test('appends a trailing slash to the base URL before resolving the path', async () => {
    const fetchMock = mockFetch({ json: { user: {} } })

    await createMiteClient(
      { ...config, miteBaseUrl: 'https://team.mite.de' },
      'k'
    ).getCurrentUser()

    expect(fetchMock.mock.calls[0][0]).toBe('https://team.mite.de/myself.json')
  })

  test('does not double the slash when the base URL already ends in one', async () => {
    const fetchMock = mockFetch({ json: { user: {} } })

    await createMiteClient(
      { ...config, miteBaseUrl: 'https://team.mite.de/' },
      'k'
    ).getCurrentUser()

    expect(fetchMock.mock.calls[0][0]).toBe('https://team.mite.de/myself.json')
  })

  // A filter the caller left undefined must not become `?project_id=undefined`, which
  // Mite reads as a literal value and matches nothing.
  test('omits undefined and null query parameters', async () => {
    const fetchMock = mockFetch({ json: [] })

    await createMiteClient(config, 'k').getTimeEntries({
      project_id: 7,
      customer_id: undefined,
      user_id: null,
    })

    const url = new URL(fetchMock.mock.calls[0][0])
    expect(url.searchParams.get('project_id')).toBe('7')
    expect(url.searchParams.has('customer_id')).toBe(false)
    expect(url.searchParams.has('user_id')).toBe(false)
    expect(url.searchParams.get('limit')).toBe('100')
  })

  test('lets an explicit limit override the default', async () => {
    const fetchMock = mockFetch({ json: [] })

    await createMiteClient(config, 'k').getTimeEntries({ limit: 5 })

    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('limit')).toBe('5')
  })
})

describe('error mapping', () => {
  test.each([401, 403])(
    'maps HTTP %i to a 401 with an unauthorized message',
    async (status) => {
      mockFetch({ status })

      await expect(createMiteClient(config, 'k').getCurrentUser()).rejects.toMatchObject({
        statusCode: 401,
        message: 'Unauthorized Mite API key.',
      })
    }
  )

  // A Mite outage is an upstream failure, not our fault: 502 keeps it distinguishable
  // from a bad key, which the MCP client should handle differently.
  test('maps any other failure status to 502', async () => {
    mockFetch({ status: 500 })

    await expect(createMiteClient(config, 'k').getCurrentUser()).rejects.toMatchObject({
      statusCode: 502,
      message: 'Mite API request failed with status 500.',
    })
  })

  test('maps a transport failure to 502 and keeps the cause in the message', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('ECONNREFUSED')
    })

    await expect(createMiteClient(config, 'k').getCurrentUser()).rejects.toMatchObject({
      statusCode: 502,
      message: 'Failed to reach Mite API: ECONNREFUSED',
    })
  })

  test('stringifies a non-Error rejection rather than reporting undefined', async () => {
    global.fetch = jest.fn(async () => {
      throw 'socket died'
    })

    await expect(createMiteClient(config, 'k').getCurrentUser()).rejects.toMatchObject({
      message: 'Failed to reach Mite API: socket died',
    })
  })

  test('rejects a myself.json response with no user', async () => {
    mockFetch({ json: {} })

    await expect(createMiteClient(config, 'k').getCurrentUser()).rejects.toMatchObject({
      statusCode: 502,
      message: 'Mite API response did not include a user.',
    })
  })
})

describe('collection unwrapping', () => {
  // Mite wraps every collection element in a single-key object. A caller that got the
  // wrappers back would read every field as undefined.
  test.each([
    ['getTimeEntries', 'time_entry'],
    ['getCustomers', 'customer'],
    ['getProjects', 'project'],
    ['getServices', 'service'],
    ['getUsers', 'user'],
  ])('%s unwraps the %s envelope', async (method, key) => {
    mockFetch({
      json: [{ [key]: { id: 1, name: 'first' } }, { [key]: { id: 2, name: 'second' } }],
    })

    await expect(createMiteClient(config, 'k')[method]()).resolves.toEqual([
      { id: 1, name: 'first' },
      { id: 2, name: 'second' },
    ])
  })

  test.each(['getTimeEntries', 'getCustomers', 'getProjects', 'getServices', 'getUsers'])(
    '%s returns an empty array when the payload is not a list',
    async (method) => {
      mockFetch({ json: { error: 'nope' } })

      await expect(createMiteClient(config, 'k')[method]()).resolves.toEqual([])
    }
  )
})

describe('mutations', () => {
  test('POSTs a create under the time_entry envelope with a JSON content type', async () => {
    const fetchMock = mockFetch({ status: 201, json: { time_entry: { id: 9 } } })

    const result = await createMiteClient(config, 'k').createTimeEntry({ minutes: 30 })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://team.mite.de/time_entries.json')
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual({ time_entry: { minutes: 30 } })
    expect(result).toEqual({ time_entry: { id: 9 } })
  })

  test('PATCHes an update at the entry-specific path', async () => {
    const fetchMock = mockFetch({ json: {} })

    await createMiteClient(config, 'k').updateTimeEntry(42, { minutes: 60 })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://team.mite.de/time_entries/42.json')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body)).toEqual({ time_entry: { minutes: 60 } })
  })

  // DELETE carries no body. Sending `undefined` through JSON.stringify would put the
  // string "undefined" on the wire.
  test('sends a delete with no body at all', async () => {
    const fetchMock = mockFetch({ status: 204 })

    await expect(createMiteClient(config, 'k').deleteTimeEntry(42)).resolves.toBeNull()

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://team.mite.de/time_entries/42.json')
    expect(init.method).toBe('DELETE')
    expect(init.body).toBeUndefined()
  })

  // Calling .json() on an empty response throws, so both ways Mite signals "no content"
  // have to short-circuit.
  test('returns null for a 204 instead of parsing an empty body', async () => {
    mockFetch({ status: 204, json: {} })

    await expect(createMiteClient(config, 'k').updateTimeEntry(1, {})).resolves.toBeNull()
  })

  test('returns null for a 200 that declares a zero content length', async () => {
    mockFetch({ status: 200, headers: { 'content-length': '0' } })

    await expect(createMiteClient(config, 'k').updateTimeEntry(1, {})).resolves.toBeNull()
  })

  test.each([401, 403])('maps HTTP %i on a mutation to a 401', async (status) => {
    mockFetch({ status })

    await expect(createMiteClient(config, 'k').createTimeEntry({})).rejects.toMatchObject(
      {
        statusCode: 401,
      }
    )
  })

  test('maps another failure status on a mutation to 502', async () => {
    mockFetch({ status: 422 })

    await expect(createMiteClient(config, 'k').createTimeEntry({})).rejects.toMatchObject(
      {
        statusCode: 502,
        message: 'Mite API request failed with status 422.',
      }
    )
  })

  test('maps a transport failure on a mutation to 502', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('EAI_AGAIN')
    })

    await expect(createMiteClient(config, 'k').createTimeEntry({})).rejects.toMatchObject(
      {
        statusCode: 502,
        message: 'Failed to reach Mite API: EAI_AGAIN',
      }
    )
  })

  test('stringifies a non-Error transport rejection on a mutation', async () => {
    global.fetch = jest.fn(async () => {
      throw 'reset'
    })

    await expect(createMiteClient(config, 'k').createTimeEntry({})).rejects.toMatchObject(
      {
        message: 'Failed to reach Mite API: reset',
      }
    )
  })
})
