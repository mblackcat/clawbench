import { describe, it, expect } from 'vitest'
import {
  buildToolsHarnessContent,
  extractJsonObject,
  parseFeedbackLlmResult,
  parseMemoryUpdateLlmResult,
  mergeSoulSuggestionList,
  clampMarkdown,
} from '../agent-memory-utils'

describe('agent-memory-utils', () => {
  it('buildToolsHarnessContent includes live tools section', () => {
    const md = buildToolsHarnessContent([
      { name: 'update_user_profile', description: 'Update user.md' },
      { name: 'list_workbench_apps', description: 'List apps' },
    ])
    expect(md).toContain('Module Harness')
    expect(md).toContain('Currently available tools')
    expect(md).toContain('`update_user_profile`')
    expect(md).toContain('update_sub_agents')
  })

  it('extractJsonObject parses fenced JSON', () => {
    const text = 'Here you go:\n```json\n{"memory_md":"a","user_md":"b","topic":"coding"}\n```'
    const obj = extractJsonObject(text)
    expect(obj?.memory_md).toBe('a')
    expect(obj?.topic).toBe('coding')
  })

  it('parseFeedbackLlmResult extracts soul_suggestion', () => {
    const parsed = parseFeedbackLlmResult(
      JSON.stringify({
        memory_md: 'Remember project X',
        user_md: 'User prefers concise answers',
        topic: 'coding',
        soul_suggestion: { suggestion: 'Be more concise', reason: 'thumbs down on verbosity' },
      })
    )
    expect(parsed?.memory_md).toContain('project X')
    expect(parsed?.user_md).toContain('concise')
    expect(parsed?.soul_suggestion?.suggestion).toBe('Be more concise')
  })

  it('parseMemoryUpdateLlmResult ignores tiny bodies', () => {
    expect(parseMemoryUpdateLlmResult('{"memory_md":"short"}')).toEqual({})
    const ok = parseMemoryUpdateLlmResult(
      JSON.stringify({ memory_md: 'This is a longer memory body for testing purposes ok' })
    )
    expect(ok?.memory_md).toContain('longer memory')
  })

  it('mergeSoulSuggestionList increments matching suggestions', () => {
    const once = mergeSoulSuggestionList([], { suggestion: 'Be brief', reason: 'r1' })
    expect(once[0].feedbackCount).toBe(1)
    const twice = mergeSoulSuggestionList(once, { suggestion: 'Be brief', reason: 'r2' })
    expect(twice).toHaveLength(1)
    expect(twice[0].feedbackCount).toBe(2)
    expect(twice[0].reason).toBe('r2')
  })

  it('clampMarkdown truncates', () => {
    expect(clampMarkdown('abcdefghij', 5)).toBe('abcde')
  })
})
