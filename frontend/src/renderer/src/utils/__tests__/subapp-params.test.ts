import { describe, expect, it, beforeEach, vi } from 'vitest'
import type { ParamDef } from '../../types/subapp'
import {
  buildInitialAppParams,
  loadSavedAppParams,
  saveAppParams
} from '../subapp-params'

const params: ParamDef[] = [
  { name: 'branch', type: 'string', label: 'Branch', default: 'main' },
  { name: 'dryRun', type: 'boolean', label: 'Dry run', default: 'false' },
  { name: 'limit', type: 'number', label: 'Limit', default: '10' }
]

describe('subapp params persistence', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('uses saved values over manifest defaults and keeps new defaults', () => {
    saveAppParams('app.one', { branch: 'release', dryRun: true })

    expect(buildInitialAppParams('app.one', params)).toEqual({
      branch: 'release',
      dryRun: true,
      limit: 10
    })
  })

  it('drops stale saved keys that are not in the manifest params', () => {
    saveAppParams('app.two', { branch: 'feature', removed: 'stale' })

    expect(buildInitialAppParams('app.two', params)).toEqual({
      branch: 'feature',
      dryRun: false,
      limit: 10
    })
  })

  it('falls back to defaults when stored params are malformed', () => {
    localStorage.setItem('workbench.appParams.app.bad-json', '{bad json')

    expect(buildInitialAppParams('app.bad-json', params)).toEqual({
      branch: 'main',
      dryRun: false,
      limit: 10
    })
  })

  it('returns an empty object when no saved params exist', () => {
    expect(loadSavedAppParams('missing')).toEqual({})
  })
})

