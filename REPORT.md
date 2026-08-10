# STA-3348 Windows Electron QA evidence

## Environment
- OS: Microsoft Windows NT 10.0.26200.0
- Host: ~15.9 GiB RAM, 8 logical processors (low-spec)
- Node: v24.18.0
- Checkout: OrcaWin/sta-3348-windows-repro @ d776f678d26a74e5a24f2239745f0b4fe52ae4c3
- Worktree: C:\Users\neil\orca\workspaces\orca\sta-3348-windows-repro
- Git Bash: C:\Program Files\Git\bin\bash.exe
- Method: electron skill via playwright-cli CDP (no Computer Use / OS automation)

## Steps
1. Checked out exact PR head d776f678d2 on branch OrcaWin/sta-3348-windows-repro
2. Backed up existing Claude settings (hardcoded C:/Users/neil/... paths)
3. Launched worktree dev build: REMOTE_DEBUGGING_PORT=9333 ORCA_DEV_USER_DATA_PATH=<temp> node config/scripts/run-electron-vite-dev.mjs
4. Attached playwright-cli to http://127.0.0.1:9333
5. Confirmed identity: Orca: OrcaWin/sta-3348-windows-repro @ this worktree
6. After startup reconciliation, re-read %USERPROFILE%\.claude\settings.json
7. Portability probe with Git Bash (file-existence only; no hook execution of product logic beyond path resolve)

## Results
PASS

### Hook command rewrite (user-visible config surface)
- BEFORE: absolute C:/Users/neil/.orca/agent-hooks/claude-hook.cmd
- AFTER: runtime $HOME + OSTYPE branch selecting claude-hook.cmd (Windows Git Bash) vs claude-hook.sh (POSIX)
- AFTER has zero C:/Users/neil hardcoding in managed commands
- statusLine (~/.claude/ccline/ccline) left user-owned

### Portability probe
- portable_home_guard=found under $HOME
- origin_profile=absent
- copied_literal_guard=missing for stale source profile path
- alt_home_guard=found when HOME points at temp destination profile
- stale absolute path still points at origin (documents old bug failure mode)

### Electron
- App launched and rendered empty-workspace shell (isolated user-data profile)
- No UI surface for hook command text; config-file rewrite is the product behavior under test
- Screenshots: app-window-full.png, app-window-viewport.png
