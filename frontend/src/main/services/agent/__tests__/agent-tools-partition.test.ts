import { describe, it, expect } from 'vitest'
import { partitionToolBatches, type AgentToolCall, type AgentToolDefinition } from '../agent-tools'

function tool(
  name: string,
  concurrent: boolean
): AgentToolDefinition {
  return {
    name,
    description: name,
    inputSchema: { type: 'object', properties: {} },
    source: 'builtin',
    isConcurrencySafe: () => concurrent,
    isReadOnly: () => concurrent,
    execute: async () => ({ content: 'ok', isError: false }),
  }
}

describe('partitionToolBatches', () => {
  it('batches consecutive concurrent tools', () => {
    const catalog = new Map([
      ['a', tool('a', true)],
      ['b', tool('b', true)],
      ['c', tool('c', false)],
      ['d', tool('d', true)],
    ])
    const calls: AgentToolCall[] = [
      { id: '1', name: 'a', input: {} },
      { id: '2', name: 'b', input: {} },
      { id: '3', name: 'c', input: {} },
      { id: '4', name: 'd', input: {} },
    ]
    const batches = partitionToolBatches(calls, catalog)
    expect(batches).toHaveLength(3)
    expect(batches[0].concurrent).toBe(true)
    expect(batches[0].calls.map((c) => c.name)).toEqual(['a', 'b'])
    expect(batches[1].concurrent).toBe(false)
    expect(batches[1].calls.map((c) => c.name)).toEqual(['c'])
    expect(batches[2].concurrent).toBe(true)
    expect(batches[2].calls.map((c) => c.name)).toEqual(['d'])
  })
})
