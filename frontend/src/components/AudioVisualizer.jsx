import React, { useRef, useEffect } from 'react';
import useVoiceStore from '../store/useVoiceStore';

/**
 * Real-time audio waveform visualizer.
 * Always shows an animated idle wave when recording, reacts to mic volume.
 * Uses canvas for smooth 60fps rendering.
 */
export default function AudioWaveform({ width = 220, height = 44 }) {
  const canvasRef   = useRef(null);
  const animRef     = useRef(null);
  const isRecording = useVoiceStore((s) => s.isRecording);
  const volume      = useVoiceStore((s) => s.volume);
  const volumeRef   = useRef(0);
  const smoothRef   = useRef(0);

  const BAR_COUNT = 54;
  const barsRef   = useRef(new Float32Array(BAR_COUNT));

  useEffect(() => { volumeRef.current = volume; }, [volume]);

  useEffect(() => {
    if (!isRecording) return;

    const raf = requestAnimationFrame(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      canvas.width  = width  * dpr;
      canvas.height = height * dpr;
      ctx.scale(dpr, dpr);

      const GAP      = 2.5;
      const barW     = (width - (BAR_COUNT - 1) * GAP) / BAR_COUNT;
      const centerY  = height / 2;
      const MIN_HALF = 1.5;
      const MAX_HALF = centerY - 1;

      const draw = () => {
        ctx.clearRect(0, 0, width, height);

        smoothRef.current += (volumeRef.current - smoothRef.current) * 0.15;
        const vol = Math.min(1, smoothRef.current);
        const t   = Date.now() * 0.001;

        /* Layered sine waves — high-frequency mix for a realistic jagged waveform */
        for (let i = 0; i < BAR_COUNT; i++) {
          const n  = i / (BAR_COUNT - 1);
          const w1 = Math.sin(n * Math.PI * 7  + t * 2.4) * 0.38;
          const w2 = Math.sin(n * Math.PI * 3  - t * 1.6) * 0.28;
          const w3 = Math.sin(n * Math.PI * 11 + t * 3.5) * 0.18;
          const w4 = Math.sin(n * Math.PI * 5  - t * 0.9) * 0.16;
          const combined = Math.abs(w1 + w2 + w3 + w4);   // always positive → symmetric bars

          const idleHalf  = MIN_HALF + MAX_HALF * 0.30 * combined;
          const activeHalf = MIN_HALF + MAX_HALF * Math.min(1, vol * 2.2) * combined;
          const target = Math.max(idleHalf, activeHalf);

          barsRef.current[i] += (target - barsRef.current[i]) * 0.22;
        }

        /* Glow shadow */
        ctx.shadowBlur  = 8;
        ctx.shadowColor = 'rgba(45, 212, 191, 0.55)';

        for (let i = 0; i < BAR_COUNT; i++) {
          const x     = i * (barW + GAP);
          const halfH = Math.max(MIN_HALF, barsRef.current[i]);

          /* Vertical gradient: bright teal tips → slightly dimmer at center */
          const grad = ctx.createLinearGradient(0, centerY - halfH, 0, centerY + halfH);
          grad.addColorStop(0,    'rgba(56, 232, 202, 1.00)');   // top tip
          grad.addColorStop(0.35, 'rgba(14, 165, 233, 0.85)');   // upper mid
          grad.addColorStop(0.50, 'rgba(14, 165, 233, 0.55)');   // center
          grad.addColorStop(0.65, 'rgba(14, 165, 233, 0.85)');   // lower mid
          grad.addColorStop(1,    'rgba(56, 232, 202, 1.00)');   // bottom tip

          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.roundRect(x, centerY - halfH, barW, halfH * 2, barW / 2);
          ctx.fill();
        }

        ctx.shadowBlur = 0;
        animRef.current = requestAnimationFrame(draw);
      };

      draw();
    });

    return () => {
      cancelAnimationFrame(raf);
      if (animRef.current) cancelAnimationFrame(animRef.current);
      animRef.current = null;
      barsRef.current.fill(0);
      smoothRef.current = 0;
    };
  }, [isRecording, width, height]);

  return (
    <canvas
      ref={canvasRef}
      className="block flex-shrink-0"
      style={{ width, height, opacity: isRecording ? 1 : 0, transition: 'opacity 0.25s ease' }}
      aria-hidden="true"
    />
  );
}

/**
 * Audio-file-style signal waveform — many thin bars, speech-burst envelope,
 * soft light-blue coloring, symmetric about centre.
 */
export function AudioSignal({ width = 220, height = 44 }) {
  const canvasRef   = useRef(null);
  const animRef     = useRef(null);
  const isRecording = useVoiceStore((s) => s.isRecording);
  const volume      = useVoiceStore((s) => s.volume);
  const volumeRef   = useRef(0);
  const smoothRef   = useRef(0);

  const BAR_COUNT = 180;
  const barsRef   = useRef(new Float32Array(BAR_COUNT));

  useEffect(() => { volumeRef.current = volume; }, [volume]);

  useEffect(() => {
    if (!isRecording) return;

    const raf = requestAnimationFrame(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      canvas.width  = width  * dpr;
      canvas.height = height * dpr;
      ctx.scale(dpr, dpr);

      const GAP      = 0.8;
      const barW     = (width - (BAR_COUNT - 1) * GAP) / BAR_COUNT;
      const centerY  = height / 2;
      const MIN_HALF = 1;
      const MAX_HALF = centerY - 1;

      const draw = () => {
        ctx.clearRect(0, 0, width, height);

        smoothRef.current += (volumeRef.current - smoothRef.current) * 0.12;
        const vol = Math.min(1, smoothRef.current);
        const t   = Date.now() * 0.001;

        for (let i = 0; i < BAR_COUNT; i++) {
          const n = i / (BAR_COUNT - 1);

          // Three-layer speech envelope: word bursts → syllables → fine grain
          const env1 = 0.5 + 0.5 * Math.sin(n * Math.PI * 3.5 + t * 0.9);
          const env2 = 0.5 + 0.5 * Math.sin(n * Math.PI * 8   - t * 1.8);
          const env3 = 0.4 + 0.6 * Math.abs(Math.sin(n * Math.PI * 18 + t * 3.2));
          const envelope = env1 * 0.45 + env2 * 0.30 + env3 * 0.25;

          const idleHalf  = MIN_HALF + MAX_HALF * 0.22 * envelope;
          const activeHalf = MIN_HALF + MAX_HALF * Math.min(1, vol * 1.8) * envelope;
          const target = idleHalf + (activeHalf - idleHalf) * Math.min(1, vol * 2);

          barsRef.current[i] += (target - barsRef.current[i]) * 0.18;
        }

        ctx.shadowBlur  = 5;
        ctx.shadowColor = 'rgba(96, 165, 250, 0.45)';

        for (let i = 0; i < BAR_COUNT; i++) {
          const x     = i * (barW + GAP);
          const halfH = Math.max(MIN_HALF, barsRef.current[i]);

          ctx.fillStyle = 'rgba(147, 197, 253, 0.82)'; // blue-300
          ctx.beginPath();
          ctx.roundRect(x, centerY - halfH, barW, halfH * 2, Math.min(barW / 2, 1.2));
          ctx.fill();
        }

        ctx.shadowBlur = 0;
        animRef.current = requestAnimationFrame(draw);
      };

      draw();
    });

    return () => {
      cancelAnimationFrame(raf);
      if (animRef.current) cancelAnimationFrame(animRef.current);
      animRef.current  = null;
      barsRef.current.fill(0);
      smoothRef.current = 0;
    };
  }, [isRecording, width, height]);

  return (
    <canvas
      ref={canvasRef}
      className="block flex-shrink-0"
      style={{ width, height, opacity: isRecording ? 1 : 0, transition: 'opacity 0.25s ease' }}
      aria-hidden="true"
    />
  );
}

/**
 * Oscilloscope-style continuous line waveform.
 * Draws a single smooth curve that reacts to mic volume.
 */
export function AudioLine({ width = 220, height = 44 }) {
  const canvasRef   = useRef(null);
  const animRef     = useRef(null);
  const isRecording = useVoiceStore((s) => s.isRecording);
  const volume      = useVoiceStore((s) => s.volume);
  const volumeRef   = useRef(0);
  const smoothRef   = useRef(0);

  useEffect(() => { volumeRef.current = volume; }, [volume]);

  useEffect(() => {
    if (!isRecording) return;

    const raf = requestAnimationFrame(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      canvas.width  = width  * dpr;
      canvas.height = height * dpr;
      ctx.scale(dpr, dpr);

      const centerY = height / 2;

      const draw = () => {
        ctx.clearRect(0, 0, width, height);

        smoothRef.current += (volumeRef.current - smoothRef.current) * 0.12;
        const vol = Math.min(1, smoothRef.current);
        const t   = Date.now() * 0.001;

        // Idle amplitude always visible; grows with voice volume
        const amp = centerY * (0.28 + vol * 0.68);

        // Multiple overlapping waves for a natural speech waveform shape
        const STEPS = width * 2;
        ctx.beginPath();
        for (let s = 0; s <= STEPS; s++) {
          const n = s / STEPS;
          const x = n * width;
          const w1 = Math.sin(n * Math.PI * 22 + t * 4.2) * 0.42;
          const w2 = Math.sin(n * Math.PI * 14 - t * 2.8) * 0.30;
          const w3 = Math.sin(n * Math.PI * 36 + t * 6.1) * 0.16;
          const w4 = Math.sin(n * Math.PI *  8 - t * 1.4) * 0.12;
          const y  = centerY + amp * (w1 + w2 + w3 + w4);
          s === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }

        // Gradient stroke left → right: blue to teal
        const grad = ctx.createLinearGradient(0, 0, width, 0);
        grad.addColorStop(0,    '#3b82f6');
        grad.addColorStop(0.5,  '#06b6d4');
        grad.addColorStop(1,    '#2dd4bf');

        ctx.strokeStyle = grad;
        ctx.lineWidth   = 1.8;
        ctx.lineJoin    = 'round';
        ctx.shadowBlur  = 6;
        ctx.shadowColor = 'rgba(6, 182, 212, 0.5)';
        ctx.stroke();
        ctx.shadowBlur  = 0;

        animRef.current = requestAnimationFrame(draw);
      };

      draw();
    });

    return () => {
      cancelAnimationFrame(raf);
      if (animRef.current) cancelAnimationFrame(animRef.current);
      animRef.current  = null;
      smoothRef.current = 0;
    };
  }, [isRecording, width, height]);

  return (
    <canvas
      ref={canvasRef}
      className="block flex-shrink-0"
      style={{ width, height, opacity: isRecording ? 1 : 0, transition: 'opacity 0.25s ease' }}
      aria-hidden="true"
    />
  );
}

/**
 * Circular glow ring visualizer — renders around a mic button.
 * Shows expanding/contracting glow that reacts to voice volume.
 * Always draws a subtle idle pulse so the ring is visible even at 0 volume.
 */
export function AudioGlow({ size = 100 }) {
  const canvasRef   = useRef(null);
  const animRef     = useRef(null);
  const isRecording = useVoiceStore((s) => s.isRecording);
  const volume      = useVoiceStore((s) => s.volume);
  const volumeRef   = useRef(0);
  const smoothRef   = useRef(0);

  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);

  useEffect(() => {
    if (!isRecording) return;

    const raf = requestAnimationFrame(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      canvas.width  = size * dpr;
      canvas.height = size * dpr;
      ctx.scale(dpr, dpr);

      const center = size / 2;

      const draw = () => {
        ctx.clearRect(0, 0, size, size);
        smoothRef.current += (volumeRef.current - smoothRef.current) * 0.15;
        const vol = smoothRef.current;

        /* Idle pulse so glow is always visible */
        const idlePulse = 0.06 + 0.04 * Math.sin(Date.now() * 0.003);
        const effectiveVol = Math.max(idlePulse, vol);

        const rings = 3;
        for (let r = rings; r >= 1; r--) {
          const radius = 28 + r * 7 + effectiveVol * r * 14;
          const alpha  = (0.12 + effectiveVol * 0.18) / r;

          const grad = ctx.createRadialGradient(center, center, radius * 0.4, center, center, radius);
          grad.addColorStop(0,   `rgba(29, 108, 184, ${alpha})`);
          grad.addColorStop(0.5, `rgba(77, 186, 223, ${alpha * 0.55})`);
          grad.addColorStop(1,   'rgba(26, 59, 138, 0)');

          ctx.beginPath();
          ctx.arc(center, center, radius, 0, Math.PI * 2);
          ctx.fillStyle = grad;
          ctx.fill();
        }

        /* Inner ring */
        const innerRadius = 26 + effectiveVol * 8;
        ctx.beginPath();
        ctx.arc(center, center, innerRadius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(77, 186, 223, ${0.45 + effectiveVol * 0.45})`;
        ctx.lineWidth = 2;
        ctx.stroke();

        animRef.current = requestAnimationFrame(draw);
      };

      draw();
    });

    return () => {
      cancelAnimationFrame(raf);
      if (animRef.current) cancelAnimationFrame(animRef.current);
      animRef.current  = null;
      smoothRef.current = 0;
    };
  }, [isRecording, size]);

  /* Always render canvas; toggle visibility via opacity */
  return (
    <canvas
      ref={canvasRef}
      style={{
        width: size,
        height: size,
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        pointerEvents: 'none',
        zIndex: 0,
        opacity: isRecording ? 1 : 0,
        transition: 'opacity 0.25s ease',
      }}
      aria-hidden="true"
    />
  );
}
