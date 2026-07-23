import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SshPtyProvider } from './ssh-pty-provider'

type MockMultiplexer = {
  request: ReturnType<typeof vi.fn>
  notify: ReturnType<typeof vi.fn>
  onNotification: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
  isDisposed: ReturnType<typeof vi.fn>
}

function createMockMux(): MockMultiplexer {
  return {
    request: vi.fn().mockResolvedValue(undefined),
    notify: vi.fn(),
    onNotification: vi.fn(),
    dispose: vi.fn(),
    isDisposed: vi.fn().mockReturnValue(false)
  }
}

describe('SshPtyProvider incarnation-bound shutdown capability', () => {
  let mux: MockMultiplexer
  let provider: SshPtyProvider
  const scopedPtyId = 'ssh:conn-1@@pty-1'

  beforeEach(() => {
    mux = createMockMux()
    provider = new SshPtyProvider('conn-1', mux as never)
  })

  it('retries the capability probe after a transient relay failure', async () => {
    mux.request
      .mockRejectedValueOnce(new Error('connection lost'))
      .mockResolvedValueOnce({ shutdownIncarnationVersion: 1 })

    await expect(provider.supportsIncarnationBoundShutdown()).resolves.toBeNull()
    await expect(provider.supportsIncarnationBoundShutdown()).resolves.toBe(true)
    expect(mux.request).toHaveBeenCalledTimes(2)
  })

  it('selects the legacy close lane for an old relay without the capability method', async () => {
    mux.request.mockRejectedValue(
      Object.assign(new Error('Method not found: pty.getCapabilities'), { code: -32601 })
    )

    await expect(provider.supportsIncarnationBoundShutdown()).resolves.toBe(false)
  })

  it.each([
    Object.assign(new Error('request timed out'), { code: 'TIMEOUT' }),
    Object.assign(new Error('connection lost'), { code: 'CONNECTION_LOST' })
  ])('keeps a failed capability probe unknown for %s', async (error) => {
    mux.request.mockRejectedValue(error)

    await expect(provider.supportsIncarnationBoundShutdown()).resolves.toBeNull()
  })

  it('keeps a malformed capability response unknown', async () => {
    mux.request.mockResolvedValue('not-an-object')

    await expect(provider.supportsIncarnationBoundShutdown()).resolves.toBeNull()
  })

  it('recognizes an in-place relay upgrade after an unsupported response', async () => {
    mux.request.mockResolvedValueOnce({}).mockResolvedValueOnce({ shutdownIncarnationVersion: 1 })

    await expect(provider.supportsIncarnationBoundShutdown()).resolves.toBe(false)
    await expect(provider.supportsIncarnationBoundShutdown()).resolves.toBe(true)
    expect(mux.request).toHaveBeenCalledTimes(2)
  })

  it('proves capability before forwarding exact shutdown authority', async () => {
    mux.request.mockImplementation(async (method: string) => {
      if (method === 'pty.getCapabilities') {
        return { shutdownIncarnationVersion: 1 }
      }
      return undefined
    })

    await provider.shutdown(scopedPtyId, {
      immediate: true,
      expectedIncarnationId: 'incarnation-a'
    })

    expect(mux.request.mock.calls.map((call) => call[0])).toEqual([
      'pty.getCapabilities',
      'pty.shutdown'
    ])
    expect(mux.request).toHaveBeenLastCalledWith(
      'pty.shutdown',
      {
        id: 'pty-1',
        immediate: true,
        keepHistory: false,
        expectedIncarnationId: 'incarnation-a'
      },
      undefined
    )
  })

  it('does not dispatch shutdown after cancellation wins during capability probing', async () => {
    let finishCapability!: (value: { shutdownIncarnationVersion: number }) => void
    mux.request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishCapability = resolve
        })
    )
    const controller = new AbortController()

    const shutdown = provider.shutdown(scopedPtyId, {
      immediate: true,
      expectedIncarnationId: 'incarnation-a',
      signal: controller.signal
    })
    controller.abort()
    finishCapability({ shutdownIncarnationVersion: 1 })

    await expect(shutdown).rejects.toThrow('client_disconnected')
    expect(mux.request).toHaveBeenCalledOnce()
    expect(mux.request).toHaveBeenCalledWith('pty.getCapabilities', undefined, undefined)
  })

  it('does not contact the relay after the teardown deadline has expired', async () => {
    await expect(
      provider.shutdown(scopedPtyId, { immediate: true, deadlineMs: Date.now() - 1 })
    ).rejects.toThrow('terminal_tab_close_timeout')
    expect(mux.request).not.toHaveBeenCalled()
  })
})
