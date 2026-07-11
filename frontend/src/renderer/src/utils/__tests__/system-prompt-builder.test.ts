import { describe, it, expect } from 'vitest'
import { buildSystemPrompt, PROMPT_INJECT_CAPS, injectBoundedSection } from '../system-prompt-builder'

const base = {
  currentTime: '2026-07-10',
  timezone: 'UTC',
  platform: 'win32',
  language: 'zh-CN',
  availableTools: ['list_workbench_apps', 'read_agent_file'] as string[],
  webSearchEnabled: false,
}

describe('buildSystemPrompt progressive injection', () => {
  it('uses minimal prompt when assistant disabled', () => {
    const prompt = buildSystemPrompt({
      ...base,
      assistantEnabled: false,
      agentMemory: {
        soul: '# Custom Soul',
        memory: 'x'.repeat(200),
        tools: '# Harness',
      },
    })
    expect(prompt).not.toContain('Custom Soul')
    expect(prompt).not.toContain('Harness')
    expect(prompt).toContain('helpful AI assistant')
  })

  it('always injects soul and on-demand catalog, not full tools harness', () => {
    const prompt = buildSystemPrompt({
      ...base,
      assistantEnabled: true,
      agentMemory: {
        soul: '# Custom Soul Persona',
        memory: 'User likes TypeScript. '.repeat(20),
        tools: '# Module Harness Body SECRET_HARNESS',
        agents: '### Reviewer Buddy\n- Role: review',
      },
    })
    expect(prompt).toContain('Custom Soul Persona')
    expect(prompt).toContain('Long-term Memory (preview)')
    expect(prompt).toContain('On-demand knowledge')
    expect(prompt).toContain('read_agent_file')
    // Full situational docs must NOT be inlined every turn
    expect(prompt).not.toContain('SECRET_HARNESS')
    expect(prompt).not.toContain('Reviewer Buddy')
    expect(prompt).toContain('update_user_profile')
  })

  it('injects compact user profile when short', () => {
    const prompt = buildSystemPrompt({
      ...base,
      assistantEnabled: true,
      agentMemory: {
        soul: '# Soul',
        user: 'Name: Alex; prefers low control',
      },
    })
    expect(prompt).toContain('User Profile')
    expect(prompt).toContain('prefers low control')
  })

  it('truncates oversized memory and points to read_agent_file', () => {
    const huge = 'PROJECT '.repeat(800) // well over 2000 chars
    const prompt = buildSystemPrompt({
      ...base,
      assistantEnabled: true,
      agentMemory: {
        soul: '# Soul',
        memory: huge,
      },
    })
    expect(prompt).toContain('Long-term Memory (preview)')
    expect(prompt).toContain('truncated')
    expect(prompt).toContain('file=`memory`')
    expect(prompt.length).toBeLessThan(huge.length)
  })

  it('injectBoundedSection respects zero cap (skip)', () => {
    expect(injectBoundedSection('Tools', 'lots of harness', 0, 'tools')).toBeNull()
  })

  it('PROMPT_INJECT_CAPS keeps tools/agents off by default', () => {
    expect(PROMPT_INJECT_CAPS.tools).toBe(0)
    expect(PROMPT_INJECT_CAPS.agents).toBe(0)
    expect(PROMPT_INJECT_CAPS.memory).toBeLessThan(5000)
  })
})
