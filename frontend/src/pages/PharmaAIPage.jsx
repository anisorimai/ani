import React, { useState, useEffect, useRef } from 'react';
import { HiOutlineLogout } from 'react-icons/hi';
import { toast } from 'react-hot-toast';
import useThemeStore        from '../store/useThemeStore';
import useChatStore         from '../store/useChatStore';
import useAuthStore         from '../store/useAuthStore';
import AppLogo               from '../components/AppLogo';
import ChatWindow            from '../components/ChatWindow';
import PharmaPlantDashboard  from './PharmaPlantDashboard';
import PackagingDashboard    from '../components/ai/PackagingDashboard';
import QualityDashboard      from '../components/ai/QualityDashboard';
import LogisticsDashboard    from '../components/ai/LogisticsDashboard';
import EnterpriseDashboard   from '../components/ai/EnterpriseDashboard';
import DocumentUpload        from '../components/DocumentUpload';
import UserAvatar            from '../components/UserAvatar';
import { LayoutDashboard, Factory, Package, ShieldCheck, Truck } from 'lucide-react';

const SIDEBAR_ITEMS = [
  { id: 'Enterprise', Icon: LayoutDashboard, label: 'Enterprise Overview',      color: '#7C3AED' },
  { id: 'Production', Icon: Factory,         label: 'Production Overview',      color: '#1D6CB8' },
  { id: 'Quality',    Icon: ShieldCheck,     label: 'Quality Control Overview', color: '#10b981' },
  { id: 'Packaging',  Icon: Package,         label: 'Packaging Overview',       color: '#0ea5e9' },
  { id: 'Logistics',  Icon: Truck,           label: 'Logistics Overview',       color: '#f59e0b' },
];

const DOMAIN_DASHBOARDS = {
  Enterprise: EnterpriseDashboard,
  Production: PharmaPlantDashboard,
  Packaging:  PackagingDashboard,
  Quality:    QualityDashboard,
  Logistics:  LogisticsDashboard,
};

const DOMAIN_CONTEXT = {
  Production: 'production',
  Quality:    'quality',
};

export default function PharmaAIPage() {
  const [selectedDomain, setSelectedDomain] = useState(
    () => localStorage.getItem('voxa-selected-domain') || 'Enterprise'
  );
  const [docsOpen, setDocsOpen] = useState(false);

  const loadTheme             = useThemeStore((s) => s.loadTheme);
  const theme                 = useThemeStore((s) => s.theme);
  const toggleTheme           = useThemeStore((s) => s.toggleTheme);
  const loadFromCache         = useChatStore((s) => s.loadFromCache);
  const createConversation    = useChatStore((s) => s.createConversation);
  const setActiveConversation = useChatStore((s) => s.setActiveConversation);

  const user   = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const handleLogout = () => {
    logout();
    toast.success('Signed out');
  };

  const initials = user?.name
    ? user.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
    : (user?.email?.slice(0, 2) || 'U').toUpperCase();

  const handleDomainChange = React.useCallback((newDomain) => {
    if (newDomain === selectedDomain) return;

    const currentActiveId = useChatStore.getState().activeConversationId;
    if (currentActiveId) {
      localStorage.setItem('voxa-active-id-' + selectedDomain, currentActiveId);
    }

    const savedId = localStorage.getItem('voxa-active-id-' + newDomain);
    const { conversations } = useChatStore.getState();
    if (savedId && conversations[savedId]) {
      setActiveConversation(savedId);
    } else {
      const newId = createConversation(newDomain);
      localStorage.setItem('voxa-active-id-' + newDomain, newId);
    }

    localStorage.setItem('voxa-selected-domain', newDomain);
    setSelectedDomain(newDomain);
  }, [selectedDomain, setActiveConversation, createConversation]);

  const scrollContainerRef = useRef(null);

  useEffect(() => {
    loadTheme();
    loadFromCache().then(() => {
      const currentDomain = localStorage.getItem('voxa-selected-domain') || 'Enterprise';
      const sessionId = sessionStorage.getItem('voxa-session-active-id');
      const { conversations } = useChatStore.getState();
      
      let targetId = sessionId;
      // If the session ID doesn't belong to the current domain, fall back to the domain's saved ID
      if (targetId && conversations[targetId] && conversations[targetId].domain !== currentDomain) {
        targetId = localStorage.getItem('voxa-active-id-' + currentDomain);
      }

      if (targetId && conversations[targetId]) {
        useChatStore.getState().setActiveConversation(targetId);
      } else {
        const newId = useChatStore.getState().createConversation(currentDomain);
        localStorage.setItem('voxa-active-id-' + currentDomain, newId);
        useChatStore.getState().setActiveConversation(newId);
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const DomainDashboard = DOMAIN_DASHBOARDS[selectedDomain] || PharmaPlantDashboard;

  /* Sun icon for dark mode, moon for light mode */
  const ThemeIcon = theme === 'dark'
    ? (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="5"/>
        <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
        <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
      </svg>
    )
    : (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
      </svg>
    );

  return (
    <div
      className="flex flex-col bg-[var(--bg)] w-full transition-colors duration-250"
      style={{ height: '100dvh' }}
      id="ai-root"
    >
      <style>{`
        .nav-icon-wrap {
          width: 28px; height: 28px; border-radius: 8px;
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0;
          transition: background 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease;
        }
        .nav-btn:hover .nav-icon-wrap { transform: scale(1.12); }
        .nav-btn.active .nav-icon-wrap { animation: icon-pulse 2.4s ease-in-out infinite; }
        @keyframes icon-pulse {
          0%, 100% { box-shadow: 0 0 0 0 var(--icon-glow); }
          50%       { box-shadow: 0 0 8px 3px var(--icon-glow); }
        }
      `}</style>

      {/* Mobile-only horizontal domain strip */}
      <div className="md:hidden px-4 py-2.5 border-b border-[var(--brd)] flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden flex-shrink-0">
        <button
          onClick={() => setDocsOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full flex-shrink-0 text-xs font-semibold transition-all duration-200 select-none border border-[var(--brd)] text-[var(--txt2)] hover:text-[var(--txt)] hover:border-[var(--brd2)] bg-[var(--surf)]"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
          </svg>
          <span>Knowledge Repo</span>
        </button>

        {SIDEBAR_ITEMS.map((item) => {
          const isActive = selectedDomain === item.id;
          return (
            <button
              key={item.id}
              onClick={() => handleDomainChange(item.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full flex-shrink-0 text-xs font-semibold transition-all duration-200 select-none"
              style={isActive ? {
                background: `${item.color}18`,
                color:       item.color,
                border:      `1.5px solid ${item.color}45`,
              } : {
                background: 'var(--surf)',
                color:      'var(--txt2)',
                border:     '1px solid var(--brd)',
              }}
              onMouseEnter={e => {
                if (isActive) return;
                e.currentTarget.style.background = `${item.color}15`;
                e.currentTarget.style.color = item.color;
                e.currentTarget.style.borderColor = `${item.color}50`;
              }}
              onMouseLeave={e => {
                if (isActive) return;
                e.currentTarget.style.background = 'var(--surf)';
                e.currentTarget.style.color = 'var(--txt2)';
                e.currentTarget.style.borderColor = 'var(--brd)';
              }}
            >
              <item.Icon size={14} style={{ flexShrink: 0 }} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* Body: desktop sidebar + main content */}
      <div className="flex flex-1 overflow-hidden">

        {/* Desktop left sidebar */}
        <aside className="hidden md:flex flex-col flex-shrink-0 w-56 border-r border-[var(--brd)] bg-[var(--surf)]">
          <div className="px-4 border-b border-[var(--brd)] flex-shrink-0 flex items-center justify-center" style={{ height: 52 }}>
            <div className="logo-badge">
              <AppLogo size={110} />
            </div>
          </div>

          <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
            {SIDEBAR_ITEMS.map((item) => {
              const isActive = selectedDomain === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => handleDomainChange(item.id)}
                  className={`nav-btn${isActive ? ' active' : ''} w-full flex items-center gap-2.5 rounded-lg text-left transition-all duration-200`}
                  style={{
                    padding:    '7px 10px 7px 8px',
                    borderLeft: `3px solid ${isActive ? item.color : 'transparent'}`,
                    background: isActive ? `${item.color}15` : 'transparent',
                    color:      isActive ? item.color : 'var(--txt2)',
                    '--icon-glow': `${item.color}55`,
                  }}
                  onMouseEnter={e => {
                    if (isActive) return;
                    e.currentTarget.style.background = `${item.color}12`;
                    e.currentTarget.style.borderLeftColor = `${item.color}60`;
                    e.currentTarget.style.color = item.color;
                    e.currentTarget.style.transform = 'translateX(2px)';
                    e.currentTarget.querySelector('.nav-icon-wrap').style.background = `${item.color}20`;
                  }}
                  onMouseLeave={e => {
                    if (isActive) return;
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.borderLeftColor = 'transparent';
                    e.currentTarget.style.color = 'var(--txt2)';
                    e.currentTarget.style.transform = '';
                    e.currentTarget.querySelector('.nav-icon-wrap').style.background = 'transparent';
                  }}
                >
                  <div
                    className="nav-icon-wrap"
                    style={{ background: isActive ? `${item.color}20` : 'transparent' }}
                  >
                    <item.Icon size={14} />
                  </div>
                  <span className="text-xs font-medium truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Knowledge Repository */}
          <div className="flex-shrink-0 p-2 border-t border-[var(--brd)]">
            <button
              onClick={() => setDocsOpen(true)}
              className="w-full flex items-center gap-2.5 rounded-lg text-left px-3 py-2.5 transition-all duration-150"
              style={{ background: 'var(--bg)', border: '1px solid var(--brd)' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--brd2)'; e.currentTarget.style.background = 'var(--brd2)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--brd)';  e.currentTarget.style.background = 'var(--bg)'; }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--txt2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
              </svg>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-[var(--txt)] truncate">Knowledge Repository</div>
                <div className="text-[10px] text-[var(--txt2)] truncate">Upload &amp; manage docs</div>
              </div>
            </button>
          </div>

          {/* User profile + theme toggle */}
          <div className="flex-shrink-0 px-3 py-3 border-t border-[var(--brd)]">
            <div className="flex items-center gap-2">
              {/* Avatar */}
              <UserAvatar
                className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white overflow-hidden shadow-[0_4px_10px_rgba(79,70,229,0.3)] ring-2 ring-[var(--surf)]"
                style={{ background: 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)', color: '#fff' }}
              />

              {/* Name / role */}
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-[var(--txt)] truncate">
                  {user?.name || user?.username || 'User'}
                </div>
                <div className="text-[10px] text-[var(--txt3)] truncate capitalize">
                  {user?.role || 'Analyst'}
                </div>
              </div>

              {/* Theme toggle */}
              <button
                onClick={toggleTheme}
                title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
                className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-[var(--txt3)] hover:text-[var(--txt)] hover:bg-[var(--brd2)] transition-all duration-150"
              >
                {ThemeIcon}
              </button>

              {/* Sign out */}
              <button
                onClick={handleLogout}
                title="Sign out"
                className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-[var(--txt3)] hover:text-red-400 hover:bg-red-500/10 transition-all duration-150"
              >
                <HiOutlineLogout size={14} />
              </button>
            </div>
          </div>
        </aside>

        {/* Main content */}
        <main
          className="flex-1 min-w-0 overflow-y-auto flex flex-col [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[var(--brd2)]"
          ref={scrollContainerRef}
        >
          {/* Chat */}
          <ChatWindow
            scrollContainerRef={scrollContainerRef}
            domain={selectedDomain}
            dashboardContext={DOMAIN_CONTEXT[selectedDomain] || ''}
          />

          {/* Dashboard — fills the full main area */}
          <div style={{ flex: '1 1 0%', minHeight: 0, paddingBottom: 120 }}>
            <DomainDashboard />
          </div>
        </main>
      </div>

      <DocumentUpload isOpen={docsOpen} onClose={() => setDocsOpen(false)} />
    </div>
  );
}
