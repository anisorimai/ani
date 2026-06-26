import React from 'react';
import { HiOutlineMenuAlt2, HiOutlineLogout, HiOutlineMoon, HiOutlineSun } from 'react-icons/hi';
import useAuthStore from '../store/useAuthStore';
import useChatStore from '../store/useChatStore';
import useThemeStore from '../store/useThemeStore';
import { toast } from 'react-hot-toast';
import AppLogo from './AppLogo';

export default function Header({ onToggleSidebar, onCloseSidebar, view, onViewChange }) {
  /* ── Store selectors ── */
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const conversations        = useChatStore((s) => s.conversations);
  const logout               = useAuthStore((s) => s.logout);
  const theme                = useThemeStore((s) => s.theme);
  const toggleTheme          = useThemeStore((s) => s.toggleTheme);



  /*
   * isWelcomeScreen: true when there is no active conversation with messages.
   * Controls which header elements are shown (logo + new-chat button are hidden
   * on the welcome screen to keep the layout clean).
   */
  const isWelcomeScreen =
    !activeConversationId || !conversations[activeConversationId]?.messages?.length;

  return (
    /*
     * Glass header bar.
     * Positioned absolute within the main-content div (which already has ml-[52px]).
     * The ::after pseudo-element creates a soft gradient separator instead of a hard border.
     */
    <div
      className="
        flex justify-between items-center px-4 sm:px-6 h-20
        absolute top-0 left-0 right-0 z-50
        glass-header transition-colors duration-250
        after:content-[''] after:absolute after:bottom-0
        after:left-0 after:right-0 after:h-px
        after:bg-gradient-to-r after:from-transparent after:via-[var(--brd2)] after:to-transparent
      "
      id="app-header"
    >
      {/* ── Left side: sidebar toggle + view tabs ── */}
      <div className="flex items-center gap-3">
        {/* Hamburger / menu button — opens the conversation sidebar */}
        <button
          id="sidebar-toggle-btn"
          className="
            w-9 h-9 rounded-xl flex items-center justify-center
            bg-[var(--brd)] text-[var(--gold-acc)]
            hover:bg-[var(--brd2)] hover:scale-105 active:scale-95
            transition-all duration-200
            shadow-lg
          "
          onClick={onToggleSidebar}
          aria-label="Toggle sidebar"
          title="Menu"
        >
          <HiOutlineMenuAlt2 size={20} />
        </button>

        {/* View toggle: Overview ↔ Chat */}
        {onViewChange && (
          <div className="flex items-center gap-1 bg-[var(--brd)] rounded-xl px-1 py-1">
            <button
              onClick={() => onViewChange('overview')}
              className={`
                px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200
                ${view === 'overview'
                  ? 'bg-[var(--brd2)] text-[var(--gold-acc)] shadow-sm'
                  : 'text-[var(--txt2)] hover:text-[var(--txt)]'}
              `}
            >
              Overview
            </button>
            <button
              onClick={() => onViewChange('chat')}
              className={`
                px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200
                ${view === 'chat'
                  ? 'bg-[var(--brd2)] text-[var(--gold-acc)] shadow-sm'
                  : 'text-[var(--txt2)] hover:text-[var(--txt)]'}
              `}
            >
              Chat
            </button>
          </div>
        )}

        {/* Logo + app name — only shown when inside an active chat */}
        {view === 'chat' && !isWelcomeScreen && (
          <div className="flex items-center gap-2 animate-fade-in">
            <div className="logo-badge">
              <AppLogo style={{ width: '180px' }} />
            </div>
            <span className="font-semibold text-sm text-[var(--txt)]">
              Voxa
              <span className="hidden sm:inline text-xs font-normal">
                {' '}: Voice Enabled AI Assistant
              </span>
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 bg-[var(--brd)] px-2 py-1.5 rounded-xl">
        <button
          id="theme-toggle-btn"
          className="
            w-9 h-9 rounded-xl flex items-center justify-center
            bg-[var(--brd)] text-[var(--txt)]
            hover:bg-[var(--brd2)] hover:scale-105 active:scale-95
            transition-all duration-200
          "
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
        >
          {theme === 'dark' ? <HiOutlineSun size={20} /> : <HiOutlineMoon size={20} />}
        </button>

        {/* Logout button */}
        <button
          id="logout-btn"
          className="
            w-9 h-9 rounded-xl flex items-center justify-center
            bg-[var(--brd)] text-[var(--txt)]
            hover:bg-red-500/20 hover:text-red-400 hover:scale-105 active:scale-95
            transition-all duration-200
          "
          onClick={() => {
            logout();
            toast.success('Logged out');
          }}
          aria-label="Logout"
          title="Logout"
        >
          <HiOutlineLogout size={20} />
        </button>
      </div>
    </div>
  );
}
