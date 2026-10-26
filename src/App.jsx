import { useEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'
import './App.css'

gsap.registerPlugin(ScrollTrigger)

const VIDEO_SRC = '/interior-design.mp4'

/* ---- Tuning knobs ---------------------------------------------------- */
// Required scroll distance for each second of video. More pixels = slower video.
// At 1200 px/s a 10-second clip spans about 12,000 px (roughly 13 viewports).
const SCROLL_PX_PER_SECOND = 1200
// Keep a useful pinned journey even for very short clips or unusually small windows.
const MIN_PIN_VIEWPORTS = 3
// Reduce wheel distance only while the hero is pinned; normal page scroll stays 1:1.
const HERO_WHEEL_MULTIPLIER = 0.6
// Keep Lenis' normal response curve; wheelMultiplier controls travel distance,
// while lerp controls how quickly Lenis catches up to that distance.
const LENIS_LERP = 0.1
// Stay slightly before the last timestamp to avoid black/blank final frames.
const END_PADDING = 0.05
// Ignore target changes smaller than this (seconds) to avoid redundant seeks.
const SEEK_EPSILON = 0.03
/* ---------------------------------------------------------------------- */

function App() {
  const heroRef = useRef(null)
  const videoRef = useRef(null)
  const [videoFailed, setVideoFailed] = useState(false)

  useEffect(() => {
    const video = videoRef.current
    const hero = heroRef.current
    if (!video || !hero) return undefined

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let lenis
    let trigger
    let tick
    let offLenisScroll
    let disposed = false

    // Latest wanted timestamp. Only the newest value matters, so there is never
    // a backlog of obsolete seek requests.
    let targetTime = 0
    let seekInFlight = false

    const maxTime = () => Math.max(video.duration - END_PADDING, 0)

    // Called once per frame from the shared GSAP ticker.
    const applySeek = () => {
      if (disposed || video.readyState < HTMLMediaElement.HAVE_METADATA) return

      // currentTime seeks are asynchronous. Keep replacing targetTime while a
      // seek is active, then catch up to the latest position after `seeked`.
      if (seekInFlight || video.seeking) return

      const target = Math.min(Math.max(targetTime, 0), maxTime())
      if (Math.abs(target - video.currentTime) <= SEEK_EPSILON) return

      seekInFlight = true
      try {
        video.currentTime = target
      } catch {
        seekInFlight = false
      }
    }

    const setTargetFromProgress = (progress) => {
      targetTime = Math.min(Math.max(progress, 0), 1) * maxTime()
    }

    const handleError = () => {
      seekInFlight = false
      setVideoFailed(true)
      trigger?.kill()
      trigger = undefined
    }

    const handleSeeking = () => {
      seekInFlight = true
    }

    const handleSeeked = () => {
      seekInFlight = false
    }

    const createScrollSequence = () => {
      if (disposed || !Number.isFinite(video.duration) || video.duration <= 0) return

      video.pause()
      targetTime = 0

      if (!reducedMotion) {
        lenis = new Lenis({
          autoRaf: false,
          smoothWheel: true,
          lerp: LENIS_LERP,
          // The callback scales wheel input only while this pinned sequence is active.
          virtualScroll: (data) => {
            if (trigger?.isActive && data.event.type.includes('wheel')) {
              data.deltaX *= HERO_WHEEL_MULTIPLIER
              data.deltaY *= HERO_WHEEL_MULTIPLIER
            }
          },
        })

        // Single animation loop: GSAP's ticker drives Lenis AND video seeks.
        tick = (time) => {
          lenis.raf(time * 1000)
          applySeek()
        }
        gsap.ticker.add(tick)

        const updateScroll = () => ScrollTrigger.update()
        const unsubscribe = lenis.on('scroll', updateScroll)
        offLenisScroll = typeof unsubscribe === 'function'
          ? unsubscribe
          : () => lenis.off('scroll', updateScroll)

        trigger = ScrollTrigger.create({
          trigger: hero,
          start: 'top top',
          // The full clip spans duration times the configured pixel rate.
          end: () => `+=${Math.max(
            video.duration * SCROLL_PX_PER_SECOND,
            window.innerHeight * MIN_PIN_VIEWPORTS,
          )}`,
          pin: true,
          anticipatePin: 1,
          invalidateOnRefresh: true,
          // Lenis already smooths the scroll, so no extra scrub smoothing here.
          onUpdate: (self) => setTargetFromProgress(self.progress),
          onRefresh: (self) => {
            setTargetFromProgress(self.progress)
            const pinnedDistance = Math.max(0, self.end - self.start)
            console.info('[Cinematic hero] Scroll timing', {
              videoDurationSeconds: Number(video.duration.toFixed(3)),
              totalPinnedScrollPx: Math.round(pinnedDistance),
              scrollPxPerVideoSecond: Number((pinnedDistance / video.duration).toFixed(1)),
              heroWheelMultiplier: HERO_WHEEL_MULTIPLIER,
            })
          },
        })
      }

      ScrollTrigger.refresh()
    }

    // Avoid layout jumps when mobile browser toolbars show/hide.
    ScrollTrigger.config({ ignoreMobileResize: true })

    video.addEventListener('loadedmetadata', createScrollSequence, { once: true })
    video.addEventListener('seeking', handleSeeking)
    video.addEventListener('seeked', handleSeeked)
    video.addEventListener('error', handleError)
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) createScrollSequence()

    return () => {
      disposed = true
      video.removeEventListener('loadedmetadata', createScrollSequence)
      video.removeEventListener('seeking', handleSeeking)
      video.removeEventListener('seeked', handleSeeked)
      video.removeEventListener('error', handleError)
      trigger?.kill()
      offLenisScroll?.()
      if (tick) gsap.ticker.remove(tick)
      lenis?.destroy()
    }
  }, [])

  return (
    <main>
      <section className={`hero${videoFailed ? ' hero--video-error' : ''}`} ref={heroRef} aria-label="Atelier interior design">
        <video
          className="hero__video"
          ref={videoRef}
          src={VIDEO_SRC}
          muted
          playsInline
          preload="auto"
          aria-hidden="true"
        />
        <div className="hero__shade" />
        <header className="hero__header">
          <a className="wordmark" href="#home" aria-label="Forma home">FORMA<span> / </span>STUDIO</a>
          <span className="header-note">INTERIORS WITH INTENTION</span>
          <a className="header-link" href="#studio">DISCOVER THE STUDIO <span>↗</span></a>
        </header>
        <div className="hero__copy" id="home">
          <p className="eyebrow"><span /> SPACES THAT STAY WITH YOU</p>
          <h1>Find your<br /><em>still point.</em></h1>
          <p className="hero__description">Considered interiors shaped by light, material, and the way you live.</p>
        </div>
        <div className="hero__footer">
          <span>RESIDENTIAL · HOSPITALITY · OBJECTS</span>
          <span className="scroll-cue"><i /> SCROLL TO EXPLORE</span>
          <span>EST. 2014&nbsp;&nbsp; — &nbsp;&nbsp;COPENHAGEN</span>
        </div>
      </section>

      <section className="studio" id="studio">
        <div className="studio__index">01 <span>—</span> THE STUDIO</div>
        <div className="studio__content">
          <p className="eyebrow eyebrow--dark">A QUIETER KIND OF BOLD</p>
          <h2>Good design makes<br />room for <em>being.</em></h2>
          <p className="studio__description">We create enduring spaces that feel as natural as they look. Every detail has a reason; every room, a point of view.</p>
          <a className="studio__link" href="mailto:hello@formastudio.example">MEET FORMA STUDIO <span>↗</span></a>
        </div>
        <div className="studio__bottom"><span>FORM FOLLOWS FEELING.</span><span>© FORMA STUDIO 2026</span></div>
      </section>
    </main>
  )
}

export default App
