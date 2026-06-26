import React, { useMemo, useState, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { 
  HiMicrophone, HiOutlineClipboardCopy, HiOutlineThumbUp, HiOutlineThumbDown, 
  HiCheck, HiOutlineRefresh, HiOutlinePencilAlt, HiOutlineX
} from 'react-icons/hi';
import { toast } from 'react-hot-toast';

import UserAvatar from './UserAvatar';
import PredefinedResponseTemplate from './PredefinedResponseTemplate';
import DynamicResponseTemplate from './DynamicResponseTemplate';
import { getPredefinedTemplateKey } from './predefinedTemplateUtils';

import useUIStore from '../store/useUIStore';
import { useRef } from 'react';

const TABLE_PAGE_SIZE = 10;

/**
 * Paginated table that replaces the default ReactMarkdown <table> renderer.
 * Shows TABLE_PAGE_SIZE rows at a time with Prev / Next controls.
 */
function PaginatedMarkdownTable({ node, children, ...rest }) {
  const [page, setPage] = useState(0);

  const tableChildren = React.Children.toArray(children);
  const tbodyIdx = tableChildren.findIndex(
    (c) => c && c.type === 'tbody'
  );

  if (tbodyIdx === -1) {
    return (
      <div className="table-glass">
        <table {...rest}>{children}</table>
      </div>
    );
  }

  const tbody = tableChildren[tbodyIdx];
  const allRows = React.Children.toArray(tbody.props.children);
  const totalRows = allRows.length;

  if (totalRows <= TABLE_PAGE_SIZE) {
    return (
      <div className="table-glass">
        <table {...rest}>{children}</table>
      </div>
    );
  }

  const totalPages = Math.ceil(totalRows / TABLE_PAGE_SIZE);
  const safePage = Math.min(page, totalPages - 1);
  const start = safePage * TABLE_PAGE_SIZE;
  const end = Math.min(start + TABLE_PAGE_SIZE, totalRows);
  const pageRows = allRows.slice(start, end);

  const paginatedTbody = React.cloneElement(tbody, {}, ...pageRows);
  const paginatedChildren = [
    ...tableChildren.slice(0, tbodyIdx),
    paginatedTbody,
    ...tableChildren.slice(tbodyIdx + 1),
  ];

  return (
    <div className="table-glass">
      <table {...rest}>{paginatedChildren}</table>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 14px', fontSize: '12px', color: 'var(--txt2)',
        borderTop: '1px solid var(--brd)', flexWrap: 'wrap', gap: 6,
      }}>
        <span style={{ opacity: 0.7 }}>
          Showing {start + 1}–{end} of {totalRows} records
        </span>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={safePage === 0}
            style={{
              padding: '3px 10px', borderRadius: '6px', fontSize: '12px',
              background: 'var(--surf-hover)', border: '1px solid var(--brd)',
              color: 'var(--txt2)', cursor: safePage === 0 ? 'default' : 'pointer',
              opacity: safePage === 0 ? 0.4 : 1,
            }}
          >
            ← Prev
          </button>
          <span style={{ padding: '3px 6px', opacity: 0.6 }}>
            {safePage + 1} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={safePage === totalPages - 1}
            style={{
              padding: '3px 10px', borderRadius: '6px', fontSize: '12px',
              background: 'var(--surf-hover)', border: '1px solid var(--brd)',
              color: 'var(--txt2)',
              cursor: safePage === totalPages - 1 ? 'default' : 'pointer',
              opacity: safePage === totalPages - 1 ? 0.4 : 1,
            }}
          >
            Next →
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Helper component to render an iframe that auto-resizes based on its content
 */
function IframeResizer({ srcDoc, messageId }) {
  const [height, setHeight] = useState('400px'); // Initial fallback
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const iframeRef = useRef(null);

  useEffect(() => {
    const handleMessage = (event) => {
      // Only update if the message contains our specific ID
      if (event.data && event.data.type === 'setHeight' && event.data.id === messageId) {
        setHeight(`${Math.ceil(event.data.height) + 2}px`);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [messageId]);

  // When sidebar toggles, the width changes (300ms transition).
  useEffect(() => {
    const triggerUpdate = () => {
      if (iframeRef.current && iframeRef.current.contentWindow) {
        iframeRef.current.contentWindow.postMessage({ type: 'triggerHeightUpdate' }, '*');
      }
    };

    triggerUpdate();
    const timer = setTimeout(triggerUpdate, 350); 
    
    return () => clearTimeout(timer);
  }, [sidebarOpen]);

  // Inject the ID into the script that runs inside the iframe
  const docWithId = useMemo(() => {
    if (!srcDoc) return srcDoc;
    
    let modified = srcDoc.replace(
      /window\.parent\.postMessage\(\{ type: 'setHeight', height: height \}, '\*'\)/g,
      `window.parent.postMessage({ type: 'setHeight', height: height, id: '${messageId}' }, '*')`
    );

    const listenerScript = `
      <script>
        window.addEventListener('message', (e) => {
          if (e.data.type === 'triggerHeightUpdate') {
            if (typeof sendHeight === 'function') sendHeight();
          }
        });
      </script>
    `;
    return modified.replace('</body>', `${listenerScript}</body>`);
  }, [srcDoc, messageId]);

  return (
    <iframe
      ref={iframeRef}
      srcDoc={docWithId}
      style={{ width: '100%', height, border: 'none', display: 'block', overflow: 'hidden' }}
      title={`Dashboard Response ${messageId}`}
      scrolling="no"
    />
  );
}


/**
 * Strict message schema expected:
 * { id, role, content, type: 'text'|'voice', createdAt, isError }
 */
export default function MessageBubble({ message, onRetry, onRegenerate, onEdit, isStreaming, triggerQuery, onPageChange }) {
  const { role, content, type, createdAt, isError, attachments } = message;
  const isUser = role === 'user';
  const isVoice = type === 'voice';

  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(content);

  const handleCopy = () => {
    if (!content || isStreaming) return;
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      toast.success('Copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    }).catch(err => {
      console.error('Failed to copy:', err);
      toast.error('Failed to copy');
    });
  };

  const handleFeedback = (type) => {
    setFeedback(type === feedback ? null : type);
  };

  const handleEditSubmit = () => {
    if (editContent.trim() && editContent !== content) {
      onEdit(message.id, editContent.trim());
    }
    setIsEditing(false);
  };

  const handleEditKeyDown = (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleEditSubmit();
    }
    if (e.key === 'Escape') {
      setIsEditing(false);
      setEditContent(content);
    }
  };

  const formattedTime = useMemo(() => {
    if (!createdAt) return '';
    return new Date(createdAt).toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', hour12: true,
    });
  }, [createdAt]);
  const predefinedTemplateKey = useMemo(() => {
    if (isUser || isError || !triggerQuery || isStreaming) return null;
    return getPredefinedTemplateKey(triggerQuery);
  }, [isUser, isError, triggerQuery, isStreaming]);
  const hasPredefinedTemplate = Boolean(predefinedTemplateKey);
  const hasChartIntent = useMemo(() => {
    if (isUser || isError || !triggerQuery || isStreaming) return false;
    const q = String(triggerQuery || '').toLowerCase();
    return ['chart', 'graph', 'pie', 'bar chart', 'bar graph', 'column chart', 'line chart', 'area chart', 'donut chart', 'doughnut chart'].some((k) => q.includes(k));
  }, [isUser, isError, triggerQuery, isStreaming]);

  const isWide = useMemo(() => {
    // All assistant responses should now fit the screen width for a consistent executive dashboard feel
    return !isUser;
  }, [isUser]);

  return (
    <div
      id={`message-${message.id}`}
      className={`
        group flex gap-2 sm:gap-3 py-1.5 sm:py-2 ${isWide ? 'max-w-full' : 'max-w-[1000px]'} w-full mx-auto animate-fade-in-up
        ${isUser ? 'flex-row-reverse' : ''}
        ${message.isStale ? 'message-stale' : ''}
      `}
    >
      {/* Avatar — smaller on mobile */}
      {isUser ? (
        <UserAvatar
          className="flex-shrink-0 w-7 h-7 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center text-[0.65rem] sm:text-xs font-bold mt-0.5 overflow-hidden shadow-lg"
          style={{ background: 'linear-gradient(135deg, #1A3B8A 0%, #1D6CB8 100%)', color: '#fff' }}
        />
      ) : (
        <div className="flex-shrink-0 w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center bg-[var(--surf)] border mt-0.5" style={{ borderColor: 'rgba(29,108,184,0.30)' }}>
          <svg width="18" height="18" viewBox="0 0 28 28" fill="none">
            <defs>
              <linearGradient id={`ai-grad-${message.id}`} x1="0" y1="0" x2="28" y2="28">
                <stop offset="0%" stopColor="#1D6CB8" />
                <stop offset="100%" stopColor="#4DBADF" />
              </linearGradient>
            </defs>
            <circle cx="14" cy="14" r="13" stroke={`url(#ai-grad-${message.id})`} strokeWidth="2" fill="none" />
            <path d="M10 18 C10 12, 14 9, 14 9 C14 9, 18 12, 18 18" stroke={`url(#ai-grad-${message.id})`} strokeWidth="2" strokeLinecap="round" fill="none" />
            <circle cx="14" cy="10" r="2" fill={`url(#ai-grad-${message.id})`} />
          </svg>
        </div>
      )}

      {/* Content wrapper */}
      <div className={`flex flex-col gap-0.5 sm:gap-1 ${isWide ? 'max-w-full w-full' : 'max-w-[calc(100%-44px)] sm:max-w-[calc(100%-52px)]'} min-w-0 ${isUser ? 'items-end' : ''}`}>
        {/* Bubble */}
        <div
          className={`
            px-3 sm:px-4 py-2 sm:py-3 rounded-xl
            text-[0.8375rem] sm:text-[0.9375rem] leading-[1.6] sm:leading-[1.65] break-words
            ${isUser
              ? 'ci-user-bubble'
              : `ci-assistant-bubble ${isError ? '!bg-red-500/10 !border-red-500/40' : ''}`}
            ${isEditing ? 'w-full !p-0' : ''}
            ${hasPredefinedTemplate ? '!p-0 !bg-transparent !border-transparent !shadow-none overflow-hidden' : ''}
            ${isWide ? 'w-full' : ''}
          `}
        >
          {/* Voice badge */}
          {isUser && isVoice && !isEditing && (
            <div className="inline-flex items-center gap-1 text-xs opacity-75 mb-1">
              <HiMicrophone size={12} />
              <span>Voice message</span>
            </div>
          )}

          {isEditing ? (
            <div className="flex flex-col w-full min-w-[200px] sm:min-w-[320px] bg-white/10 rounded-lg overflow-hidden border border-black/10">
              <textarea
                autoFocus
                className="w-full bg-transparent text-black outline-none border-none p-4 resize-none font-sans text-sm sm:text-base selection:bg-black/20"
                rows={Math.max(2, editContent.split('\n').length)}
                value={editContent}
                onChange={e => setEditContent(e.target.value)}
                onKeyDown={handleEditKeyDown}
              />
              <div className="flex items-center justify-end gap-3 p-3 bg-black/5 border-t border-black/10">
                <button 
                  onClick={() => {
                    setIsEditing(false);
                    setEditContent(content);
                  }}
                  className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-black/60 hover:text-black transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleEditSubmit}
                  className="px-4 py-1.5 text-[11px] font-black uppercase tracking-widest rounded-lg transition-all shadow-md active:scale-95" style={{ background: 'linear-gradient(135deg, #1A3B8A, #1D6CB8)', color: '#fff' }}
                >
                  Send
                </button>
              </div>
            </div>
          ) : isUser ? (
            <div className="flex flex-col gap-2">
              {/* Attachments */}
              {attachments && attachments.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {attachments.map((att) =>
                    att.isImage && att.url ? (
                      <img
                        key={att.id}
                        src={att.url}
                        alt={att.name}
                        className="rounded-lg max-w-[200px] max-h-[180px] object-cover border border-white/20"
                        title={att.name}
                      />
                    ) : (
                      <div
                        key={att.id}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-white/15 bg-white/10 text-[0.75rem]"
                      >
                        <span className="font-bold uppercase text-[0.6rem] opacity-70">
                          {att.name.split('.').pop()}
                        </span>
                        <span className="opacity-90 truncate max-w-[120px]" title={att.name}>
                          {att.name}
                        </span>
                      </div>
                    )
                  )}
                </div>
              )}
              {content && <p>{content}</p>}
            </div>
          ) : hasPredefinedTemplate ? (
            <div className="w-full flex flex-col gap-3">
              <PredefinedResponseTemplate templateKey={predefinedTemplateKey} content={content} />
            </div>
          ) : hasChartIntent ? (
            <div className="w-full flex flex-col gap-3">
              <DynamicResponseTemplate content={content} query={triggerQuery} />
            </div>
          ) : isStreaming ? (
            // Plain-text render during streaming — avoids running ReactMarkdown
            // on every token flush (eliminates the RAF >100ms violations).
            <div className="prose-gold chatbot-reference-markdown overflow-x-auto whitespace-pre-wrap break-words">
              {(content || '')
                .replace(/```json\s*KPI_METRICS_JSON[\s\S]*?```/gi, '')
                .replace(/KPI_METRICS_JSON[^\n]*/gi, '')
                .trim()}
            </div>
          ) : (
            <div className={`prose-gold chatbot-reference-markdown overflow-x-auto ${isError ? 'text-red-400' : ''}`}>
              {(() => {
                const c = content || '';
                // Strip KPI_METRICS_JSON blocks in all LLM output variants:
                // 1. marker inside code block:  ```json\nKPI_METRICS_JSON\n{...}\n```
                // 2. marker before code block:  KPI_METRICS_JSON\n```json\n{...}\n```
                // 3. standalone marker text with no adjacent block
                let displayContent = c
                  .replace(/```json\s*KPI_METRICS_JSON[\s\S]*?```/gi, '')
                  .replace(/KPI_METRICS_JSON[^\n]*\n\s*```[\s\S]*?```/gi, '')
                  .replace(/KPI_METRICS_JSON[^\n]*/gi, '')
                  .trim();
                let extractedHtml = '';
                
                const lowerC = c.toLowerCase();
                const htmlStartIndex = lowerC.indexOf('<!doctype html>');
                const htmlEndIndex = lowerC.indexOf('</html>');
                
                if (htmlStartIndex !== -1 && htmlEndIndex !== -1) {
                  const fullEndIndex = htmlEndIndex + '</html>'.length;
                  extractedHtml = c.substring(htmlStartIndex, fullEndIndex);
                  
                  // Inject auto-resize script into the HTML if not present
                  if (!extractedHtml.includes('window.parent.postMessage')) {
                    const script = `
                      <script>
                        function sendHeight() {
                          const wrapper = document.getElementById('app') || document.body;
                          const height = wrapper.getBoundingClientRect().height;
                          window.parent.postMessage({ type: 'setHeight', height: height }, '*');
                        }
                        window.addEventListener('load', sendHeight);
                        window.addEventListener('resize', sendHeight);
                        if (window.ResizeObserver) {
                          const observer = new ResizeObserver(sendHeight);
                          observer.observe(document.body);
                        }
                        setInterval(sendHeight, 1000);
                      </script>
                    `;
                    extractedHtml = extractedHtml.replace('</body>', `${script}</body>`);
                  }

                  
                  // Extract content before and after the HTML block
                  const beforeHtml = c.substring(0, htmlStartIndex).replace(/```[a-z]*\s*$/i, '').trim();
                  const afterHtml = c.substring(fullEndIndex).replace(/^\s*```/i, '').trim();

                  return (
                    <>
                      {beforeHtml && (
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{ table: PaginatedMarkdownTable }}
                        >
                          {beforeHtml}
                        </ReactMarkdown>
                      )}

                      <div className="w-full bg-white rounded-xl overflow-hidden my-4 border border-blue-300/40 shadow-lg animate-fade-in-scale" style={{ maxWidth: '100%', display: 'block' }}>
                        <IframeResizer srcDoc={extractedHtml} messageId={message.id} />
                      </div>

                      {afterHtml && (
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{ table: PaginatedMarkdownTable }}
                        >
                          {afterHtml}
                        </ReactMarkdown>
                      )}
                    </>
                  );
                }

                return (
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{ table: PaginatedMarkdownTable }}
                  >
                    {displayContent}
                  </ReactMarkdown>
                );
              })()}
            </div>
          )}

          {/* Streaming cursor */}
          {isStreaming && (
            <span className="inline-block text-blue-500 animate-pulse-beat ml-0.5" aria-hidden="true">▊</span>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-[var(--gold-acc)] opacity-60 px-1">{formattedTime}</span>

          {/* User actions: Edit */}
          {isUser && !isEditing && onEdit && (
             <div className="flex items-center gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-150">
                <button
                  className="w-6 h-6 rounded flex items-center justify-center text-[var(--gold-acc)] opacity-60 hover:opacity-100 hover:bg-blue-500/10 transition-all duration-150"
                  onClick={() => setIsEditing(true)}
                  title="Edit message"
                >
                  <HiOutlinePencilAlt size={14} />
                </button>
             </div>
          )}

          {!isUser && !isStreaming && (
            /* Actions — always visible */
            <div className="flex items-center gap-1">
              {isError && onRetry && (
                <button
                  className="w-6 h-6 rounded flex items-center justify-center text-red-400 hover:bg-red-500/10 transition-all duration-150"
                  onClick={onRetry}
                  title="Retry response"
                >
                  <HiOutlineRefresh size={14} />
                </button>
              )}
              {!isError && onRegenerate && (
                <button
                  className="w-6 h-6 rounded flex items-center justify-center text-[var(--gold-acc)] opacity-60 hover:opacity-100 hover:bg-blue-500/10 transition-all duration-150"
                  onClick={onRegenerate}
                  title="Regenerate response"
                  disabled={isStreaming}
                >
                  <HiOutlineRefresh size={14} />
                </button>
              )}
              <button
                className="w-6 h-6 rounded flex items-center justify-center text-[var(--gold-acc)] opacity-60 hover:opacity-100 hover:bg-blue-500/10 transition-all duration-150"
                onClick={handleCopy}
                title="Copy response"
              >
                {copied ? <HiCheck size={14} className="text-emerald-400" /> : <HiOutlineClipboardCopy size={14} />}
              </button>
              <button
                className={`w-6 h-6 rounded flex items-center justify-center transition-all duration-150
                  ${feedback === 'up' ? 'text-emerald-400' : 'text-[var(--gold-acc)] opacity-60 hover:opacity-100 hover:bg-blue-500/10'}`}
                onClick={() => handleFeedback('up')}
                title="Good response"
              >
                <HiOutlineThumbUp size={14} />
              </button>
              <button
                className={`w-6 h-6 rounded flex items-center justify-center transition-all duration-150
                  ${feedback === 'down' ? 'text-red-400' : 'text-[var(--gold-acc)] opacity-60 hover:opacity-100 hover:bg-blue-500/10'}`}
                onClick={() => handleFeedback('down')}
                title="Bad response"
              >
                <HiOutlineThumbDown size={14} />
              </button>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

/**
 * Typing indicator shown while waiting for first token
 */
export function TypingIndicator() {
  return (
    <div className="flex gap-3 py-2 max-w-[1000px] w-full mx-auto animate-fade-in-up" id="typing-indicator">
      <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-[var(--surf)] border mt-0.5" style={{ borderColor: 'rgba(29,108,184,0.30)' }}>
        <svg width="18" height="18" viewBox="0 0 28 28" fill="none">
          <defs>
            <linearGradient id="ai-grad-typing" x1="0" y1="0" x2="28" y2="28">
              <stop offset="0%" stopColor="#1D6CB8" />
              <stop offset="100%" stopColor="#4DBADF" />
            </linearGradient>
          </defs>
          <circle cx="14" cy="14" r="13" stroke="url(#ai-grad-typing)" strokeWidth="2" fill="none" />
          <path d="M10 18 C10 12, 14 9, 14 9 C14 9, 18 12, 18 18" stroke="url(#ai-grad-typing)" strokeWidth="2" strokeLinecap="round" fill="none" />
          <circle cx="14" cy="10" r="2" fill="url(#ai-grad-typing)" />
        </svg>
      </div>
      <div className="flex flex-col gap-1 max-w-[calc(100%-52px)] min-w-0">
        <div className="px-4 py-3 rounded-xl rounded-bl-sm bg-[var(--surf)] border border-blue-300/25 shadow-[0_2px_8px_rgba(0,0,0,0.3)]">
          <div className="flex gap-1.5 py-1">
            <span className="w-2 h-2 rounded-full bg-[var(--txt3)] animate-typing-dot" style={{ animationDelay: '0s' }} />
            <span className="w-2 h-2 rounded-full bg-[var(--txt3)] animate-typing-dot" style={{ animationDelay: '0.15s' }} />
            <span className="w-2 h-2 rounded-full bg-[var(--txt3)] animate-typing-dot" style={{ animationDelay: '0.3s' }} />
          </div>
        </div>
      </div>
    </div>
  );
}
