/**
 * Skill Sources Store
 *
 * Persists references to skills the user has loaded from disk (drag-in folder
 * or file picker). These are NOT copied into the managed store — only the
 * source path is remembered so the skill can be listed and later installed
 * via one of the four placement modes.
 */

import Store from 'electron-store'
import { randomUUID } from 'crypto'

export interface SkillSource {
  id: string
  /** Display name derived from the skill at load time. */
  name: string
  /** Absolute path to the skill folder (the directory containing SKILL.md). */
  sourcePath: string
  description?: string
  addedAt: string
}

interface SkillSourcesSchema {
  sources: SkillSource[]
}

export const skillSourcesStore = new Store<SkillSourcesSchema>({
  name: 'skill-sources',
  schema: {
    sources: {
      type: 'array',
      default: [],
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          sourcePath: { type: 'string' },
          description: { type: 'string' },
          addedAt: { type: 'string' }
        },
        required: ['id', 'name', 'sourcePath', 'addedAt']
      }
    }
  }
})

export function getSkillSources(): SkillSource[] {
  return skillSourcesStore.get('sources')
}

export function addSkillSource(
  source: Omit<SkillSource, 'id' | 'addedAt'>
): SkillSource {
  const sources = getSkillSources()
  // De-dupe by absolute source path: refresh the existing entry instead.
  const existing = sources.find((s) => s.sourcePath === source.sourcePath)
  if (existing) {
    existing.name = source.name
    existing.description = source.description
    skillSourcesStore.set('sources', sources)
    return existing
  }
  const created: SkillSource = {
    ...source,
    id: randomUUID(),
    addedAt: new Date().toISOString()
  }
  sources.push(created)
  skillSourcesStore.set('sources', sources)
  return created
}

export function removeSkillSource(id: string): boolean {
  const sources = getSkillSources()
  const filtered = sources.filter((s) => s.id !== id)
  if (filtered.length === sources.length) return false
  skillSourcesStore.set('sources', filtered)
  return true
}
