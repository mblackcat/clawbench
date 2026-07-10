import fs from 'fs'
import os from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAppScaffold } from '../publisher.service'

describe('generated App dynamic option SDK reference', () => {
  let targetDir: string

  beforeEach(() => {
    targetDir = fs.mkdtempSync(join(os.tmpdir(), 'clawbench-scaffold-test-'))
  })

  afterEach(() => {
    fs.rmSync(targetDir, { recursive: true, force: true })
  })

  it('generates an SDK 1.1.0 scaffold that documents option slots', () => {
    const result = createAppScaffold({
      id: 'slot-doc-test',
      name: 'Slot Docs',
      version: '1.0.0',
      description: 'Generated documentation contract test',
      author: 'Tester',
      entry: 'main.py',
      targetDir
    })

    expect(result.success).toBe(true)
    const appDir = result.path!
    const manifest = JSON.parse(
      fs.readFileSync(join(appDir, 'manifest.json'), 'utf-8')
    )
    const reference = fs.readFileSync(join(appDir, 'SDK_REFERENCE.md'), 'utf-8')
    const requirements = fs.readFileSync(join(appDir, 'requirements.txt'), 'utf-8')

    expect(manifest.min_sdk_version).toBe('1.1.0')
    expect(reference).toContain('"options_slot": "models"')
    expect(reference).toContain('def resolve_slot(self, slot: str)')
    expect(reference).toContain('must not rewrite manifest.json')
    expect(requirements).toContain('clawbench-sdk>=1.1.0')
  })
})
