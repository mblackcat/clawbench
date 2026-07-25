import { describe, expect, it } from 'vitest'
import {
  DEFAULT_APP_MODE,
  APP_MODE_LABELS,
  isAppMode,
  normalizeAppMode,
  parseStoredAppMode,
  shouldShowLeftSider,
  isGeneralModePath,
  generalModeFallbackPath,
  resolveDefaultRoute
} from '../app-mode'

describe('app-mode', () => {
  it('defaults to pro mode (preserves ClawBench UX)', () => {
    expect(DEFAULT_APP_MODE).toBe('pro')
    expect(normalizeAppMode(undefined)).toBe('pro')
    expect(normalizeAppMode(null)).toBe('pro')
    expect(normalizeAppMode('junk')).toBe('pro')
    expect(parseStoredAppMode(null)).toBe('pro')
    expect(parseStoredAppMode('')).toBe('pro')
  })

  it('accepts only general | pro', () => {
    expect(isAppMode('general')).toBe(true)
    expect(isAppMode('pro')).toBe(true)
    expect(isAppMode('expert')).toBe(false)
    expect(normalizeAppMode('general')).toBe('general')
    expect(parseStoredAppMode('general')).toBe('general')
  })

  it('hides left sider in general and shows it in pro', () => {
    expect(shouldShowLeftSider('general')).toBe(false)
    expect(shouldShowLeftSider('pro')).toBe(true)
  })

  it('allows workbench + settings + all AI modules in general mode', () => {
    // workbench
    expect(isGeneralModePath('/workbench/installed')).toBe(true)
    expect(isGeneralModePath('/workbench/library')).toBe(true)
    expect(isGeneralModePath('/workbench/my-contributions')).toBe(true)
    // settings
    expect(isGeneralModePath('/settings')).toBe(true)
    // AI surfaces stay reachable in general mode (ClawBench keeps them)
    expect(isGeneralModePath('/ai-chat')).toBe(true)
    expect(isGeneralModePath('/ai-agents')).toBe(true)
    expect(isGeneralModePath('/ai-agents/openclaw')).toBe(true)
    expect(isGeneralModePath('/ai-agents/hermes')).toBe(true)
    expect(isGeneralModePath('/openclaw')).toBe(true)
    expect(isGeneralModePath('/ai-coding')).toBe(true)
    expect(isGeneralModePath('/developer/new-skill')).toBe(true)
    // stale / garbage routes are filtered
    expect(isGeneralModePath('/nonexistent')).toBe(false)
    expect(isGeneralModePath('/login')).toBe(false)
  })

  it('resolves general default route: restore allowed, else workbench', () => {
    // allowed route restored
    expect(resolveDefaultRoute('/ai-chat', 'general')).toBe('/ai-chat')
    expect(resolveDefaultRoute('/workbench/library', 'general')).toBe('/workbench/library')
    // disallowed route → fallback
    expect(resolveDefaultRoute('/nonexistent', 'general')).toBe(generalModeFallbackPath())
    expect(resolveDefaultRoute(null, 'general')).toBe('/workbench/installed')
  })

  it('preserves AI routes in pro mode (never drops them)', () => {
    expect(resolveDefaultRoute('/ai-chat', 'pro')).toBe('/ai-chat')
    expect(resolveDefaultRoute('/ai-agents/hermes', 'pro')).toBe('/ai-agents/hermes')
    expect(resolveDefaultRoute('/openclaw', 'pro')).toBe('/openclaw')
    expect(resolveDefaultRoute('/ai-coding', 'pro')).toBe('/ai-coding')
    expect(resolveDefaultRoute('/developer/new-skill', 'pro')).toBe('/developer/new-skill')
    // no lastRoute → historical /ai-chat default
    expect(resolveDefaultRoute(null, 'pro')).toBe('/ai-chat')
    expect(resolveDefaultRoute('/', 'pro')).toBe('/ai-chat')
    expect(resolveDefaultRoute('/login', 'pro')).toBe('/ai-chat')
  })

  it('exposes 通用 / 研发 labels', () => {
    expect(APP_MODE_LABELS.general.zh).toBe('通用')
    expect(APP_MODE_LABELS.pro.zh).toBe('研发')
    expect(APP_MODE_LABELS.general.en).toBe('General')
    expect(APP_MODE_LABELS.pro.en).toBe('Dev')
  })
})
