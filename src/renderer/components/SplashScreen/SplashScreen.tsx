// SPDX-License-Identifier: Apache-2.0

/**
 * SplashScreen — Cinematic startup animation with humanistic touch.
 *
 * Architecture:
 *   - Rendered as a fixed z-9999 overlay on top of the entire app
 *   - AppLayout renders behind it (when appReady) for seamless reveal
 *   - CSS compositor-thread particle system (gold + blue, organic firefly)
 *   - Time-of-day greeting for human warmth
 *   - Module-level `splashPlayed` prevents replay on macOS hide/show
 *
 * Particle animation (CSS compositor thread):
 *   Firefly particles are rendered as absolutely-positioned <div> elements with
 *   CSS keyframe animations using compositor-eligible properties (`transform`,
 *   `opacity`). Promoted to GPU layers via `will-change`, they animate on the
 *   browser's compositor thread — completely independent of the main JS thread.
 *   React mounting the entire AppLayout tree (DOM commits, style recalc, layout,
 *   effects) has ZERO impact on particle animation smoothness.
 *   No Canvas, no Web Worker, no OffscreenCanvas — just the browser doing what
 *   it does best: GPU-accelerated CSS compositing.
 *
 * CSS animation orchestration (JS-driven):
 *   CSS animations are triggered by adding the `.splash-in` class to elements
 *   at precisely scheduled times via JavaScript `setTimeout`. This decouples
 *   animation timing from DOM insertion, making it robust against:
 *     - React StrictMode double-mount (effects restart cleanly)
 *     - Electron window display gap (double rAF ensures first paint)
 *     - Vite HMR reloads (CSS re-application doesn't break sequencing)
 *     - Variable IPC response times (appReady is independent of timeline)
 *
 * Props:
 *   - appReady: boolean — true when initial data has loaded
 *   - onComplete: () => void — called after reveal animation finishes
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import logoSrc from '@/assets/opencow-ip.png'

// ── Module-level replay guard ──────────────────────────────────────
// Prevents splash from playing again on macOS show/hide window cycles.
// A module-level `let` is the correct pattern for Electron (not sessionStorage).
// IMPORTANT: Only set to `true` AFTER the animation fully completes —
// never inside useEffect setup, because React StrictMode double-mounts
// would prematurely mark it as played during the simulated unmount/remount.
let splashPlayed = false

interface SplashScreenProps {
  appReady: boolean
  onComplete: () => void
}

// ── Greeting logic ─────────────────────────────────────────────────

interface GreetingData {
  timeLabel: string
  message: string
}

function getGreeting(): GreetingData {
  const hour = new Date().getHours()

  if (hour >= 5 && hour < 12) {
    return { timeLabel: 'Good morning ☀️', message: 'A new day to create something wonderful' }
  }
  if (hour >= 12 && hour < 14) {
    return { timeLabel: 'Good afternoon 🌤', message: "Let's keep the momentum going" }
  }
  if (hour >= 14 && hour < 18) {
    return { timeLabel: 'Good afternoon ☕', message: 'Great ideas are brewing' }
  }
  if (hour >= 18 && hour < 22) {
    return { timeLabel: 'Good evening 🌆', message: 'The quiet hours spark the best ideas' }
  }
  // 22:00 – 4:59
  return { timeLabel: 'Burning the midnight oil 🌙', message: "The world is quiet — it's your time to shine" }
}

// ── Inspirational quotes ───────────────────────────────────────────

const QUOTES = [
  '"Technology is best when it brings people together." — Matt Mullenweg',
  '"The best way to predict the future is to create it." — Alan Kay',
  '"Stay hungry, stay foolish." — Steve Jobs',
  '"Make something wonderful and put it out there." — Steve Jobs',
  '"Simplicity is the ultimate sophistication." — Leonardo da Vinci',
  '"The only way to do great work is to love what you do." — Steve Jobs',
  '"In the middle of difficulty lies opportunity." — Albert Einstein',
  '"Creativity is intelligence having fun." — Albert Einstein',
]

function getRandomQuote(): string {
  return QUOTES[Math.floor(Math.random() * QUOTES.length)]
}

// ── Boot status text ───────────────────────────────────────────────

const BOOT_PHRASES = [
  'Initializing your workspace...',
  'Loading projects & preferences...',
  'Your AI companion is ready ✨',
]

// ── CSS Particle System ─────────────────────────────────────────────
//
// Firefly particles as GPU-composited <div> elements.
// Each particle gets randomized position, color, size, drift vectors,
// and timing — then CSS keyframes handle the actual animation on the
// compositor thread (completely off the main JS thread).

const PARTICLE_COUNT = 45

interface ParticleConfig {
  /** Inline styles including CSS custom properties consumed by @keyframes */
  style: React.CSSProperties
}

function generateParticles(): ParticleConfig[] {
  return Array.from({ length: PARTICLE_COUNT }, (): ParticleConfig => {
    // Position: distributed in a ring around center (viewport %)
    const angle = Math.random() * Math.PI * 2
    const dist = 8 + Math.random() * 32
    const x = 50 + Math.cos(angle) * dist
    const y = 50 + Math.sin(angle) * dist

    // Color palette: 65% gold, 20% amber, 15% blue (matches logo)
    const roll = Math.random()
    let color: string
    if (roll < 0.65) {
      color = `hsl(${38 + Math.random() * 15} ${70 + Math.random() * 20}% ${55 + Math.random() * 15}%)`
    } else if (roll < 0.85) {
      color = `hsl(${28 + Math.random() * 12} ${60 + Math.random() * 25}% ${50 + Math.random() * 15}%)`
    } else {
      color = `hsl(${205 + Math.random() * 15} ${70 + Math.random() * 20}% ${55 + Math.random() * 15}%)`
    }

    // Size: three tiers for depth — small (foreground dust), medium, large (hero fireflies)
    const sizeRoll = Math.random()
    const size = sizeRoll < 0.45
      ? 2 + Math.random() * 2     // 2-4px — ambient dust
      : sizeRoll < 0.8
        ? 3.5 + Math.random() * 2.5 // 3.5-6px — medium fireflies
        : 5.5 + Math.random() * 3   // 5.5-8.5px — hero fireflies
    const glowRadius = size * (4 + Math.random() * 5)

    // Animation timing — fast enough to show clear movement within the ~3s splash
    const duration = 3 + Math.random() * 4   // 3-7s full cycle (was 5-13s)
    const delay = -(Math.random() * 5)       // negative = start mid-cycle for organic stagger

    // Drift vectors (px) — large enough for obvious, lively motion
    const driftRange = 60 + Math.random() * 80  // 60-140px (was 30-80px)
    const dx1 = (Math.random() - 0.5) * driftRange
    const dy1 = -15 - Math.random() * 45    // stronger upward drift
    const dx2 = (Math.random() - 0.5) * driftRange
    const dy2 = -20 - Math.random() * 60

    // Peak opacity — higher for visibility, varied for depth
    const peak = 0.45 + Math.random() * 0.45

    return {
      style: {
        left: `${x}%`,
        top: `${y}%`,
        width: size,
        height: size,
        backgroundColor: color,
        boxShadow: `0 0 ${glowRadius}px ${color}`,
        animationDuration: `${duration}s`,
        animationDelay: `${delay}s`,
        '--dx1': `${dx1}px`,
        '--dy1': `${dy1}px`,
        '--dx2': `${dx2}px`,
        '--dy2': `${dy2}px`,
        '--peak': `${peak}`,
      } as React.CSSProperties,
    }
  })
}

// ── Animation timeline ─────────────────────────────────────────────
//
// Each step triggers CSS animations via `.splash-in` class addition.
// Delays are relative to the first browser paint (double rAF), NOT DOM insertion.
//
//   Step 1 (0ms):    Logo materializes + ambient glow fades in + particles
//   Step 2 (500ms):  Greeting slides up (overlaps with logo settle)
//   Step 3 (700ms):  Footer quote + brand name (anchors the composition)
//   Step 4 (1300ms): Boot status + progress bar (last, feels like "ready")
//
const STEP_DELAYS_MS = [0, 500, 700, 1300] as const

/** Minimum splash display time (ms) from mount.
 *  Ensures the full animation plays before reveal, even if appReady fires instantly. */
const MINIMUM_DISPLAY_MS = 3000

// ── Component ──────────────────────────────────────────────────────

export function SplashScreen({ appReady, onComplete }: SplashScreenProps): React.JSX.Element | null {
  const [phase, setPhase] = useState<'boot' | 'ready' | 'reveal'>('boot')
  const [step, setStep] = useState(0)
  const [bootPhraseIdx, setBootPhraseIdx] = useState(0)
  const [greeting] = useState(getGreeting)
  const [quote] = useState(getRandomQuote)
  const [particles] = useState(generateParticles)

  const mountTimeRef = useRef(Date.now())

  // If splash already completed in a PREVIOUS mount cycle (macOS hide/show),
  // skip immediately. Note: we check `splashPlayed` but NEVER set it during
  // effect setup — only after the animation fully completes. This makes it
  // safe under React StrictMode's double-mount in development.
  const shouldSkip = splashPlayed

  // ── Skip immediately if already played ─────────────────────────
  useEffect(() => {
    if (shouldSkip) onComplete()
  }, [shouldSkip, onComplete])

  // ── JS-driven animation timeline ───────────────────────────────
  // Double requestAnimationFrame ensures at least one browser paint has
  // completed, guaranteeing the Electron window is visible before
  // animations begin. This eliminates the timing gap between DOM
  // insertion and window display that broke CSS animation-delay.
  useEffect(() => {
    if (shouldSkip) return

    let cancelled = false
    const timers: ReturnType<typeof setTimeout>[] = []
    let raf1 = 0
    let raf2 = 0

    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        if (cancelled) return

        // Step 1 is immediate after first paint
        setStep(1)

        // Schedule remaining steps relative to first paint
        for (let i = 1; i < STEP_DELAYS_MS.length; i++) {
          timers.push(
            setTimeout(() => {
              if (!cancelled) setStep(i + 1)
            }, STEP_DELAYS_MS[i])
          )
        }
      })
    })

    return () => {
      cancelled = true
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
      timers.forEach(clearTimeout)
    }
  }, [shouldSkip])

  // ── Phase: boot → ready (when appReady + minimum time elapsed) ─
  useEffect(() => {
    if (!appReady || phase !== 'boot') return

    const elapsed = Date.now() - mountTimeRef.current
    const remaining = Math.max(0, MINIMUM_DISPLAY_MS - elapsed)

    const timer = setTimeout(() => setPhase('ready'), remaining)
    return () => clearTimeout(timer)
  }, [appReady, phase])

  // ── Phase: ready → reveal ──────────────────────────────────────
  useEffect(() => {
    if (phase !== 'ready') return
    const timer = setTimeout(() => setPhase('reveal'), 600)
    return () => clearTimeout(timer)
  }, [phase])

  // ── Phase: reveal → complete ───────────────────────────────────
  useEffect(() => {
    if (phase !== 'reveal') return
    const timer = setTimeout(() => {
      // Mark as played only AFTER animation completes — StrictMode safe
      splashPlayed = true
      onComplete()
    }, 700) // matches CSS reveal animation duration
    return () => clearTimeout(timer)
  }, [phase, onComplete])

  // ── Boot phrase cycling (starts when boot status becomes visible) ─
  const bootVisible = step >= 4
  useEffect(() => {
    if (!bootVisible) return
    let idx = 0
    const interval = setInterval(() => {
      idx++
      if (idx >= BOOT_PHRASES.length) {
        clearInterval(interval)
        return
      }
      setBootPhraseIdx(idx)
    }, 800)
    return () => clearInterval(interval)
  }, [bootVisible])

  // ── Handle animationEnd for reveal phase ───────────────────────
  const handleAnimationEnd = useCallback(
    (e: React.AnimationEvent) => {
      // Only respond to the reveal animation on the overlay itself,
      // not bubbled animationend events from child elements.
      if (e.target !== e.currentTarget) return
      if (phase === 'reveal') {
        splashPlayed = true
        onComplete()
      }
    },
    [phase, onComplete]
  )

  // Skip render entirely if already played
  if (shouldSkip) return null

  return (
    <div
      className={`splash-overlay${phase === 'reveal' ? ' splash-exit' : ''}`}
      onAnimationEnd={handleAnimationEnd}
    >
      {/* Ambient glow */}
      <div className={`splash-ambient${step >= 1 ? ' splash-in' : ''}`} />

      {/* Particle field — CSS compositor-thread animation (GPU layers) */}
      <div className={`splash-particles${step >= 1 ? ' splash-in' : ''}`}>
        {particles.map((p, i) => (
          <div key={i} className="splash-firefly" style={p.style} />
        ))}
      </div>

      {/* Center content */}
      <div className="splash-center">
        {/* Logo — IP character with breathing animation */}
        <div className={`splash-logo-wrapper${step >= 1 ? ' splash-in' : ''}`}>
          <div className="splash-ring" />
          <div className="splash-ring" />
          <div className="splash-ring" />
          <img src={logoSrc} alt="OpenCow" className="splash-logo-img" draggable={false} />
        </div>

        {/* Greeting */}
        <div className={`splash-greeting${step >= 2 ? ' splash-in' : ''}`}>
          <div className="splash-greeting-time">{greeting.timeLabel}</div>
          <div className="splash-greeting-message">{greeting.message}</div>
        </div>

        {/* Boot status */}
        <div className={`splash-boot-status${step >= 4 ? ' splash-in' : ''}`}>
          <div className="splash-progress-track">
            <div className="splash-progress-fill" />
          </div>
          <div className="splash-boot-text">{BOOT_PHRASES[bootPhraseIdx]}</div>
        </div>
      </div>

      {/* Footer */}
      <div className={`splash-footer${step >= 3 ? ' splash-in' : ''}`}>
        <div className="splash-quote">{quote}</div>
      </div>
      <div className={`splash-brand${step >= 3 ? ' splash-in' : ''}`}>OpenCow</div>
    </div>
  )
}
