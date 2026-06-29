import React, { useRef, useEffect, useState } from 'react';
import { HiMicrophone, HiStop } from 'react-icons/hi';
import AudioWaveform, { AudioSignal, AudioLine, AudioGlow } from './AudioVisualizer';
import useVoiceStore from '../store/useVoiceStore';

/**
 * Compact voice button for the chat input bar.
 * When recording, expands to fill the full pill width with a responsive waveform.
 */
export default function VoiceButton({ onRecordComplete, disabled = false }) {
  const isRecording    = useVoiceStore((s) => s.isRecording);
  const isTranscribing = useVoiceStore((s) => s.isTranscribing);
  const recordingDuration = useVoiceStore((s) => s.recordingDuration);

  const waveContainerRef = useRef(null);
  const [waveWidth, setWaveWidth] = useState(100);

  // Track the waveform container's width so the canvas fills it exactly
  useEffect(() => {
    if (!isRecording) return;
    const el = waveContainerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setWaveWidth(Math.floor(entry.contentRect.width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [isRecording]);

  const formatDuration = (sec) => {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const state = isTranscribing ? 'transcribing' : isRecording ? 'recording' : 'idle';

  return (
    <div
      id="voice-button-container"
      className={`flex items-center gap-2 transition-all duration-250 ${isRecording ? 'flex-1 min-w-0 w-full' : 'flex-shrink-0'}`}
    >
      {state === 'transcribing' ? (
        <div
          className="transcribing-loader w-10 h-10 min-w-[40px] min-h-[40px] flex-shrink-0"
          aria-label="Transcribing audio"
          aria-busy="true"
        >
          <div className="orbit-ring" />
          <div className="orbit-ring-inner" />
          <div className="orbit-dot" />
        </div>
      ) : (
        <div className="relative flex items-center justify-center w-10 h-10 min-w-[40px] min-h-[40px] flex-shrink-0">
          <AudioGlow size={72} />
          <button
            id="voice-record-btn"
            className={`
              vb-${state}
              relative z-[2] w-10 h-10 min-w-[40px] min-h-[40px] flex-shrink-0
              flex items-center justify-center cursor-pointer text-white
              transition-all duration-200 border-none outline-none
              disabled:opacity-40 disabled:cursor-not-allowed disabled:!transform-none disabled:!animate-none
              ${state === 'idle'
                ? 'shadow-[0_2px_12px_rgba(29,108,184,0.45)] hover:scale-[1.06] active:scale-95'
                : 'shadow-[0_4px_28px_rgba(29,108,184,0.55)] animate-pulse-beat'}
            `}
            style={{
              borderRadius: '9999px',
              background: state === 'recording'
                ? 'linear-gradient(135deg, #1A3B8A, #1D6CB8)'
                : 'linear-gradient(135deg, #1D6CB8, #2A8FD4)',
            }}
            onClick={onRecordComplete}
            disabled={disabled}
            aria-label={isRecording ? 'Stop voice command' : 'Start voice command'}
            title={isRecording ? 'Stop voice command' : 'Voice command'}
          >
            {state === 'recording' ? <HiStop size={18} /> : <HiMicrophone size={21} />}
          </button>
        </div>
      )}

      {/* Waveform + duration — stretches to fill remaining pill width */}
      {isRecording && (
        <div className="flex items-center gap-3 animate-fade-in flex-1 min-w-0">
          <div ref={waveContainerRef} className="flex-1 min-w-0">
            <AudioSignal width={waveWidth} height={24} />
          </div>
          <span
            className="text-[0.8125rem] font-bold tabular-nums whitespace-nowrap tracking-wide flex-shrink-0"
            style={{ color: '#4DBADF' }}
          >
            {formatDuration(recordingDuration)}
          </span>
        </div>
      )}
    </div>
  );
}
