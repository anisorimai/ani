import React, { useRef, useEffect } from 'react';
import useVoiceStore from '../store/useVoiceStore';

/**
 * Real-time audio waveform visualizer.
 * Always shows an animated idle wave when recording, reacts to mic volume.
 * Uses canvas for smooth 60fps rendering.
 */
export default function AudioWaveform({ width = 200, height = 40 }) {
  const canvasRef = useRef(null);
  const animRef   = useRef(null);
  const isRecording = useVoiceStore((s) => s.isRecording);
  const volume      = useVoiceStore((s) => s.volume);
  const volumeRef   = useRef(0);
  const smoothRef   = useRef(0);
  const barsRef     = useRef(Array(24).fill(0));

  /* Keep volumeRef in sync with the store value each frame */
  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);

  useEffect(() => {
    if (!isRecording) return;

    /* Wait one microtask so the canvas is in the DOM */
    const raf = requestAnimationFrame(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      canvas.width  = width  * dpr;
      canvas.height = height * dpr;
      ctx.scale(dpr, dpr);

      const BAR_COUNT = 24;
      const GAP       = 3;
      const barWidth  = (width - (BAR_COUNT - 1) * GAP) / BAR_COUNT;
      const centerY   = height / 2;
      const MIN_H     = height * 0.18; // always at least 18% of canvas height

      const draw = () => {
        ctx.clearRect(0, 0, width, height);

        /* Smooth volume towards current value */
        smoothRef.current += (volumeRef.current - smoothRef.current) * 0.2;
        const vol = smoothRef.current;

        /* Add a sine-based idle wave so bars are always visible */
        const bars = barsRef.current;
        const t    = Date.now() * 0.004;
        for (let i = 0; i < BAR_COUNT; i++) {
          const idle   = MIN_H * (0.5 + 0.5 * Math.sin(t + i * 0.55));
          const active = vol * (0.35 + 0.65 * Math.abs(Math.sin(t * 1.3 + i * 0.6))) * height * 0.88;
          const target = Math.max(idle, active);
          bars[i] += (target - bars[i]) * 0.25;
        }

        /* Draw bars: royal blue → sky blue gradient (matches logo) */
        for (let i = 0; i < BAR_COUNT; i++) {
          const x    = i * (barWidth + GAP);
          const barH = bars[i];
          const frac = i / BAR_COUNT;

          /* Interpolate: #1D6CB8 (29,108,184) → #4DBADF (77,186,223) */
          const r = Math.round(29  + (77  - 29)  * frac);
          const g = Math.round(108 + (186 - 108) * frac);
          const b = Math.round(184 + (223 - 184) * frac);
          /* Alpha: minimum 0.80 so bars are always clearly visible */
          const alpha = Math.min(1, 0.80 + vol * 0.20);

          ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
          ctx.beginPath();
          ctx.roundRect(x, centerY - barH / 2, barWidth, barH, barWidth / 2);
          ctx.fill();
        }

        animRef.current = requestAnimationFrame(draw);
      };

      draw();
    });

    return () => {
      cancelAnimationFrame(raf);
      if (animRef.current) cancelAnimationFrame(animRef.current);
      animRef.current = null;
      /* Reset bars for next session */
      barsRef.current = Array(24).fill(0);
      smoothRef.current = 0;
    };
  }, [isRecording, width, height]);

  /* Always render the canvas so canvasRef is populated before the effect */
  return (
    <canvas
      ref={canvasRef}
      className="block flex-shrink-0"
      style={{
        width,
        height,
        opacity: isRecording ? 1 : 0,
        transition: 'opacity 0.2s ease',
      }}
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
