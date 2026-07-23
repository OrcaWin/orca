export const PTY_INCARNATION_BOUND_SHUTDOWN_VERSION = 1 as const

export type PtyProviderProbeOptions = {
  signal?: AbortSignal
  ptyId?: string
  deadlineMs?: number
}

export type PtyProviderBooleanProbe = (
  options?: PtyProviderProbeOptions
) => boolean | Promise<boolean>

export type PtyShutdownCapabilityProbe = (
  options?: PtyProviderProbeOptions
) => boolean | null | Promise<boolean | null>

export type PtyShutdownOptions = {
  immediate?: boolean
  keepHistory?: boolean
  deadlineMs?: number
  expectedIncarnationId?: string
  signal?: AbortSignal
}

export function assertPtyShutdownActive(options: PtyShutdownOptions): void {
  if (options.signal?.aborted) {
    throw new Error('client_disconnected')
  }
  if (options.deadlineMs !== undefined && Date.now() >= options.deadlineMs) {
    throw new Error('terminal_tab_close_timeout')
  }
}
