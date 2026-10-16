import React from 'react'
import type { WeatherType } from './WeatherEffect'
import { useT } from '../i18n'

export interface WeatherIconProps {
  type?: WeatherType | 'atmosphere'
  color?: string
  size?: number
  style?: React.CSSProperties
  className?: string
}

export const WeatherIcon: React.FC<WeatherIconProps> = ({
  type = 'atmosphere',
  color = 'currentColor',
  size = 16,
  style,
  className
}) => {
  const props = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: color,
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
    style: { display: 'block' as const, flexShrink: 0, ...style }
  }

  // 1. 雪 (Snow) — 6-arm symmetric snowflake with crystal terminal ticks
  if (type === 'snow') {
    return (
      <svg {...props}>
        <line x1="12" y1="2.5" x2="12" y2="21.5" />
        <line x1="2.5" y1="12" x2="21.5" y2="12" />
        <line x1="5.28" y1="5.28" x2="18.72" y2="18.72" />
        <line x1="5.28" y1="18.72" x2="18.72" y2="5.28" />
        <path d="M9.5 5.5l2.5-3 2.5 3" />
        <path d="M9.5 18.5l2.5 3 2.5-3" />
        <path d="M5.5 9.5l-3 2.5 3 2.5" />
        <path d="M18.5 9.5l3 2.5-3 2.5" />
      </svg>
    )
  }

  // 2. 雨 (Rain) — weather cloud with rain streak slashes
  if (type === 'rain') {
    return (
      <svg {...props}>
        <path d="M7 14.5a4 4 0 0 1-.5-7.96A5 5 0 0 1 16.5 7.5a4 4 0 0 1 .5 7H7z" />
        <line x1="9" y1="17.5" x2="8" y2="21" />
        <line x1="13" y1="17.5" x2="12" y2="21" />
        <line x1="17" y1="17.5" x2="16" y2="21" />
      </svg>
    )
  }

  // 3. 风 / 飘叶 (Leaves / Breeze) — wind currents with fluttering leaf
  if (type === 'leaves') {
    return (
      <svg {...props}>
        <path d="M3 8.5h11a2.5 2.5 0 1 0-2.5-2.5" />
        <path d="M2 13h14a2.5 2.5 0 1 1-2.5 2.5" />
        <path d="M14 17.5c2.5 0 4.5-1.5 5.5-3.5-2 0-4.5 1-5.5 3.5z" />
      </svg>
    )
  }

  // 4. 烟花 (Fireworks) — radiating burst rays with center spark
  if (type === 'fireworks') {
    return (
      <svg {...props}>
        <line x1="12" y1="2.5" x2="12" y2="6" />
        <line x1="12" y1="18" x2="12" y2="21.5" />
        <line x1="2.5" y1="12" x2="6" y2="12" />
        <line x1="18" y1="12" x2="21.5" y2="12" />
        <line x1="5.28" y1="5.28" x2="7.78" y2="7.78" />
        <line x1="16.22" y1="16.22" x2="18.72" y2="18.72" />
        <line x1="5.28" y1="18.72" x2="7.78" y2="16.22" />
        <line x1="16.22" y1="7.78" x2="18.72" y2="5.28" />
        <circle cx="12" cy="12" r="1.5" fill={color} />
      </svg>
    )
  }

  // 5. 樱花 (Sakura) — 5-petal floral blossom
  if (type === 'sakura') {
    return (
      <svg {...props}>
        <path d="M12 3c-1.5 2.5-1.5 5 0 7 1.5-2 1.5-4.5 0-7z" />
        <path d="M20.5 9c-2.8.5-4.5 2.3-5.2 4.3 2.4-.7 4.8-.3 5.2-4.3z" />
        <path d="M17.3 19.3c-2-2-4.4-2.4-6.4-1.9 1.4 2 1.7 4.5 6.4 1.9z" />
        <path d="M6.7 19.3c2-2 2.3-4.5.9-6.5-2 1.3-2.5 3.7-.9 6.5z" />
        <path d="M3.5 9c2.8.5 4.5 2.3 5.2 4.3-2.4-.7-4.8-.3-5.2-4.3z" />
        <circle cx="12" cy="12" r="1.5" />
      </svg>
    )
  }

  // 6. 流星 (Meteor) — shooting star with streak trails
  if (type === 'meteor') {
    return (
      <svg {...props}>
        <path d="M4 14.5c1.8.2 3.3 1.7 3.5 3.5.2-1.8 1.7-3.3 3.5-3.5-1.8-.2-3.3-1.7-3.5-3.5-.2 1.8-1.7 3.3-3.5 3.5z" />
        <line x1="21" y1="3" x2="10" y2="14" />
        <line x1="21" y1="8" x2="14" y2="15" />
        <line x1="16" y1="3" x2="9" y2="10" />
      </svg>
    )
  }

  // 7. 孔明灯 (Lantern) — traditional sky lantern with tassel
  if (type === 'lantern') {
    return (
      <svg {...props}>
        <path d="M7 6.5C7 4.2 9.2 3 12 3s5 1.2 5 3.5v8c0 2-2 3-5 3s-5-1-5-3v-8z" />
        <line x1="12" y1="3" x2="12" y2="17.5" />
        <line x1="8" y1="17.5" x2="16" y2="17.5" />
        <line x1="12" y1="17.5" x2="12" y2="21" />
      </svg>
    )
  }

  // 默认: 氛围效果 (Atmosphere / Celestial Sparkle)
  return (
    <svg {...props}>
      <path d="M12 3c.3 3.8 3.8 6.5 7.5 6.8-3.7.3-7.2 3-7.5 6.8-.3-3.8-3.8-6.5-7.5-6.8 3.7-.3 7.2-3 7.5-6.8z" />
      <path d="M18.5 16.5c.2 1.8 1.8 3 3.5 3.2-1.7.2-3.3 1.4-3.5 3.2-.2-1.8-1.8-3-3.5-3.2 1.7-.2 3.3-1.4 3.5-3.2z" />
    </svg>
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
