import { EventEmitter } from 'events'
import fs from 'fs'
import os from 'os'
import { join } from 'path'
import { PassThrough } from 'stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  resolveSubAppSlot,
  type SlotExecutionRequest,
  type SpawnedSlotProcess
} from '../subapp-slot.service'

class FakeChildProcess extends EventEmitter implements SpawnedSlotProcess {
  stdout = new PassThrough()
  stderr = new PassThrough()
  kill = vi.fn(() => true)
}

const request: SlotExecutionRequest = {
  appPath: 'D:/apps/example',
  entryFile: 'main.py',
  slot: 'models',
  params: { proxy_url: 'http://proxy', model: 'old' },
  workspace: { name: 'repo', path: 'D:/repo', vcsType: 'git' },
  pythonPath: 'python',
  sdkPath: 'D:/clawbench/python-sdk',
  timeoutMs: 30_000
}

describe('resolveSubAppSlot', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(join(os.tmpdir(), 'clawbench-slot-test-'))
  })

  afterEach(() => {
    vi.useRealTimers()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  function start(child: FakeChildProcess): Promise<unknown> {
    return resolveSubAppSlot(request, {
      spawnProcess: vi.fn(() => child),
      tempDir
    })
  }

  it('returns data from the matching slot result after ordinary output', async () => {
    const child = new FakeChildProcess()
    const promise = start(child)

    child.stdout.write('{"type":"output","message":"fetching"}\n')
    child.stdout.write(
      '{"type":"slot_result","slot":"models","data":{"options":["a"]}}\n'
    )
    child.emit('close', 0)

    await expect(promise).resolves.toEqual({ options: ['a'] })
    expect(fs.readdirSync(tempDir)).toEqual([])
  })

  it('parses a final slot result without a trailing newline', async () => {
    const child = new FakeChildProcess()
    const promise = start(child)

    child.stdout.write(
      '{"type":"slot_result","slot":"models","data":{"options":["final"]}}'
    )
    child.emit('close', 0)

    await expect(promise).resolves.toEqual({ options: ['final'] })
  })

  it('rejects a result for a different slot and cleans temporary files', async () => {
    const child = new FakeChildProcess()
    const promise = start(child)

    child.stdout.write('{"type":"slot_result","slot":"other","data":{}}\n')
    child.emit('close', 0)

    await expect(promise).rejects.toThrow('Unexpected slot result: other')
    expect(fs.readdirSync(tempDir)).toEqual([])
  })

  it('rejects duplicate matching slot results', async () => {
    const child = new FakeChildProcess()
    const promise = start(child)
    const line = '{"type":"slot_result","slot":"models","data":{"options":["a"]}}\n'

    child.stdout.write(line)
    child.stdout.write(line)
    child.emit('close', 0)

    await expect(promise).rejects.toThrow('Duplicate slot result: models')
  })

  it('surfaces structured App errors', async () => {
    const child = new FakeChildProcess()
    const promise = start(child)

    child.stdout.write(
      '{"type":"error","message":"Unhandled exception","details":"proxy unavailable"}\n'
    )
    child.emit('close', 1)

    await expect(promise).rejects.toThrow('proxy unavailable')
  })

  it('uses stderr when the child exits non-zero without a structured error', async () => {
    const child = new FakeChildProcess()
    const promise = start(child)

    child.stderr.write('python failed')
    child.emit('close', 2)

    await expect(promise).rejects.toThrow('python failed')
  })

  it('rejects when the process exits successfully without a result', async () => {
    const child = new FakeChildProcess()
    const promise = start(child)

    child.stdout.write('plain diagnostic output\n')
    child.emit('close', 0)

    await expect(promise).rejects.toThrow('No matching slot result: models')
  })

  it('rejects a process start error and cleans temporary files', async () => {
    const child = new FakeChildProcess()
    const promise = start(child)

    child.emit('error', new Error('spawn denied'))

    await expect(promise).rejects.toThrow('spawn denied')
    expect(fs.readdirSync(tempDir)).toEqual([])
  })

  it('kills the resolver and rejects after the configured timeout', async () => {
    vi.useFakeTimers()
    const child = new FakeChildProcess()
    const promise = start(child)
    const rejection = expect(promise).rejects.toThrow(
      'Slot resolver timed out after 30000ms'
    )

    await vi.advanceTimersByTimeAsync(30_000)

    await rejection
    expect(child.kill).toHaveBeenCalledOnce()
    expect(fs.readdirSync(tempDir)).toEqual([])
  })

  it('cleans the first temp file when writing the second file fails', async () => {
    const child = new FakeChildProcess()
    const writeFile = vi
      .fn()
      .mockImplementationOnce((path: fs.PathOrFileDescriptor, data: string) => {
        fs.writeFileSync(path, data, 'utf-8')
      })
      .mockImplementationOnce(() => {
        throw new Error('disk full')
      })

    const promise = resolveSubAppSlot(request, {
      spawnProcess: vi.fn(() => child),
      tempDir,
      writeFile
    })
    queueMicrotask(() => child.emit('close', 0))

    await expect(promise).rejects.toThrow('disk full')
    expect(fs.readdirSync(tempDir)).toEqual([])
  })
})
