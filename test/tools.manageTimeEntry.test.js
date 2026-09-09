import { jest } from '@jest/globals'

import { registerManageTimeEntryTools } from '../src/tools/manageTimeEntry.js'
import { fakeServer } from './helpers.js'

function setup(overrides = {}) {
  const miteClient = {
    getProjects: jest.fn(async () => []),
    getServices: jest.fn(async () => []),
    createTimeEntry: jest.fn(async (fields) => ({
      time_entry: { id: 500, ...fields },
    })),
    updateTimeEntry: jest.fn(async () => null),
    deleteTimeEntry: jest.fn(async () => null),
    ...overrides,
  }
  const server = fakeServer()
  registerManageTimeEntryTools(server, { miteClient })
  return { miteClient, server }
}

test('registers all three mutation tools', () => {
  const { server } = setup()

  expect([...server.tools.keys()]).toEqual([
    'create_time_entry',
    'update_time_entry',
    'delete_time_entry',
  ])
})

// The destructive hint is what lets a client warn before deleting. It is metadata a
// refactor can silently drop, so it is asserted rather than assumed.
test('marks delete as destructive and create as non-idempotent', () => {
  const { server } = setup()

  expect(server.tools.get('delete_time_entry').meta.annotations).toEqual({
    readOnlyHint: false,
    idempotentHint: false,
    destructiveHint: true,
  })
  expect(server.tools.get('create_time_entry').meta.annotations).toEqual({
    readOnlyHint: false,
    idempotentHint: false,
  })
})

describe('create_time_entry', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-13T12:00:00Z'))
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  test('defaults the date to today and omits absent optional fields', async () => {
    const { miteClient, server } = setup()

    await server.handler('create_time_entry')({ minutes: 90 })

    expect(miteClient.createTimeEntry).toHaveBeenCalledWith({
      minutes: 90,
      date_at: '2026-05-13',
    })
  })

  test('keeps an explicit date and forwards project, service and note', async () => {
    const { miteClient, server } = setup()

    await server.handler('create_time_entry')({
      minutes: 120,
      date_at: '2026-05-12',
      project_id: 7,
      service_id: 8,
      note: '#123 - fix bug',
    })

    expect(miteClient.createTimeEntry).toHaveBeenCalledWith({
      minutes: 120,
      date_at: '2026-05-12',
      project_id: 7,
      service_id: 8,
      note: '#123 - fix bug',
    })
  })

  test('resolves project and service names to ids', async () => {
    const { miteClient, server } = setup({
      getProjects: jest.fn(async () => [{ id: 71, name: 'Platform Rewrite' }]),
      getServices: jest.fn(async () => [{ id: 81, name: 'Development - Backend' }]),
    })

    await server.handler('create_time_entry')({
      minutes: 60,
      project_name: 'platform',
      service_name: 'backend',
    })

    expect(miteClient.createTimeEntry).toHaveBeenCalledWith(
      expect.objectContaining({ project_id: 71, service_id: 81 })
    )
  })

  // An empty note is a meaningful value the caller chose; treating it as absent would
  // silently discard it.
  test('forwards an empty note rather than dropping it', async () => {
    const { miteClient, server } = setup()

    await server.handler('create_time_entry')({ minutes: 30, note: '' })

    expect(miteClient.createTimeEntry).toHaveBeenCalledWith(
      expect.objectContaining({ note: '' })
    )
  })

  test('summarises the created entry as hours and date', async () => {
    const { server } = setup({
      createTimeEntry: jest.fn(async () => ({
        time_entry: { id: 501, minutes: 95, date_at: '2026-05-13' },
      })),
    })

    const result = await server.handler('create_time_entry')({ minutes: 95 })

    expect(result.content[0].text).toBe('Created time entry 501 (1:35 on 2026-05-13)')
    expect(result.structuredContent.time_entry.id).toBe(501)
  })

  // Mite is inconsistent about the envelope on writes, so the tool accepts both shapes.
  test('accepts a create response with no time_entry envelope', async () => {
    const { server } = setup({
      createTimeEntry: jest.fn(async () => ({
        id: 502,
        minutes: 60,
        date_at: '2026-05-13',
      })),
    })

    const result = await server.handler('create_time_entry')({ minutes: 60 })

    expect(result.structuredContent.time_entry.id).toBe(502)
    expect(result.content[0].text).toContain('1:00')
  })

  test('refuses an unresolvable project name', async () => {
    const { server } = setup({ getProjects: jest.fn(async () => []) })

    await expect(
      server.handler('create_time_entry')({ minutes: 30, project_name: 'Ghost' })
    ).rejects.toThrow('No project found matching "Ghost"')
  })

  test('refuses an ambiguous service name', async () => {
    const { server } = setup({
      getServices: jest.fn(async () => [
        { id: 1, name: 'Development - Backend' },
        { id: 2, name: 'Development - Frontend' },
      ]),
    })

    await expect(
      server.handler('create_time_entry')({ minutes: 30, service_name: 'Development' })
    ).rejects.toThrow(/Ambiguous service name/)
  })
})

describe('update_time_entry', () => {
  test('sends only the fields the caller supplied', async () => {
    const { miteClient, server } = setup()

    await server.handler('update_time_entry')({ id: 900, minutes: 45 })

    expect(miteClient.updateTimeEntry).toHaveBeenCalledWith(900, { minutes: 45 })
  })

  test('resolves names and reports what changed', async () => {
    const { miteClient, server } = setup({
      getProjects: jest.fn(async () => [{ id: 71, name: 'Platform' }]),
    })

    const result = await server.handler('update_time_entry')({
      id: 900,
      project_name: 'Platform',
      date_at: '2026-05-01',
      note: 'rework',
    })

    expect(miteClient.updateTimeEntry).toHaveBeenCalledWith(900, {
      date_at: '2026-05-01',
      project_id: 71,
      note: 'rework',
    })
    expect(result.content[0].text).toBe('Updated time entry 900')
    expect(result.structuredContent).toEqual({
      id: 900,
      updated: { date_at: '2026-05-01', project_id: 71, note: 'rework' },
    })
  })

  // A PATCH with an empty body is a no-op that Mite answers 200 to, so the tool would
  // report success without changing anything.
  test('refuses an update that carries no fields', async () => {
    const { miteClient, server } = setup()

    await expect(server.handler('update_time_entry')({ id: 900 })).rejects.toThrow(
      'No fields to update — provide at least one field to change.'
    )
    expect(miteClient.updateTimeEntry).not.toHaveBeenCalled()
  })
})

describe('delete_time_entry', () => {
  test('deletes by id and confirms', async () => {
    const { miteClient, server } = setup()

    const result = await server.handler('delete_time_entry')({ id: 900 })

    expect(miteClient.deleteTimeEntry).toHaveBeenCalledWith(900)
    expect(result.content[0].text).toBe('Deleted time entry 900')
    expect(result.structuredContent).toEqual({ id: 900 })
  })

  test('propagates a delete failure instead of reporting success', async () => {
    const { server } = setup({
      deleteTimeEntry: jest.fn(async () => {
        throw new Error('Unauthorized Mite API key.')
      }),
    })

    await expect(server.handler('delete_time_entry')({ id: 900 })).rejects.toThrow(
      'Unauthorized Mite API key.'
    )
  })
})
