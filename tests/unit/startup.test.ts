import { describe, expect, it, vi } from 'vitest'
import { throwAppError } from '@shared/appError'
import { startOrQuit } from '../../src/main/startup'

describe('startOrQuit', () => {
  it('reports and quits when startup throws', async () => {
    const report = vi.fn()
    const quit = vi.fn()
    await startOrQuit(
      () => {
        throw new Error('window failed')
      },
      { report, quit }
    )
    expect(report).toHaveBeenCalledWith('window failed')
    expect(quit).toHaveBeenCalledOnce()
  })

  it('reports an AppError by its message, not its JSON', async () => {
    const report = vi.fn()
    await startOrQuit(() => throwAppError({ code: 'db_too_new', message: 'Update the app.' }), {
      report,
      quit: vi.fn()
    })
    expect(report).toHaveBeenCalledWith('Update the app.')
  })

  it('reports and quits when async startup rejects', async () => {
    const report = vi.fn()
    const quit = vi.fn()
    await startOrQuit(async () => Promise.reject(new Error('late')), { report, quit })
    expect(report).toHaveBeenCalledWith('late')
    expect(quit).toHaveBeenCalledOnce()
  })

  it('does nothing extra when startup succeeds', async () => {
    const report = vi.fn()
    const quit = vi.fn()
    await startOrQuit(() => {}, { report, quit })
    expect(report).not.toHaveBeenCalled()
    expect(quit).not.toHaveBeenCalled()
  })
})
