/** Motion layer public surface. Styles live in styles/motion.css. */
export {
  MOTION_STORAGE_KEY,
  initMotionPreference,
  setMotionMode,
  readStoredMotionPref,
  isAgileMotion,
  prefersReducedMotion,
  supportsDiscreteTransition,
  supportsPopover,
  supportsViewTransitions,
  supportsAnchorPositioning
} from './pref'
export type { MotionMode } from './pref'

export {
  withViewTransition,
  setSharedTransitionName,
  SHARED_VT_NAME,
  isViewTransitionInFlight
} from './view-transition'

export { initWindowFocusSync } from './window-focus'
export { playStaggerOnce, useStaggerOnce } from './stagger'
export { setLayerOpen } from './layer-fallback'
