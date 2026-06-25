import React from 'react';

const DOMAIN_SUGGESTIONS = {
  Production: [
    { text: "Show today's production output by manufacturing area",     icon: '🏭' },
    { text: 'What is the current capacity utilization?',               icon: '📊' },
    { text: 'List all active batches with their current status',       icon: '📋' },
    { text: "Show quality pass rates for today's inspections",         icon: '✅' },
  ],
  Packaging: [
    { text: 'Show packaging line efficiency for today',                icon: '📦' },
    { text: 'What is the material waste percentage this week?',        icon: '♻️' },
    { text: 'List packaging orders due for completion today',          icon: '📅' },
    { text: 'Show packaging material inventory levels',                icon: '🗃️' },
  ],
  Quality: [
    { text: "Show inspection results for today's production batches",  icon: '🔬' },
    { text: 'List all open quality deviations this month',             icon: '⚠️' },
    { text: 'What is the batch rejection rate trend?',                 icon: '📉' },
    { text: 'Show QC test pass/fail rates by product line',            icon: '🧪' },
  ],
  Logistics: [
    { text: 'Show on-time delivery performance for this month',        icon: '🚛' },
    { text: 'List shipments currently delayed or at risk',             icon: '⏰' },
    { text: 'What is the current warehouse occupancy rate?',           icon: '🏪' },
    { text: 'Show logistics cost breakdown by delivery zone',          icon: '💰' },
  ],
};

const DOMAIN_META = {
  Production: { color: '#6366f1', context: 'manufacturing operations' },
  Packaging:  { color: '#0ea5e9', context: 'packaging lines'          },
  Quality:    { color: '#10b981', context: 'quality assurance'        },
  Logistics:  { color: '#f59e0b', context: 'supply chain & logistics' },
};

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function WelcomeHero({ domain, user }) {
  const suggestions = DOMAIN_SUGGESTIONS[domain] || DOMAIN_SUGGESTIONS.Production;
  const meta        = DOMAIN_META[domain]        || DOMAIN_META.Production;
  const firstName   = user?.name?.split(' ')[0]  || 'there';

  const handleSuggestion = (text) => {
    window.dispatchEvent(new CustomEvent('voxa:suggest-query', { detail: { text } }));
    setTimeout(() => {
      document.getElementById('ai-chat-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  };

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 animate-fade-in">
      {/* Greeting */}
      <div className="mb-5">
        <h2 className="text-xl sm:text-2xl font-bold text-[var(--txt)] mb-1.5 tracking-tight">
          {getGreeting()}, {firstName} 👋
        </h2>
        <p className="text-sm text-[var(--txt2)]">
          How can{' '}
          <span className="font-semibold" style={{ color: meta.color }}>ANI-VOXA</span>
          {' '}help with your{' '}
          <span className="font-semibold" style={{ color: meta.color }}>{meta.context}</span>
          {' '}today?
        </p>
      </div>

      {/* Domain suggestion cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {suggestions.map((s, i) => (
          <button
            key={i}
            onClick={() => handleSuggestion(s.text)}
            className="
              group flex flex-col gap-2.5 p-4 text-left
              rounded-xl border border-[var(--brd)]
              bg-[var(--surf)] hover:bg-[var(--surf-hover)]
              hover:border-[var(--brd2)]
              transition-all duration-200 hover:-translate-y-0.5
              shadow-sm hover:shadow-md
              cursor-pointer
            "
          >
            <span className="text-xl leading-none select-none">{s.icon}</span>
            <span
              className="text-xs text-[var(--txt2)] group-hover:text-[var(--txt)] leading-snug transition-colors duration-150"
            >
              {s.text}
            </span>
            <span
              className="text-[10px] font-semibold opacity-0 group-hover:opacity-100 transition-opacity duration-150"
              style={{ color: meta.color }}
            >
              Ask ANI-VOXA →
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
