import React from 'react';
import TextInput from './TextInput';
import VoiceButton from './VoiceButton';

export default function WelcomeScreen({
  onVoiceClick,
  onTextSend,
  isRecording,
  isBusy,
}) {
  return (
    <div className="flex items-center justify-center flex-1 h-full px-6 sm:px-10">
      <div className="w-full max-w-2xl">
        <div
          className={`
            chat-input-row flex items-center gap-2 relative
            bg-white dark:bg-[var(--surf)]
            rounded-full border border-[var(--brd)]
            px-3 py-2.5
            shadow-sm transition-all duration-150
            ${isRecording ? 'recording-pill' : ''}
          `}
        >
          <VoiceButton onRecordComplete={onVoiceClick} disabled={isBusy && !isRecording} />
          <TextInput onSend={onTextSend} disabled={isBusy} />
        </div>
      </div>
    </div>
  );
}
