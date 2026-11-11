import React from 'react'
import type { IconInput } from 'morphicons/react'
import {
  Snowflake,
  CloudRain,
  CloudDrizzle,
  Wind,
  Leaf,
  Sparkles,
  Zap,
  Flower2,
  Sparkle,
  Flame,
  Sun,
  CloudSun
} from 'lucide'
import type { WeatherType } from './WeatherEffect'
import { useT } from '../i18n'
import { InteractiveMorphIcon } from './common/InteractiveMorphIcon'

export interface WeatherIconProps {
  type?: WeatherType | 'atmosphere'
  color?: string
  size?: number | string
  style?: React.CSSProperties
  className?: string
}

/** Each effect morphs into a related glyph on hover (static when motion is off). */
const WEATHER_MORPH_CONFIG: Record<WeatherType | 'atmosphere', { icon: IconInput; hoverIcon: IconInput }> = {
  snow: { icon: Snowflake, hoverIcon: Sparkles },
  rain: { icon: CloudRain, hoverIcon: CloudDrizzle },
  leaves: { icon: Wind, hoverIcon: Leaf },
  fireworks: { icon: Sparkles, hoverIcon: Zap },
  sakura: { icon: Flower2, hoverIcon: Sparkle },
  meteor: { icon: Flame, hoverIcon: Sparkles },
  lantern: { icon: Flame, hoverIcon: Sun },
  atmosphere: { icon: CloudSun, hoverIcon: Sparkles }
}

export const WeatherIcon: React.FC<WeatherIconProps> = ({
  type = 'atmosphere',
  color = 'currentColor',
  size = 16,
  style,
  className
}) => {
  const config = WEATHER_MORPH_CONFIG[type] ?? WEATHER_MORPH_CONFIG.atmosphere

  return (
    <InteractiveMorphIcon
      icon={config.icon}
      hoverIcon={config.hoverIcon}
      size={size}
      className={className}
      style={{ color, ...style }}
    />
  )
}

export const useWeatherNames = (): Record<WeatherType, string> => {
  const t = useT()
  return {
    snow: t('statusbar.weatherSnow'),
    rain: t('statusbar.weatherRain'),
    leaves: t('statusbar.weatherLeaves'),
    fireworks: t('statusbar.weatherFireworks'),
    sakura: t('statusbar.weatherSakura'),
    meteor: t('statusbar.weatherMeteor'),
    lantern: t('statusbar.weatherLantern')
  }
}

export default WeatherIcon
