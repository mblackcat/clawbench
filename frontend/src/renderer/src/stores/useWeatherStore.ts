import { useEffect } from 'react'
import { create } from 'zustand'
import type { WeatherType } from '../components/WeatherEffect'

export const WEATHER_TYPES: WeatherType[] = [
  'snow',
  'rain',
  'leaves',
  'fireworks',
  'sakura',
  'meteor',
  'lantern'
]

/** localStorage keys (kept identical to the original StatusBar implementation) */
const KEY_VISIBLE = 'cb-weather-visible'
const KEY_TYPE = 'cb-weather-type'
/** Set while the user has manually turned weather on — suppresses auto weather */
const KEY_MANUAL = 'cb-weather-manual'
/** Set while the currently visible weather was auto-triggered */
const KEY_AUTO = 'cb-weather-auto'

const AUTO_INITIAL_DELAY_MS = 3000
const AUTO_INTERVAL_MS = 60 * 60 * 1000
const AUTO_CHANCE = 0.5

export function pickRandomWeather(): WeatherType {
  return WEATHER_TYPES[Math.floor(Math.random() * WEATHER_TYPES.length)]
}

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function lsSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* storage unavailable */
  }
}

function lsRemove(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    /* storage unavailable */
  }
}

interface WeatherState {
  weatherVisible: boolean
  weatherType: WeatherType
  /** Manual on/off (on = random type, disables auto-dismiss) */
  toggleWeather: () => void
  /** Advance to the next weather type */
  cycleWeather: () => void
  setWeatherVisible: (visible: boolean) => void
  setWeatherType: (type: WeatherType) => void
  /**
   * Hourly auto weather: 50% chance to show a random effect for 5–15 minutes,
   * unless the user turned weather on manually. Returns a cleanup function.
   */
  startAutoWeather: () => () => void
}

export const useWeatherStore = create<WeatherState>((set, get) => ({
  weatherVisible: lsGet(KEY_VISIBLE) === 'true',
  weatherType: (() => {
    const saved = lsGet(KEY_TYPE) as WeatherType | null
    return saved && WEATHER_TYPES.includes(saved) ? saved : pickRandomWeather()
  })(),

  toggleWeather: () => {
    const next = !get().weatherVisible
    if (next) {
      const type = pickRandomWeather()
      set({ weatherVisible: true, weatherType: type })
      lsSet(KEY_TYPE, type)
      lsSet(KEY_MANUAL, 'true')
      lsRemove(KEY_AUTO)
    } else {
      set({ weatherVisible: false })
      lsRemove(KEY_MANUAL)
      lsRemove(KEY_AUTO)
    }
    lsSet(KEY_VISIBLE, String(next))
  },

  cycleWeather: () => {
    const idx = WEATHER_TYPES.indexOf(get().weatherType)
    const next = WEATHER_TYPES[(idx + 1) % WEATHER_TYPES.length]
    set({ weatherType: next })
    lsSet(KEY_TYPE, next)
  },

  setWeatherVisible: (visible: boolean) => {
    set({ weatherVisible: visible })
    lsSet(KEY_VISIBLE, String(visible))
  },

  setWeatherType: (type: WeatherType) => {
    set({ weatherType: type })
    lsSet(KEY_TYPE, type)
  },

  startAutoWeather: () => {
    let dismissTimer: ReturnType<typeof setTimeout> | null = null

    const hideAuto = (): void => {
      if (lsGet(KEY_AUTO) === 'true') {
        set({ weatherVisible: false })
        lsSet(KEY_VISIBLE, 'false')
        lsRemove(KEY_AUTO)
      }
    }

    const tryRandomWeather = (): void => {
      // Only trigger if user hasn't manually turned it on
      if (lsGet(KEY_MANUAL) === 'true') return

      if (Math.random() < AUTO_CHANCE) {
        const type = pickRandomWeather()
        set({ weatherVisible: true, weatherType: type })
        lsSet(KEY_TYPE, type)
        lsSet(KEY_VISIBLE, 'true')
        lsSet(KEY_AUTO, 'true')

        // Auto-dismiss after 5–15 minutes (only if still the auto-triggered one)
        if (dismissTimer) clearTimeout(dismissTimer)
        const duration = (5 + Math.random() * 10) * 60 * 1000
        dismissTimer = setTimeout(() => {
          dismissTimer = null
          hideAuto()
        }, duration)
      } else {
        hideAuto()
      }
    }

    const initialTimer = setTimeout(tryRandomWeather, AUTO_INITIAL_DELAY_MS)
    const interval = setInterval(tryRandomWeather, AUTO_INTERVAL_MS)
    return () => {
      clearTimeout(initialTimer)
      clearInterval(interval)
      if (dismissTimer) clearTimeout(dismissTimer)
    }
  }
}))

/** Mount once (AppLayout) to run the hourly auto-weather scheduler. */
export function useAutoWeather(): void {
  useEffect(() => useWeatherStore.getState().startAutoWeather(), [])
}
