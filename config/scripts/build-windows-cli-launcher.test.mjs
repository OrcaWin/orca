import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const itCrossHost = process.platform === 'win32' ? it.skip : it
const projectRoot = resolve(import.meta.dirname, '../..')
const environmentHarnessSource = join(
  projectRoot,
  'native',
  'windows-cli-launcher',
  'OrcaCliEnvironmentBlockHarness.cs'
)
// Why: cold csc.exe startup exceeds Vitest's 5s unit budget on hosted Windows;
// keep the larger allowance scoped to the real compiler integration test.
function itWindows(name, test) {
  const runner = process.platform === 'win32' ? it : it.skip
  runner(name, { timeout: 15_000 }, test)
}

function buildWindowsExecutable(sourcePath, outputPath) {
  const windowsDirectory = process.env.WINDIR ?? process.env.SystemRoot
  const compilerCandidates = windowsDirectory
    ? [
        join(windowsDirectory, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
        join(windowsDirectory, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe')
      ]
    : []
  const compiler = compilerCandidates.find((candidate) => existsSync(candidate))
  expect(compiler, 'Expected the Windows .NET Framework C# compiler').toBeTruthy()
  return spawnSync(
    compiler,
    ['/nologo', '/target:exe', '/optimize+', '/warnaserror+', `/out:${outputPath}`, sourcePath],
    { cwd: projectRoot, encoding: 'utf8' }
  )
}

function readFixtureEnvironment(stdout) {
  const parsed = JSON.parse(stdout)
  return new Map(parsed.environment.map(({ name, value }) => [name, value]))
}

describe('Windows CLI launcher', () => {
  itCrossHost('fails closed when the Windows launcher cannot be compiled on this host', () => {
    const outputRoot = mkdtempSync(join(tmpdir(), 'orca cross-host launcher '))
    try {
      const result = spawnSync(
        process.execPath,
        ['config/scripts/build-windows-cli-launcher.mjs', '--output', join(outputRoot, 'orca.exe')],
        { cwd: projectRoot, encoding: 'utf8' }
      )

      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('Windows CLI launcher')
      expect(result.stderr).toContain('Windows host')
    } finally {
      rmSync(outputRoot, { recursive: true, force: true })
    }
  })

  itWindows('preserves a multiline argument from PowerShell through the native launcher', () => {
    const appRoot = mkdtempSync(join(tmpdir(), 'orca cli launcher '))
    try {
      const resourcesPath = join(appRoot, 'resources')
      const launcherPath = join(resourcesPath, 'bin', 'orca.exe')
      const cliPath = join(resourcesPath, 'app.asar.unpacked', 'out', 'cli', 'index.js')
      mkdirSync(join(resourcesPath, 'bin'), { recursive: true })
      mkdirSync(dirname(cliPath), { recursive: true })
      copyFileSync(process.execPath, join(appRoot, 'Orca.exe'))
      writeFileSync(
        cliPath,
        `process.stdout.write(JSON.stringify({
  argv: process.argv.slice(2),
  electronRunAsNode: process.env.ELECTRON_RUN_AS_NODE,
  nodeOptions: process.env.NODE_OPTIONS ?? null,
  orcaNodeOptions: process.env.ORCA_NODE_OPTIONS ?? null
}))\n`,
        'utf8'
      )

      const build = spawnSync(
        process.execPath,
        ['config/scripts/build-windows-cli-launcher.mjs', '--output', launcherPath],
        { cwd: projectRoot, encoding: 'utf8' }
      )
      expect(build.status, `${build.stdout}\n${build.stderr}`).toBe(0)

      const body = 'paragraph one line one\nparagraph one line two\n\nparagraph two'
      const powershell = spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          '& $env:ORCA_TEST_LAUNCHER orchestration send --body $env:ORCA_TEST_BODY --json'
        ],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            NODE_OPTIONS: '--no-warnings',
            ORCA_TEST_BODY: body,
            ORCA_TEST_LAUNCHER: launcherPath
          }
        }
      )

      expect(powershell.status, powershell.stderr).toBe(0)
      expect(JSON.parse(powershell.stdout)).toEqual({
        argv: ['orchestration', 'send', '--body', body, '--json'],
        electronRunAsNode: '1',
        nodeOptions: null,
        orcaNodeOptions: '--no-warnings'
      })
    } finally {
      rmSync(appRoot, { recursive: true, force: true })
    }
  })

  itWindows('normalizes case-only keys before launching the packaged CLI', () => {
    const appRoot = mkdtempSync(join(tmpdir(), 'orca cli environment '))
    try {
      const resourcesPath = join(appRoot, 'resources')
      const launcherPath = join(resourcesPath, 'bin', 'orca.exe')
      const cliPath = join(resourcesPath, 'app.asar.unpacked', 'out', 'cli', 'index.js')
      const harnessPath = join(appRoot, 'environment-block-harness.exe')
      mkdirSync(join(resourcesPath, 'bin'), { recursive: true })
      mkdirSync(dirname(cliPath), { recursive: true })
      copyFileSync(process.execPath, join(appRoot, 'Orca.exe'))
      writeFileSync(
        cliPath,
        `const observed = new Set(['PATH', 'ORCA_CASE_TEST', 'ORCA_EMPTY_TEST', 'ORCA_UNICODE_TEST', 'ORCA_CLI_CWD'])
process.stdout.write(JSON.stringify({
  argv: process.argv.slice(2),
  environment: Object.keys(process.env)
    .filter((name) => observed.has(name.toUpperCase()))
    .map((name) => ({ name, value: process.env[name] }))
}))\n`,
        'utf8'
      )

      const launcherBuild = spawnSync(
        process.execPath,
        ['config/scripts/build-windows-cli-launcher.mjs', '--output', launcherPath],
        { cwd: projectRoot, encoding: 'utf8' }
      )
      expect(launcherBuild.status, `${launcherBuild.stdout}\n${launcherBuild.stderr}`).toBe(0)
      const harnessBuild = buildWindowsExecutable(environmentHarnessSource, harnessPath)
      expect(harnessBuild.status, `${harnessBuild.stdout}\n${harnessBuild.stderr}`).toBe(0)

      const runCase = (environmentCase) =>
        spawnSync(
          harnessPath,
          [launcherPath, environmentCase, 'probe', 'value with spaces', '한글 "quoted"'],
          { encoding: 'utf8' }
        )
      const expectedArgs = ['probe', 'value with spaces', '한글 "quoted"']

      const pathPair = runCase('path-pair')
      expect(pathPair.status, pathPair.stderr).toBe(0)
      expect(JSON.parse(pathPair.stdout).argv).toEqual(expectedArgs)
      expect(readFixtureEnvironment(pathPair.stdout)).toEqual(
        new Map([
          ['ORCA_CLI_CWD', 'C:\\WSL Folder\\한글'],
          ['Path', 'C:\\Windows\\System32;C:\\Windows']
        ])
      )

      const generalPair = runCase('general-pair')
      expect(generalPair.status, generalPair.stderr).toBe(0)
      expect(readFixtureEnvironment(generalPair.stdout).get('ORCA_CASE_TEST')).toBe('first')
      expect(readFixtureEnvironment(generalPair.stdout).has('orca_case_test')).toBe(false)

      const emptyPair = runCase('empty-pair')
      expect(emptyPair.status, emptyPair.stderr).toBe(0)
      expect(readFixtureEnvironment(emptyPair.stdout).get('ORCA_EMPTY_TEST')).toBe('')
      expect(readFixtureEnvironment(emptyPair.stdout).has('orca_empty_test')).toBe(false)

      for (const environmentCase of ['only-PATH', 'only-Path', 'unicode-control']) {
        const result = runCase(environmentCase)
        expect(result.status, `${environmentCase}: ${result.stderr}`).toBe(0)
      }
      expect(readFixtureEnvironment(runCase('only-PATH').stdout).get('PATH')).toBe(
        'C:\\single-bin'
      )
      expect(readFixtureEnvironment(runCase('only-Path').stdout).get('Path')).toBe(
        'C:\\single-bin'
      )
      expect(readFixtureEnvironment(runCase('unicode-control').stdout).get('ORCA_UNICODE_TEST')).toBe(
        '한글 value with spaces and "quotes"'
      )
    } finally {
      rmSync(appRoot, { recursive: true, force: true })
    }
  })
})
