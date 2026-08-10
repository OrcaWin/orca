# STA-3735 post-review Windows Electron QA — PR #13552

**Verdict: PASS (with noted gaps)**  
**Exact head:** `6ac33ff31fc32382dfc734f203039a4bb1bd3e8d`  
**Worktree:** `C:\Users\neil\orca\workspaces\orca\sta-3735-windows-repro`  
**Date:** 2026-08-10  
**Method:** Electron CDP via `playwright-cli` only (no Computer Use / OS UI injection)

## Environment

- Windows Low-spec host (build observed via prior repro notes)
- Dev Orca launched from PR worktree with `REMOTE_DEBUGGING_PORT=9336` and isolated profile under `%TEMP%\orca-sta-3735-qa-*`
- Identity confirmed: `devWorktreeName=sta-3735-windows-repro`, `devBranch=6ac33ff31f`, `devRepoRoot` matches this worktree
- WSL distro available: `Ubuntu`
- Installation payload **not executed** (draft-only) to avoid mutating global agent-skill state

## Focused tests

```text
pnpm exec vitest run --config config/vitest.config.ts \
  src/renderer/src/components/settings/CliSkillRuntimeSetup.test.tsx \
  src/renderer/src/components/settings/AgentSkillSetupPanel.test.tsx \
  src/renderer/src/components/feature-tips/CliSkillSetupTerminal.test.tsx \
  src/renderer/src/components/settings/CliSection.test.tsx \
  src/renderer/src/components/onboarding/FeatureSetupInlineTerminal.test.tsx
```

**Result:** 5 files passed — **58 passed, 1 skipped**

Includes post-review cases:

- missing-WSL host repair fallback (`CliSkillSetupTerminal`)
- open-terminal freeze of command/runtime/shell (`AgentSkillSetupPanel`)
- retry snapshot refresh to current runtime (`AgentSkillSetupPanel`)
- bare copy vs PowerShell setup wrap (`CliSkillRuntimeSetup`)

## Electron / CDP end-to-end

### Surface used

Settings → **Orchestration** skill panel (`AgentSkillSetupPanel`), with global default runtime set to **WSL / Ubuntu**.

**Gap:** Settings → General → **Orca CLI → Agent skills → CLI skill** is **hidden in this electron-vite dev launch** because `cli.getInstallStatus()` returns `unsupportedReason: launch_mode_unavailable` (`Development mode uses a generated launcher for validation only.`). That gates `!isBrowserManaged` and omits the Agent skills block. Orchestration skill uses the same `AgentSkillSetupPanel` + command builders, so it is a valid substitute for the shared fix surface.

### Results

| Check | Result | Evidence |
| --- | --- | --- |
| Copy command is bare POSIX `npx` (no PowerShell `& { ... }`) | **PASS** | Clipboard: `npx skills add https://github.com/stablyai/orca --skill orchestration --global` (len 78). Dialog shows same bare string. Screenshots `02-*.png`. |
| Bare command parses in Ubuntu Bash | **PASS** | `wsl -d Ubuntu -- bash -n -c "<bare command>"` → exit `0`. PowerShell-wrap sample fails with ``syntax error near unexpected token `&'`` exit `2`. |
| Install opens PowerShell setup terminal | **PASS** | PTY `ephemeral-setup-terminal:settings-orchestration-skill-terminal@@…`, `getForegroundProcess` → `pwsh.exe`. |
| Setup execution draft uses WSL wrap for Ubuntu | **PASS** | Buffer head: `PS C:\Users\neil> & { $PSNativeCommandArgumentPassing = 'Legacy'; wsl.exe -d 'Ubuntu' -- sh -c 'eval ...`. Visible `<code>` stays bare `npx ... orchestration --global`. |
| Open terminal freezes command/runtime/shell when settings runtime changes | **PASS** | While draft open, settings switched Ubuntu → Fedora. Buffer **still** `wsl.exe -d 'Ubuntu'`; no `Fedora` in buffer. Shell stayed `pwsh.exe`. |
| Missing / unavailable WSL distro surfaces repair path | **PASS (UI)** | With default runtime WSL/`Fedora` (not installed), Orchestration showed: *“The selected WSL distro is unavailable. Choose an available distro or switch this project to Windows.”* and Install disabled. Screenshot `05-*.png`. |
| Missing-WSL **host setup-terminal fallback** (`cmd.exe /d /s /c` without `wsl.exe`) | **PASS (unit) / partial live** | Covered by `CliSkillSetupTerminal.test.tsx`. Live path is the feature-tip auto-paste terminal, not fully exercised here because Orchestration **disables** Install instead of auto-opening a host fallback terminal. |
| Retry snapshot refresh to current runtime | **PASS (unit) / partial live** | Fully covered by `captures the current runtime when retrying a failed command`. Live Retry UI was not cleanly reached: killing the PTY during a Fedora unavailable state did not present Retry (Install disabled by unavailable distro). |
| Installation execution | **Not run (intentional)** | Draft only; no Enter on install payload. |

## Screenshots

- `qa-evidence/01-orchestration-skill-wsl-ubuntu.png`
- `qa-evidence/02-copy-dialog-bare-npx-orchestration.png`
- `qa-evidence/03-setup-terminal-open-with-draft.png`
- `qa-evidence/04-setup-terminal-after-renderer-tweak.png`
- `qa-evidence/05-missing-wsl-distro-fedora-disabled.png`
- `qa-evidence/06-final-setup-terminal-ubuntu-wrap.png`

## Residual gaps (not regressions of this PR)

1. **Dev launch hides Settings CLI skill section** via `launch_mode_unavailable` — cannot re-validate the exact General → Orca CLI → CLI skill Install control in electron-vite without a production/packaged build of this head.
2. **Retry live path** not re-shown after forced PTY kill under unavailable-distro conditions; unit coverage is strong.
3. **Feature-tip CliSkillSetupTerminal live host fallback** not opened in Feature Tips UI; unit coverage is strong.
4. Install payload not executed end-to-end (by design for this QA).

## Conclusion

At head `6ac33ff31fc32382dfc734f203039a4bb1bd3e8d`, the reviewed fixes behave correctly on Windows for the shared skill setup path:

- copied command is shell-native bare `npx`
- Orca-owned setup terminal remains PowerShell + `wsl.exe -d '<distro>'` for WSL
- open terminal stays pinned when runtime settings change
- focused Vitest suites for copy/wrap/pin/retry/repair-fallback all pass

No product code was modified.
