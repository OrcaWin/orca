import {
  assertPtyShutdownActive,
  PTY_INCARNATION_BOUND_SHUTDOWN_VERSION
} from '../../shared/pty-shutdown-authority'
import type {
  PtyProviderProbeOptions,
  PtyShutdownOptions
} from '../../shared/pty-shutdown-authority'
import type { SshChannelMultiplexer } from '../ssh/ssh-channel-multiplexer'

// Why: sequential relay teardown calls share one absolute budget; convert it only when dispatching.
export function sshPtyRelayTimeoutOptions(
  deadlineMs: number | undefined
): { timeoutMs: number } | undefined {
  return deadlineMs === undefined ? undefined : { timeoutMs: Math.max(1, deadlineMs - Date.now()) }
}

export class SshPtyShutdownCapability {
  private result: Promise<boolean | null> | null = null

  constructor(private readonly mux: SshChannelMultiplexer) {}

  async supports(options: PtyProviderProbeOptions = {}): Promise<boolean | null> {
    if (options.signal?.aborted) {
      return null
    }
    const existing = this.result
    if (existing) {
      const supported = await existing
      return options.signal?.aborted ? null : supported
    }
    const probe = this.mux
      .request('pty.getCapabilities', undefined, sshPtyRelayTimeoutOptions(options.deadlineMs))
      .then(
        (value) => {
          if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return null
          }
          return (
            (value as { shutdownIncarnationVersion?: number }).shutdownIncarnationVersion ===
            PTY_INCARNATION_BOUND_SHUTDOWN_VERSION
          )
        },
        (error) => ((error as { code?: unknown } | null)?.code === -32601 ? false : null)
      )
    this.result = probe
    const supported = await probe
    if (supported !== true && this.result === probe) {
      // Why: a disconnect or in-place relay upgrade must be able to replace a negative probe.
      this.result = null
    }
    return options.signal?.aborted ? null : supported
  }
}

export async function requestSshPtyShutdown(args: {
  mux: SshChannelMultiplexer
  relayPtyId: string
  options: PtyShutdownOptions
  capability: SshPtyShutdownCapability
}): Promise<void> {
  const { options } = args
  assertPtyShutdownActive(options)
  if (options.expectedIncarnationId) {
    const supported = await args.capability.supports({
      deadlineMs: options.deadlineMs,
      signal: options.signal
    })
    assertPtyShutdownActive(options)
    if (!supported) {
      throw new Error('pty_incarnation_shutdown_unsupported')
    }
  }
  assertPtyShutdownActive(options)
  await args.mux.request(
    'pty.shutdown',
    {
      id: args.relayPtyId,
      immediate: options.immediate ?? false,
      keepHistory: options.keepHistory ?? false,
      ...(options.expectedIncarnationId
        ? { expectedIncarnationId: options.expectedIncarnationId }
        : {})
    },
    sshPtyRelayTimeoutOptions(options.deadlineMs)
  )
}
