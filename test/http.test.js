import { getSessionId, readJsonBody, sendJson } from '../src/http.js'
import { fakeReq, fakeRes } from './helpers.js'

describe('sendJson', () => {
  test('writes the status, the JSON content type and a byte-accurate length', () => {
    const res = fakeRes()

    sendJson(res, 201, { ok: true })

    expect(res.statusCode).toBe(201)
    expect(res.sentHeaders['Content-Type']).toBe('application/json')
    expect(res.body).toBe('{"ok":true}')
    expect(res.sentHeaders['Content-Length']).toBe(11)
  })

  // Content-Length counts bytes, not characters. `body.length` would understate a
  // multi-byte payload and the client would hang waiting for the rest of it.
  test('measures multi-byte characters in bytes', () => {
    const res = fakeRes()

    sendJson(res, 200, { note: 'außergewöhnlich' })

    expect(res.sentHeaders['Content-Length']).toBe(Buffer.byteLength(res.body))
    expect(res.sentHeaders['Content-Length']).toBeGreaterThan(res.body.length)
  })
})

describe('readJsonBody', () => {
  test('parses a JSON body delivered in one chunk', async () => {
    const req = fakeReq({ chunks: [Buffer.from('{"a":1}')] })

    await expect(readJsonBody(req)).resolves.toEqual({ a: 1 })
  })

  // A body split across chunks has to be concatenated before parsing; parsing each chunk
  // separately fails on any payload larger than one TCP segment.
  test('reassembles a body split across chunks', async () => {
    const req = fakeReq({ chunks: [Buffer.from('{"a":'), Buffer.from('1}')] })

    await expect(readJsonBody(req)).resolves.toEqual({ a: 1 })
  })

  test('treats no body at all as an empty object', async () => {
    await expect(readJsonBody(fakeReq({ chunks: [] }))).resolves.toEqual({})
  })

  test('rejects a malformed body with a readable message', async () => {
    const req = fakeReq({ chunks: [Buffer.from('not json')] })

    await expect(readJsonBody(req)).rejects.toThrow('Request body must be valid JSON.')
  })

  test('decodes multi-byte characters split mid-character across chunks', async () => {
    const full = Buffer.from(JSON.stringify({ note: 'größer' }), 'utf8')
    const req = fakeReq({ chunks: [full.subarray(0, 10), full.subarray(10)] })

    await expect(readJsonBody(req)).resolves.toEqual({ note: 'größer' })
  })
})

describe('getSessionId', () => {
  test('passes a single header value through', () => {
    expect(getSessionId('abc')).toBe('abc')
  })

  // A repeated Mcp-Session-Id header arrives as an array; using it as a Map key that way
  // never matches a stored session.
  test('takes the first value of a repeated header', () => {
    expect(getSessionId(['first', 'second'])).toBe('first')
  })

  test('passes undefined through for an absent header', () => {
    expect(getSessionId(undefined)).toBeUndefined()
  })
})
