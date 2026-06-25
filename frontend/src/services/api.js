/**
 * API Service Layer
 *
 * Auth flow:
 *   - Access token (60 min) is sent as Bearer header on every request.
 *   - On 401, refreshAccessToken() is called automatically.
 *   - If refresh succeeds, the original request is retried once.
 *   - If refresh fails, a 'voxa:auth-expired' event is dispatched so the
 *     auth store can clear state and redirect to login.
 *
 * Token storage: Zustand persist writes to localStorage under 'auth-storage'.
 * api.js reads tokens directly from there to avoid a circular import with the store.
 */

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';
const WS_BASE  = import.meta.env.VITE_WS_URL  || 'ws://localhost:8000/api';

// ── Token helpers (read from Zustand persisted localStorage) ─────────────────

function _readAuthState() {
  try {
    return JSON.parse(localStorage.getItem('auth-storage') || '{}')?.state || {};
  } catch {
    return {};
  }
}

function _writeAuthState(patch) {
  try {
    const stored = JSON.parse(localStorage.getItem('auth-storage') || '{}');
    stored.state = { ...stored.state, ...patch };
    localStorage.setItem('auth-storage', JSON.stringify(stored));
  } catch { /* ignore */ }
}

function getAccessToken()  { return _readAuthState().token        || null; }
function getRefreshToken() { return _readAuthState().refreshToken || null; }

// Legacy alias used by streamMessage WebSocket URL construction
function getAuthToken() { return getAccessToken(); }

// ── Token refresh ─────────────────────────────────────────────────────────────

let _refreshInFlight = null; // deduplicate concurrent refresh attempts

async function refreshAccessToken() {
  // Only one refresh at a time
  if (_refreshInFlight) return _refreshInFlight;

  _refreshInFlight = (async () => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return null;

    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });

      if (!res.ok) {
        window.dispatchEvent(new Event('voxa:auth-expired'));
        return null;
      }

      const data = await res.json();
      // Persist new tokens directly into localStorage
      _writeAuthState({
        token:        data.access_token,
        refreshToken: data.refresh_token,
      });
      return data.access_token;
    } catch {
      window.dispatchEvent(new Event('voxa:auth-expired'));
      return null;
    } finally {
      _refreshInFlight = null;
    }
  })();

  return _refreshInFlight;
}

// ── Central authenticated fetch (with one auto-refresh retry on 401) ─────────

async function apiFetch(url, options = {}) {
  const token = getAccessToken();
  const headers = {
    ...options.headers,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  let res = await fetch(url, { ...options, headers });

  if (res.status === 401) {
    const newToken = await refreshAccessToken();
    if (!newToken) {
      throw new Error('Session expired. Please log in again.');
    }
    res = await fetch(url, {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${newToken}` },
    });
  }

  return res;
}

async function apiJson(url, options = {}) {
  const res = await apiFetch(url, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Request failed (${res.status})`);
  }
  return res.json();
}

// ── Persistent WebSocket manager ─────────────────────────────────────────────
//
// One connection is kept alive for the lifetime of the page.
// It auto-reconnects with exponential backoff and sends a ping every 25 s
// to keep proxies / load-balancers from timing out the idle connection.
//
// Each streamMessage() call reuses the open connection (or waits for it to
// (re)open) and registers per-request callbacks for tokens / done / error.

const PING_MS      = 25_000;   // heartbeat interval
const CONNECT_MS   = 10_000;   // open() timeout
const MAX_DELAY_MS = 30_000;   // cap on reconnect backoff

class _VoxaWebSocket {
  constructor() {
    this._ws          = null;
    this._phase       = 'idle';   // 'idle' | 'connecting' | 'open'
    this._backoff     = 1_000;
    this._reconnTimer = null;
    this._pingTimer   = null;
    this._waiters     = [];       // { resolve, reject } waiting for open

    // In-flight request handlers
    this._onToken    = null;
    this._onComplete = null;
    this._onError    = null;
    this._buf        = '';
    this._flushTimer = null;
    this._requestId  = null;   // id of the in-flight request; late frames from
                               // stopped/superseded requests are discarded
  }

  // ── Open (or return existing open connection) ─────────────────────────────
  _ensureOpen() {
    if (this._phase === 'open') return Promise.resolve();
    if (this._phase === 'connecting') {
      return new Promise((resolve, reject) => this._waiters.push({ resolve, reject }));
    }
    return new Promise((resolve, reject) => {
      this._waiters.push({ resolve, reject });
      this._phase = 'connecting';
      this._openSocket();
    });
  }

  _openSocket() {
    const ws = new WebSocket(`${WS_BASE}/stream`);
    this._ws = ws;

    const timeout = setTimeout(() => {
      if (ws.readyState === WebSocket.CONNECTING) ws.close();
    }, CONNECT_MS);

    ws.onopen = () => {
      clearTimeout(timeout);
      this._phase   = 'open';
      this._backoff = 1_000;
      this._startPing();
      this._waiters.forEach(w => w.resolve());
      this._waiters = [];
    };

    ws.onmessage = e => this._onMessage(e);

    ws.onerror = () => { clearTimeout(timeout); };

    ws.onclose = () => {
      clearTimeout(timeout);
      this._stopPing();
      const wasConnecting = this._phase === 'connecting';
      this._phase = 'idle';
      this._ws    = null;
      if (wasConnecting) {
        const err = new Error('WebSocket failed to connect');
        this._waiters.forEach(w => w.reject(err));
        this._waiters = [];
      }
      // Notify in-flight request that the connection dropped
      if (this._onError) {
        const cb = this._onError;
        this._clearHandlers();
        cb(new Error('Connection lost. Reconnecting…'));
      }
      this._scheduleReconnect();
    };
  }

  _scheduleReconnect() {
    if (this._reconnTimer) return;
    this._reconnTimer = setTimeout(() => {
      this._reconnTimer = null;
      if (this._phase === 'idle') {
        this._phase = 'connecting';
        this._openSocket();
      }
    }, this._backoff);
    this._backoff = Math.min(this._backoff * 2, MAX_DELAY_MS);
  }

  _startPing() {
    this._stopPing();
    this._pingTimer = setInterval(() => {
      if (this._ws?.readyState === WebSocket.OPEN) {
        this._ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, PING_MS);
  }

  _stopPing() {
    if (this._pingTimer) { clearInterval(this._pingTimer); this._pingTimer = null; }
  }

  _onMessage(evt) {
    let data;
    try { data = JSON.parse(evt.data); } catch { return; }

    // Heartbeat reply — ignore
    if (data.type === 'pong') return;

    // Late frame from a stopped or superseded request — discard
    if (data.request_id && data.request_id !== this._requestId) return;

    if (data.error) {
      const isAuth = /unauthorized|token|401/i.test(data.error);
      if (isAuth) {
        // Refresh token silently; next message will use the new one
        refreshAccessToken().catch(() => {});
      }
      if (this._onError) {
        const cb = this._onError;
        this._clearHandlers();
        cb(new Error(data.error));
      }
      return;
    }

    if (data.token) {
      this._buf += data.token;
      if (!this._flushTimer) {
        this._flushTimer = setInterval(() => {
          if (this._buf && this._onToken) { this._onToken(this._buf); this._buf = ''; }
        }, 80);
      }
    }

    if (data.done) {
      if (this._buf && this._onToken) { this._onToken(this._buf); this._buf = ''; }
      const cb = this._onComplete;
      this._clearHandlers();
      if (cb) cb(null, data);
    }
  }

  _clearHandlers() {
    this._onToken    = null;
    this._onComplete = null;
    this._onError    = null;
    this._buf        = '';
    this._requestId  = null;
    if (this._flushTimer) { clearInterval(this._flushTimer); this._flushTimer = null; }
  }

  /** Tell the backend to abort the in-flight generation (keeps connection open). */
  _sendStop() {
    if (this._requestId && this._ws?.readyState === WebSocket.OPEN) {
      try {
        this._ws.send(JSON.stringify({ type: 'stop', request_id: this._requestId }));
      } catch { /* socket died — backend aborts on disconnect anyway */ }
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  cancel() {
    this._sendStop();
    this._clearHandlers();
  }

  async send(message, conversationId, history, page, onToken, onComplete, onError, dashboardContext = "") {
    this._clearHandlers();
    this._onToken    = onToken;
    this._onComplete = onComplete;
    this._onError    = onError;

    try {
      await this._ensureOpen();
    } catch (err) {
      this._clearHandlers();
      onError(err);
      return;
    }

    this._requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const token = getAccessToken();
    this._ws.send(JSON.stringify({
      token, message, conversation_id: conversationId, history, page,
      request_id: this._requestId,
      dashboard_context: dashboardContext,
    }));
  }

  /** Call once after login to pre-open the socket before the first message. */
  warmup() {
    if (this._phase === 'idle') {
      this._phase = 'connecting';
      this._openSocket();
    }
  }
}

const _ws = new _VoxaWebSocket();

export function closeStream() {
  _ws.cancel();
}

export function streamMessage(message, conversationId, onToken, onComplete, onError, history = [], page = 1, dashboardContext = "") {
  _ws.cancel();
  _ws.send(message, conversationId, history, page, onToken, onComplete, onError, dashboardContext);
  return { close: () => _ws.cancel() };
}

/** Pre-open the WebSocket connection (call after successful login). */
export function warmupWebSocket() {
  _ws.warmup();
}

// ── Auth endpoints ────────────────────────────────────────────────────────────

export async function login(username, password, rememberMe = false) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, remember_me: rememberMe }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Login failed');
  }
  return res.json();
}

export async function signup(userData) {
  const res = await fetch(`${API_BASE}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(userData),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Signup failed');
  }
  return res.json();
}

export async function getMe(token) {
  const res = await fetch(`${API_BASE}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to fetch user');
  return res.json();
}

export async function refreshTokenApi(refreshToken) {
  const res = await fetch(`${API_BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Token refresh failed');
  }
  return res.json();
}

export async function logoutApi(refreshToken) {
  // Best-effort — don't throw if server is unreachable
  try {
    await fetch(`${API_BASE}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
  } catch { /* ignore */ }
}

export async function logoutAllApi() {
  return apiJson(`${API_BASE}/auth/logout-all`, { method: 'POST' });
}

export async function resetPassword(identifier, oldPassword, newPassword) {
  const res = await fetch(`${API_BASE}/auth/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, old_password: oldPassword, new_password: newPassword }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Password reset failed');
  }
  return res.json();
}

// ── Admin endpoints ───────────────────────────────────────────────────────────

export async function clearServerCache() {
  return apiJson(`${API_BASE}/cache/clear`, { method: 'POST' });
}

// ── Data endpoints ────────────────────────────────────────────────────────────

export async function checkHealth() {
  const res = await fetch(`${API_BASE}/health`);
  if (!res.ok) throw new Error('Health check failed');
  return res.json();
}

export async function transcribeAudio(audioBlob) {
  const form = new FormData();
  const type = audioBlob.type || '';
  const ext  = type.includes('mp4') || type.includes('m4a') ? 'mp4'
             : type.includes('ogg') ? 'ogg'
             : 'webm';
  form.append('audio', audioBlob, `recording.${ext}`);
  return apiJson(`${API_BASE}/speech-to-text`, { method: 'POST', body: form });
}

export async function sendMessage(message, conversationId, history = []) {
  return apiJson(`${API_BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, conversation_id: conversationId, history }),
  });
}

export async function executeQuery(query, conversationId) {
  return apiJson(`${API_BASE}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, conversation_id: conversationId }),
  });
}

export async function getHistory() {
  return apiJson(`${API_BASE}/history`);
}

export async function syncHistory(conversations) {
  return apiJson(`${API_BASE}/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversations }),
  });
}
