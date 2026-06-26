import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  login as loginApi,
  signup as signupApi,
  getMe,
  resetPassword as resetPasswordApi,
  logoutApi,
  logoutAllApi,
  refreshTokenApi,
  warmupWebSocket,
} from '../services/api';

const useAuthStore = create(
  persist(
    (set, get) => ({
      user:            null,
      token:           null,   // access token
      refreshToken:    null,   // refresh token (persisted for remember-me)
      isAuthenticated: false,
      loading:         false,
      isCheckingAuth:  true,

      // ── Login ──────────────────────────────────────────────────────────────
      login: async (identifier, password, rememberMe = false) => {
        set({ loading: true, error: null });
        try {
          const data = await loginApi(identifier, password, rememberMe);
          set({
            user:            data.user,
            token:           data.access_token,
            refreshToken:    data.refresh_token,
            isAuthenticated: true,
            loading:         false,
            isCheckingAuth:  false,
          });
          localStorage.setItem('voice-ai-active-id', '__new__');
          warmupWebSocket();
          return data;
        } catch (err) {
          set({ error: err.message, loading: false, isCheckingAuth: false });
          throw err;
        }
      },

      // ── Signup ─────────────────────────────────────────────────────────────
      signup: async (userData, rememberMe = false) => {
        set({ loading: true, error: null });
        try {
          const data = await signupApi({ ...userData, remember_me: rememberMe });
          if (data.access_token) {
            set({
              user:            data.user || { email: userData.email, name: userData.name },
              token:           data.access_token,
              refreshToken:    data.refresh_token,
              isAuthenticated: true,
              loading:         false,
              isCheckingAuth:  false,
            });
            localStorage.setItem('voice-ai-active-id', '__new__');
          } else {
            set({ loading: false });
          }
          return data;
        } catch (err) {
          set({ error: err.message, loading: false });
          throw err;
        }
      },

      // ── Logout (this device) ───────────────────────────────────────────────
      logout: async () => {
        const { refreshToken } = get();
        // Revoke session on server (best-effort)
        if (refreshToken) await logoutApi(refreshToken);
        get()._clearAuthState();
      },

      // ── Logout all devices ─────────────────────────────────────────────────
      logoutAll: async () => {
        try { await logoutAllApi(); } catch { /* ignore */ }
        get()._clearAuthState();
      },

      // ── Refresh access token ───────────────────────────────────────────────
      refresh: async () => {
        const { refreshToken } = get();
        if (!refreshToken) {
          get()._clearAuthState();
          return false;
        }
        try {
          const data = await refreshTokenApi(refreshToken);
          set({
            token:        data.access_token,
            refreshToken: data.refresh_token,
          });
          return true;
        } catch {
          get()._clearAuthState();
          return false;
        }
      },

      // ── Check auth on app load ─────────────────────────────────────────────
      // Decodes JWT expiry locally to skip the /me call when already expired,
      // avoiding guaranteed 401s in the browser console.
      checkAuth: async () => {
        const { token, refresh } = get();
        if (!token) {
          set({ isAuthenticated: false, user: null, isCheckingAuth: false });
          return;
        }
        set({ isCheckingAuth: true });

        // Decode expiry without a library — skip getMe if already expired
        const isExpired = (() => {
          try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            return payload.exp * 1000 < Date.now();
          } catch { return true; }
        })();

        if (!isExpired) {
          try {
            const user = await getMe(token);
            set({ user, isAuthenticated: true, isCheckingAuth: false });
            warmupWebSocket();
            return;
          } catch { /* token rejected by server — fall through to refresh */ }
        }

        // Token expired or server-rejected — try refreshing silently
        const ok = await refresh();
        if (ok) {
          try {
            const user = await getMe(get().token);
            set({ user, isAuthenticated: true, isCheckingAuth: false });
            warmupWebSocket();
            return;
          } catch { /* refresh succeeded but getMe still failed */ }
        }
        set({ isAuthenticated: false, user: null, isCheckingAuth: false });
      },

      // ── Password reset ─────────────────────────────────────────────────────
      updatePassword: async (identifier, oldPassword, newPassword) => {
        set({ loading: true, error: null });
        try {
          const data = await resetPasswordApi(identifier, oldPassword, newPassword);
          set({ loading: false });
          // Backend revokes all sessions on password change — clear local auth
          get()._clearAuthState();
          return data;
        } catch (err) {
          set({ error: err.message, loading: false });
          throw err;
        }
      },

      clearError: () => set({ error: null }),

      // ── Internal: wipe auth state + local cache ────────────────────────────
      _clearAuthState: () => {
        // Capture user ID before wiping state
        const userId = get().user?.id;

        set({
          user: null, token: null, refreshToken: null,
          isAuthenticated: false, error: null, isCheckingAuth: false,
        });

        localStorage.removeItem('voice-ai-active-id');

        // Clear scoped chat cache for this user + any legacy unscoped keys
        const scopedPrefix = userId ? `voice-ai-chat:${userId}:` : null;
        const legacyPrefix = 'voice-ai-chat:';
        const toRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (!k) continue;
          if (scopedPrefix && k.startsWith(scopedPrefix)) { toRemove.push(k); continue; }
          // Legacy keys: start with 'voice-ai-chat:' but have no second ':' (old unscoped format)
          if (k.startsWith(legacyPrefix) && !k.slice(legacyPrefix.length).includes(':')) {
            toRemove.push(k);
          }
        }
        toRemove.forEach((k) => localStorage.removeItem(k));
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        token:           state.token,
        refreshToken:    state.refreshToken,
        user:            state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);

// ── Global auth-expiry listener ───────────────────────────────────────────────
// api.js dispatches 'voxa:auth-expired' when a refresh attempt fails.
// We clear auth state here without importing the store into api.js (avoids circular deps).
if (typeof window !== 'undefined') {
  window.addEventListener('voxa:auth-expired', () => {
    useAuthStore.getState()._clearAuthState();
  });
}

export default useAuthStore;
