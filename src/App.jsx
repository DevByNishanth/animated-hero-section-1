import { useEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'
import './App.css'

gsap.registerPlugin(ScrollTrigger)

/* ---- Tuning knobs ---------------------------------------------------- */
const FRAME_COUNT = 301                    // number of files in /public/frames
const FRAMES_DIR_LARGE = '/frames'         // 1600px wide
const FRAMES_DIR_SMALL = '/frames-sm'      // 960px wide (phones / small screens)
const SMALL_SCREEN_MAX_WIDTH = 820
// Viewport heights of scrolling for the whole walkthrough. Higher = slower.
const SCROLL_VIEWPORTS = 6
// How quickly the picture catches up with the scroll position (0-1 per frame
// at 60fps). Lower = floatier/more cinematic, higher = more direct.
const FOLLOW = 0.1
// Parallel image downloads while preloading.
const LOAD_CONCURRENCY = 8
/* ---------------------------------------------------------------------- */

const frameUrl = (dir, i) => `${dir}/frame_${String(i + 1).padStart(4, '0')}.webp`

function App() {
  const heroRef = useRef(null)
  const canvasRef = useRef(null)
  const [videoFailed, setVideoFailed] = useState(false)
  const [loadedPct, setLoadedPct] = useState(0)

  useEffect(() => {
    const canvas = canvasRef.current
    const hero = heroRef.current
    if (!canvas || !hero) return undefined

    const ctx = canvas.getContext('2d', { alpha: false })
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const dir = window.innerWidth <= SMALL_SCREEN_MAX_WIDTH ? FRAMES_DIR_SMALL : FRAMES_DIR_LARGE

    const images = new Array(FRAME_COUNT).fill(null)
    let disposed = false
    let lenis
    let trigger
    let tick
    let offLenisScroll

    let targetFrame = 0     // where scroll says we should be (float)
    let currentFrame = 0    // where we are drawing (float, eased)
    let lastDrawn = -1
    let cssW = 0
    let cssH = 0

    /* --- drawing ------------------------------------------------------ */
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      cssW = canvas.clientWidth
      cssH = canvas.clientHeight
      canvas.width = Math.round(cssW * dpr)
      canvas.height = Math.round(cssH * dpr)
      lastDrawn = -1
      draw(currentFrame)
    }

    // Closest loaded frame to index i (so gaps while loading never show blank).
    const nearest = (i) => {
      if (images[i]) return images[i]
      for (let d = 1; d < FRAME_COUNT; d++) {
        if (images[i - d]) return images[i - d]
        if (images[i + d]) return images[i + d]
      }
      return null
    }

    const drawCover = (img, alpha) => {
      const cw = canvas.width
      const ch = canvas.height
      const scale = Math.max(cw / img.naturalWidth, ch / img.naturalHeight)
      const w = img.naturalWidth * scale
      const h = img.naturalHeight * scale
      ctx.globalAlpha = alpha
      ctx.drawImage(img, (cw - w) / 2, (ch - h) / 2, w, h)
    }

    // Draws frame position f (float): blends the two neighbouring frames so
    // slow scrolling glides between frames instead of stepping.
    const draw = (f) => {
      if (disposed) return
      const clamped = Math.min(Math.max(f, 0), FRAME_COUNT - 1)
      if (Math.abs(clamped - lastDrawn) < 0.002) return
      const a = Math.floor(clamped)
      const b = Math.min(a + 1, FRAME_COUNT - 1)
      const mix = clamped - a
      const imgA = nearest(a)
      if (!imgA) return
      lastDrawn = clamped
      drawCover(imgA, 1)
      if (mix > 0.01 && b !== a) {
        const imgB = nearest(b)
        if (imgB && imgB !== imgA) drawCover(imgB, mix)
      }
      ctx.globalAlpha = 1
    }

    const setTargetFromProgress = (p) => {
      targetFrame = Math.min(Math.max(p, 0), 1) * (FRAME_COUNT - 1)
      if (reducedMotion) draw(targetFrame)
    }

    /* --- preloading --------------------------------------------------- */
    const loadImage = (i) =>
      new Promise((resolve) => {
        const img = new Image()
        img.decoding = 'async'
        img.onload = () => {
          // decode() makes sure the bitmap is ready so drawing never janks
          const done = () => {
            images[i] = img
            resolve(true)
          }
          if (img.decode) img.decode().then(done, done)
          else done()
        }
        img.onerror = () => resolve(false)
        img.src = frameUrl(dir, i)
      })

    const preload = async () => {
      // First frame immediately so the hero is never empty.
      const ok = await loadImage(0)
      if (disposed) return
      if (!ok) {
        setVideoFailed(true)
        return
      }
      resize()

      // Load in a spread order (every 8th frame first, then fill in) so the
      // scene is usable at low fidelity long before everything is downloaded.
      const order = []
      const seen = new Set([0])
      for (const step of [8, 4, 2, 1]) {
        for (let i = 0; i < FRAME_COUNT; i += step) {
          if (!seen.has(i)) {
            seen.add(i)
            order.push(i)
          }
        }
      }
      if (!seen.has(FRAME_COUNT - 1)) order.unshift(FRAME_COUNT - 1)

      let done = 1
      let cursor = 0
      const worker = async () => {
        while (!disposed && cursor < order.length) {
          const i = order[cursor++]
          await loadImage(i)
          done++
          if (done % 6 === 0 || done === FRAME_COUNT) {
            setLoadedPct(Math.round((done / FRAME_COUNT) * 100))
          }
        }
      }
      await Promise.all(Array.from({ length: LOAD_CONCURRENCY }, worker))
      if (!disposed) {
        setLoadedPct(100)
        ScrollTrigger.refresh()
      }
    }

    /* --- scroll + render loop ---------------------------------------- */
    ScrollTrigger.config({ ignoreMobileResize: true })

    if (!reducedMotion) {
      lenis = new Lenis({ autoRaf: false, smoothWheel: true })

      // One animation loop: GSAP's ticker drives Lenis AND the canvas.
      gsap.ticker.lagSmoothing(0)
      tick = (time, deltaTime) => {
        lenis.raf(time * 1000)
        // Frame-rate independent easing toward the scroll target.
        const k = 1 - Math.pow(1 - FOLLOW, (deltaTime || 16.7) / 16.7)
        currentFrame += (targetFrame - currentFrame) * k
        if (Math.abs(targetFrame - currentFrame) < 0.01) currentFrame = targetFrame
        draw(currentFrame)
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
        end: () => `+=${window.innerHeight * SCROLL_VIEWPORTS}`,
        pin: true,
        anticipatePin: 1,
        invalidateOnRefresh: true,
        onUpdate: (self) => setTargetFromProgress(self.progress),
        onRefresh: (self) => setTargetFromProgress(self.progress),
      })
    }

    window.addEventListener('resize', resize)
    preload()

    return () => {
      disposed = true
      window.removeEventListener('resize', resize)
      trigger?.kill()
      offLenisScroll?.()
      if (tick) gsap.ticker.remove(tick)
      lenis?.destroy()
    }
  }, [])

  return (
    <main>
      <section className={`hero${videoFailed ? ' hero--video-error' : ''}`} ref={heroRef} aria-label="Atelier interior design">
        <canvas
          className="hero__video"
          ref={canvasRef}
          style={{ display: 'block', width: '100%', height: '100%' }}
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
          <span className="scroll-cue"><i /> {loadedPct < 100 ? `LOADING ${loadedPct}%` : 'SCROLL TO EXPLORE'}</span>
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
