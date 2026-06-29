import React from 'react';

const DOMAIN_META = {
  Production: { icon: '🏭', color: '#1D6CB8', label: 'Production' },
  Packaging:  { icon: '📦', color: '#0ea5e9', label: 'Packaging'  },
  Quality:    { icon: '📋', color: '#10b981', label: 'Quality'    },
  Logistics:  { icon: '🚛', color: '#f59e0b', label: 'Logistics'  },
  Enterprise: { icon: '📊', color: '#7C3AED', label: 'Enterprise' },
};

export const DOMAIN_SUGGESTIONS = {
  Production: [
    { icon: '📈', label: 'Check Batch Status?',    text: 'Show current production batch status and any active delays' },
    { icon: '⚙️', label: 'Equipment Issues?',      text: 'Which equipment is under maintenance or has downtime right now?' },
    { icon: '🎯', label: 'Current Yield Rate?',    text: 'What is the production yield rate for this week?' },
    { icon: '🕐', label: 'View Schedule?',         text: 'Show the production schedule for the next 7 days' },
    { icon: '🧪', label: 'Material Stock?',        text: 'What is the current raw material inventory level?' },
    { icon: '⚠️', label: 'Any Bottlenecks?',       text: 'Are there any production delays or bottlenecks today?' },
  ],
  Packaging: [
    { icon: '⚡', label: 'Line Efficiency?',       text: 'How is the packaging line performing right now?' },
    { icon: '🏷️', label: 'Labelling Errors?',      text: 'Are there any labelling errors or compliance issues?' },
    { icon: '📊', label: 'Current Fill Rate?',     text: 'What is the current fill rate across all packaging lines?' },
    { icon: '🔧', label: 'Recent Downtime?',       text: 'Show packaging line downtime incidents this week' },
    { icon: '📦', label: 'Low Materials?',         text: 'What packaging materials are running low in stock?' },
    { icon: '✅', label: 'Met Compliance?',        text: 'Are all packaging operations meeting compliance standards?' },
  ],
  Quality: [
    { icon: '🔬', label: 'Recent Lab Results?',    text: 'Show recent lab test results and any out-of-spec items' },
    { icon: '📋', label: 'Compliance Rate?',       text: 'What is the quality compliance rate for this week?' },
    { icon: '⚠️', label: 'Open Deviations?',       text: 'List all open quality deviations and their current status' },
    { icon: '📌', label: 'Overdue CAPAs?',         text: 'What CAPAs are currently open or overdue?' },
    { icon: '🏛️', label: 'Audit Findings?',        text: 'Show upcoming and recent audit findings' },
    { icon: '📉', label: 'Defect Trends?',         text: 'What is the defect rate trend over the past month?' },
  ],
  Logistics: [
    { icon: '🚛', label: 'Shipment Issues?',       text: 'Summarise logistics delays and shipment issues today' },
    { icon: '📦', label: 'Warehouse Stock?',       text: 'What is the current warehouse inventory status?' },
    { icon: '🌡️', label: 'Cold Chain Alerts?',     text: 'Are there any cold chain temperature excursions to report?' },
    { icon: '🗺️', label: 'Pending Deliveries?',    text: 'Show all pending deliveries and their ETA' },
    { icon: '⚠️', label: 'Active Delays?',         text: 'Which shipments are delayed and by how much?' },
    { icon: '📊', label: 'On-Time Rate?',          text: 'What is the on-time delivery rate this month?' },
  ],
  Enterprise: [
    { icon: '📊', label: 'Executive Overview?',    text: 'Give me an executive overview of all operations today' },
    { icon: '💰', label: 'Cost Performance?',      text: 'What is the overall production efficiency and cost performance?' },
    { icon: '⚠️', label: 'Critical Issues?',       text: 'Are there any critical issues across any domain right now?' },
    { icon: '📈', label: 'Performance Trends?',    text: 'Show key performance trends across production, quality, and logistics' },
    { icon: '🏆', label: 'Overall Compliance?',    text: 'What is the overall compliance status across all departments?' },
    { icon: '🔮', label: 'Monthly Forecast?',      text: 'What are the production and delivery forecasts for next month?' },
  ],
};

export default function WelcomeScreen({ domain = 'Production', onQueryClick }) {
  const meta        = DOMAIN_META[domain]        || DOMAIN_META.Production;
  const suggestions = DOMAIN_SUGGESTIONS[domain] || DOMAIN_SUGGESTIONS.Production;

  return (
    <div className="flex flex-col w-full px-4 sm:px-8 md:px-10 pt-8 pb-8 gap-7">

      {/* Domain badge + greeting */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2 mb-0.5">
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold"
            style={{ background: `${meta.color}18`, color: meta.color, border: `1px solid ${meta.color}35` }}
          >
            <span>{meta.icon}</span>
            {meta.label} Assistant
          </span>
        </div>
        <h2 className="text-xl font-bold text-[var(--txt)] leading-snug">
          What would you like to know?
        </h2>
        <p className="text-sm text-[var(--txt3)]">
          Scoped to <strong>{meta.label}</strong> — pick a prompt below or type your own question.
        </p>
      </div>

      {/* Domain-specific quick prompts (Compact Question Pills) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        {suggestions.map((s) => (
          <button
            key={s.label}
            onClick={() => onQueryClick?.(s.text)}
            className="
              flex items-center gap-3 px-4 py-3 rounded-2xl text-left
              border border-[var(--brd)] bg-[var(--surf)]/80 backdrop-blur-sm
              hover:bg-[var(--surf-hover)] hover:border-[var(--txt3)]
              hover:shadow-sm active:scale-[0.98]
              transition-all duration-200 group
              h-full min-h-[88px] w-full
              outline-none focus:outline-none
            "
          >
            <span className="text-xl leading-none flex-shrink-0 opacity-80 group-hover:opacity-100 transition-opacity">
              {s.icon}
            </span>
            <div className="text-[13px] font-medium text-[var(--txt2)] group-hover:text-[var(--txt)] leading-snug transition-colors line-clamp-3">
              {s.text}
            </div>
          </button>
        ))}
      </div>

    </div>
  );
}
