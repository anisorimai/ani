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
import WelcomeScreen from './WelcomeScreen';

/**
 * Returns true if user is scrolled near the bottom (within 150px).
 */
function isNearBottom(el) {
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight < 150;
}

export default function ChatWindow({ scrollContainerRef, domain = 'Production', dashboardContext = '' }) {
  /* ── DOM refs ── */
  const messagesContainerRef = useRef(null);   // scroll container
  const messagesEndRef       = useRef(null);   // invisible sentinel at the bottom
  const streamHandleRef      = useRef(null);   // holds the active stream handle for cancellation
  const shouldAutoScrollRef  = useRef(true);   // tracks if user is near the bottom
  const messageScrollRef     = useRef(null);    // inner messages scroll container
  const [showScrollBottom, setShowScrollBottom] = useState(false);

  /* ── Chat store selectors ── */
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

  /* ── Voice store selectors ── */
  const isRecording    = useVoiceStore((s) => s.isRecording);
  const audioBlob      = useVoiceStore((s) => s.audioBlob);
  const isTranscribing = useVoiceStore((s) => s.isTranscribing);
  const setTranscribing    = useVoiceStore((s) => s.setTranscribing);
  const setTranscribedText = useVoiceStore((s) => s.setTranscribedText);
  const resetVoice         = useVoiceStore((s) => s.reset);

  const { startRecording, stopRecording } = useVoiceRecorder();

  /* ── Derived state ── */
  const activeConversation = activeConversationId ? conversations[activeConversationId] : null;
  const messages   = activeConversation?.messages || [];
  const hasMessages = messages.length > 0;
  const getTriggerQueryForAssistant = useCallback((assistantIndex) => {
    for (let i = assistantIndex - 1; i >= 0; i -= 1) {
      if (messages[i]?.role === 'user') return messages[i].content || '';
    }
    return '';
  }, [messages]);

  const streamingTriggerQuery = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i]?.role === 'user') return messages[i].content || '';
    }
    return '';
  }, [messages]);

  /*
   * Smart auto-scroll: only scrolls to the bottom when the user is already
   * near the bottom (<150px away). If the user has scrolled up to read history,
   * we don't hijack their scroll position.
   *
   * The scroll-to-bottom button is shown only when messagesEndRef is BELOW the
   * viewport (user scrolled up within the chat). If the user has scrolled PAST
   * the chat into the dashboard section, messagesEndRef is above the viewport
   * (rect.bottom < 0) and the button is hidden.
   */
  const handleScroll = useCallback(() => {
    shouldAutoScrollRef.current = isNearBottom(messageScrollRef?.current);
    if (!messagesEndRef.current || !messageScrollRef.current) { setShowScrollBottom(false); return; }
    const cRect = messageScrollRef.current.getBoundingClientRect();
    const mRect = messagesEndRef.current.getBoundingClientRect();
    setShowScrollBottom(mRect.bottom > cRect.bottom + 50);
  }, []);

  // Attach scroll listener to the inner messages scroll container
  useEffect(() => {
    if (!hasMessages) return;
    const el = messageScrollRef?.current;
    if (!el) return;
    el.addEventListener('scroll', handleScroll);
    return () => el.removeEventListener('scroll', handleScroll);
  }, [handleScroll, hasMessages]);

  const scrollToBottom = useCallback(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, []);

  // Auto-scroll logic
  useEffect(() => {
    if (shouldAutoScrollRef.current && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [messages.length, streamingText]);

  // Force scroll to bottom when a new message from the assistant starts
  useEffect(() => {
    if (messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
      shouldAutoScrollRef.current = true;
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [messages.length]);

  /* ── Keyboard shortcuts ── */
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && (isStreaming || isLoading)) {
        e.preventDefault();
        handleStopGenerating();
      }
      if (e.key === ' ' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
        handleVoiceToggle();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isRecording, isStreaming, isLoading]);

  const handleCancelStream = useCallback(() => {
    closeStream();
    if (streamHandleRef.current) {
      streamHandleRef.current.close();
      streamHandleRef.current = null;
    }
    cancelStream();
  }, [cancelStream]);

  /* User-initiated stop — aborts backend generation and leaves a notice in the chat */
  const handleStopGenerating = useCallback(() => {
    if (streamHandleRef.current) {
      streamHandleRef.current.close();
      streamHandleRef.current = null;
    }
    stopStream();
  }, [stopStream]);

  useEffect(() => {
    return () => {
      closeStream();
      if (streamHandleRef.current) streamHandleRef.current.close();
    };
  }, []);

  const sendTextAndStream = useCallback((text, type = 'text', page = 1, attachments = null) => {
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
      text,
      convId,
      (token) => {
        if (useChatStore.getState().isLoading) startStreaming(streamId);
        appendToken(token, streamId);
      },
      (finalMessage, doneMeta) => {
        const pagination = doneMeta?.pagination || null;
        finalizeStream(streamId, finalMessage, pagination);
        streamHandleRef.current = null;
      },
      (err) => {
        console.error('Stream error:', err);
        cancelStream();
        setLoading(false);
        addMessage(convId, {
          role: 'assistant',
          content: `Sorry, something went wrong: ${err.message || 'Unknown error'}. Please try again.`,
          type: 'text',
          isError: true,
        });
        streamHandleRef.current = null;
      },
      priorHistory,
      page,
      dashboardContext
    );
  }, [activeConversationId, createConversation, addMessage, setLoading, startStreaming, appendToken, finalizeStream, cancelStream, handleCancelStream, removeLastAssistantMessage]);

  /* ── External query trigger (AI suggestion cards) ── */
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
    if (isRecording) stopRecording();
    else startRecording();
  }, [isRecording, isLoading, isStreaming, startRecording, stopRecording]);

  useEffect(() => {
    if (!audioBlob || isRecording) return;
    const processAudio = async () => {
      setTranscribing(true);
      try {
        const result = await transcribeAudio(audioBlob);
        const text = (result.text || '').trim();
        if (!text) {
          setTranscribing(false);
          toast('No speech detected. Please speak clearly.', { duration: 3000 });
          return;
        }
        if (text.toLowerCase().startsWith('[error:')) {
          setTranscribing(false);
          toast.error('Speech recognition failed. Please try again.');
          return;
        }

        setTranscribedText(text);
        setTranscribing(false);
        sendTextAndStream(text, 'voice');
      } catch (err) {
        console.error('Transcription error:', err);
        setTranscribing(false);
        toast.error('Couldn\'t transcribe audio. Please try again.');
      } finally {
        /* Always reset voice state so the text input is re-enabled */
        setTimeout(() => resetVoice(), 400);
      }
    };
    processAudio();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioBlob, isRecording]);

  const handleTextSend = useCallback((text, attachments) => sendTextAndStream(text, 'text', 1, attachments || null), [sendTextAndStream]);
  const handleQueryClick = useCallback((text) => sendTextAndStream(text, 'text'), [sendTextAndStream]);

  const appStatus = useAppStatus();
  /* 'error' is intentionally excluded — a voice error must not freeze the text input */
  const isBusy = ['recording', 'transcribing', 'streaming', 'loading'].includes(appStatus);

  const handleRetry = useCallback((messageId, mode = 'retry') => {
    if (!activeConversationId) return;
    if (useChatStore.getState().isStreaming) handleCancelStream();

    const store = useChatStore.getState();
    const conv = store.conversations[activeConversationId];
    if (!conv) return;

    const targetMsg = conv.messages.find(m => m.id === messageId);
    if (!targetMsg) return;

    const prevUserMsg = store.getPreviousUserMessage(activeConversationId, messageId);
    if (!prevUserMsg) return;

    handleCancelStream();

    if (mode === 'retry') {
      removeMessage(activeConversationId, messageId);
    } else if (mode === 'regenerate') {
      store.markMessageStale(activeConversationId, messageId);
    }

    sendTextAndStream(prevUserMsg.content, prevUserMsg.type);
  }, [activeConversationId, removeMessage, sendTextAndStream, handleCancelStream]);

  const handleEditMessage = useCallback((messageId, newContent) => {
    if (!activeConversationId) return;
    const store = useChatStore.getState();
    
    handleCancelStream();
    
    // 1. Update the message content in place
    store.updateMessage(activeConversationId, messageId, newContent);
    
    // 2. Truncate history after this message (remove all subsequent messages)
    store.truncateHistory(activeConversationId, messageId);
    
    // 3. Resend without adding a duplicate message bubble
    setLoading(true);
    const streamId = Date.now().toString();
    
    // Get updated history for the stream
    const updatedConv = useChatStore.getState().conversations[activeConversationId];
    const history = updatedConv?.messages || [];

    streamHandleRef.current = streamMessage(
      newContent,
      activeConversationId,
      (token) => {
        if (useChatStore.getState().isLoading) startStreaming(streamId);
        appendToken(token, streamId);
      },
      (finalMessage) => {
        finalizeStream(streamId, finalMessage);
        streamHandleRef.current = null;
      },
      (err) => {
        console.error('Stream error:', err);
        cancelStream();
        setLoading(false);
        addMessage(activeConversationId, {
          role: 'assistant',
          content: `Sorry, something went wrong: ${err.message || 'Unknown error'}. Please try again.`,
          type: 'text',
          isError: true,
        });
        streamHandleRef.current = null;
      },
      history.slice(0, -1), // Send history excluding the message we just updated as 'current query'
      1,
      dashboardContext
    );
  }, [activeConversationId, addMessage, setLoading, startStreaming, appendToken, finalizeStream, cancelStream, handleCancelStream]);

  // Welcome screen (no messages) — flows naturally with the page
  if (!hasMessages) {
    return (
      <div className="flex flex-col" id="chat-window">
        <WelcomeScreen
          domain={domain}
          onQueryClick={handleQueryClick}
          onVoiceClick={handleVoiceToggle}
          onTextSend={handleTextSend}
          isRecording={isRecording}
          isTranscribing={isTranscribing}
          isBusy={isBusy}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" id="chat-window">
      {/* Messages area — inner scroll; messages anchor to bottom via mt-auto */}
      <div
        className="flex flex-col flex-1 min-h-0 overflow-y-auto"
        id="chat-messages"
        ref={messageScrollRef}
      >
        <div className="flex flex-col mt-auto py-4 px-2 sm:py-6 sm:px-4 md:px-8 gap-2 max-w-[1200px] w-full mx-auto pb-6">


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
        </div>
      </div>

      {/* Scroll-to-bottom button */}
      {showScrollBottom && (
        <button
          onClick={scrollToBottom}
          className="fixed bottom-[100px] right-4 sm:right-6 z-30 w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-[var(--surf)] border flex items-center justify-center hover:bg-[var(--surf-hover)] active:scale-90 transition-all duration-200 animate-fade-in" style={{ borderColor: 'rgba(29,108,184,0.35)', color: '#4DBADF', boxShadow: '0 4px 12px rgba(29,108,184,0.25)' }}
          title="Scroll to bottom"
        >
          <HiArrowDown size={16} />
        </button>
      )}

      {/* Input bar — pinned to bottom of the flex column, safe-area aware */}
      <div
        className="
          bg-[var(--bg)] flex flex-col items-center gap-2 w-full flex-shrink-0
          px-3 sm:px-5 md:px-8
          pt-2
          pb-[calc(10px+env(safe-area-inset-bottom,0px))] sm:pb-4
        "
        id="chat-input-area"
      >
        {(isStreaming || isLoading) && (
          <button
            className="
              inline-flex items-center gap-1.5 sm:gap-2
              px-3 sm:px-4 py-1 sm:py-1.5 rounded-md
              bg-[var(--surf)] border border-[var(--brd)] text-[var(--txt2)]
              text-[0.7rem] sm:text-xs cursor-pointer
              hover:border-red-500/50 hover:text-red-400 hover:bg-red-500/5
              transition-all duration-150 animate-fade-in
            "
            onClick={handleStopGenerating}
            id="cancel-stream-btn"
          >
            Stop generating
            <span className="hidden sm:inline">·</span>
            <kbd className="hidden sm:inline bg-[var(--surf-hover)] px-1.5 py-0.5 rounded text-xs border border-[var(--brd2)] font-sans">
              Esc
            </kbd>
          </button>
        )}

        {/* Input pill — full width on mobile, capped on desktop */}
        <div
          className={`
            chat-input-row max-w-[1200px] w-full flex items-center gap-2 sm:gap-2.5 relative
            glass-surface rounded-full
            px-3 sm:px-4 py-2.5
            shadow-[0_4px_16px_rgba(0,0,0,0.25)] transition-all duration-150
            gradient-border-focus
            ${isRecording ? 'recording-pill' : ''}
          `}
        >
          <VoiceButton onRecordComplete={handleVoiceToggle} disabled={isLoading || isStreaming} />
          <TextInput onSend={handleTextSend} disabled={isBusy} />
        </div>

        <p className="hidden md:block text-[11px] text-[var(--txt2)] text-center">
          Press Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
