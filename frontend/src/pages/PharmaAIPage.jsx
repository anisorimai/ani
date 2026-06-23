import React, { useState, useEffect } from 'react';
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

const SIDEBAR_ITEMS = [
  { id: 'Enterprise', icon: '📊', label: 'Enterprise level dashboard', color: '#6366f1' },
  { id: 'Production', icon: '🏭', label: 'Production dashboard',       color: '#6366f1' },
  { id: 'Packaging',  icon: '📦', label: 'Packaging dashboard',        color: '#0ea5e9' },
  { id: 'Quality',    icon: '📋', label: 'Quality dashboard',          color: '#10b981' },
  { id: 'Logistics',  icon: '🚛', label: 'Logistics dashboard',        color: '#f59e0b' },
];

const DOMAIN_DASHBOARDS = {
  Enterprise: EnterpriseDashboard,
  Production: PharmaPlantDashboard,
  Packaging:  PackagingDashboard,
  Quality:    QualityDashboard,
  Logistics:  LogisticsDashboard,
};

export default function PharmaAIPage() {
  const [selectedDomain, setSelectedDomain] = useState('Production');

  const loadTheme     = useThemeStore((s) => s.loadTheme);
  const loadFromCache = useChatStore((s) => s.loadFromCache);

  useEffect(() => {
    loadTheme();
    loadFromCache();
  }, [loadTheme, loadFromCache]);

  const DomainDashboard = DOMAIN_DASHBOARDS[selectedDomain] || PharmaPlantDashboard;

  return (
    <div
      className="flex flex-col bg-[var(--bg)] transition-colors duration-250"
      style={{ height: '100dvh' }}
      id="ai-root"
    >
      {/* Sticky top header */}
      <AIHeader />

      {/* Mobile-only horizontal domain strip */}
      <div className="md:hidden px-4 py-2.5 border-b border-[var(--brd)] flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden flex-shrink-0">
        {SIDEBAR_ITEMS.map((item) => {
          const isActive = selectedDomain === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setSelectedDomain(item.id)}
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
            >
              <span className="text-sm leading-none">{item.icon}</span>
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
            <span className="text-[10px] font-bold tracking-widest text-[var(--txt3)] uppercase">
              Menu
            </span>
          </div>

          <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
            {SIDEBAR_ITEMS.map((item) => {
              const isActive = selectedDomain === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setSelectedDomain(item.id)}
                  className="w-full flex items-center gap-2.5 rounded-lg text-left transition-all duration-150 hover:bg-[var(--brd2)]"
                  style={{
                    padding:    '8px 12px 8px 9px',
                    borderLeft: `3px solid ${isActive ? item.color : 'transparent'}`,
                    background: isActive ? `${item.color}18` : undefined,
                    color:      isActive ? item.color : 'var(--txt2)',
                  }}
                >
                  <span className="text-base leading-none flex-shrink-0">{item.icon}</span>
                  <span className="text-xs font-medium truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Main content: chat fills viewport height, dashboard below */}
        <main className="flex-1 min-w-0 overflow-y-auto flex flex-col">

          {/* Chat section fills the viewport */}
          <div className="flex flex-col flex-shrink-0" style={{ height: 'calc(100dvh - 64px)' }}>
            <ChatWindow />
          </div>

          {/* Domain dashboard workspace — revealed by scrolling */}
          <div className="flex-shrink-0 mb-10 border-t border-[var(--brd)]">
            <div className="text-[11px] font-bold tracking-widest text-[var(--txt3)] uppercase px-5 py-2.5 border-b border-[var(--brd)] bg-[var(--surf)]">
              {selectedDomain} Dashboard
            </div>
            <DomainDashboard />
          </div>

        </main>
      </div>
    </div>
  );
}
