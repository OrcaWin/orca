import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DaemonClient } from './client'
import { DaemonServer } from './daemon-server'
import { getDaemonSocketPath } from './daemon-spawner'
import type { SubprocessHandle } from './session'

function createMockSubprocess(): SubprocessHandle {
  return {
    pid: 55555,
    getForegroundProcess: vi.fn(() => null),
    confirmForegroundProcess: vi.fn(async () => null),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    forceKill: vi.fn(),
    signal: vi.fn(),
    onData: vi.fn(),
    onExit: vi.fn(),
    dispose: vi.fn()
  }
}

describe('DaemonServer pending-spawn exact shutdown', () => {
  let dir: string
  let server: DaemonServer
  let client: DaemonClient

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'daemon-pending-test-'))
  })

  afterEach(async () => {
    client?.disconnect()
    await server?.shutdown()
    rmSync(dir, { recursive: true, force: true })
  })

  it('does not let a stale exact kill cancel an unregistered replacement generation', async () => {
    let finishPreparation!: () => void
    const preparation = new Promise<void>((resolve) => {
      finishPreparation = resolve
    })
    const preparePtySpawn = vi.fn(() => preparation)
    const spawnSubprocess = vi.fn(() => createMockSubprocess())
    const socketPath = getDaemonSocketPath(dir)
    const tokenPath = join(dir, 'test.token')
    server = new DaemonServer({ socketPath, tokenPath, preparePtySpawn, spawnSubprocess })
    await server.start()
    client = new DaemonClient({ socketPath, tokenPath })
    await client.ensureConnected()

    const replacement = client.request('createOrAttach', {
      sessionId: 'reused-session',
      cols: 80,
      rows: 24
    })
    await vi.waitFor(() => expect(preparePtySpawn).toHaveBeenCalledOnce())

    try {
      await expect(
        client.request('kill', {
          sessionId: 'reused-session',
          immediate: true,
          expectedIncarnationId: 'stale-incarnation'
        })
      ).rejects.toThrow('pty_incarnation_stale')
    } finally {
      finishPreparation()
    }

    await expect(replacement).resolves.toMatchObject({ isNew: true })
    expect(spawnSubprocess).toHaveBeenCalledOnce()
  })
})
