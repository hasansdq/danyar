import { afterEach, beforeEach, expect, mock, test } from 'bun:test'

const countUsers = mock(async () => 0)
const countSchools = mock(async () => 0)
const repair = mock(() => Buffer.from(''))
const superadmin = mock(async () => false)
const violationTypes = mock(async () => false)
const demo = mock(async () => ({}))

mock.module('node:child_process', () => ({ execSync: repair }))
mock.module('../src/lib/db', () => ({ db: {
  user: { count: countUsers }, school: { count: countSchools },
} }))
mock.module('../src/lib/seed-data', () => ({
  ensureSuperadmin: superadmin, ensureViolationTypes: violationTypes, seedDemoData: demo,
}))
const { ensureSeeded } = await import('../src/lib/bootstrap')

const saved = { ...process.env }
beforeEach(() => {
  Object.assign(process.env, { NODE_ENV: 'production' })
  process.env.DATABASE_URL = 'file:/unused.db'
  process.env.INFRA_RUN_MODE = 'docker'
  delete process.env.NEXT_PHASE
  delete process.env.DANIAR_ALLOW_DEV_SCHEMA_REPAIR
  for (const fn of [countUsers, countSchools, repair, superadmin, violationTypes, demo]) fn.mockClear()
  countUsers.mockImplementation(async () => 0)
})
afterEach(() => {
  for (const key of ['NODE_ENV', 'DATABASE_URL', 'INFRA_RUN_MODE', 'NEXT_PHASE', 'DANIAR_ALLOW_DEV_SCHEMA_REPAIR']) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

test('production database errors never trigger schema repair', async () => {
  countUsers.mockImplementation(async () => { throw new Error('Database unavailable') })
  const result = await ensureSeeded(true)
  expect(result.ok).toBe(false)
  expect(repair).not.toHaveBeenCalled()
  expect(superadmin).not.toHaveBeenCalled()
  expect(demo).not.toHaveBeenCalled()
})

test('production login does not provision accounts or demo schools', async () => {
  expect((await ensureSeeded(true)).ok).toBe(true)
  expect(superadmin).not.toHaveBeenCalled()
  expect(countSchools).not.toHaveBeenCalled()
  expect(demo).not.toHaveBeenCalled()
  expect(violationTypes).toHaveBeenCalledTimes(1)
})

test('preview flags cannot enable production schema repair or demo data', async () => {
  process.env.INFRA_RUN_MODE = 'preview'
  process.env.DANIAR_ALLOW_DEV_SCHEMA_REPAIR = '1'
  countUsers.mockImplementation(async () => { throw new Error('Unavailable') })
  expect((await ensureSeeded(true)).ok).toBe(false)
  expect(repair).not.toHaveBeenCalled()
  expect(demo).not.toHaveBeenCalled()
})

test('build without database configuration has no database side effects', async () => {
  delete process.env.DATABASE_URL
  expect((await ensureSeeded(true)).reason).toBe('db-not-configured')
  expect(countUsers).not.toHaveBeenCalled()
  expect(repair).not.toHaveBeenCalled()
})
