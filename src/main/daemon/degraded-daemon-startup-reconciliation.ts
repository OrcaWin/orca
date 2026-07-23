import type { IPtyProvider } from '../providers/types'
import type { DaemonPtyAdapter } from './daemon-pty-adapter'

export async function reconcileDegradedDaemonSessionsOnStartup(
  adapters: readonly DaemonPtyAdapter[],
  sessionProviders: Map<string, IPtyProvider>,
  validWorktreeIds: Set<string>
): Promise<{ alive: string[]; killed: string[] }> {
  const alive: string[] = []
  const killed: string[] = []
  for (const adapter of adapters) {
    const result = await adapter.reconcileOnStartup(validWorktreeIds)
    for (const id of result.alive) {
      alive.push(id)
      sessionProviders.set(id, adapter)
    }
    for (const id of result.killed) {
      killed.push(id)
      sessionProviders.delete(id)
    }
  }
  return { alive, killed }
}
