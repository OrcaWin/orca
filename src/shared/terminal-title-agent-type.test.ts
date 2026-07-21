import { describe, expect, it } from 'vitest'
import { getAgentLabel as getSharedAgentLabel } from './agent-title-identity'
import { isOpenCodeNativeTitle } from './opencode-terminal-title'
import {
  getAgentLabel as getTerminalAgentLabel,
  isClaudeAgent,
  isGrokRotatingWorkingTitle,
  resolveExplicitTerminalTitleAgentType,
  resolveTerminalTitleAgentType
} from './terminal-title-agent-type'

describe('isGrokRotatingWorkingTitle', () => {
  it('matches Grok working frames regardless of the rotating middle text', () => {
    expect(isGrokRotatingWorkingTitle('⠋ - Waiting for response… - grok')).toBe(true)
    expect(isGrokRotatingWorkingTitle('⠴ - Thinking - grok')).toBe(true)
    expect(isGrokRotatingWorkingTitle('⠦ - Sleep 2s then echo hello… - grok')).toBe(true)
    // Collapsed/stable form must stay matched so re-normalization is idempotent.
    expect(isGrokRotatingWorkingTitle('⠋ grok')).toBe(true)
    expect(isGrokRotatingWorkingTitle('⠋ Grok')).toBe(true)
  })

  it('ignores non-working, non-Grok, and lookalike titles', () => {
    expect(isGrokRotatingWorkingTitle('grok')).toBe(false) // idle bare name, no spinner
    expect(isGrokRotatingWorkingTitle('Fix the auth bug - grok')).toBe(false) // session title, no spinner
    expect(isGrokRotatingWorkingTitle('⠋ debugging grok - claude')).toBe(false) // trailing name is another agent
    expect(isGrokRotatingWorkingTitle('⠋ ~/grok-scratch/ready')).toBe(false) // path fragment, not a trailing token
    expect(isGrokRotatingWorkingTitle('⠋ grokking the plan')).toBe(false) // "grok" not a whole trailing token
    expect(isGrokRotatingWorkingTitle('⠋ Codex')).toBe(false)
    // Task text ending in "grok" is not the Grok frame shape "spinner - phrase - grok".
    expect(isGrokRotatingWorkingTitle('⠋ wire up grok')).toBe(false)
    expect(isGrokRotatingWorkingTitle('⠋ Codex is thinking about grok')).toBe(false)
    expect(isGrokRotatingWorkingTitle('⠋ support for Grok')).toBe(false)
    // Why: Claude/Codex braille + task can end with " - grok" without the
    // post-spinner delimiter that marks a real Grok Build frame.
    expect(isGrokRotatingWorkingTitle('⠋ fix the flaky suite - grok')).toBe(false)
    expect(isGrokRotatingWorkingTitle('⠋ review grok integration - claude')).toBe(false)
  })
})

describe('resolveExplicitTerminalTitleAgentType', () => {
  it('maps explicit product-name titles to their TuiAgent id', () => {
    expect(resolveExplicitTerminalTitleAgentType('✳ Claude Code')).toBe('claude')
    expect(resolveExplicitTerminalTitleAgentType('⠋ Codex')).toBe('codex')
    expect(resolveExplicitTerminalTitleAgentType('✦ Gemini CLI')).toBe('gemini')
    expect(resolveExplicitTerminalTitleAgentType('MiMo Code')).toBe('mimo-code')
    expect(resolveExplicitTerminalTitleAgentType('⠋ OpenClaude')).toBe('openclaude')
    expect(resolveExplicitTerminalTitleAgentType('OMP')).toBe('omp')
  })

  it('treats Claude generic status prefixes as activity-only, not identity', () => {
    expect(resolveExplicitTerminalTitleAgentType('✳ investigating startup')).toBeNull()
    expect(resolveExplicitTerminalTitleAgentType('⠸ investigating startup')).toBeNull()
    expect(resolveExplicitTerminalTitleAgentType('. Compare Opencode Vs Orca')).toBeNull()
    expect(resolveExplicitTerminalTitleAgentType('* Review Codex behavior')).toBeNull()
  })

  it('resolves OpenCode native abbreviated session titles before task-text identities', () => {
    expect(resolveExplicitTerminalTitleAgentType('OC | Understand about the plugin')).toBe(
      'opencode'
    )
    expect(resolveExplicitTerminalTitleAgentType('OC | Compare Codex and Claude')).toBe('opencode')
    // Why: Gemini glyphs inside OpenCode session text must not rebrand the tab.
    expect(resolveExplicitTerminalTitleAgentType('OC | ✦ Gemini CLI')).toBe('opencode')
    expect(getSharedAgentLabel('OC | Compare Codex and Claude')).toBe('OpenCode')
    expect(getSharedAgentLabel('OC | ✦ Gemini CLI')).toBe('OpenCode')
    expect(resolveExplicitTerminalTitleAgentType('tmux | OC | ses_123')).toBe('opencode')
    expect(resolveExplicitTerminalTitleAgentType('OC|compact-session')).toBe('opencode')
    expect(resolveExplicitTerminalTitleAgentType('oc | Understand about the plugin')).toBeNull()
  })

  it('does not find an OpenCode marker inside another agent task title', () => {
    expect(isOpenCodeNativeTitle('⠋ Fix foo | OC | bar')).toBe(false)
    expect(resolveExplicitTerminalTitleAgentType('⠋ Fix foo | OC | bar')).toBeNull()
  })

  // Why: adversarial coverage — native OC must not steal Claude/Codex/Cursor/
  // Gemini/Pi identity, and those agents must keep resolving when titled normally.
  it('keeps other agents classified correctly alongside OpenCode native titles', () => {
    expect(resolveExplicitTerminalTitleAgentType('✳ Claude Code')).toBe('claude')
    expect(resolveExplicitTerminalTitleAgentType('⠋ Codex')).toBe('codex')
    expect(resolveExplicitTerminalTitleAgentType('✦ Gemini CLI')).toBe('gemini')
    expect(resolveExplicitTerminalTitleAgentType('Cursor Agent')).toBe('cursor')
    expect(resolveExplicitTerminalTitleAgentType('Pi ready')).toBe('pi')
    expect(resolveExplicitTerminalTitleAgentType('OpenCode ready')).toBe('opencode')
    expect(resolveTerminalTitleAgentType('OC | ⠋ implementing the feature')).toBe('opencode')
    expect(isClaudeAgent('OC | ⠋ implementing the feature')).toBe(false)
    expect(isClaudeAgent('OC | Understand about the plugin')).toBe(false)
  })

  it('still resolves Claude when the title explicitly names Claude', () => {
    expect(resolveExplicitTerminalTitleAgentType('. Claude Code compare Opencode')).toBe('claude')
  })

  it('returns null for plain shell and unknown titles', () => {
    expect(resolveExplicitTerminalTitleAgentType('Terminal 1')).toBeNull()
    expect(resolveExplicitTerminalTitleAgentType('zsh')).toBeNull()
  })

  // Why: `cursor` is ordinary editor vocabulary, so a name token is not identity.
  // A Claude/Codex tab working on cursor code must not commit to Cursor identity.
  it('resolves Cursor by its identity titles, never a bare cursor token', () => {
    expect(resolveExplicitTerminalTitleAgentType('Cursor Agent')).toBe('cursor')
    expect(resolveExplicitTerminalTitleAgentType('⠋ Cursor Agent')).toBe('cursor')
    expect(resolveExplicitTerminalTitleAgentType('Cursor ready')).toBe('cursor')
    expect(resolveExplicitTerminalTitleAgentType('Cursor - action required')).toBe('cursor')
    // A Claude tab whose task text mentions a text cursor is not Cursor identity.
    expect(
      resolveExplicitTerminalTitleAgentType('⠋ preserve cursor visibility across replays')
    ).toBeNull()
    expect(resolveExplicitTerminalTitleAgentType('~/cursor-rules')).toBeNull()
  })
})

describe('resolveTerminalTitleAgentType', () => {
  // Why: the activity facet keeps Claude's braille prefix as Claude — but only when
  // the "cursor" it mentions is task text, not Cursor's own identity title.
  it('labels cursor-mentioning agent tabs by their true agent, real Cursor as cursor', () => {
    expect(resolveTerminalTitleAgentType('⠋ Cursor Agent')).toBe('cursor')
    expect(resolveTerminalTitleAgentType('Cursor Agent')).toBe('cursor')
    expect(resolveTerminalTitleAgentType('Cursor ready')).toBe('cursor')
    expect(resolveTerminalTitleAgentType('Cursor - action required')).toBe('cursor')
    expect(resolveTerminalTitleAgentType('⠋ preserve cursor visibility across replays')).toBe(
      'claude'
    )
    expect(resolveTerminalTitleAgentType('⠋ Codex: fix cursor offsets')).toBe('codex')
  })
})

// Why: getAgentLabel lives in two parallel copies (terminal-title-agent-type.ts and
// agent-title-identity.ts). Assert BOTH so a fix landing in one but not the other is caught.
const bothAgentLabelCopies: [string, (title: string) => string | null][] = [
  ['terminal-title-agent-type', getTerminalAgentLabel],
  ['agent-title-identity', getSharedAgentLabel]
]

describe.each(bothAgentLabelCopies)(
  'getAgentLabel (%s) — Windows .exe suffix (bug #8302/2)',
  (_name, getAgentLabel) => {
    it('detects Hermes/Droid/Antigravity titles carrying a Windows executable suffix', () => {
      // Why: Windows launcher titles surface `hermes.exe`; without the suffix these fell
      // through to isClaudeAgent's braille heuristic and mis-showed the Claude icon.
      expect(getAgentLabel('hermes.exe')).toBe('Hermes')
      expect(getAgentLabel('⠋ hermes.exe')).toBe('Hermes')
      expect(getAgentLabel('hermes.cmd')).toBe('Hermes')
      expect(getAgentLabel('droid.exe')).toBe('Droid')
      expect(getAgentLabel('⠋ droid.bat')).toBe('Droid')
      expect(getAgentLabel('agy.exe')).toBe('Antigravity')
    })

    it('does not mint Droid/Hermes identity from lookalikes or path fragments', () => {
      // `android.exe` embeds "droid" but is not a token boundary; paths carry the name too.
      expect(getAgentLabel('android.exe')).toBeNull()
      expect(getAgentLabel('~/hermes/working')).toBeNull()
      expect(getAgentLabel('hermes.zip')).toBeNull()
    })
  }
)

describe.each(bothAgentLabelCopies)(
  'getAgentLabel (%s) — Kimi/Qwen title detection (bug #8302/3)',
  (_name, getAgentLabel) => {
    it('recognizes Kimi/Qwen titles before the Claude braille fallback', () => {
      expect(getAgentLabel('kimi')).toBe('Kimi')
      expect(getAgentLabel('⠋ Kimi')).toBe('Kimi')
      expect(getAgentLabel('qwen')).toBe('Qwen')
      expect(getAgentLabel('⠋ Qwen')).toBe('Qwen')
    })

    it('token-matches so unrelated words do not mint Kimi/Qwen identity', () => {
      // No token boundary and no other signal → no identity.
      expect(getAgentLabel('~/kimi-notes/plan')).toBeNull()
      // A Claude braille task mentioning "qwen…" stays Claude; the token never matches.
      expect(getAgentLabel('⠋ qwenching the build')).not.toBe('Qwen')
      expect(getAgentLabel('⠋ qwenching the build')).toBe('Claude Code')
    })
  }
)

describe('resolveTerminalTitleAgentType — new agents (bug #8302)', () => {
  it('maps Kimi/Qwen titles to their TuiAgent ids', () => {
    expect(resolveTerminalTitleAgentType('⠋ Kimi')).toBe('kimi')
    expect(resolveTerminalTitleAgentType('⠋ Qwen')).toBe('qwen-code')
  })

  it('maps Windows-suffixed Hermes/Droid/Antigravity titles to their TuiAgent ids', () => {
    expect(resolveTerminalTitleAgentType('hermes.exe')).toBe('hermes')
    expect(resolveTerminalTitleAgentType('droid.exe')).toBe('droid')
    expect(resolveTerminalTitleAgentType('agy.exe')).toBe('antigravity')
  })
})

// Why: this module carries its own isClaudeAgent copy parallel to agent-title-identity.ts;
// both got the identical isCursorAgentTitle guard, so pin this copy directly to catch drift.
describe('isClaudeAgent', () => {
  it('excludes real Cursor identity titles, keeps cursor-mentioning Claude braille titles', () => {
    expect(isClaudeAgent('⠋ Cursor Agent')).toBe(false)
    expect(isClaudeAgent('Cursor ready')).toBe(false)
    expect(isClaudeAgent('⠋ preserve cursor visibility across replays')).toBe(true)
    expect(isClaudeAgent('⠋ OpenClaude')).toBe(false)
  })
})
