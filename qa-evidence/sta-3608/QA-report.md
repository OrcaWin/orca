# STA-3608 Windows low-spec Electron QA (PR #13443)

**Verdict: PASS**

## Environment
| Item | Value |
| --- | --- |
| Machine | Windows Low spec |
| OS | Microsoft Windows NT 10.0.26200.0 (Windows 11 Pro build 26200) |
| CPU | Intel Core i7-6700T @ 2.80 GHz |
| RAM | 15.89 GiB |
| PR head | `ececf08d9787799cf03c38c973e8a42e7eec2d4c` (`fix(claude): harden managed hook invocation`) |
| Branch | `OrcaWin/sta-3608-windows-repro` |
| Electron build | Orca `1.4.178-rc.2` preview via electron-vite CDP |
| Claude Code | `2.1.223` |
| Git | user Git on host |

## Scope validated
User-visible Windows managed Claude hook path/cmd console flash fix and intended headless hook-launch behavior only. No product code edits. No Computer Use / OS UI automation.

## Method
1. Checked out exact PR head `ececf08d97` on branch `OrcaWin/sta-3608-windows-repro`.
2. Built electron-vite with store exposure for CDP (`VITE_EXPOSE_STORE=true`).
3. Ran Electron/CDP harness `artifacts/sta-3608/validate-fixed-hooks-qa.mjs` (preview + Playwright `connectOverCDP`, mock Anthropic, process-start sampler).
4. Prompt: *Use the Read tool exactly once to read package.json… reply with only DONE.*

## Results
| Check | Result |
| --- | --- |
| Managed hooks installed | **11/11** |
| Headless exec form (`conhost.exe --headless` + `cmd.exe /d /c` + `claude-hook.cmd`) | **11/11** |
| `bash.exe` hook roots during turn | **0** |
| Observed headless chains | **5×** `claude.exe -> conhost.exe -> cmd.exe` |
| Hook posts (`curl.exe`) | **3** `cmd.exe -> curl.exe` chains |
| Deterministic turn completed | **DONE** in terminal; mock `/v1/messages` call count ≥ 2 |
| Harness verdict | **true** |

Sample hook definition:
`json
{
  "type": "command",
  "command": "C:\\WINDOWS\\System32\\conhost.exe",
  "args": ["--headless", "C:\\WINDOWS\\System32\\cmd.exe", "/d", "/c", "...\\claude-hook.cmd"],
  "timeout": 10
}
`

## Evidence (this run)
- `artifacts/sta-3608/fixed-2026-08-10T07-19-37-950Z-validation.json`
- `artifacts/sta-3608/fixed-2026-08-10T07-19-37-950Z-process-starts.ndjson`
- `artifacts/sta-3608/fixed-2026-08-10T07-19-37-950Z-mock-requests.ndjson`
- `artifacts/sta-3608/fixed-2026-08-10T07-19-37-950Z-running.png` (uncropped Electron window, turn in progress)
- `artifacts/sta-3608/fixed-2026-08-10T07-19-37-950Z-complete.png` (uncropped Electron window, DONE)

## Notes / residual risk
- CDP captures Orca web contents only; momentary top-level console HWND flash cannot be pixel-proved from Electron. Process evidence shows hooks use `conhost --headless` (windowless) rather than ordinary Bash+conhost roots that caused the flash.
- First scoped sampler pass missed short-lived `curl.exe`; re-run with global process capture confirmed curl posts. Product path itself is headless on both runs (0 bash, 11 headless definitions).
- Residual: external flash not photographable via CDP; agent-status last-status file may lag short turns under isolation (not the STA-3608 flash bug).
