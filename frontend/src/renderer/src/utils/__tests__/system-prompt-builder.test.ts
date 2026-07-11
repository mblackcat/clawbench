import { describe, it, expect } from 'vitest'
import { buildSystemPrompt } from '../system-prompt-builder'

const base = {
  currentTime: '2026-07-10',
  timezone: 'UTC',
  platform: 'win32',
  language: 'zh-CN',
  availableTools: ['list_workbench_apps'] as string[],
  webSearchEnabled: false,
}

describe('buildSystemPrompt', () => {
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

  it('injects soul, memory, harness when enabled', () => {
    const prompt = buildSystemPrompt({
      ...base,
      assistantEnabled: true,
      agentMemory: {
        soul: '# Custom Soul Persona',
        memory: 'User likes TypeScript. '.repeat(20),
        tools: '# Module Harness Body',
      },
    })
    expect(prompt).toContain('Custom Soul Persona')
    expect(prompt).toContain('Long-term Memory')
    expect(prompt).toContain('Module Harness')
    expect(prompt).toContain('Module Harness Body')
    expect(prompt).toContain('update_user_profile')
    expect(prompt).toContain('update_sub_agents')
  })

  it('injects user profile and sub-agents when present', () => {
    const prompt = buildSystemPrompt({
      ...base,
      assistantEnabled: true,
      agentMemory: {
        soul: '# Soul',
        user: 'Name: Alex; prefers low control',
        agents: '### Reviewer\n- Role: code review',
      },
    })
    expect(prompt).toContain('User Profile')
    expect(prompt).toContain('prefers low control')
    expect(prompt).toContain('Sub-agents')
    expect(prompt).toContain('Reviewer')
  })
})
