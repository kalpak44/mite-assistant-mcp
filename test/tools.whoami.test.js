import { registerWhoAmITool } from '../src/tools/whoami.js'
import { fakeServer } from './helpers.js'

const user = {
  id: 42,
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  role: 'admin',
}

test('registers a read-only, idempotent whoami tool', () => {
  const server = fakeServer()

  registerWhoAmITool(server, { user, miteBaseUrl: 'https://team.mite.de' })

  const { meta } = server.tools.get('whoami')
  expect(meta.annotations).toEqual({ readOnlyHint: true, idempotentHint: true })
})

test('reports the session user as text and as structured content', async () => {
  const server = fakeServer()
  registerWhoAmITool(server, { user, miteBaseUrl: 'https://team.mite.de' })

  const result = await server.handler('whoami')()

  expect(result.content[0].text).toBe('Ada Lovelace <ada@example.com> (admin)')
  expect(result.structuredContent).toEqual({
    miteBaseUrl: 'https://team.mite.de',
    user,
  })
})
