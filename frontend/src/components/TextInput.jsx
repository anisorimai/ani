import React, { useState, useRef, useEffect } from 'react';
import { HiPaperAirplane, HiPaperClip, HiX } from 'react-icons/hi';

export default function TextInput({ onSend, disabled = false, onFocus, onBlur }) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState([]);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 120) + 'px';
    }
  }, [text]);

  const handleSend = () => {
    const trimmed = text.trim();
    if ((!trimmed && attachments.length === 0) || disabled) return;
    onSend(trimmed, attachments.length > 0 ? attachments : null);
    setText('');
    setAttachments([]);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    files.forEach((file) => {
      const isImage = file.type.startsWith('image/');
      const base = {
        id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: file.name,
        size: file.size,
        mimeType: file.type,
        isImage,
        url: null,
      };

      if (isImage) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          setAttachments((prev) => [...prev, { ...base, url: ev.target.result }]);
        };
        reader.readAsDataURL(file);
      } else {
        setAttachments((prev) => [...prev, base]);
      }
    });

    e.target.value = '';
  };

  const removeAttachment = (id) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const handlePaste = (e) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imageItems = items.filter((item) => item.type.startsWith('image/'));
    if (imageItems.length === 0) return;

    e.preventDefault();
    imageItems.forEach((item) => {
      const file = item.getAsFile();
      if (!file) return;
      const base = {
        id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: file.name && file.name !== 'image.png' ? file.name : `pasted-${Date.now()}.png`,
        size: file.size,
        mimeType: file.type,
        isImage: true,
        url: null,
      };
      const reader = new FileReader();
      reader.onload = (ev) => {
        setAttachments((prev) => [...prev, { ...base, url: ev.target.result }]);
      };
      reader.readAsDataURL(file);
    });
  };

  const canSend = (text.trim().length > 0 || attachments.length > 0) && !disabled;

  return (
    <div className="text-input-wrap flex-1 min-w-0">

      {/* Attachment chips — absolutely positioned above the pill so it never deforms the pill shape */}
      {attachments.length > 0 && (
        <div className="text-input-chips absolute bottom-full left-0 right-0 mb-2 px-3 sm:px-4 flex flex-wrap gap-1.5">
          {attachments.map((att) => (
            <div
              key={att.id}
              className="flex items-center gap-1 bg-[var(--surf)] border border-[var(--brd2)] rounded-2xl overflow-hidden shadow-sm"
              style={{ maxWidth: 168 }}
            >
              {att.isImage && att.url ? (
                <img src={att.url} alt={att.name} className="w-8 h-8 object-cover flex-shrink-0" />
              ) : (
                <div
                  className="w-8 h-8 flex items-center justify-center flex-shrink-0 text-[0.55rem] font-bold uppercase tracking-wide"
                  style={{ color: 'var(--gold-acc)', background: 'rgba(59,130,246,0.08)' }}
                >
                  {att.name.split('.').pop().slice(0, 4)}
                </div>
              )}
              <span
                className="text-[0.68rem] text-[var(--txt2)] truncate flex-1 pl-0.5"
                style={{ maxWidth: 76 }}
                title={att.name}
              >
                {att.name}
              </span>
              <button
                type="button"
                className="w-5 h-5 flex-shrink-0 mr-1 flex items-center justify-center text-[var(--txt3)] hover:text-red-400 transition-colors duration-150"
                onClick={() => removeAttachment(att.id)}
                aria-label={`Remove ${att.name}`}
              >
                <HiX size={11} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input row: [📎] [textarea] [send] */}
      <div className="flex items-center gap-2">

        <button
          type="button"
          className="text-input-attach-btn flex-shrink-0 w-10 h-10 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-full text-white shadow-[0_2px_12px_rgba(29,108,184,0.45)] hover:scale-[1.06] active:scale-95 transition-all duration-200 border-none outline-none disabled:opacity-40 disabled:cursor-not-allowed disabled:!transform-none"
          style={{ background: 'linear-gradient(135deg, #1D6CB8, #2A8FD4)' }}
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          aria-label="Attach file or image"
          title="Attach file"
        >
          <HiPaperClip size={20} />
        </button>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,.pdf,.csv,.txt,.json,.xlsx,.xls,.doc,.docx"
          className="hidden"
          tabIndex={-1}
          onChange={handleFileChange}
        />

        <textarea
          ref={textareaRef}
          id="text-input-field"
          className="text-input-field flex-1 min-w-0 resize-none bg-transparent border-none outline-none focus-visible:outline-none text-[var(--txt)] text-[0.9375rem] leading-6 py-2 px-3 min-h-[40px] max-h-[120px] overflow-auto font-sans placeholder:text-[var(--txt3)] disabled:opacity-50"
          placeholder="Type a message..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          disabled={disabled}
          onFocus={onFocus}
          onBlur={onBlur}
          rows={1}
          aria-label="Type a message"
        />

        <button
          id="text-send-btn"
          className={`text-send-btn flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-full transition-all duration-150 ${
            canSend
              ? 'bg-gold-gradient text-white shadow-[0_4px_24px_rgba(29,108,184,0.40)] hover:scale-[1.04] active:scale-95'
              : 'bg-[var(--surf-hover)] text-[var(--txt3)] opacity-40 cursor-not-allowed'
          }`}
          onClick={handleSend}
          disabled={!canSend}
          aria-label="Send message"
          title="Send"
        >
          <HiPaperAirplane size={18} className="rotate-90" />
        </button>
      </div>
    </div>
  );
}
