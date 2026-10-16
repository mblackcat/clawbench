/**
 * Motion layer — wrap react-router push/replace in withViewTransition.
 *
 * Patches the navigator once. The VT callback calls the ORIGINAL push so we
 * cannot recurse. High-frequency inputs (typeahead) must not go through
 * navigate(); they already don't.
 *
 * Risk note: relies on react-router's UNSAFE_NavigationContext (v6). If the
 * context or navigator shape changes in a future router version, this bridge
 * degrades to a no-op (plain navigation without view transitions) instead of
 * breaking routing.
 */
import { useLayoutEffect, useContext } from 'react'
import { UNSAFE_NavigationContext } from 'react-router-dom'
import { withViewTransition } from './view-transition'

type PatchableNavigator = {
  push: (...args: unknown[]) => void
  replace: (...args: unknown[]) => void
}

function isPatchable(nav: unknown): nav is PatchableNavigator {
  return (
    !!nav &&
    typeof (nav as PatchableNavigator).push === 'function' &&
    typeof (nav as PatchableNavigator).replace === 'function'
  )
}

export default function ViewTransitionBridge(): null {
  const ctx = useContext(UNSAFE_NavigationContext) as { navigator?: unknown } | null
  const navigator = ctx?.navigator

  useLayoutEffect(() => {
    if (!isPatchable(navigator)) return
    const nav = navigator
    const originalPush = nav.push
    const originalReplace = nav.replace

    nav.push = (...args: unknown[]) => {
      withViewTransition(() => {
        originalPush.apply(nav, args)
      })
    }
    nav.replace = (...args: unknown[]) => {
      withViewTransition(() => {
        originalReplace.apply(nav, args)
      })
    }

    return () => {
      nav.push = originalPush
      nav.replace = originalReplace
    }
  }, [navigator])

  return null
}
