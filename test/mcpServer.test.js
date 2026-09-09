import { createMcpApp } from '../src/mcpServer.js'

const session = {
  user: { id: 1, name: 'Ada', email: 'ada@example.com', role: 'admin' },
  miteBaseUrl: 'https://team.mite.de',
  miteClient: {},
}

// Built against the real McpServer, not a fake: the tool handlers are covered in the
// tools suites, so what is left worth checking is that the five zod schemas are accepted
// by the SDK actually installed. A version bump that tightens schema validation fails
// here, on its own dependency PR.
//
// `_registeredTools` is an SDK internal. If a major rename breaks this, fix the accessor —
// do not delete the assertion, because it is the only thing that exercises the real SDK.
test('registers every tool on a real McpServer', () => {
  const server = createMcpApp(session)

  expect(Object.keys(server._registeredTools).sort()).toEqual([
    'create_time_entry',
    'delete_time_entry',
    'list_time_entries',
    'update_time_entry',
    'whoami',
  ])
})

test('returns a server the transport can connect to', () => {
  const server = createMcpApp(session)

  expect(typeof server.connect).toBe('function')
})
