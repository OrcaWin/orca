// One guest install pass, its repeat policy, and what the pass produces: the managed
// agent hooks, then OpenCode's status plugin and the config-overlay dir the guest
// materialized for it. Keyed by distro rather than by relay run — the overlay is
// instance-keyed and lives on the distro's persistent filesystem, so it outlives a relay
// crash and dropping it would blank status on panes spawned mid-relaunch. The manager
// owns WHEN a relay runs; this owns what each run installs and reports.
import type { SshChannelMultiplexer } from '../ssh/ssh-channel-multiplexer'
import { installWslGuestHooks } from './wsl-hook-fs-adapter'
import { requestGuestOpenCodeOverlayDir } from './wsl-guest-plugin-install'
import { REINSTALL_MIN_INTERVAL_MS, type WslHookRelayManagerDeps } from './wsl-hook-relay-deps'
import { WslOverlaySpawnWaiters } from './wsl-overlay-spawn-waiters'

export type WslGuestInstallPass = {
  /** Distro key, shared with the manager's state map. */
  key: string
  distro: string
  mux: SshChannelMultiplexer
  guestHome: string
  /** False once this pass's relay link has been replaced — its answer is then stale. */
  isCurrent: () => boolean
}

export class WslGuestInstallCycle {
  private overlayDirs = new Map<string, string>()
  private lastRunAt = new Map<string, number>()
  private waiters = new WslOverlaySpawnWaiters()

  constructor(private deps: WslHookRelayManagerDeps) {}

  /** Guest OpenCode overlay dir for this distro, or null until a pass reports one. */
  overlayDir(key: string): string | null {
    return this.overlayDirs.get(key) ?? null
  }

  async run(pass: WslGuestInstallPass): Promise<void> {
    this.lastRunAt.set(pass.key, Date.now())
    await installWslGuestHooks({
      mux: pass.mux,
      guestHome: pass.guestHome,
      distro: pass.distro,
      installHooks: this.deps.installHooks,
      warn: this.deps.warn
    })
    // Why: ship OpenCode's status plugin and record the guest overlay dir the PTY env
    // points OPENCODE_CONFIG_DIR at; identity-guarded against teardown.
    const overlay = await requestGuestOpenCodeOverlayDir(pass.mux, this.deps, pass.distro)
    if (pass.isCurrent() && overlay.kind !== 'unavailable') {
      // Clearing on 'none' matters: a rebuild that failed after wiping leaves the dir
      // present but plugin-less, and advertising it would hide the user's own config.
      if (overlay.kind === 'dir') {
        this.overlayDirs.set(pass.key, overlay.dir)
      } else {
        this.overlayDirs.delete(pass.key)
      }
    }
    // Why: 'unavailable' is an answer too — an older guest bundle never reports a dir, so
    // a parked spawn must be released here rather than wait out its whole timeout.
    this.release(pass.key)
  }

  /** Re-runs a pass once the last one is old enough. Why repeat at all: the installers
   *  are byte-equality idempotent and pick up configs that appear after first install —
   *  Codex's runtime-home config.toml is seeded by the launch path, so its hook-trust
   *  entries can only be written once that file exists. Also re-ships the plugin source,
   *  so a mid-session Orca upgrade refreshes it. */
  async maybeRepeat(pass: WslGuestInstallPass | null): Promise<void> {
    if (
      !pass ||
      pass.mux.isDisposed() ||
      Date.now() - (this.lastRunAt.get(pass.key) ?? 0) < REINSTALL_MIN_INTERVAL_MS
    ) {
      return
    }
    try {
      await this.run(pass)
    } catch (err) {
      this.deps.warn(
        `[agent-hooks] WSL hook reinstall for '${pass.distro}' failed: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  /** Park a spawn until this distro's next report, bounded by `timeoutMs`. */
  park(key: string, timeoutMs: number): Promise<string | null> {
    return this.waiters.park(key, timeoutMs)
  }

  release(key: string): void {
    this.waiters.settle(key, this.overlayDir(key))
  }

  releaseAll(): void {
    this.waiters.releaseAll()
  }
}
