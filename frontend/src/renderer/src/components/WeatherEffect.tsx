import React, { useEffect, useRef, useCallback, useState } from 'react'
import { useLocation } from 'react-router-dom'

export type WeatherType = 'snow' | 'rain' | 'leaves' | 'fireworks' | 'sakura' | 'meteor' | 'lantern'

interface Particle {
  x: number
  y: number
  size: number
  speedX: number
  speedY: number
  opacity: number
  rotation?: number
  rotationSpeed?: number
  wobble?: number
  wobbleSpeed?: number
  wobblePhase?: number
  phase?: 'rise' | 'burst' | 'wait'
  life?: number
  maxLife?: number
  color?: string
  tailLength?: number
  originX?: number
  originY?: number
}

const WEATHER_CONFIG = {
  snow: { count: 60, color: '#ffffff' },
  rain: { count: 100, color: '#a0c4ff' },
  leaves: { count: 25, color: '#8bc34a' },
  fireworks: { count: 50, color: '#ff6b6b' },
  sakura: { count: 45, color: '#ffb7c5' },
  meteor: { count: 8, color: '#e0e8ff' },
  lantern: { count: 15, color: '#ffaa33' }
}

const WEATHER_TYPES: WeatherType[] = ['snow', 'rain', 'leaves', 'fireworks', 'sakura', 'meteor', 'lantern']

function pickRandom(): WeatherType {
  return WEATHER_TYPES[Math.floor(Math.random() * WEATHER_TYPES.length)]
}

function createParticle(w: number, h: number, type: WeatherType, scatter = false): Particle {
  const base: Particle = {
    x: Math.random() * w,
    y: scatter ? Math.random() * h : -10,
    size: 0,
    speedX: 0,
    speedY: 0,
    opacity: 0
  }

  switch (type) {
    case 'snow':
      base.size = 2 + Math.random() * 4
      base.speedX = -0.3 + Math.random() * 0.6
      base.speedY = 0.4 + Math.random() * 1.0
      base.opacity = 0.15 + Math.random() * 0.25
      base.wobble = 0
      base.wobbleSpeed = 0.01 + Math.random() * 0.02
      base.wobblePhase = Math.random() * Math.PI * 2
      break
    case 'rain':
      base.size = 1 + Math.random() * 1.5
      base.speedX = -1 + Math.random() * 0.5
      base.speedY = 8 + Math.random() * 6
      base.opacity = 0.1 + Math.random() * 0.15
      break
    case 'leaves':
      base.size = 6 + Math.random() * 8
      base.speedX = 0.5 + Math.random() * 1.5
      base.speedY = 0.3 + Math.random() * 0.8
      base.opacity = 0.15 + Math.random() * 0.2
      base.rotation = Math.random() * 360
      base.rotationSpeed = -2 + Math.random() * 4
      base.wobble = 0
      base.wobbleSpeed = 0.02 + Math.random() * 0.03
      base.wobblePhase = Math.random() * Math.PI * 2
      break
    case 'fireworks': {
      const colors = ['#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff', '#ff6bcb', '#ff9f43']
      base.color = colors[Math.floor(Math.random() * colors.length)]
      // ~1 in 10 particles is a rising rocket, rest start as waiting burst sparks
      if (!scatter && Math.random() < 1) {
        // This is the rising rocket
        base.x = w * 0.15 + Math.random() * w * 0.7
        base.y = h + 10
        base.size = 3
        base.speedX = -0.2 + Math.random() * 0.4
        base.speedY = -(5 + Math.random() * 3)
        base.opacity = 0.4
        base.phase = 'rise'
        base.life = 0
        base.maxLife = 50 + Math.random() * 30
      } else if (scatter && Math.random() < 0.12) {
        // Scatter init: some rockets already mid-flight
        base.x = w * 0.15 + Math.random() * w * 0.7
        base.y = h * 0.5 + Math.random() * h * 0.4
        base.size = 3
        base.speedX = -0.2 + Math.random() * 0.4
        base.speedY = -(3 + Math.random() * 3)
        base.opacity = 0.4
        base.phase = 'rise'
        base.life = Math.random() * 20
        base.maxLife = 30 + Math.random() * 20
      } else {
        // Waiting burst particle — invisible until a rocket explodes and assigns position
        base.x = -100
        base.y = -100
        base.size = 0
        base.speedX = 0
        base.speedY = 0
        base.opacity = 0
        base.phase = 'wait'
        base.life = 0
        base.maxLife = 60 + Math.random() * 30
      }
      break
    }
    case 'sakura':
      base.size = 4 + Math.random() * 5
      base.speedX = -0.3 + Math.random() * 0.6
      base.speedY = 0.4 + Math.random() * 0.7
      base.opacity = 0.15 + Math.random() * 0.2
      base.rotation = Math.random() * 360
      base.rotationSpeed = -1 + Math.random() * 2
      base.wobble = 0
      base.wobbleSpeed = 0.015 + Math.random() * 0.025
      base.wobblePhase = Math.random() * Math.PI * 2
      base.color = ['#ffb7c5', '#ffc8d6', '#ffaabb', '#ffd0dc'][Math.floor(Math.random() * 4)]
      break
    case 'meteor':
      base.x = w * 0.3 + Math.random() * w * 0.7
      base.y = scatter ? Math.random() * h * 0.5 : -10
      base.size = 1.5 + Math.random() * 1.5
      base.speedX = -(3 + Math.random() * 4)
      base.speedY = 3 + Math.random() * 4
      base.opacity = 0.2 + Math.random() * 0.2
      base.tailLength = 30 + Math.random() * 50
      base.life = 0
      base.maxLife = 80 + Math.random() * 60
      base.color = Math.random() < 0.6 ? '#e0e8ff' : '#b8d0ff'
      break
    case 'lantern':
      base.x = Math.random() * w
      base.y = scatter ? h * 0.3 + Math.random() * h * 0.7 : h + 10
      base.size = 8 + Math.random() * 6
      base.speedX = 0
      base.speedY = -(0.3 + Math.random() * 0.5)
      base.opacity = 0.15 + Math.random() * 0.2
      base.wobble = 0
      base.wobbleSpeed = 0.008 + Math.random() * 0.012
      base.wobblePhase = Math.random() * Math.PI * 2
      base.color = Math.random() < 0.7 ? '#ffaa33' : '#ff8833'
      break
  }

  return base
}

function drawParticle(
  ctx: CanvasRenderingContext2D,
  p: Particle,
  type: WeatherType
): void {
  ctx.globalAlpha = p.opacity

  switch (type) {
    case 'snow': {
      // Simple filled circle instead of per-particle radialGradient (much cheaper)
      ctx.fillStyle = `rgba(255,255,255,${p.opacity})`
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
      ctx.fill()
      break
    }
    case 'rain': {
      ctx.strokeStyle = WEATHER_CONFIG.rain.color
      ctx.lineWidth = p.size
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(p.x, p.y)
      ctx.lineTo(p.x + p.speedX * 2, p.y + p.speedY * 1.5)
      ctx.stroke()
      break
    }
    case 'leaves': {
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(((p.rotation ?? 0) * Math.PI) / 180)
      // leaf shape
      const s = p.size
      ctx.fillStyle = WEATHER_CONFIG.leaves.color
      ctx.beginPath()
      ctx.moveTo(0, -s / 2)
      ctx.bezierCurveTo(s / 2, -s / 3, s / 2, s / 3, 0, s / 2)
      ctx.bezierCurveTo(-s / 2, s / 3, -s / 2, -s / 3, 0, -s / 2)
      ctx.fill()
      // center vein
      ctx.strokeStyle = 'rgba(50,100,20,0.3)'
      ctx.lineWidth = 0.5
      ctx.beginPath()
      ctx.moveTo(0, -s / 2)
      ctx.lineTo(0, s / 2)
      ctx.stroke()
      ctx.restore()
      break
    }
    case 'fireworks': {
      if (p.phase === 'wait') break // invisible waiting particles
      const c = p.color ?? '#ff6b6b'
      if (p.phase === 'rise') {
        // Rising rocket: bright dot + upward trail
        ctx.fillStyle = '#ffffff'
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size * 0.6, 0, Math.PI * 2)
        ctx.fill()
        // Trail behind rocket
        const trailLen = 15
        const grad = ctx.createLinearGradient(p.x, p.y, p.x, p.y + trailLen)
        grad.addColorStop(0, c)
        grad.addColorStop(1, 'transparent')
        ctx.strokeStyle = grad
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(p.x, p.y)
        ctx.lineTo(p.x - p.speedX * 2, p.y + trailLen)
        ctx.stroke()
      } else if (p.phase === 'burst') {
        // Burst spark: small dot that fades
        ctx.fillStyle = c
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        ctx.fill()
        // Tiny trail for each spark
        if (p.originX != null && p.originY != null) {
          const dx = p.x - p.originX
          const dy = p.y - p.originY
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist > 3) {
            const tg = ctx.createLinearGradient(
              p.x, p.y,
              p.x - dx * 0.3, p.y - dy * 0.3
            )
            tg.addColorStop(0, c)
            tg.addColorStop(1, 'transparent')
            ctx.strokeStyle = tg
            ctx.lineWidth = p.size * 0.6
            ctx.beginPath()
            ctx.moveTo(p.x, p.y)
            ctx.lineTo(p.x - dx * 0.3, p.y - dy * 0.3)
            ctx.stroke()
          }
        }
      }
      break
    }
    case 'sakura': {
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(((p.rotation ?? 0) * Math.PI) / 180)
      const r = p.size
      const c = p.color ?? '#ffb7c5'
      ctx.fillStyle = c
      // Single petal shape: teardrop with a notch at the wide end
      ctx.beginPath()
      // Start at the narrow tip (top)
      ctx.moveTo(0, -r)
      // Right curve down to wide base
      ctx.bezierCurveTo(r * 0.6, -r * 0.5, r * 0.7, r * 0.3, r * 0.15, r * 0.7)
      // Notch at base center
      ctx.quadraticCurveTo(0, r * 0.45, -r * 0.15, r * 0.7)
      // Left curve back up to tip
      ctx.bezierCurveTo(-r * 0.7, r * 0.3, -r * 0.6, -r * 0.5, 0, -r)
      ctx.fill()
      // Subtle center vein
      ctx.strokeStyle = 'rgba(200,120,140,0.25)'
      ctx.lineWidth = 0.5
      ctx.beginPath()
      ctx.moveTo(0, -r * 0.8)
      ctx.lineTo(0, r * 0.5)
      ctx.stroke()
      ctx.restore()
      break
    }
    case 'meteor': {
      const mc = p.color ?? '#e0e8ff'
      const tl = p.tailLength ?? 40
      // Tail line
      const dx = -p.speedX
      const dy = -p.speedY
      const mag = Math.sqrt(dx * dx + dy * dy)
      const nx = (dx / mag) * tl
      const ny = (dy / mag) * tl
      const grad = ctx.createLinearGradient(p.x, p.y, p.x + nx, p.y + ny)
      grad.addColorStop(0, mc)
      grad.addColorStop(1, 'transparent')
      ctx.strokeStyle = grad
      ctx.lineWidth = p.size
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(p.x, p.y)
      ctx.lineTo(p.x + nx, p.y + ny)
      ctx.stroke()
      // Head glow
      ctx.fillStyle = mc
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.size * 1.2, 0, Math.PI * 2)
      ctx.fill()
      break
    }
    case 'lantern': {
      ctx.save()
      ctx.translate(p.x, p.y)
      const lc = p.color ?? '#ffaa33'
      const sz = p.size
      // Warm glow
      const glow = ctx.createRadialGradient(0, 0, sz * 0.2, 0, 0, sz * 1.5)
      glow.addColorStop(0, `rgba(255,170,51,${p.opacity * 0.4})`)
      glow.addColorStop(1, 'transparent')
      ctx.fillStyle = glow
      ctx.beginPath()
      ctx.arc(0, 0, sz * 1.5, 0, Math.PI * 2)
      ctx.fill()
      // Lantern body (rounded rect via ellipse)
      ctx.fillStyle = lc
      ctx.beginPath()
      ctx.ellipse(0, 0, sz * 0.5, sz * 0.65, 0, 0, Math.PI * 2)
      ctx.fill()
      // Top opening
      ctx.fillStyle = 'rgba(180,80,0,0.3)'
      ctx.beginPath()
      ctx.ellipse(0, -sz * 0.6, sz * 0.2, sz * 0.08, 0, 0, Math.PI * 2)
      ctx.fill()
      // Small flame
      ctx.fillStyle = `rgba(255,220,100,${p.opacity * 1.5})`
      ctx.beginPath()
      ctx.moveTo(0, sz * 0.15)
      ctx.bezierCurveTo(-sz * 0.1, -sz * 0.05, sz * 0.1, -sz * 0.05, 0, sz * 0.15)
      ctx.fill()
      ctx.restore()
      break
    }
  }

  ctx.globalAlpha = 1
}

function updateParticle(p: Particle, type: WeatherType, time: number, particles?: Particle[]): void {
  if (type === 'fireworks' && p.phase === 'wait') return // skip invisible waiting particles

  p.x += p.speedX
  p.y += p.speedY

  if (type === 'snow' && p.wobbleSpeed != null && p.wobblePhase != null) {
    p.x += Math.sin(time * p.wobbleSpeed + p.wobblePhase) * 0.5
  }

  if (type === 'leaves') {
    if (p.rotationSpeed != null) {
      p.rotation = ((p.rotation ?? 0) + p.rotationSpeed) % 360
    }
    if (p.wobbleSpeed != null && p.wobblePhase != null) {
      p.x += Math.sin(time * p.wobbleSpeed + p.wobblePhase) * 1.2
      p.y += Math.cos(time * p.wobbleSpeed * 0.7 + p.wobblePhase) * 0.3
    }
  }

  if (type === 'fireworks') {
    if (p.life != null) p.life++
    if (p.phase === 'rise') {
      // Rocket decelerates as it rises
      p.speedY *= 0.988
      // When rocket reaches its peak (slow enough or maxLife reached), explode
      if ((p.life != null && p.maxLife != null && p.life >= p.maxLife) || Math.abs(p.speedY) < 1.5) {
        // Explode: find waiting particles and assign them burst positions
        const burstX = p.x
        const burstY = p.y
        const burstColor = p.color ?? '#ff6b6b'
        const colors = ['#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff', '#ff6bcb', '#ff9f43']
        const chosenColor = colors[Math.floor(Math.random() * colors.length)]
        let assigned = 0
        const burstCount = 15 + Math.floor(Math.random() * 10)
        if (particles) {
          for (const sp of particles) {
            if (sp.phase === 'wait' && assigned < burstCount) {
              const angle = (Math.PI * 2 * assigned) / burstCount + (Math.random() - 0.5) * 0.4
              const speed = 1 + Math.random() * 2.5
              sp.x = burstX
              sp.y = burstY
              sp.originX = burstX
              sp.originY = burstY
              sp.speedX = Math.cos(angle) * speed
              sp.speedY = Math.sin(angle) * speed
              sp.size = 1.5 + Math.random() * 1.5
              sp.opacity = 0.35 + Math.random() * 0.1
              sp.phase = 'burst'
              sp.life = 0
              sp.maxLife = 55 + Math.random() * 30
              sp.color = Math.random() < 0.7 ? chosenColor : burstColor
              assigned++
            }
          }
        }
        // The rocket itself becomes a burst particle too
        const angle = Math.random() * Math.PI * 2
        const speed = 1 + Math.random() * 2
        p.originX = burstX
        p.originY = burstY
        p.speedX = Math.cos(angle) * speed
        p.speedY = Math.sin(angle) * speed
        p.size = 1.5 + Math.random() * 1.5
        p.phase = 'burst'
        p.life = 0
        p.maxLife = 55 + Math.random() * 30
      }
    } else if (p.phase === 'burst') {
      // Burst sparks slow down, gravity pulls them down, fade out
      p.speedX *= 0.97
      p.speedY *= 0.97
      p.speedY += 0.025
      if (p.life != null && p.maxLife != null) {
        p.opacity = Math.max(0, 0.4 * (1 - p.life / p.maxLife))
      }
    }
  }

  if (type === 'sakura') {
    if (p.rotationSpeed != null) {
      p.rotation = ((p.rotation ?? 0) + p.rotationSpeed) % 360
    }
    if (p.wobbleSpeed != null && p.wobblePhase != null) {
      p.x += Math.sin(time * p.wobbleSpeed + p.wobblePhase) * 0.8
      p.y += Math.cos(time * p.wobbleSpeed * 0.5 + p.wobblePhase) * 0.15
    }
  }

  if (type === 'meteor') {
    if (p.life != null) p.life++
    // Gradually fade
    if (p.life != null && p.maxLife != null) {
      p.opacity = Math.max(0, 0.3 * (1 - p.life / p.maxLife))
    }
  }

  if (type === 'lantern') {
    if (p.wobbleSpeed != null && p.wobblePhase != null) {
      p.x += Math.sin(time * p.wobbleSpeed + p.wobblePhase) * 0.3
    }
    // Gentle flicker
    p.opacity = 0.15 + Math.random() * 0.05 + Math.sin(time * 0.05) * 0.02
  }
}

interface WeatherEffectProps {
  type: WeatherType
  visible: boolean
}

const WeatherEffect: React.FC<WeatherEffectProps> = ({ type, visible }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const particlesRef = useRef<Particle[]>([])
  const animRef = useRef<number>(0)
  const timeRef = useRef(0)
  const pausedRef = useRef(false)
  const location = useLocation()

  // Pause animation briefly on route change so React can render without contention
  useEffect(() => {
    pausedRef.current = true
    const timer = setTimeout(() => {
      pausedRef.current = false
    }, 300)
    return () => clearTimeout(timer)
  }, [location.pathname])

  const init = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const w = window.innerWidth
    const h = window.innerHeight
    canvas.width = w
    canvas.height = h
    const count = WEATHER_CONFIG[type].count
    particlesRef.current = Array.from({ length: count }, () =>
      createParticle(w, h, type, true)
    )
  }, [type])

  useEffect(() => {
    if (!visible) {
      cancelAnimationFrame(animRef.current)
      return
    }

    init()

    const handleResize = (): void => {
      const canvas = canvasRef.current
      if (canvas) {
        canvas.width = window.innerWidth
        canvas.height = window.innerHeight
      }
    }
    window.addEventListener('resize', handleResize)

    const animate = (): void => {
      animRef.current = requestAnimationFrame(animate)

      // Skip frame while paused (route transition) or tab hidden
      if (pausedRef.current || document.hidden) return

      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const w = canvas.width
      const h = canvas.height
      timeRef.current++

      ctx.clearRect(0, 0, w, h)

      const allParticles = particlesRef.current

      // For fireworks: periodically spawn a new rocket from waiting particles
      if (type === 'fireworks' && timeRef.current % 70 === 0) {
        const waiting = allParticles.find((pp) => pp.phase === 'wait')
        if (waiting) {
          const colors = ['#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff', '#ff6bcb', '#ff9f43']
          waiting.x = w * 0.15 + Math.random() * w * 0.7
          waiting.y = h + 10
          waiting.size = 3
          waiting.speedX = -0.2 + Math.random() * 0.4
          waiting.speedY = -(5 + Math.random() * 3)
          waiting.opacity = 0.4
          waiting.phase = 'rise'
          waiting.life = 0
          waiting.maxLife = 50 + Math.random() * 30
          waiting.color = colors[Math.floor(Math.random() * colors.length)]
        }
      }

      for (const p of allParticles) {
        updateParticle(p, type, timeRef.current, allParticles)
        drawParticle(ctx, p, type)

        // recycle off-screen particles or expired particles
        if (type === 'fireworks' && p.phase === 'wait') continue
        const offScreen = p.y > h + 20 || p.x > w + 20 || p.x < -20
        const expired =
          (type === 'fireworks' && p.phase === 'burst' && p.life != null && p.maxLife != null && p.life >= p.maxLife) ||
          (type === 'meteor' && p.life != null && p.maxLife != null && p.life >= p.maxLife) ||
          (type === 'lantern' && p.y < -30)
        if (offScreen || expired) {
          if (type === 'fireworks') {
            // Expired burst sparks go back to waiting; off-screen rockets get recycled
            if (p.phase === 'burst' || p.phase === 'wait') {
              p.x = -100
              p.y = -100
              p.size = 0
              p.speedX = 0
              p.speedY = 0
              p.opacity = 0
              p.phase = 'wait'
              p.life = 0
            } else {
              // Recycle off-screen rocket
              const fresh = createParticle(w, h, type)
              Object.assign(p, fresh)
            }
          } else {
            const fresh = createParticle(w, h, type)
            if (type === 'leaves') {
              fresh.x = -10
              fresh.y = Math.random() * h * 0.7
            }
            Object.assign(p, fresh)
          }
        }
      }
    }

    animRef.current = requestAnimationFrame(animate)

    return () => {
      cancelAnimationFrame(animRef.current)
      window.removeEventListener('resize', handleResize)
    }
  }, [type, visible, init])

  if (!visible) return null

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        pointerEvents: 'none',
        zIndex: 9999
      }}
    />
  )
}

// Hook for managing weather state
export function useWeatherEffect(): {
  weatherType: WeatherType
  weatherVisible: boolean
  toggleWeather: () => void
  cycleWeather: () => void
} {
  const [weatherVisible, setWeatherVisible] = useState(() => {
    try {
      return localStorage.getItem('cb-weather-visible') === 'true'
    } catch {
      return false
    }
  })
  const [weatherType, setWeatherType] = useState<WeatherType>(() => {
    try {
      const saved = localStorage.getItem('cb-weather-type') as WeatherType
      return WEATHER_TYPES.includes(saved) ? saved : pickRandom()
    } catch {
      return pickRandom()
    }
  })

  // Hourly random weather: 50% chance to show, random type
  useEffect(() => {
    const tryRandomWeather = (): void => {
      // Only trigger if user hasn't manually turned it on
      const manuallyOn = localStorage.getItem('cb-weather-manual') === 'true'
      if (manuallyOn) return

      if (Math.random() < 0.5) {
        const t = pickRandom()
        setWeatherType(t)
        setWeatherVisible(true)
        localStorage.setItem('cb-weather-type', t)
        localStorage.setItem('cb-weather-visible', 'true')
        localStorage.setItem('cb-weather-auto', 'true')

        // Auto-dismiss after 5–15 minutes
        const duration = (5 + Math.random() * 10) * 60 * 1000
        setTimeout(() => {
          // Only auto-dismiss if it's still the auto-triggered one
          if (localStorage.getItem('cb-weather-auto') === 'true') {
            setWeatherVisible(false)
            localStorage.setItem('cb-weather-visible', 'false')
            localStorage.removeItem('cb-weather-auto')
          }
        }, duration)
      } else {
        // 50% chance → no weather
        if (localStorage.getItem('cb-weather-auto') === 'true') {
          setWeatherVisible(false)
          localStorage.setItem('cb-weather-visible', 'false')
          localStorage.removeItem('cb-weather-auto')
        }
      }
    }

    // Run once on mount after a short delay, then every hour
    const initialTimer = setTimeout(tryRandomWeather, 3000)
    const interval = setInterval(tryRandomWeather, 60 * 60 * 1000)

    return () => {
      clearTimeout(initialTimer)
      clearInterval(interval)
    }
  }, [])

  const toggleWeather = useCallback(() => {
    setWeatherVisible((prev) => {
      const next = !prev
      if (next) {
        const t = pickRandom()
        setWeatherType(t)
        localStorage.setItem('cb-weather-type', t)
        localStorage.setItem('cb-weather-manual', 'true')
        localStorage.removeItem('cb-weather-auto')
      } else {
        localStorage.removeItem('cb-weather-manual')
        localStorage.removeItem('cb-weather-auto')
      }
      localStorage.setItem('cb-weather-visible', String(next))
      return next
    })
  }, [])

  const cycleWeather = useCallback(() => {
    setWeatherType((prev) => {
      const idx = WEATHER_TYPES.indexOf(prev)
      const next = WEATHER_TYPES[(idx + 1) % WEATHER_TYPES.length]
      localStorage.setItem('cb-weather-type', next)
      return next
    })
  }, [])

  return { weatherType, weatherVisible, toggleWeather, cycleWeather }
}

export default WeatherEffect
