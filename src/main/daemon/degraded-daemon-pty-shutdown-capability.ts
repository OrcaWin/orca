import type {
  PtyProviderProbeOptions,
  PtyShutdownCapabilityProbe
} from '../../shared/pty-shutdown-authority'
import type { IPtyProvider } from '../providers/types'

export function probeDegradedDaemonPtyShutdownCapability(args: {
  options: PtyProviderProbeOptions
  fallback: IPtyProvider
  findOwner: (ptyId: string) => IPtyProvider | null | undefined
}): ReturnType<PtyShutdownCapabilityProbe> {
  const target = args.options.ptyId ? args.findOwner(args.options.ptyId) : args.fallback
  // Why: an unmapped restored ID must not borrow exact-kill authority from fresh local spawns.
  return target?.supportsIncarnationBoundShutdown?.(args.options) ?? null
}
