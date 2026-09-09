import { extractBearerToken, tokensMatch } from '../src/auth.js'

describe('extractBearerToken', () => {
  test('returns the token from a Bearer header', () => {
    expect(extractBearerToken('Bearer abc123')).toBe('abc123')
  })

  test.each([
    ['missing', undefined],
    ['empty', ''],
    // Node hands back an array when a header is repeated, and `.split` on an array
    // throws — the guard is what stops a duplicated Authorization header 500ing.
    ['repeated', ['Bearer a', 'Bearer b']],
    ['a different scheme', 'Basic abc123'],
    ['a scheme with no token', 'Bearer'],
  ])('returns null for %s', (_label, header) => {
    expect(extractBearerToken(header)).toBeNull()
  })
})

describe('tokensMatch', () => {
  test('accepts identical tokens', () => {
    expect(tokensMatch('secret', 'secret')).toBe(true)
  })

  test('rejects different tokens of equal length', () => {
    expect(tokensMatch('secret', 'sekret')).toBe(false)
  })

  // timingSafeEqual throws on mismatched lengths, so the length test has to short-circuit
  // before it rather than being a redundant extra check.
  test('rejects tokens of different length without throwing', () => {
    expect(tokensMatch('short', 'much-longer-token')).toBe(false)
  })
})
