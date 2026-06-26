import { create } from 'zustand';
import { saveConversation, getAllConversations, deleteConversation as deleteCachedConversation, clearLegacyConversations } from '../services/cache';
import { closeStream, syncHistory, getHistory } from '../services/api';
import useAuthStore from './useAuthStore';

// Reads the current user ID from the auth store at call time (not at store creation)
const _uid = () => useAuthStore.getState().user?.id ?? null;

/**
 * Strict message schema — enforced throughout the app:
 * {
 *   id: string,
 *   role: 'user' | 'assistant',
 *   content: string,
 *   type: 'text' | 'voice',
 *   createdAt: number,
 * }
 */

const generateId = () => `conv_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
const generateMsgId = () => `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

/**
 * Enforces the strict message schema.
 * Throws if required fields are missing or invalid.
 */
function createMessage({ role, content, type, isError, pagination = null, attachments = null }) {
  if (!['user', 'assistant'].includes(role)) {
    throw new Error(`Invalid message role: "${role}"`);
  }
  if (typeof content !== 'string') {
    throw new Error('Message content must be a string');
  }
  if (!['text', 'voice'].includes(type)) {
    throw new Error(`Invalid message type: "${type}". Must be "text" or "voice".`);
  }

  return {
    id: generateMsgId(),
    role,
    content,
    type,
    isError: !!isError,
    isStale: false,
    parentId: null,
    createdAt: Date.now(),
    pagination: pagination || null,
    attachments: attachments || null,
  };
}

const useChatStore = create((set, get) => ({
  // ---- State ----
  // conversations: { [id]: { id, title, messages[], createdAt, updatedAt } }
  conversations: {},
  activeConversationId: null,
  isLoading: false,

  // Streaming state
  isStreaming: false,
  streamingText: '',
  activeStreamId: null,
  isSyncing: false,

  // ---- Helpers ----
  syncWithBackend: async () => {
    // Basic debounce to avoid spamming the backend during rapid state changes
    if (get()._syncTimeout) clearTimeout(get()._syncTimeout);
    
    const timeout = setTimeout(async () => {
      try {
        const { conversations } = get();
        await syncHistory(conversations);
      } catch (err) {
        console.warn('Failed to sync with backend:', err);
      }
    }, 1000); // 1s debounce

    set({ _syncTimeout: timeout });
  },

  // ---- Conversation Actions ----

  createConversation: (domain = '') => {
    const id = generateId();
    const conversation = {
      id,
      title: 'New Chat',
      domain,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    set((state) => ({
      conversations: { ...state.conversations, [id]: conversation },
      activeConversationId: id,
      streamingText: '',
      isStreaming: false,
      isLoading: false,
    }));
    localStorage.setItem('voice-ai-active-id', id);
    sessionStorage.setItem('voxa-session-active-id', id);
    if (domain) localStorage.setItem('voxa-active-id-' + domain, id);
    return id;
  },

  setActiveConversation: (id) => {
    // Cancel any active stream when switching conversations
    get().cancelStream();
    set({ activeConversationId: id, streamingText: '', isStreaming: false });
    localStorage.setItem('voice-ai-active-id', id || '');
    if (id) sessionStorage.setItem('voxa-session-active-id', id);
    else sessionStorage.removeItem('voxa-session-active-id');
  },

  addMessage: (conversationId, { role, content, type, isError, pagination, attachments }) => {
    const msg = createMessage({ role, content, type, isError, pagination, attachments });

    set((state) => {
      const conv = state.conversations[conversationId];
      if (!conv) return state;

      const updatedMessages = [...conv.messages, msg];

      // Auto-generate title from first user message
      let title = conv.title;
      if (title === 'New Chat' && role === 'user' && content) {
        title = content.length > 40 ? content.slice(0, 40) + '...' : content;
      }

      const updatedConv = {
        ...conv,
        messages: updatedMessages,
        title,
        updatedAt: Date.now(), // Always update on new message
      };

      const newConversations = { ...state.conversations, [conversationId]: updatedConv };
      
      // Enforce LRU cache size (max 30)
      const uid = _uid();
      const maxCacheSize = 30;
      const keys = Object.keys(newConversations);
      if (keys.length > maxCacheSize) {
        const sortedKeys = keys.sort((a, b) => newConversations[a].updatedAt - newConversations[b].updatedAt);
        const keysToDelete = sortedKeys.slice(0, keys.length - maxCacheSize);
        keysToDelete.forEach(k => {
          if (k !== state.activeConversationId) {
            delete newConversations[k];
            deleteCachedConversation(k, uid);
          }
        });
      }

      saveConversation(conversationId, updatedConv, uid);
      
      return { conversations: newConversations };
    });

    // Sync with backend asynchronously AFTER state is updated
    get().syncWithBackend();

    return msg.id;
  },

  removeMessage: (conversationId, messageId) => {
    set((state) => {
      const conv = state.conversations[conversationId];
      if (!conv) return state;

      const updatedMessages = conv.messages.filter((m) => m.id !== messageId);
      const updatedConv = {
        ...conv,
        messages: updatedMessages,
        updatedAt: Date.now(),
      };

      const newConversations = { ...state.conversations, [conversationId]: updatedConv };
      saveConversation(conversationId, updatedConv, _uid());
      return { conversations: newConversations };
    });
    
    get().syncWithBackend();
  },

  // ---- Streaming Actions ----
  // streamingText is NEVER stored in messages until finalizeStream() is called.

  startStreaming: (streamId) => {
    set({ isStreaming: true, streamingText: '', isLoading: false, activeStreamId: streamId });
  },

  appendToken: (token, streamId) => {
    const state = get();
    // Ignore stale streams due to race conditions
    if (streamId && state.activeStreamId !== streamId) return;

    set({ streamingText: state.streamingText + token });
  },

  /**
   * Finalize stream — commit to messages, reset.
   */
  finalizeStream: (streamId, finalMessage = null, pagination = null) => {
    const { streamingText, activeConversationId, activeStreamId } = get();

    // Ignore if from a stale stream
    if (streamId && activeStreamId && activeStreamId !== streamId) return;

    if (finalMessage && activeConversationId) {
      get().addMessage(activeConversationId, {
        role: finalMessage.role || 'assistant',
        content: finalMessage.content || '',
        type: finalMessage.type || 'text',
        isError: !!finalMessage.isError,
        pagination,
      });
    } else if (streamingText && activeConversationId) {
      get().addMessage(activeConversationId, {
        role: 'assistant',
        content: streamingText,
        type: 'text',
        pagination,
      });
      // addMessage already calls syncWithBackend
    }

    set({ streamingText: '', isStreaming: false, isLoading: false, activeStreamId: null });
  },

  /**
   * Remove the last assistant message in a conversation (used for pagination replacement).
   */
  removeLastAssistantMessage: (conversationId) => {
    set((state) => {
      const conv = state.conversations[conversationId];
      if (!conv) return state;
      const messages = [...conv.messages];
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'assistant') {
          messages.splice(i, 1);
          break;
        }
      }
      const updatedConv = { ...conv, messages, updatedAt: Date.now() };
      saveConversation(conversationId, updatedConv, _uid());
      return { conversations: { ...state.conversations, [conversationId]: updatedConv } };
    });
  },

  /**
   * Cancel an active stream — clears partial text without committing.
   * Silent: used when switching conversations, resending, or unmounting.
   */
  cancelStream: () => {
    closeStream(); // sends a stop frame so the backend aborts generation too
    set({
      streamingText: '',
      isStreaming: false,
      isLoading: false,
      activeStreamId: null,
    });
  },

  /**
   * User-initiated stop ("Stop generating" / Esc) — aborts backend generation,
   * keeps whatever text was already streamed, and appends a fallback notice.
   */
  stopStream: () => {
    const { streamingText, activeConversationId, isStreaming, isLoading } = get();
    closeStream(); // sends a stop frame so the backend aborts generation too
    if (activeConversationId && (isStreaming || isLoading)) {
      const content = streamingText
        ? `${streamingText}\n\n*⏹ Response generation stopped — this answer may be incomplete.*`
        : '*⏹ Response generation stopped before any output was produced. Ask again whenever you\'re ready.*';
      get().addMessage(activeConversationId, {
        role: 'assistant',
        content,
        type: 'text',
        isStopped: true,
      });
    }
    set({
      streamingText: '',
      isStreaming: false,
      isLoading: false,
      activeStreamId: null,
    });
  },

  setLoading: (loading) => set({ isLoading: loading }),

  // ---- Conversation Management ----

  renameConversation: async (id, newTitle) => {
    const updatedConv = { ...get().conversations[id], title: newTitle, updatedAt: Date.now() };

    set((state) => {
      const newConversations = { ...state.conversations, [id]: updatedConv };
      saveConversation(id, updatedConv, _uid());
      return { conversations: newConversations };
    });
    
    // Immediate sync for renames
    try {
      await syncHistory(get().conversations);
    } catch (err) {
      console.warn('Failed to sync rename:', err);
    }
  },

  deleteConversation: (id) => {
    set((state) => {
      const newConversations = { ...state.conversations };
      delete newConversations[id];
      deleteCachedConversation(id, _uid());

      const newActiveId = state.activeConversationId === id
        ? Object.keys(newConversations).sort((a, b) => {
            return (newConversations[b]?.updatedAt || 0) - (newConversations[a]?.updatedAt || 0);
          })[0] || null
        : state.activeConversationId;

      // Sync with backend
      setTimeout(() => get().syncWithBackend(), 0);

      return { conversations: newConversations, activeConversationId: newActiveId };
    });
  },

  clearAll: async () => {
    // 1. Clear local state immediately
    set({
      conversations: {},
      activeConversationId: null,
      streamingText: '',
      isStreaming: false,
      isLoading: false,
      activeStreamId: null,
    });
    
    // 2. Clear browser cache (scoped to current user)
    const cache = await import('../services/cache');
    cache.clearAllConversations(_uid());
    
    // 3. FORCE immediate sync with backend (no debounce)
    try {
      await syncHistory({});
    } catch (err) {
      console.warn('Failed to clear backend history:', err);
    }
  },

  loadFromCache: async () => {
    const userId = _uid();

    // One-time migration: drop any unscoped legacy keys left by the old cache format
    clearLegacyConversations();

    const cached = getAllConversations(userId);
    const savedActiveId = localStorage.getItem('voice-ai-active-id');

    set({ conversations: cached });

    // Try to fetch from backend if authenticated
    try {
      const backendResponse = await getHistory();
      const backendHistory = backendResponse?.conversations || backendResponse || {};
      if (backendHistory && typeof backendHistory === 'object') {
        const merged = { ...cached };

        Object.entries(backendHistory).forEach(([id, bConv]) => {
          const lConv = cached[id];
          if (!lConv || (bConv.updatedAt || 0) > (lConv.updatedAt || 0)) {
            merged[id] = bConv;
            saveConversation(id, bConv, userId);
          }
        });

        set({ conversations: merged });
      }
    } catch (err) {
      console.warn('Failed to load history from backend:', err);
    }

    const currentConversations = get().conversations;

    if (savedActiveId === '__new__') {
      set({ activeConversationId: null });
    } else if (savedActiveId && currentConversations[savedActiveId]) {
      set({ activeConversationId: savedActiveId });
    } else if (Object.keys(currentConversations).length > 0) {
      const mostRecentId = Object.values(currentConversations).sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id;
      set({ activeConversationId: mostRecentId });
    } else {
      set({ activeConversationId: null });
    }
  },

  /**
   * Start a new empty chat — sets active to null (shows welcome screen)
   * and persists the state for refresh.
   */
  newChat: () => {
    get().cancelStream();
    set({ activeConversationId: null, streamingText: '', isStreaming: false, isLoading: false });
    localStorage.setItem('voice-ai-active-id', '__new__');
    sessionStorage.removeItem('voxa-session-active-id');
    const domain = localStorage.getItem('voxa-selected-domain') || 'Enterprise';
    localStorage.removeItem('voxa-active-id-' + domain);
  },

  getActiveConversation: () => {
    const { conversations, activeConversationId } = get();
    return activeConversationId ? conversations[activeConversationId] : null;
  },

  // Mark message as stale (for regenerate)
  markMessageStale: (conversationId, messageId) => {
    set((state) => {
      const conv = state.conversations[conversationId];
      if (!conv) return state;

      const updatedMessages = conv.messages.map((m) =>
        m.id === messageId ? { ...m, isStale: true } : m
      );

      const updatedConv = {
        ...conv,
        messages: updatedMessages,
        updatedAt: Date.now(),
      };

      saveConversation(conversationId, updatedConv, _uid());

      return {
        conversations: {
          ...state.conversations,
          [conversationId]: updatedConv,
        },
      };
    });
  },

  // Find previous user message
  getPreviousUserMessage: (conversationId, messageId) => {
    const conv = get().conversations[conversationId];
    if (!conv) return null;

    const idx = conv.messages.findIndex((m) => m.id === messageId);
    if (idx <= 0) return null;

    for (let i = idx - 1; i >= 0; i--) {
      if (conv.messages[i].role === 'user') {
        return conv.messages[i];
      }
    }

    return null;
  },

  updateMessage: (conversationId, messageId, newContent) => {
    set((state) => {
      const conv = state.conversations[conversationId];
      if (!conv) return state;

      const updatedMessages = conv.messages.map((m) =>
        m.id === messageId ? { ...m, content: newContent, updatedAt: Date.now() } : m
      );

      const updatedConv = {
        ...conv,
        messages: updatedMessages,
        updatedAt: Date.now(),
      };

      saveConversation(conversationId, updatedConv, _uid());
      return {
        conversations: {
          ...state.conversations,
          [conversationId]: updatedConv,
        },
      };
    });

    get().syncWithBackend();
  },

  truncateHistory: (conversationId, messageId) => {
    set((state) => {
      const conv = state.conversations[conversationId];
      if (!conv) return state;

      const idx = conv.messages.findIndex((m) => m.id === messageId);
      if (idx === -1) return state;

      const updatedMessages = conv.messages.slice(0, idx + 1);

      const updatedConv = {
        ...conv,
        messages: updatedMessages,
        updatedAt: Date.now(),
      };

      saveConversation(conversationId, updatedConv, _uid());
      return {
        conversations: {
          ...state.conversations,
          [conversationId]: updatedConv,
        },
      };
    });

    get().syncWithBackend();
  },
}));

export default useChatStore;
