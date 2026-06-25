import React from 'react';
import { HiMicrophone, HiStop } from 'react-icons/hi';
import AudioWaveform, { AudioGlow } from './AudioVisualizer';
import useVoiceStore from '../store/useVoiceStore';

/**
 * Compact voice button for the chat input bar.
 * Shows a small waveform + duration counter when recording.
 */
export default function VoiceButton({ onRecordComplete, disabled = false }) {
  const isRecording = useVoiceStore((s) => s.isRecording);
  const isTranscribing = useVoiceStore((s) => s.isTranscribing);
  const recordingDuration = useVoiceStore((s) => s.recordingDuration);

  const formatDuration = (sec) => {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const state = isTranscribing ? 'transcribing' : isRecording ? 'recording' : 'idle';

  return (
    <div className="flex items-center gap-2 flex-shrink-0 transition-all duration-250" id="voice-button-container">
      {state === 'transcribing' ? (
        /* Compact orbital loader for chat input bar */
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
                ? 'bg-[#3B82F6] shadow-[0_2px_12px_rgba(59,130,246,0.4)] hover:bg-[#2563EB] hover:scale-[1.06] active:scale-95'
                : 'bg-red-500 shadow-[0_4px_28px_rgba(239,68,68,0.4)] animate-pulse-beat'}
            `}
            style={{ borderRadius: '9999px' }}
            onClick={onRecordComplete}
            disabled={disabled}
            aria-label={isRecording ? 'Stop voice command' : 'Start voice command'}
            title={isRecording ? 'Stop voice command' : 'Voice command'}
          >
            {state === 'recording' ? <HiStop size={18} /> : <HiMicrophone size={21} />}
          </button>
        </div>
      )}

      {/* Inline waveform + duration when recording */}
      {isRecording && (
        <div className="flex items-center gap-3 animate-fade-in">
          <AudioWaveform width={100} height={24} />
          <span className="text-[0.8125rem] font-bold text-red-400 tabular-nums whitespace-nowrap tracking-wide">
            {formatDuration(recordingDuration)}
          </span>
        </div>
      )}
    </div>
  );
}
