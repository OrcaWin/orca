import type { AgentSessionOwnerBinding } from '../../shared/agent-session-host-authority'
import type { PtyIncarnationId } from '../../shared/pty-incarnation'

export type PtyProcessInfo = {
  id: string
  incarnationId?: PtyIncarnationId
  /** Whether this provider can atomically reject shutdown of a reused PTY id. */
  incarnationBoundShutdown?: boolean | null
  cwd: string
  title: string
  /** Owning worktree when the provider can report it authoritatively. */
  worktreeId?: string
  /** Trusted ORCA_TERMINAL_HANDLE exported into this PTY, when known. */
  terminalHandle?: string
  agentSessionOwners?: AgentSessionOwnerBinding[]
}
