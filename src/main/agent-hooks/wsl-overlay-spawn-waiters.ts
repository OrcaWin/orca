// Parks WSL PTY spawns that race the guest relay's first OpenCode overlay report.
// A pane's env is frozen at spawn and nothing rewrites it later, so a pane that
// spawns before the report runs OpenCode without Orca's status plugin for its whole
// life — while every pane after it works. Keyed exactly like WslHookRelayManager's
// distro states so a report can answer every spawn parked on that distro at once.
export class WslOverlaySpawnWaiters {
  private waiters = new Map<string, Set<(dir: string | null) => void>>()

  /** Park until `settle`/`releaseAll` answers for `key`, or `timeoutMs` elapses.
   *  Timing out resolves null: the caller then falls back to the guest's own config
   *  (no status) rather than stalling the terminal on a cold or relay-less distro. */
  park(key: string, timeoutMs: number): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      const parked = this.waiters.get(key) ?? new Set<(dir: string | null) => void>()
      this.waiters.set(key, parked)
      let timer: ReturnType<typeof setTimeout> | undefined
      const settle = (dir: string | null): void => {
        clearTimeout(timer)
        parked.delete(settle)
        resolve(dir)
      }
      timer = setTimeout(() => settle(null), timeoutMs)
      parked.add(settle)
    })
  }

  settle(key: string, dir: string | null): void {
    const parked = this.waiters.get(key)
    if (!parked) {
      return
    }
    this.waiters.delete(key)
    for (const settle of parked) {
      settle(dir)
    }
  }

  releaseAll(): void {
    for (const parked of this.waiters.values()) {
      for (const settle of parked) {
        settle(null)
      }
    }
    this.waiters.clear()
  }
}
