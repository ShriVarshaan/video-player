import { describe, expect, it } from 'vitest'

describe('toolchain', () => {
  it('runs node:sqlite under the test runner', async () => {
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(':memory:')
    expect({ ...db.prepare('select 1 as x').get() }).toEqual({ x: 1 })
  })
})
