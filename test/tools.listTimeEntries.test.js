import { jest } from '@jest/globals'

import { registerListTimeEntriesTool } from '../src/tools/listTimeEntries.js'
import { fakeServer } from './helpers.js'

function setup(overrides = {}) {
  const miteClient = {
    getTimeEntries: jest.fn(async () => []),
    getCustomers: jest.fn(async () => []),
    getProjects: jest.fn(async () => []),
    getServices: jest.fn(async () => []),
    getUsers: jest.fn(async () => []),
    ...overrides,
  }
  const server = fakeServer()
  registerListTimeEntriesTool(server, { miteClient })
  return { miteClient, run: server.handler('list_time_entries') }
}

const entry = {
  id: 1,
  date_at: '2026-05-12',
  minutes: 95,
  customer_id: 10,
  customer_name: 'Acme',
  project_id: 20,
  project_name: 'Platform',
  service_id: 30,
  service_name: 'Development',
  user_id: 40,
  user_name: 'Ada',
  note: 'work',
  billable: true,
  locked: false,
  revenue: 100,
}

describe('filters', () => {
  test('passes explicit ids straight through without a lookup', async () => {
    const { miteClient, run } = setup()

    await run({ customer_id: 1, project_id: 2, service_id: 3, user_id: 4 })

    expect(miteClient.getTimeEntries).toHaveBeenCalledWith({
      customer_id: 1,
      project_id: 2,
      service_id: 3,
      user_id: 4,
    })
    expect(miteClient.getCustomers).not.toHaveBeenCalled()
    expect(miteClient.getProjects).not.toHaveBeenCalled()
  })

  test('resolves each name to an id case-insensitively and partially', async () => {
    const { miteClient, run } = setup({
      getCustomers: jest.fn(async () => [{ id: 11, name: 'Acme Corporation' }]),
      getProjects: jest.fn(async () => [{ id: 22, name: 'Platform Rewrite' }]),
      getServices: jest.fn(async () => [{ id: 33, name: 'Development' }]),
      getUsers: jest.fn(async () => [{ id: 44, name: 'Ada Lovelace' }]),
    })

    await run({
      customer_name: 'acme',
      project_name: 'PLATFORM',
      service_name: 'devel',
      user_name: 'ada',
    })

    expect(miteClient.getTimeEntries).toHaveBeenCalledWith({
      customer_id: 11,
      project_id: 22,
      service_id: 33,
      user_id: 44,
    })
  })

  // An id silently winning over a name would quietly ignore half the caller's request;
  // the id is documented as authoritative, so assert it rather than assume it.
  test('prefers an explicit id over a name for the same dimension', async () => {
    const { miteClient, run } = setup({
      getProjects: jest.fn(async () => [{ id: 99, name: 'Other' }]),
    })

    await run({ project_id: 7, project_name: 'Other' })

    expect(miteClient.getProjects).not.toHaveBeenCalled()
    expect(miteClient.getTimeEntries).toHaveBeenCalledWith({ project_id: 7 })
  })

  test('refuses a name that matches nothing', async () => {
    const { run } = setup({
      getCustomers: jest.fn(async () => [{ id: 1, name: 'Acme' }]),
    })

    await expect(run({ customer_name: 'Globex' })).rejects.toThrow(
      'No customer found matching "Globex"'
    )
  })

  // Picking the first of several matches would book time against an arbitrary project.
  // The error lists the candidates so the caller can choose.
  test('refuses an ambiguous name and names every candidate', async () => {
    const { run } = setup({
      getProjects: jest.fn(async () => [
        { id: 1, name: 'Platform API' },
        { id: 2, name: 'Platform UI' },
      ]),
    })

    await expect(run({ project_name: 'Platform' })).rejects.toThrow(
      'Ambiguous project name "Platform" — matches: "Platform API" (id: 1), "Platform UI" (id: 2)'
    )
  })

  test('forwards note and locked filters', async () => {
    const { miteClient, run } = setup()

    await run({ note: 'review', locked: false })

    expect(miteClient.getTimeEntries).toHaveBeenCalledWith({
      note: 'review',
      locked: false,
    })
  })

  test('sends no filters at all when none are given', async () => {
    const { miteClient, run } = setup()

    await run({})

    expect(miteClient.getTimeEntries).toHaveBeenCalledWith({})
  })
})

describe('time frames', () => {
  // Wednesday, so the this_week window is genuinely mid-week rather than a boundary that
  // would pass even with an off-by-one.
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-13T12:00:00Z'))
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  test.each([
    ['today', { at: '2026-05-13' }],
    ['yesterday', { at: '2026-05-12' }],
    ['this_week', { from: '2026-05-11', to: '2026-05-13' }],
    ['last_week', { from: '2026-05-04', to: '2026-05-10' }],
    ['this_month', { from: '2026-05-01', to: '2026-05-13' }],
    ['last_month', { from: '2026-04-01', to: '2026-04-30' }],
  ])('resolves %s', async (at, expected) => {
    const { miteClient, run } = setup()

    await run({ at })

    expect(miteClient.getTimeEntries).toHaveBeenCalledWith(expected)
  })

  // `from`/`to` are documented as overriding `at`. Merging both would send Mite a
  // contradictory window and the narrower one would silently win.
  test('an explicit range overrides a time frame', async () => {
    const { miteClient, run } = setup()

    await run({ at: 'this_month', from: '2026-01-01', to: '2026-01-31' })

    expect(miteClient.getTimeEntries).toHaveBeenCalledWith({
      from: '2026-01-01',
      to: '2026-01-31',
    })
  })

  test.each([
    ['from', { from: '2026-01-01' }],
    ['to', { to: '2026-01-31' }],
  ])('accepts %s on its own', async (_label, args) => {
    const { miteClient, run } = setup()

    await run({ at: 'today', ...args })

    expect(miteClient.getTimeEntries).toHaveBeenCalledWith(args)
  })
})

describe('output', () => {
  test('flattens each entry and renders minutes as hours', async () => {
    const { run } = setup({ getTimeEntries: jest.fn(async () => [entry]) })

    const result = await run({})

    expect(result.content[0].text).toBe('1 time entry')
    expect(result.structuredContent.count).toBe(1)
    expect(result.structuredContent.entries[0]).toEqual({
      id: 1,
      date: '2026-05-12',
      minutes: 95,
      hours: '1:35',
      customer_id: 10,
      customer: 'Acme',
      project_id: 20,
      project: 'Platform',
      service_id: 30,
      service: 'Development',
      user_id: 40,
      user: 'Ada',
      note: 'work',
      billable: true,
      locked: false,
      revenue: 100,
    })
  })

  test('pads the minutes component to two digits', async () => {
    const { run } = setup({
      getTimeEntries: jest.fn(async () => [{ ...entry, minutes: 125 }]),
    })

    const result = await run({})

    expect(result.structuredContent.entries[0].hours).toBe('2:05')
  })

  test.each([
    [0, '0 time entries'],
    [1, '1 time entry'],
    [2, '2 time entries'],
  ])('pluralises %i as "%s"', async (count, text) => {
    const { run } = setup({
      getTimeEntries: jest.fn(async () => Array.from({ length: count }, () => entry)),
    })

    const result = await run({})

    expect(result.content[0].text).toBe(text)
  })
})
