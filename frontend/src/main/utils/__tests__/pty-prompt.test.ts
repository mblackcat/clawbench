import { describe, expect, it } from 'vitest'
import { looksLikePtyPrompt } from '../pty-prompt'

describe('looksLikePtyPrompt', () => {
  it('detects explicit y/n and numbered-choice prompts', () => {
    expect(looksLikePtyPrompt('Overwrite file.txt? (y/n)')).toBe(true)
    expect(looksLikePtyPrompt('Continue [Y/n]: ')).toBe(true)
    expect(looksLikePtyPrompt('Apply patch (yes/no)')).toBe(true)
    expect(looksLikePtyPrompt('Select an option [1-3]')).toBe(true)
  })

  it('detects short confirmation questions on the last line', () => {
    expect(looksLikePtyPrompt('some output\nDo you want to make this edit to app.ts?')).toBe(true)
    expect(looksLikePtyPrompt('❯ Allow this command to run?')).toBe(true)
    expect(looksLikePtyPrompt('是否继续执行？')).toBe(true)
  })

  it('ignores ordinary answers that merely end with a question mark', () => {
    expect(looksLikePtyPrompt('I refactored the parser. Anything else you want me to look at?')).toBe(false)
    expect(looksLikePtyPrompt('What does this function return?')).toBe(false)
    expect(looksLikePtyPrompt('Done.')).toBe(false)
    expect(looksLikePtyPrompt('')).toBe(false)
  })

  it('ignores overly long trailing lines', () => {
    expect(looksLikePtyPrompt(`Do you want ${'x'.repeat(300)}?`)).toBe(false)
  })
})
