import { describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

vi.mock('electron', () => ({ shell: { openExternal: vi.fn() }, app: { getPath: () => os.tmpdir() } }))
vi.mock('../../store/settings.store', () => ({
  settingsStore: { get: vi.fn(), set: vi.fn() },
  getLocalEnvMirrorBackup: vi.fn(),
  setLocalEnvMirrorBackup: vi.fn()
}))

import {
  isWingetSuccess,
  shouldRetryWingetElevated,
  parseInstallerExitCode,
  pipIndexNeedsTrustedHost,
  readDockerDaemonJson,
  writeDockerDaemonJson
} from '../local-env.service'

const run = (code: number | null, output = '', timedOut = false) => ({ code, output, timedOut })

describe('winget result classification', () => {
  it('never elevates after a timeout', () => {
    expect(shouldRetryWingetElevated(run(null, '', true))).toBe(false)
    expect(shouldRetryWingetElevated(run(5, '', true))).toBe(false)
  })

  it('elevates only for permission-type codes', () => {
    expect(shouldRetryWingetElevated(run(0x8a150019 | 0))).toBe(true) // COMMAND_REQUIRES_ADMIN (signed)
    expect(shouldRetryWingetElevated(run(5))).toBe(true)
    expect(shouldRetryWingetElevated(run(0x80070005))).toBe(true)
    expect(shouldRetryWingetElevated(run(0x8a150006, 'Installer failed with exit code: 1603'))).toBe(true)
    expect(shouldRetryWingetElevated(run(0x8a150006, 'Installer failed with exit code: 1925'))).toBe(true)
    // generic failures: no elevation
    expect(shouldRetryWingetElevated(run(0x8a150006, 'Installer failed with exit code: 2'))).toBe(false)
    expect(shouldRetryWingetElevated(run(0x8a15010f))).toBe(false)
    expect(shouldRetryWingetElevated(run(1))).toBe(false)
  })

  it('treats reboot-required as success', () => {
    expect(isWingetSuccess(run(0))).toBe(true)
    expect(isWingetSuccess(run(0x8a15002b))).toBe(true)
    expect(isWingetSuccess(run(3010))).toBe(true)
    expect(isWingetSuccess(run(1641))).toBe(true)
    expect(isWingetSuccess(run(0x8a150109 | 0))).toBe(true)
    expect(isWingetSuccess(run(0x8a150006, 'Installer failed with exit code: 3010'))).toBe(true)
    expect(isWingetSuccess(run(0x8a15010a))).toBe(false) // reboot required *before* install
    expect(isWingetSuccess(run(0, '', true))).toBe(false)
  })

  it('parses installer exit codes', () => {
    expect(parseInstallerExitCode('Installer failed with exit code: 1603')).toBe(1603)
    expect(parseInstallerExitCode('exit code 0x80070005')).toBe(0x80070005)
    expect(parseInstallerExitCode('nothing')).toBeNull()
  })
})

describe('pip mirror', () => {
  it('sets trusted-host only for http index URLs', () => {
    expect(pipIndexNeedsTrustedHost('https://mirrors.tuna.tsinghua.edu.cn/pypi/web/simple')).toBe(false)
    expect(pipIndexNeedsTrustedHost('http://mirror.local/simple')).toBe(true)
    expect(pipIndexNeedsTrustedHost('not a url')).toBe(false)
  })
})

describe('docker daemon.json', () => {
  const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'cb-daemon-'))

  it('aborts on unparsable / non-object JSON instead of returning {}', () => {
    const dir = tmp()
    const p = path.join(dir, 'daemon.json')
    fs.writeFileSync(p, '{ "registry-mirrors": [ // comment\n')
    expect(() => readDockerDaemonJson(p)).toThrow()
    fs.writeFileSync(p, '[1,2]')
    expect(() => readDockerDaemonJson(p)).toThrow()
    fs.writeFileSync(p, '   ')
    expect(readDockerDaemonJson(p)).toEqual({})
    expect(readDockerDaemonJson(path.join(dir, 'missing.json'))).toEqual({})
  })

  it('writes a .bak of the previous content before modifying', () => {
    const dir = tmp()
    const p = path.join(dir, 'daemon.json')
    fs.writeFileSync(p, '{"debug":true}')
    writeDockerDaemonJson({ debug: true, 'registry-mirrors': ['https://m'] }, p)
    expect(fs.readFileSync(`${p}.bak`, 'utf8')).toBe('{"debug":true}')
    expect(JSON.parse(fs.readFileSync(p, 'utf8'))['registry-mirrors']).toEqual(['https://m'])
  })
})
