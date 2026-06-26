import React, { useState, useRef, useEffect } from 'react';
import { HiOutlineLogout, HiOutlineChevronDown } from 'react-icons/hi';
import { toast } from 'react-hot-toast';
import useAuthStore from '../../store/useAuthStore';
import useThemeStore from '../../store/useThemeStore';
import useChatStore from '../../store/useChatStore';
import AppLogo from '../AppLogo';

export default function AIHeader() {
  const user               = useAuthStore((s) => s.user);
  const logout             = useAuthStore((s) => s.logout);
  const theme              = useThemeStore((s) => s.theme);
  const toggleTheme        = useThemeStore((s) => s.toggleTheme);
  const createConversation    = useChatStore((s) => s.createConversation);
  const setActiveConversation = useChatStore((s) => s.setActiveConversation);
  const newChat               = useChatStore((s) => s.newChat);
  const hasMessages           = useChatStore((s) => {
    const conv = s.conversations[s.activeConversationId];
    return !!(conv?.messages?.length);
  });

  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (profileRef.current && !profileRef.current.contains(e.target)) {
        setProfileOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleLogout = () => {
    logout();
    toast.success('Signed out');
    setProfileOpen(false);
  };

  const initials = user?.name
    ? user.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
    : (user?.email?.slice(0, 2) || 'U').toUpperCase();

  return (
    <header
      className="
        flex items-center justify-between
        px-4 sm:px-6 h-16 flex-shrink-0
        sticky top-0 z-50
        glass-header
        after:content-[''] after:absolute after:bottom-0
        after:left-0 after:right-0 after:h-px
        after:bg-gradient-to-r after:from-transparent after:via-[var(--brd2)] after:to-transparent
      "
    >
      {/* ── Left: Logo ── */}
      <div className="flex items-center gap-3 flex-shrink-0">
        <div className="flex-shrink-0 sm:hidden logo-badge">
          <AppLogo size={150} />
        </div>
        <div className="flex-shrink-0 hidden sm:block logo-badge">
          <AppLogo size={210} />
        </div>
      </div>

      {/* ── Center: Application name ── */}
      <div className="flex flex-col items-center leading-none select-none">
        <span className="text-sm font-extrabold text-[var(--txt)] tracking-tight">ANI-VOXA</span>
        <span className="text-[10px] text-[var(--txt3)] mt-0.5">Pharma AI Assistant</span>
      </div>

      {/* ── Right: New Chat + Close Chat (when active) + Theme + Profile ── */}
      <div className="flex items-center gap-2">

        {/* New Chat — indigo pill, always visible, creates a fresh conversation */}
        <button
          onClick={createConversation}
          title="New Chat"
          className="
            flex items-center gap-1.5
            px-2.5 sm:px-3 py-1.5 rounded-full
            text-[11px] font-semibold tracking-wide
            border transition-all duration-200 active:scale-95
          "
          style={{
            color: 'var(--gold-acc)',
            borderColor: 'rgba(29,108,184,0.35)',
            background: 'rgba(29,108,184,0.07)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(29,108,184,0.15)';
            e.currentTarget.style.borderColor = 'rgba(29,108,184,0.6)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(29,108,184,0.07)';
            e.currentTarget.style.borderColor = 'rgba(29,108,184,0.35)';
          }}
        >
          {/* Compose icon */}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5H5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-7"/>
            <path d="M17.5 3.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 7.5-7.5z"/>
          </svg>
          <span className="hidden sm:inline">New Chat</span>
        </button>

        {/* Close Chat — muted pill, only when a conversation is active */}
        {hasMessages && (
          <button
            onClick={newChat}
            title="Close Chat"
            className="
              flex items-center gap-1.5
              px-2.5 sm:px-3 py-1.5 rounded-full
              text-[11px] font-semibold tracking-wide
              border transition-all duration-200 active:scale-95
            "
            style={{
              color: '#f87171',
              borderColor: 'rgba(248,113,113,0.35)',
              background: 'rgba(239,68,68,0.14)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(239,68,68,0.24)';
              e.currentTarget.style.borderColor = 'rgba(248,113,113,0.55)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(239,68,68,0.14)';
              e.currentTarget.style.borderColor = 'rgba(248,113,113,0.35)';
            }}
          >
            {/* End/close icon */}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
            <span className="hidden sm:inline">Close</span>
          </button>
        )}

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className="
            w-8 h-8 rounded-lg flex items-center justify-center
            text-[var(--txt2)] hover:text-[var(--txt)]
            hover:bg-[var(--brd2)]
            transition-all duration-200
          "
          style={{ background: 'var(--surf-hover)' }}
          title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
        >
          {theme === 'dark'
            ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
            : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
          }
        </button>

        {/* Profile dropdown */}
        <div className="relative" ref={profileRef}>
          <button
            onClick={() => setProfileOpen((v) => !v)}
            className="
              flex items-center gap-2 px-2 py-1.5 rounded-xl
              hover:bg-[var(--brd2)]
              transition-all duration-200
            "
          >
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, #1A3B8A 0%, #1D6CB8 100%)' }}
            >
              {initials}
            </div>
            <div className="hidden md:flex flex-col items-start leading-none">
              <span className="text-xs font-semibold text-[var(--txt)]">
                {user?.name || user?.username || 'User'}
              </span>
              <span className="text-[10px] text-[var(--txt3)] mt-0.5 capitalize">
                {user?.role || 'Analyst'}
              </span>
            </div>
            <HiOutlineChevronDown
              size={13}
              className={`text-[var(--txt3)] transition-transform duration-200 ${profileOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {/* Dropdown menu */}
          {profileOpen && (
            <div
              className="
                absolute right-0 top-full mt-2 w-52
                bg-[var(--surf)] border border-[var(--brd)]
                rounded-xl overflow-hidden
                shadow-[0_8px_32px_rgba(0,0,0,0.28)]
                animate-fade-in z-50
              "
            >
              <div className="px-4 py-3 border-b border-[var(--brd)]">
                <div className="text-xs font-semibold text-[var(--txt)] truncate">
                  {user?.name || user?.username || 'User'}
                </div>
                <div className="text-[10px] text-[var(--txt3)] mt-0.5 truncate">
                  {user?.email || ''}
                </div>
              </div>
              <div className="p-1.5">
                <button
                  onClick={handleLogout}
                  className="
                    w-full flex items-center gap-2.5
                    px-3 py-2 rounded-lg
                    text-xs text-[var(--txt2)]
                    hover:bg-red-500/10 hover:text-red-400
                    transition-all duration-150 text-left
                  "
                >
                  <HiOutlineLogout size={14} />
                  Sign Out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
