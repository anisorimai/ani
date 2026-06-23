import React, { useState, useEffect } from 'react';
import useThemeStore    from '../store/useThemeStore';
import useChatStore     from '../store/useChatStore';
import useAuthStore     from '../store/useAuthStore';
import CopilotHeader    from '../components/copilot/CopilotHeader';
import DomainSelector   from '../components/copilot/DomainSelector';
import WelcomeHero      from '../components/copilot/WelcomeHero';
import ChatWindow       from '../components/ChatWindow';
import PharmaPlantDashboard from './PharmaPlantDashboard';
import PackagingDashboard   from '../components/copilot/PackagingDashboard';
import QualityDashboard     from '../components/copilot/QualityDashboard';
import LogisticsDashboard   from '../components/copilot/LogisticsDashboard';

const DOMAIN_DASHBOARDS = {
  Production: PharmaPlantDashboard,
  Packaging:  PackagingDashboard,
  Quality:    QualityDashboard,
  Logistics:  LogisticsDashboard,
};

export default function PharmaCopilotPage() {
  const [selectedDomain, setSelectedDomain] = useState('Production');

  const user          = useAuthStore((s) => s.user);
  const loadTheme     = useThemeStore((s) => s.loadTheme);
  const loadFromCache = useChatStore((s) => s.loadFromCache);

  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const conversations        = useChatStore((s) => s.conversations);

  const hasMessages = Boolean(
    activeConversationId &&
    conversations[activeConversationId]?.messages?.length
  );

  useEffect(() => {
    loadTheme();
    loadFromCache();
  }, [loadTheme, loadFromCache]);

  const DomainDashboard = DOMAIN_DASHBOARDS[selectedDomain] || PharmaPlantDashboard;

  return (
    <div
      className="flex flex-col bg-[var(--bg)] transition-colors duration-250"
      style={{ minHeight: '100dvh' }}
      id="copilot-root"
    >
      {/* ── Sticky top header ── */}
      <CopilotHeader selectedDomain={selectedDomain} />

      {/* ── Domain selector strip ── */}
      <DomainSelector
        selectedDomain={selectedDomain}
        onDomainChange={setSelectedDomain}
      />

      {/* ── Scrollable main body ── */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-[1600px] mx-auto">

          {/* Welcome hero — greeting + domain-specific quick-action cards */}
          <WelcomeHero domain={selectedDomain} user={user} />

          {/* ── Chat assistant area ── */}
          <div
            id="copilot-chat-section"
            className="
              mx-4 sm:mx-6 lg:mx-8
              rounded-2xl overflow-hidden
              border border-[var(--brd)]
              bg-[var(--surf)]
              shadow-[0_2px_12px_rgba(0,0,0,0.08)]
              transition-all duration-500
              flex flex-col
            "
            style={{
              /*
               * Height adjusts based on whether a conversation is active:
               * taller when messages are flowing so the full chat is usable,
               * shorter on the welcome state so the domain dashboard stays
               * visible without scrolling too far.
               */
              height: hasMessages ? 'clamp(480px, 62vh, 700px)' : 'clamp(380px, 50vh, 560px)',
            }}
          >
            <ChatWindow />
          </div>

          {/* ── Domain-specific dashboard workspace ── */}
          <div className="mt-6 mb-10 rounded-2xl overflow-hidden mx-4 sm:mx-6 lg:mx-8 border border-[var(--brd)] shadow-[0_2px_12px_rgba(0,0,0,0.06)]">
            <div className="text-[11px] font-bold tracking-widest text-[var(--txt3)] uppercase px-5 py-2.5 border-b border-[var(--brd)] bg-[var(--surf)]">
              {selectedDomain} Dashboard Workspace
            </div>
            <DomainDashboard />
          </div>

        </div>
      </main>
    </div>
  );
}
