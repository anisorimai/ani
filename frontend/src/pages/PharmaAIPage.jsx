import React, { useState, useEffect, useRef } from 'react';
import useThemeStore        from '../store/useThemeStore';
import useChatStore         from '../store/useChatStore';
import useAuthStore         from '../store/useAuthStore';
import AIHeader              from '../components/ai/AIHeader';
import ChatWindow            from '../components/ChatWindow';
import PharmaPlantDashboard  from './PharmaPlantDashboard';
import PackagingDashboard    from '../components/ai/PackagingDashboard';
import QualityDashboard      from '../components/ai/QualityDashboard';
import LogisticsDashboard    from '../components/ai/LogisticsDashboard';
import EnterpriseDashboard   from '../components/ai/EnterpriseDashboard';
import DocumentUpload        from '../components/DocumentUpload';
import { LayoutDashboard, Factory, Package, ShieldCheck, Truck } from 'lucide-react';

const SIDEBAR_ITEMS = [
  { id: 'Enterprise', Icon: LayoutDashboard, label: 'Enterprise Overview',     color: '#7C3AED' },
  { id: 'Production', Icon: Factory,         label: 'Production Overview',     color: '#1D6CB8' },
  { id: 'Quality',    Icon: ShieldCheck,     label: 'Quality Control Overview',color: '#10b981' },
  { id: 'Packaging',  Icon: Package,         label: 'Packaging Overview',      color: '#0ea5e9' },
  { id: 'Logistics',  Icon: Truck,           label: 'Logistics Overview',      color: '#f59e0b' },
];

const DOMAIN_DASHBOARDS = {
  Enterprise: EnterpriseDashboard,
  Production: PharmaPlantDashboard,
  Packaging:  PackagingDashboard,
  Quality:    QualityDashboard,
  Logistics:  LogisticsDashboard,
};

// Maps sidebar domain → backend dashboard_context (empty = unrestricted).
// Enterprise intentionally omitted — no context means full collection access.
// Future dashboards (Packaging, Logistics, etc.) should be added here once
// their MongoDB collections and dashboard pages are implemented.
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
  const loadFromCache         = useChatStore((s) => s.loadFromCache);
  const createConversation    = useChatStore((s) => s.createConversation);
  const setActiveConversation = useChatStore((s) => s.setActiveConversation);

  const handleDomainChange = React.useCallback((newDomain) => {
    if (newDomain === selectedDomain) return;

    // Persist the current domain's active conversation so we can restore it later
    const currentActiveId = useChatStore.getState().activeConversationId;
    if (currentActiveId) {
      localStorage.setItem('voxa-active-id-' + selectedDomain, currentActiveId);
    }

    // Restore or create the target domain's conversation
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
      // Use sessionStorage as the source of truth — it is cleared when the user
      // explicitly closes a chat or when the tab/browser is closed, so stale
      // localStorage entries can never resurrect a closed conversation.
      const sessionId = sessionStorage.getItem('voxa-session-active-id');
      const { conversations } = useChatStore.getState();
      if (sessionId && conversations[sessionId]) {
        useChatStore.getState().setActiveConversation(sessionId);
      } else {
        useChatStore.setState({ activeConversationId: null });
        sessionStorage.removeItem('voxa-session-active-id');
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const DomainDashboard = DOMAIN_DASHBOARDS[selectedDomain] || PharmaPlantDashboard;

  return (
    <div
      className="flex flex-col bg-[var(--bg)] transition-colors duration-250"
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
        .nav-btn:hover .nav-icon-wrap {
          transform: scale(1.12);
        }
        .nav-btn.active .nav-icon-wrap {
          animation: icon-pulse 2.4s ease-in-out infinite;
        }
        @keyframes icon-pulse {
          0%, 100% { box-shadow: 0 0 0 0 var(--icon-glow); }
          50%       { box-shadow: 0 0 8px 3px var(--icon-glow); }
        }
      `}</style>

      {/* Sticky top header */}
      <AIHeader />

      {/* Mobile-only horizontal domain strip */}
      <div className="md:hidden px-4 py-2.5 border-b border-[var(--brd)] flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden flex-shrink-0">
        {/* Knowledge Repository — mobile */}
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
                e.currentTarget.style.transform = 'scale(1.05)';
              }}
              onMouseLeave={e => {
                if (isActive) return;
                e.currentTarget.style.background = 'var(--surf)';
                e.currentTarget.style.color = 'var(--txt2)';
                e.currentTarget.style.borderColor = 'var(--brd)';
                e.currentTarget.style.transform = '';
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
          <div className="px-4 py-3 border-b border-[var(--brd)] flex-shrink-0">
            <span className="text-[10px] font-bold tracking-widest text-[var(--txt2)] uppercase">
              Dashboards
            </span>
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
                    style={{
                      background: isActive ? `${item.color}20` : 'transparent',
                    }}
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
              className="w-full flex items-center gap-2.5 rounded-lg text-left px-3 py-2.5 transition-all duration-150 group"
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
        </aside>

        {/* Main content — single scrollbar, everything flows in one column */}
        <main
          className="flex-1 min-w-0 overflow-y-auto flex flex-col"
          ref={scrollContainerRef}
        >
          {/* Chat section — no inner scroll; messages flow with the page */}
          <ChatWindow
            scrollContainerRef={scrollContainerRef}
            domain={selectedDomain}
            dashboardContext={DOMAIN_CONTEXT[selectedDomain] || ''}
          />

          {/* Dashboard below the chat */}
          <div className="border-t border-[var(--brd)]">
            <div className="text-[11px] font-bold tracking-widest text-[var(--txt3)] uppercase px-5 py-2.5 border-b border-[var(--brd)] bg-[var(--surf)]">
              {selectedDomain} Dashboard
            </div>
            <DomainDashboard />
          </div>
        </main>
      </div>

      <DocumentUpload isOpen={docsOpen} onClose={() => setDocsOpen(false)} />
    </div>
  );
}
