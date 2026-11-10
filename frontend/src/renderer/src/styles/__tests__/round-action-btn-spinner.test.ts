import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

/**
 * antd's spinners (LoadingOutlined, <Icon spin />) rotate via a `loadingCircle`
 * animation on `transform`. An `!important` declaration outranks a running CSS
 * animation, so any `transform: none !important` that reaches `.anticon-spin`
 * freezes the spinner (the workbench install button got stuck on a static icon
 * this way in the fork). Guard every stylesheet that styles action buttons.
 */
describe('action button icon resets keep spinners spinning', () => {
  const files = ['theme-overhaul.css', 'workbench-cards.css', 'motion.css']

  /** Selector lists of every rule whose body forces `transform: none !important`. */
  const transformResetSelectors = (css: string): string[] => {
    const out: string[] = []
    const ruleRe = /([^{}]+)\{([^{}]*)\}/g
    let m: RegExpExecArray | null
    while ((m = ruleRe.exec(css))) {
      if (/transform\s*:\s*none\s*!important/.test(m[2])) {
        out.push(
          ...m[1]
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        )
      }
    }
    return out
  }

  it.each(files)('%s never forces transform:none onto spinning icons inside action buttons', (file) => {
    const css = readFileSync(resolve(__dirname, '..', file), 'utf8')
    const iconResets = transformResetSelectors(css).filter((sel) =>
      /\.(cb-round-action-btn|cb-notch-btn|cb-card-corner-close-btn)\b.*\.anticon\b/.test(sel)
    )
    for (const sel of iconResets) {
      expect(sel).toContain(':not(.anticon-spin)')
    }
  })

  it('the detector catches an unguarded reset', () => {
    const css = '.cb-round-action-btn .anticon { transform: none !important; }'
    expect(transformResetSelectors(css)).toEqual(['.cb-round-action-btn .anticon'])
  })
})
