import React from 'react'
import { theme } from 'antd'
import type { LobsterAnimationState } from '../../types/openclaw'
import './LobsterSVG.css'

interface LobsterSVGProps {
  state: LobsterAnimationState
  size?: number
  variant?: 'main' | 'sub'
}

const LobsterSVG: React.FC<LobsterSVGProps> = ({ state, size = 160, variant = 'main' }) => {
  const { token } = theme.useToken()
  const showAccessory = state !== 'idle' && state !== 'thinking' && state !== 'scratching'

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 -30 500 580"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g className={`lobster--${state}`} transform="translate(0, -20)">

        {/* ── Body + head parts (eyes & antennas move with body) ── */}
        <g className="lobster__body" style={{ transformOrigin: '250px 250px' }}>
          {/* Legs */}
          {variant === 'main' && (
            <path
              d="M 210 330 L 190 410 M 240 340 L 230 420 M 270 340 L 280 420 M 300 330 L 320 410"
              stroke="#BD3328" strokeWidth="12" strokeLinecap="round"
            />
          )}
          {/* Tail fins */}
          <g transform="translate(15, -10)">
            <ellipse cx="290" cy="330" rx="40" ry="25" transform="rotate(20 290 330)" fill="#D63D31" />
            <ellipse cx="330" cy="350" rx="35" ry="20" transform="rotate(40 330 350)" fill="#E74C3C" />
            <ellipse cx="360" cy="370" rx="30" ry="15" transform="rotate(60 360 370)" fill="#D63D31" />
            <path d="M 370 370 Q 420 350 430 380 Q 430 410 390 400 Z" fill="#E74C3C" />
          </g>
          {/* Main body */}
          <path d="M 250 40 C 265 40, 275 90, 290 160 C 315 280, 310 350, 250 350 C 190 350, 185 280, 210 160 C 225 90, 235 40, 250 40 Z" fill="#E74C3C" />
          {/* Body highlight */}
          <path d="M 250 80 C 260 80, 265 120, 280 180 C 295 250, 290 330, 250 330 C 210 330, 205 250, 220 180 C 235 120, 240 80, 250 80 Z" fill="#EF695B" opacity="0.3" />
          {/* Shell markings */}
          <polygon points="242,210 258,210 255,225 245,225" fill="#F1C40F" />
          <polygon points="245,225 255,225 265,300 250,330 235,300" fill="#F1C40F" />
          {/* Mouth */}
          <path d="M 235 180 Q 250 195 265 180" fill="none" stroke="#2D3E4E" strokeWidth="5" strokeLinecap="round" />
          {/* Eyebrow marks */}
          <path d="M 215 110 Q 230 100 240 115" fill="none" stroke="#2D3E4E" strokeWidth="4" strokeLinecap="round" />
          <path d="M 285 110 Q 270 100 260 115" fill="none" stroke="#2D3E4E" strokeWidth="4" strokeLinecap="round" />

          {/* Left Antenna — inside body so it sways with head */}
          <g className="lobster__left-antenna" style={{ transformOrigin: '160px 180px' }}>
            <path d="M 210 180 Q 150 200 130 150" fill="none" stroke="#BD3328" strokeWidth="5" strokeLinecap="round" />
          </g>

          {/* Right Antenna */}
          <g className="lobster__right-antenna" style={{ transformOrigin: '340px 180px' }}>
            <path d="M 290 180 Q 350 200 370 150" fill="none" stroke="#BD3328" strokeWidth="5" strokeLinecap="round" />
          </g>

          {/* Left Eye — inside body so it moves with head */}
          <g className="lobster__left-eye" style={{ transformOrigin: '200px 130px' }}>
            <ellipse cx="200" cy="130" rx="30" ry="35" fill="#FFFFFF" />
            <circle cx="200" cy="130" r="14" fill="#2D3E4E" />
          </g>

          {/* Right Eye */}
          <g className="lobster__right-eye" style={{ transformOrigin: '300px 130px' }}>
            <ellipse cx="300" cy="130" rx="30" ry="35" fill="#FFFFFF" />
            <circle cx="300" cy="130" r="14" fill="#2D3E4E" />
          </g>
        </g>

        {/* ── Left Claw (sibling — animates independently) ── */}
        <g className="lobster__left-claw" style={{ transformOrigin: '190px 240px' }}>
          <path d="M 210 230 C 170 250, 110 220, 110 180" fill="none" stroke="#E74C3C" strokeWidth="25" strokeLinecap="round" />
          <path d="M 120 190 C 30 200, -20 80, 60 60 C 110 50, 140 110, 120 150 C 110 170, 130 180, 120 190 Z" fill="#E74C3C" />
          <path d="M 100 180 C 140 170, 170 100, 130 80 C 100 60, 80 120, 100 180 Z" fill="#E74C3C" />
        </g>

        {/* ── Right Claw (sibling — animates independently) ── */}
        <g className="lobster__right-claw" style={{ transformOrigin: '310px 240px' }}>
          <path d="M 290 230 C 330 250, 390 220, 390 180" fill="none" stroke="#E74C3C" strokeWidth="25" strokeLinecap="round" />
          <path d="M 380 190 C 470 200, 520 80, 440 60 C 390 50, 360 110, 380 150 C 390 170, 370 180, 380 190 Z" fill="#E74C3C" />
          <path d="M 400 180 C 360 170, 330 100, 370 80 C 400 60, 420 120, 400 180 Z" fill="#E74C3C" />
        </g>

        {/* ── Thinking bubble ── */}
        {state === 'thinking' && (
          <g className="lobster__thinking-bubble">
            <circle cx="340" cy="100" r="6" fill="#FFFFFF" opacity={0.7} />
            <circle cx="370" cy="65" r="10" fill="#FFFFFF" opacity={0.85} />
            <rect x="380" y="10" width="90" height="55" rx="25" fill="#FFFFFF" />
            <circle cx="405" cy="37" r="6" fill="#2D3E4E" />
            <circle cx="425" cy="37" r="6" fill="#2D3E4E" />
            <circle cx="445" cy="37" r="6" fill="#2D3E4E" />
          </g>
        )}

        {/* ── State-specific accessories ── */}
        {showAccessory && (
          <g className="lobster__accessory" style={{ transformOrigin: '430px 50px' }}>
            {state === 'web_search' && (
              <>
                <circle cx="430" cy="52" r="28" stroke={token.colorInfo} strokeWidth="7" fill="none" />
                <line x1="450" y1="72" x2="472" y2="94" stroke={token.colorInfo} strokeWidth="7" strokeLinecap="round" />
              </>
            )}
            {state === 'doc_processing' && (
              <>
                <rect x="408" y="18" width="52" height="64" rx="6" fill="none" stroke={token.colorWarning} strokeWidth="6" />
                <line x1="420" y1="38" x2="448" y2="38" stroke={token.colorWarning} strokeWidth="4" />
                <line x1="420" y1="52" x2="448" y2="52" stroke={token.colorWarning} strokeWidth="4" />
                <line x1="420" y1="66" x2="440" y2="66" stroke={token.colorWarning} strokeWidth="4" />
              </>
            )}
            {state === 'sending_message' && (
              <>
                <rect x="385" y="14" width="90" height="55" rx="22" fill={token.colorSuccess} opacity={0.85} />
                <polygon points="410,69 422,90 434,69" fill={token.colorSuccess} opacity={0.85} />
                <circle cx="415" cy="41" r="6" fill="#FFFFFF" />
                <circle cx="430" cy="41" r="6" fill="#FFFFFF" />
                <circle cx="445" cy="41" r="6" fill="#FFFFFF" />
              </>
            )}
            {state === 'tool_call' && (
              <g style={{ transformOrigin: '430px 50px' }}>
                <circle cx="430" cy="50" r="22" fill="none" stroke={token.colorWarning} strokeWidth="6" />
                <circle cx="430" cy="50" r="9" fill={token.colorWarning} />
                {[0, 45, 90, 135].map((deg) => (
                  <line
                    key={deg}
                    x1={430 + 20 * Math.cos((deg * Math.PI) / 180)}
                    y1={50 + 20 * Math.sin((deg * Math.PI) / 180)}
                    x2={430 + 30 * Math.cos((deg * Math.PI) / 180)}
                    y2={50 + 30 * Math.sin((deg * Math.PI) / 180)}
                    stroke={token.colorWarning}
                    strokeWidth="7"
                    strokeLinecap="round"
                  />
                ))}
              </g>
            )}
            {state === 'agent_conversation' && (
              <>
                <rect x="382" y="8" width="74" height="44" rx="18" fill={token.colorPrimary} opacity={0.85} />
                <polygon points="396,52 408,70 420,52" fill={token.colorPrimary} opacity={0.85} />
                <rect x="424" y="36" width="74" height="44" rx="18" fill={token.colorSuccess} opacity={0.85} />
                <polygon points="438,80 450,98 462,80" fill={token.colorSuccess} opacity={0.85} />
              </>
            )}
          </g>
        )}
      </g>
    </svg>
  )
}

export default LobsterSVG

