import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import useChatStore from '../store/useChatStore';
import useVoiceStore from '../store/useVoiceStore';
import useVoiceRecorder from '../hooks/useVoiceRecorder';
import { transcribeAudio, streamMessage, closeStream } from '../services/api';
import {
  HiOutlineClipboardCopy, HiOutlineThumbUp, HiOutlineThumbDown,
  HiCheck, HiOutlineRefresh, HiOutlinePencilAlt, HiOutlineX, HiArrowDown
} from 'react-icons/hi';
import { toast } from 'react-hot-toast';
import useAppStatus from '../hooks/useAppStatus';
import MessageBubble, { TypingIndicator } from './MessageBubble';
import VoiceButton from './VoiceButton';
import TextInput from './TextInput';
import { DOMAIN_SUGGESTIONS } from './WelcomeScreen';

function isNearBottom(el) {
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight < 150;
}

const DOMAIN_META = {
  Production: { icon: '🏭', color: '#1D6CB8', label: 'Production' },
  Packaging:  { icon: '📦', color: '#0ea5e9', label: 'Packaging'  },
  Quality:    { icon: '📋', color: '#10b981', label: 'Quality'    },
  Logistics:  { icon: '🚛', color: '#f59e0b', label: 'Logistics'  },
  Enterprise: { icon: '📊', color: '#7C3AED', label: 'Enterprise' },
};

export default function ChatWindow({ scrollContainerRef, domain = 'Production', dashboardContext = '' }) {
  const messagesEndRef      = useRef(null);
  const streamHandleRef     = useRef(null);
  const shouldAutoScrollRef = useRef(true);
  const messageScrollRef    = useRef(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [isOverlayOpen, setIsOverlayOpen] = useState(false);
  const [chatSize, setChatSize] = useState('open'); // 'mini' | 'open'
  const [showSuggestions, setShowSuggestions] = useState(false);

  const currentDrawerH = '86vh';
  const hideTimer = useRef(null);

  /* ── Chat store ── */
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const conversations        = useChatStore((s) => s.conversations);
  const isLoading            = useChatStore((s) => s.isLoading);
  const isStreaming           = useChatStore((s) => s.isStreaming);
  const streamingText        = useChatStore((s) => s.streamingText);
  const addMessage           = useChatStore((s) => s.addMessage);
  const startStreaming        = useChatStore((s) => s.startStreaming);
  const appendToken          = useChatStore((s) => s.appendToken);
  const finalizeStream       = useChatStore((s) => s.finalizeStream);
  const cancelStream         = useChatStore((s) => s.cancelStream);
  const stopStream           = useChatStore((s) => s.stopStream);
  const setLoading           = useChatStore((s) => s.setLoading);
  const createConversation   = useChatStore((s) => s.createConversation);
  const removeMessage        = useChatStore((s) => s.removeMessage);
  const removeLastAssistantMessage = useChatStore((s) => s.removeLastAssistantMessage);

  /* ── Voice store ── */
  const isRecording    = useVoiceStore((s) => s.isRecording);
  const audioBlob      = useVoiceStore((s) => s.audioBlob);
  const isTranscribing = useVoiceStore((s) => s.isTranscribing);
  const setTranscribing    = useVoiceStore((s) => s.setTranscribing);
  const setTranscribedText = useVoiceStore((s) => s.setTranscribedText);
  const resetVoice         = useVoiceStore((s) => s.reset);

  const { startRecording, stopRecording } = useVoiceRecorder();

  /* ── Derived ── */
  const activeConversation = activeConversationId ? conversations[activeConversationId] : null;
  const messages   = activeConversation?.messages || [];
  const hasMessages = messages.length > 0;

  const meta        = DOMAIN_META[domain]        || DOMAIN_META.Production;
  const suggestions = DOMAIN_SUGGESTIONS[domain] || DOMAIN_SUGGESTIONS.Production;

  const getTriggerQueryForAssistant = useCallback((idx) => {
    for (let i = idx - 1; i >= 0; i--) {
      if (messages[i]?.role === 'user') return messages[i].content || '';
    }
    return '';
  }, [messages]);

  const streamingTriggerQuery = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === 'user') return messages[i].content || '';
    }
    return '';
  }, [messages]);

  /* ── Scroll ── */
  const handleScroll = useCallback(() => {
    shouldAutoScrollRef.current = isNearBottom(messageScrollRef?.current);
    if (!messagesEndRef.current || !messageScrollRef.current) { setShowScrollBottom(false); return; }
    const cRect = messageScrollRef.current.getBoundingClientRect();
    const mRect = messagesEndRef.current.getBoundingClientRect();
    setShowScrollBottom(mRect.bottom > cRect.bottom + 50);
  }, []);

  useEffect(() => {
    if (!hasMessages) return;
    const el = messageScrollRef?.current;
    if (!el) return;
    el.addEventListener('scroll', handleScroll);
    return () => el.removeEventListener('scroll', handleScroll);
  }, [handleScroll, hasMessages]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, []);

  useEffect(() => {
    if (shouldAutoScrollRef.current && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [messages.length, streamingText]);

  useEffect(() => {
    if (messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
      shouldAutoScrollRef.current = true;
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [messages.length]);

  /* ── Keyboard shortcuts ── */
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape' && (isStreaming || isLoading)) { e.preventDefault(); handleStopGenerating(); }
      if (e.key === ' ' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); handleVoiceToggle(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isRecording, isStreaming, isLoading]);

  const handleCancelStream = useCallback(() => {
    closeStream();
    if (streamHandleRef.current) { streamHandleRef.current.close(); streamHandleRef.current = null; }
    cancelStream();
  }, [cancelStream]);

  const handleStopGenerating = useCallback(() => {
    if (streamHandleRef.current) { streamHandleRef.current.close(); streamHandleRef.current = null; }
    stopStream();
  }, [stopStream]);

  useEffect(() => {
    return () => { closeStream(); if (streamHandleRef.current) streamHandleRef.current.close(); };
  }, []);

  const sendTextAndStream = useCallback((text, type = 'text', page = 1, attachments = null) => {
    setIsOverlayOpen(true);
    setChatSize((s) => s === 'mini' ? 'open' : s);
    setShowSuggestions(false); // hide suggestions once a message is sent
    handleCancelStream();
    if (useChatStore.getState().isStreaming) handleCancelStream();

    let convId = activeConversationId;
    if (!convId) {
      convId = createConversation(domain);
      localStorage.setItem('voxa-active-id-' + domain, convId);
    }

    const priorHistory = useChatStore.getState().conversations[convId]?.messages || [];
    addMessage(convId, { role: 'user', content: text, type, attachments });
    setLoading(true);

    const streamId = Date.now().toString();
    streamHandleRef.current = streamMessage(
      text, convId,
      (token) => { if (useChatStore.getState().isLoading) startStreaming(streamId); appendToken(token, streamId); },
      (finalMessage, doneMeta) => { finalizeStream(streamId, finalMessage, doneMeta?.pagination || null); streamHandleRef.current = null; },
      (err) => {
        console.error('Stream error:', err);
        cancelStream(); setLoading(false);
        addMessage(convId, { role: 'assistant', content: `Sorry, something went wrong: ${err.message || 'Unknown error'}. Please try again.`, type: 'text', isError: true });
        streamHandleRef.current = null;
      },
      priorHistory, page, dashboardContext
    );
  }, [activeConversationId, createConversation, addMessage, setLoading, startStreaming, appendToken, finalizeStream, cancelStream, handleCancelStream, removeLastAssistantMessage]);

  useEffect(() => {
    const handler = (e) => sendTextAndStream(e.detail.text, 'text');
    window.addEventListener('voxa:suggest-query', handler);
    return () => window.removeEventListener('voxa:suggest-query', handler);
  }, [sendTextAndStream]);

  const handlePageChange = useCallback((newPage, originalQuery) => {
    if (!activeConversationId) return;
    removeLastAssistantMessage(activeConversationId);
    sendTextAndStream(originalQuery, 'text', newPage);
  }, [activeConversationId, removeLastAssistantMessage, sendTextAndStream]);

  const handleVoiceToggle = useCallback(() => {
    if (isLoading || isStreaming) return;
    if (isRecording) stopRecording(); else startRecording();
  }, [isRecording, isLoading, isStreaming, startRecording, stopRecording]);

  useEffect(() => {
    if (!audioBlob || isRecording) return;
    const processAudio = async () => {
      setTranscribing(true);
      try {
        const result = await transcribeAudio(audioBlob);
        const text = (result.text || '').trim();
        if (!text) { setTranscribing(false); toast('No speech detected. Please speak clearly.', { duration: 3000 }); return; }
        if (text.toLowerCase().startsWith('[error:')) { setTranscribing(false); toast.error('Speech recognition failed. Please try again.'); return; }
        setTranscribedText(text); setTranscribing(false); sendTextAndStream(text, 'voice');
      } catch (err) {
        console.error('Transcription error:', err); setTranscribing(false);
        toast.error('Couldn\'t transcribe audio. Please try again.');
      } finally { setTimeout(() => resetVoice(), 400); }
    };
    processAudio();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioBlob, isRecording]);

  const handleTextSend  = useCallback((text, attachments) => sendTextAndStream(text, 'text', 1, attachments || null), [sendTextAndStream]);
  const handleQueryClick = useCallback((text) => sendTextAndStream(text, 'text'), [sendTextAndStream]);

  const appStatus = useAppStatus();
  const isBusy = ['recording', 'transcribing', 'streaming', 'loading'].includes(appStatus);

  const handleRetry = useCallback((messageId, mode = 'retry') => {
    if (!activeConversationId) return;
    setIsOverlayOpen(true);
    if (useChatStore.getState().isStreaming) handleCancelStream();
    const store = useChatStore.getState();
    const conv = store.conversations[activeConversationId];
    if (!conv) return;
    const targetMsg = conv.messages.find(m => m.id === messageId);
    if (!targetMsg) return;
    const prevUserMsg = store.getPreviousUserMessage(activeConversationId, messageId);
    if (!prevUserMsg) return;
    handleCancelStream();
    if (mode === 'retry') removeMessage(activeConversationId, messageId);
    else if (mode === 'regenerate') store.markMessageStale(activeConversationId, messageId);
    sendTextAndStream(prevUserMsg.content, prevUserMsg.type);
  }, [activeConversationId, removeMessage, sendTextAndStream, handleCancelStream]);

  const handleEditMessage = useCallback((messageId, newContent) => {
    if (!activeConversationId) return;
    setIsOverlayOpen(true);
    const store = useChatStore.getState();
    handleCancelStream();
    store.updateMessage(activeConversationId, messageId, newContent);
    store.truncateHistory(activeConversationId, messageId);
    setLoading(true);
    const streamId = Date.now().toString();
    const history = useChatStore.getState().conversations[activeConversationId]?.messages || [];
    streamHandleRef.current = streamMessage(
      newContent, activeConversationId,
      (token) => { if (useChatStore.getState().isLoading) startStreaming(streamId); appendToken(token, streamId); },
      (finalMessage) => { finalizeStream(streamId, finalMessage); streamHandleRef.current = null; },
      (err) => {
        console.error('Stream error:', err); cancelStream(); setLoading(false);
        addMessage(activeConversationId, { role: 'assistant', content: `Sorry, something went wrong: ${err.message || 'Unknown error'}. Please try again.`, type: 'text', isError: true });
        streamHandleRef.current = null;
      },
      history.slice(0, -1), 1, dashboardContext
    );
  }, [activeConversationId, addMessage, setLoading, startStreaming, appendToken, finalizeStream, cancelStream, handleCancelStream]);

  // Inner search bar — rendered either inside the glass drawer or as a standalone fixed bar
  const searchBarInner = (
    <div className="w-full flex flex-col items-center gap-1.5">
      {(isStreaming || isLoading) && (
        <button
          onClick={handleStopGenerating}
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[0.7rem] cursor-pointer animate-fade-in transition-all duration-150 hover:opacity-90"
          style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171' }}
        >
          <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>
          Stop generating
          <span className="hidden sm:inline opacity-60">· Esc</span>
        </button>
      )}

      <div className={`w-full glass-surface prompt-bar-pill transition-all duration-200 ${showSuggestions ? 'rounded-[32px]' : 'rounded-full gradient-border-focus'}`}>
        {showSuggestions && (
          <>
            <div className="px-4 pt-3 pb-2.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-2.5">
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold flex-shrink-0"
                  style={{ background: `${meta.color}18`, color: meta.color, border: `1px solid ${meta.color}35` }}
                >
                  <span>{meta.icon}</span>
                  {meta.label}
                </span>
                <span className="text-sm font-bold text-[var(--txt)]">What would you like to know?</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {suggestions.map((s) => (
                  <button
                    key={s.label}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      clearTimeout(hideTimer.current);
                      handleQueryClick(s.text);
                      setShowSuggestions(false);
                    }}
                    className="flex items-center gap-2 px-2.5 py-2 rounded-xl text-left transition-all duration-150 active:scale-[0.97] select-none"
                    style={{ background: 'var(--bg)', border: '1px solid var(--brd)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--brd2)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg)'; }}
                  >
                    <span className="text-base leading-none flex-shrink-0">{s.icon}</span>
                    <span className="text-[11px] font-medium text-[var(--txt)] truncate">{s.label}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="border-t border-[var(--brd)]" />
          </>
        )}
        <div className="chat-input-row flex items-center gap-2 sm:gap-2.5 px-2 sm:px-3 py-1.5">
          <button
            onClick={() => createConversation(domain)}
            title="New Chat"
            className={`${isRecording ? 'hidden' : 'flex'} flex-shrink-0 w-10 h-10 min-w-[40px] min-h-[40px] items-center justify-center rounded-full text-white shadow-[0_2px_12px_rgba(29,108,184,0.45)] hover:scale-[1.06] active:scale-95 transition-all duration-200 border-none outline-none`}
            style={{ background: 'linear-gradient(135deg, #1D6CB8, #2A8FD4)' }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              <line x1="12" y1="9" x2="12" y2="13"/>
              <line x1="10" y1="11" x2="14" y2="11"/>
            </svg>
          </button>
          <VoiceButton onRecordComplete={handleVoiceToggle} disabled={isLoading || isStreaming} />
          <TextInput
            onSend={handleTextSend}
            disabled={isBusy}
            onFocus={() => { clearTimeout(hideTimer.current); if (!isOverlayOpen) setShowSuggestions(true); }}
            onBlur={() => { hideTimer.current = setTimeout(() => setShowSuggestions(false), 150); }}
          />
        </div>
      </div>

      <div className="hidden md:flex justify-center mt-0.5">
        <p className="text-[10px] text-[var(--txt2)] text-center select-none bg-[var(--surf)]/80 backdrop-blur-md border border-[var(--brd)] px-3 py-1 rounded-full shadow-sm">
          Enter to send · Shift+Enter for new line · Space to toggle voice
        </p>
      </div>
    </div>
  );

  // Standalone fixed bar — shown only when drawer is closed or minimised
  const floatingBar = (
    <div className="floating-prompt-bar fixed bottom-0 left-0 md:left-56 right-0 z-40 px-3 sm:px-5 md:px-8 pt-3 pb-[calc(5px+env(safe-area-inset-bottom,0px))] sm:pb-2">
      {searchBarInner}
    </div>
  );

  // Whether to embed the search bar inside the drawer (open, not mini) or show it standalone
  const drawerActive = isOverlayOpen && chatSize !== 'mini';

  return (
    <>
      {/* Standalone floating bar — only when drawer is not active */}
      {!drawerActive && floatingBar}

      {/* Scrim above drawer — only when drawer is active */}
      {drawerActive && (
        <div
          className="fixed top-0 left-0 md:left-56 right-0 z-[49] pointer-events-auto"
          style={{ bottom: currentDrawerH, background: 'rgba(0,0,0,0.18)', backdropFilter: 'blur(2px)' }}
          onClick={() => setChatSize('mini')}
        />
      )}

      {/* Glass drawer — extends to bottom-0, embeds search bar when active */}
      <div
        className={`fixed left-0 md:left-56 right-0 bottom-0 z-[50] pointer-events-none transition-[transform,opacity] duration-500 ease-[cubic-bezier(0.25,0.46,0.45,0.94)] ${isOverlayOpen ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0'}`}
        style={{ height: chatSize === 'mini' ? '44px' : currentDrawerH, willChange: 'transform' }}
      >
        <div className={`chat-overlay-panel w-full h-full rounded-t-2xl flex flex-col overflow-hidden ${isOverlayOpen ? 'pointer-events-auto' : 'pointer-events-none'}`}>

          {/* Header bar */}
          <div
            className="flex-shrink-0 flex items-center justify-between px-4 select-none"
            style={{ height: 44, flexShrink: 0, borderBottom: chatSize !== 'mini' ? '1px solid rgba(128,128,128,0.12)' : 'none', cursor: chatSize === 'mini' ? 'pointer' : 'default' }}
            onClick={() => chatSize === 'mini' && setChatSize('open')}
          >
            {/* Domain label */}
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--txt2)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>{meta.icon}</span>
              <span>{meta.label} Assistant</span>
              {chatSize === 'mini' && hasMessages && (
                <span style={{ fontSize: 9.5, fontWeight: 600, color: 'var(--txt3)', background: 'var(--brd)', borderRadius: 8, padding: '1px 6px', marginLeft: 2 }}>
                  {messages.length} msg{messages.length !== 1 ? 's' : ''}
                </span>
              )}
            </span>

            {/* Controls */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {/* Minimize (open→mini) or Expand (mini→open) — mutually exclusive */}
              {chatSize === 'mini' ? (
                <button
                  onClick={(e) => { e.stopPropagation(); setChatSize('open'); }}
                  title="Expand"
                  style={{ width: 26, height: 26, borderRadius: 7, border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--txt3)', transition: 'background 0.15s' }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--brd)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  {/* chevron up */}
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
                </button>
              ) : (
                <button
                  onClick={(e) => { e.stopPropagation(); setChatSize('mini'); }}
                  title="Minimise"
                  style={{ width: 26, height: 26, borderRadius: 7, border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--txt3)', transition: 'background 0.15s' }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--brd)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  {/* minus */}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>
                </button>
              )}
              {/* Close */}
              <button
                onClick={(e) => { e.stopPropagation(); setIsOverlayOpen(false); setChatSize('open'); }}
                title="Close chat"
                style={{ width: 26, height: 26, borderRadius: 7, border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--txt3)', transition: 'background 0.15s' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(239,68,68,0.12)'; e.currentTarget.style.color = '#f87171'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--txt3)'; }}
              >
                <HiOutlineX size={14} />
              </button>
            </div>
          </div>

          {/* Messages — hidden when minimised */}
          <div
            className="flex flex-col flex-1 min-h-0 overflow-y-auto [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[var(--brd2)]"
            id="chat-messages"
            ref={messageScrollRef}
            style={{ display: chatSize === 'mini' ? 'none' : undefined }}
          >
            <div className="flex flex-col pt-5 pb-4 px-3 sm:px-5 md:px-10 gap-2 w-full">
              {!hasMessages ? (
                <div className="flex flex-col items-center justify-center pt-8 text-[var(--txt3)] text-sm">
                  Send a message to start a conversation.
                </div>
              ) : (
                <>
                  {messages.map((msg, idx) => (
                    <MessageBubble
                      key={msg.id}
                      message={msg}
                      triggerQuery={msg.role === 'assistant' ? getTriggerQueryForAssistant(idx) : null}
                      onRetry={msg.isError ? () => handleRetry(msg.id, 'retry') : null}
                      onRegenerate={
                        msg.role === 'assistant' && !msg.isError
                          ? () => handleRetry(msg.id, 'regenerate')
                          : null
                      }
                      onEdit={msg.role === 'user' ? handleEditMessage : null}
                      onPageChange={msg.role === 'assistant' && msg.pagination ? handlePageChange : null}
                    />
                  ))}
                  {isStreaming && streamingText && (
                    <MessageBubble
                      message={{ id: 'streaming', role: 'assistant', content: streamingText, type: 'text', createdAt: Date.now() }}
                      triggerQuery={streamingTriggerQuery}
                      isStreaming
                    />
                  )}
                  {isLoading && !isStreaming && <TypingIndicator />}
                  <div ref={messagesEndRef} />
                </>
              )}
            </div>
          </div>

          {showScrollBottom && (
            <button
              onClick={scrollToBottom}
              className="absolute z-30 w-9 h-9 rounded-full flex items-center justify-center active:scale-90 transition-all duration-200"
              style={{ bottom: drawerActive ? 'calc(90px + 16px)' : '24px', right: '16px', background: 'var(--surf)', border: '1px solid rgba(29,108,184,0.35)', color: '#4DBADF', boxShadow: '0 4px 12px rgba(29,108,184,0.25)' }}
            >
              <HiArrowDown size={16} />
            </button>
          )}

          {/* Embedded search bar — shown inside drawer when active */}
          {drawerActive && (
            <div
              className="flex-shrink-0 px-3 sm:px-5 md:px-8 pt-2 pb-[calc(6px+env(safe-area-inset-bottom,0px))]"
              style={{ borderTop: '1px solid rgba(128,128,128,0.12)' }}
            >
              {searchBarInner}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
