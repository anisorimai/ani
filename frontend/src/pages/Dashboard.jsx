import React, { useEffect, useState, useRef } from 'react';
import useThemeStore from '../store/useThemeStore';
import useChatStore from '../store/useChatStore';
import useUIStore from '../store/useUIStore';
import Header from '../components/Header';
import Sidebar from '../components/Sidebar';
import ChatWindow from '../components/ChatWindow';
import PharmaPlantDashboard from './PharmaPlantDashboard';

export default function Dashboard() {
  const sidebarOpen   = useUIStore((s) => s.sidebarOpen);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);

  const loadTheme     = useThemeStore((s) => s.loadTheme);
  const loadFromCache = useChatStore((s) => s.loadFromCache);

  const [view, setView] = useState('overview'); // 'overview' | 'chat'
  const scrollContainerRef = useRef(null);

  useEffect(() => {
    loadTheme();
    loadFromCache();
  }, [loadTheme, loadFromCache]);

  const closeSidebar = () => setSidebarOpen(false);

  return (
    <div
      className="flex w-full h-[100dvh] overflow-hidden bg-[var(--bg)] transition-colors duration-250"
      id="app-root"
    >
      <Sidebar
        isOpen={sidebarOpen}
        onClose={closeSidebar}
        onNavigateToChat={() => setView('chat')}
      />

      <div
        className={`
          flex flex-col h-[100dvh] min-w-0 relative pt-20
          transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]
          ${sidebarOpen ? 'md:ml-[240px] md:w-[calc(100%-240px)]' : 'ml-0 w-full'}
        `}
        id="main-content"
      >
        <Header
          onToggleSidebar={toggleSidebar}
          onCloseSidebar={closeSidebar}
          view={view}
          onViewChange={setView}
        />

        {view === 'overview'
          ? (
            <div className="flex-1 overflow-y-auto">
              <PharmaPlantDashboard />
            </div>
          )
          : (
            <div className="flex-1 overflow-y-auto flex flex-col min-h-0" ref={scrollContainerRef}>
              <ChatWindow scrollContainerRef={scrollContainerRef} dashboardContext="production" />
            </div>
          )
        }
      </div>
    </div>
  );
}
