import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const ipcEmitter = new EventEmitter()
const ipcMainMock = {
  on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
    ipcEmitter.on(channel, listener)
  }),
  removeListener: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
    ipcEmitter.removeListener(channel, listener)
  })
}

vi.mock('electron', () => ({ ipcMain: ipcMainMock }))

describe('requestTerminalTabCloseFromRenderer', () => {
  beforeEach(() => {
    ipcEmitter.removeAllListeners()
    ipcMainMock.on.mockClear()
    ipcMainMock.removeListener.mockClear()
  })

  it('waits for the targeted renderer durability acknowledgement', async () => {
    const { requestTerminalTabCloseFromRenderer } =
      await import('./terminal-tab-close-request-relay')
    const webContents = { isDestroyed: () => false, send: vi.fn() }
    const otherWebContents = {}
    const mainWindow = { isDestroyed: () => false, webContents }
    const pending = requestTerminalTabCloseFromRenderer(mainWindow as never, 'tab-1')
    const request = webContents.send.mock.calls[0]?.[1] as { requestId: string; tabId: string }

    expect(request.tabId).toBe('tab-1')
    ipcEmitter.emit(
      'ui:terminalTabCloseResponse',
      { sender: otherWebContents },
      { requestId: request.requestId }
    )
    let settled = false
    void pending.finally(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    ipcEmitter.emit(
      'ui:terminalTabCloseResponse',
      { sender: webContents },
      { requestId: request.requestId }
    )
    await expect(pending).resolves.toBeUndefined()
  })

  it('propagates renderer cancellation instead of reporting success', async () => {
    const { requestTerminalTabCloseFromRenderer } =
      await import('./terminal-tab-close-request-relay')
    const webContents = { isDestroyed: () => false, send: vi.fn() }
    const pending = requestTerminalTabCloseFromRenderer(
      { isDestroyed: () => false, webContents } as never,
      'tab-pinned'
    )
    const request = webContents.send.mock.calls[0]?.[1] as { requestId: string }

    ipcEmitter.emit(
      'ui:terminalTabCloseResponse',
      { sender: webContents },
      { requestId: request.requestId, error: 'terminal_tab_pinned' }
    )

    await expect(pending).rejects.toThrow('terminal_tab_pinned')
  })

  it('validates exact bindings through a separate read-only channel', async () => {
    const { requestTerminalTabCloseValidationFromRenderer } =
      await import('./terminal-tab-close-request-relay')
    const webContents = { isDestroyed: () => false, send: vi.fn() }
    const otherWebContents = {}
    const pending = requestTerminalTabCloseValidationFromRenderer(
      { isDestroyed: () => false, webContents } as never,
      'tab-1',
      ['pty-left', 'pty-right']
    )
    const request = webContents.send.mock.calls[0]?.[1] as { requestId: string }

    expect(webContents.send).toHaveBeenCalledWith('ui:terminalTabCloseValidationRequest', {
      requestId: request.requestId,
      tabId: 'tab-1',
      expectedPtyIds: ['pty-left', 'pty-right']
    })
    ipcEmitter.emit(
      'ui:terminalTabCloseValidationResponse',
      { sender: otherWebContents },
      { requestId: request.requestId }
    )
    let settled = false
    void pending.finally(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    ipcEmitter.emit(
      'ui:terminalTabCloseValidationResponse',
      { sender: webContents },
      { requestId: request.requestId }
    )
    await expect(pending).resolves.toBeUndefined()
    expect(webContents.send).toHaveBeenCalledTimes(1)
  })

  it('rejects when read-only validation exceeds its deadline', async () => {
    vi.useFakeTimers()
    try {
      const { requestTerminalTabCloseValidationFromRenderer } =
        await import('./terminal-tab-close-request-relay')
      const webContents = { isDestroyed: () => false, send: vi.fn() }
      const pending = requestTerminalTabCloseValidationFromRenderer(
        { isDestroyed: () => false, webContents } as never,
        'tab-timeout',
        ['pty-1']
      )
      const rejected = expect(pending).rejects.toThrow('terminal_tab_close_timeout')

      await vi.advanceTimersByTimeAsync(20_000)

      await rejected
      expect(webContents.send).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects immediately when validation cannot be delivered', async () => {
    const { requestTerminalTabCloseValidationFromRenderer } =
      await import('./terminal-tab-close-request-relay')
    const webContents = {
      isDestroyed: () => false,
      send: vi.fn(() => {
        throw new Error('destroyed')
      })
    }

    await expect(
      requestTerminalTabCloseValidationFromRenderer(
        { isDestroyed: () => false, webContents } as never,
        'tab-timeout',
        ['pty-1']
      )
    ).rejects.toThrow('renderer_unavailable')
  })
})
