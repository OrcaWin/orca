import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { dirname } from 'node:path'
import { z } from 'zod'
import type { TerminalExplicitCloseOperation } from '../shared/types'
import { terminalExplicitCloseOperationSchema } from '../shared/workspace-session-schema'

type TerminalExplicitCloseSurface = TerminalExplicitCloseOperation['surfaces'][number]

export type TerminalExplicitCloseWalEntry =
  | { phase: 'active'; operation: TerminalExplicitCloseOperation }
  | {
      phase: 'confirmed'
      operation: TerminalExplicitCloseOperation
      retiredSurfaces: TerminalExplicitCloseSurface[]
      topologyRevision: number
    }

const terminalExplicitCloseSurfaceSchema =
  terminalExplicitCloseOperationSchema.shape.surfaces.element
const terminalExplicitCloseWalSchema = z.object({
  version: z.literal(1),
  entriesByHostId: z.record(
    z.string(),
    z.record(
      z.string(),
      z.discriminatedUnion('phase', [
        z.object({ phase: z.literal('active'), operation: terminalExplicitCloseOperationSchema }),
        z.object({
          phase: z.literal('confirmed'),
          operation: terminalExplicitCloseOperationSchema,
          retiredSurfaces: z.array(terminalExplicitCloseSurfaceSchema),
          topologyRevision: z.number().int().nonnegative()
        })
      ])
    )
  )
})

type TerminalExplicitCloseWalState = z.infer<typeof terminalExplicitCloseWalSchema>

const EMPTY_WAL: TerminalExplicitCloseWalState = { version: 1, entriesByHostId: {} }

export function getTerminalExplicitCloseWalPath(dataFile: string): string {
  return `${dataFile}.terminal-close-wal.json`
}

export class TerminalExplicitCloseWal {
  private state: TerminalExplicitCloseWalState = EMPTY_WAL
  private readonly path: string
  private loadError: Error | null = null

  constructor(dataFile: string) {
    this.path = getTerminalExplicitCloseWalPath(dataFile)
    if (!existsSync(this.path)) {
      return
    }
    try {
      this.state = terminalExplicitCloseWalSchema.parse(JSON.parse(readFileSync(this.path, 'utf8')))
    } catch (error) {
      this.loadError = error instanceof Error ? error : new Error(String(error))
      console.error(
        '[persistence] Terminal close WAL is unreadable; exact closes are disabled:',
        error
      )
    }
  }

  entries(): { hostId: string; entry: TerminalExplicitCloseWalEntry }[] {
    const entries = Object.entries(this.state.entriesByHostId).flatMap(([hostId, entries]) =>
      Object.values(entries).map((entry) => ({ hostId, entry }))
    )
    return entries.sort((left, right) => {
      if (left.entry.phase !== right.entry.phase) {
        return left.entry.phase === 'confirmed' ? -1 : 1
      }
      if (left.entry.phase === 'confirmed' && right.entry.phase === 'confirmed') {
        return (
          left.entry.topologyRevision - right.entry.topologyRevision ||
          left.entry.operation.id.localeCompare(right.entry.operation.id)
        )
      }
      return left.entry.operation.id.localeCompare(right.entry.operation.id)
    })
  }

  hasConfirmed(): boolean {
    return this.entries().some(({ entry }) => entry.phase === 'confirmed')
  }

  setActive(hostId: string, operation: TerminalExplicitCloseOperation): void {
    this.updateEntry(hostId, operation.id, { phase: 'active', operation })
  }

  setConfirmed(
    hostId: string,
    operation: TerminalExplicitCloseOperation,
    retiredSurfaces: readonly TerminalExplicitCloseSurface[],
    topologyRevision: number
  ): void {
    this.updateEntry(hostId, operation.id, {
      phase: 'confirmed',
      operation,
      retiredSurfaces: [...retiredSurfaces],
      topologyRevision
    })
  }

  compactConfirmed(): void {
    this.assertWritable()
    const entriesByHostId: TerminalExplicitCloseWalState['entriesByHostId'] = {}
    for (const [hostId, entries] of Object.entries(this.state.entriesByHostId)) {
      const active = Object.fromEntries(
        Object.entries(entries).filter(([, entry]) => entry.phase === 'active')
      )
      if (Object.keys(active).length > 0) {
        entriesByHostId[hostId] = active
      }
    }
    const next = { version: 1 as const, entriesByHostId }
    this.persist(next)
    this.state = next
  }

  private updateEntry(
    hostId: string,
    operationId: string,
    entry: TerminalExplicitCloseWalEntry
  ): void {
    this.assertWritable()
    const next: TerminalExplicitCloseWalState = {
      version: 1,
      entriesByHostId: {
        ...this.state.entriesByHostId,
        [hostId]: {
          ...this.state.entriesByHostId[hostId],
          [operationId]: entry
        }
      }
    }
    this.persist(next)
    this.state = next
  }

  private assertWritable(): void {
    if (this.loadError) {
      throw new Error('terminal_close_journal_unavailable', { cause: this.loadError })
    }
  }

  private persist(next: TerminalExplicitCloseWalState): void {
    const dir = dirname(this.path)
    mkdirSync(dir, { recursive: true })
    if (Object.keys(next.entriesByHostId).length === 0) {
      if (existsSync(this.path)) {
        unlinkSync(this.path)
        this.syncDirectory(dir)
      }
      return
    }
    const tmpPath = `${this.path}.${process.pid}.${Date.now()}.tmp`
    let renamed = false
    try {
      const fd = openSync(tmpPath, 'w', 0o600)
      try {
        writeFileSync(fd, JSON.stringify(next), 'utf8')
        fsyncSync(fd)
      } finally {
        closeSync(fd)
      }
      renameSync(tmpPath, this.path)
      renamed = true
      this.syncDirectory(dir)
    } finally {
      if (!renamed) {
        try {
          unlinkSync(tmpPath)
        } catch {
          // Best-effort cleanup preserves the original write failure.
        }
      }
    }
  }

  private syncDirectory(dir: string): void {
    if (process.platform === 'win32') {
      return
    }
    const fd = openSync(dir, 'r')
    try {
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
  }
}
