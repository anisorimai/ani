import React from 'react';
import TextInput from './TextInput';
import VoiceButton from './VoiceButton';

const DOMAIN_META = {
  Production: { icon: '🏭', color: '#6366f1', label: 'Production' },
  Packaging:  { icon: '📦', color: '#0ea5e9', label: 'Packaging'  },
  Quality:    { icon: '📋', color: '#10b981', label: 'Quality'    },
  Logistics:  { icon: '🚛', color: '#f59e0b', label: 'Logistics'  },
  Enterprise: { icon: '📊', color: '#8b5cf6', label: 'Enterprise' },
};

const DOMAIN_SUGGESTIONS = {
  Production: [
    { icon: '📈', label: 'Batch Status',    text: 'Show current production batch status and any active delays' },
    { icon: '⚙️', label: 'Equipment',       text: 'Which equipment is under maintenance or has downtime right now?' },
    { icon: '🎯', label: 'Yield Rate',      text: 'What is the production yield rate for this week?' },
    { icon: '🕐', label: 'Schedule',        text: 'Show the production schedule for the next 7 days' },
    { icon: '🧪', label: 'Raw Materials',   text: 'What is the current raw material inventory level?' },
    { icon: '⚠️', label: 'Bottlenecks',    text: 'Are there any production delays or bottlenecks today?' },
  ],
  Packaging: [
    { icon: '⚡', label: 'Line Efficiency', text: 'How is the packaging line performing right now?' },
    { icon: '🏷️', label: 'Labelling',       text: 'Are there any labelling errors or compliance issues?' },
    { icon: '📊', label: 'Fill Rate',        text: 'What is the current fill rate across all packaging lines?' },
    { icon: '🔧', label: 'Downtime',         text: 'Show packaging line downtime incidents this week' },
    { icon: '📦', label: 'Materials Stock',  text: 'What packaging materials are running low in stock?' },
    { icon: '✅', label: 'Compliance',       text: 'Are all packaging operations meeting compliance standards?' },
  ],
  Quality: [
    { icon: '🔬', label: 'Lab Results',     text: 'Show recent lab test results and any out-of-spec items' },
    { icon: '📋', label: 'Compliance Rate', text: 'What is the quality compliance rate for this week?' },
    { icon: '⚠️', label: 'Deviations',     text: 'List all open quality deviations and their current status' },
    { icon: '📌', label: 'CAPA',            text: 'What CAPAs are currently open or overdue?' },
    { icon: '🏛️', label: 'Audits',          text: 'Show upcoming and recent audit findings' },
    { icon: '📉', label: 'Defect Trend',    text: 'What is the defect rate trend over the past month?' },
  ],
  Logistics: [
    { icon: '🚛', label: 'Shipments',       text: 'Summarise logistics delays and shipment issues today' },
    { icon: '📦', label: 'Inventory',       text: 'What is the current warehouse inventory status?' },
    { icon: '🌡️', label: 'Cold Chain',      text: 'Are there any cold chain temperature excursions to report?' },
    { icon: '🗺️', label: 'Deliveries',      text: 'Show all pending deliveries and their ETA' },
    { icon: '⚠️', label: 'Delays',          text: 'Which shipments are delayed and by how much?' },
    { icon: '📊', label: 'On-Time Rate',    text: 'What is the on-time delivery rate this month?' },
  ],
  Enterprise: [
    { icon: '📊', label: 'Overview',        text: 'Give me an executive overview of all operations today' },
    { icon: '💰', label: 'Performance',     text: 'What is the overall production efficiency and cost performance?' },
    { icon: '⚠️', label: 'Critical Issues', text: 'Are there any critical issues across any domain right now?' },
    { icon: '📈', label: 'Trends',          text: 'Show key performance trends across production, quality, and logistics' },
    { icon: '🏆', label: 'Compliance',      text: 'What is the overall compliance status across all departments?' },
    { icon: '🔮', label: 'Forecast',        text: 'What are the production and delivery forecasts for next month?' },
  ],
};

export default function WelcomeScreen({
  domain = 'Production',
  onQueryClick,
  onVoiceClick,
  onTextSend,
  isRecording,
  isBusy,
}) {
  const meta        = DOMAIN_META[domain]        || DOMAIN_META.Production;
  const suggestions = DOMAIN_SUGGESTIONS[domain] || DOMAIN_SUGGESTIONS.Production;

  return (
    <div className="flex flex-col w-full px-4 sm:px-8 md:px-10 pt-6 pb-8 gap-7">

      {/* ── Input bar — top of chat ── */}
      <div className="w-full">
        <p className="text-[10px] font-bold tracking-widest text-[var(--txt3)] uppercase mb-2">
          Ask ANI‑VOXA
        </p>
        <div
          className={`
            chat-input-row flex items-center gap-2 relative
            glass-surface rounded-full
            px-3 sm:px-4 py-2.5
            shadow-[0_4px_16px_rgba(0,0,0,0.18)]
            gradient-border-focus transition-all duration-150
            ${isRecording ? 'recording-pill' : ''}
          `}
        >
          <VoiceButton onRecordComplete={onVoiceClick} disabled={isBusy && !isRecording} />
          <TextInput onSend={onTextSend} disabled={isBusy} />
        </div>
        <p className="hidden md:block text-[11px] text-[var(--txt3)] opacity-50 mt-1.5 ml-1">
          Press Enter to send · Shift+Enter for new line · Space to toggle voice
        </p>
      </div>

      {/* ── Domain badge + greeting ── */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2 mb-0.5">
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold"
            style={{ background: `${meta.color}18`, color: meta.color, border: `1px solid ${meta.color}35` }}
          >
            <span>{meta.icon}</span>
            {meta.label} Assistant
          </span>
        </div>
        <h2 className="text-lg font-bold text-[var(--txt)] leading-snug">
          What would you like to know?
        </h2>
        <p className="text-sm text-[var(--txt3)]">
          This assistant is scoped to <strong>{meta.label}</strong> — pick a prompt or type your own question.
        </p>
      </div>

      {/* ── Domain-specific quick prompts ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
        {suggestions.map((s) => (
          <button
            key={s.label}
            onClick={() => onQueryClick?.(s.text)}
            className="
              flex items-start gap-3 p-3.5 rounded-xl text-left
              border border-[var(--brd)] bg-[var(--surf)]
              hover:bg-[var(--brd2)] hover:border-[var(--txt3)]
              active:scale-[0.98]
              transition-all duration-150 group
            "
          >
            <span className="text-xl leading-none mt-0.5 flex-shrink-0">{s.icon}</span>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-[var(--txt)] mb-0.5">
                {s.label}
              </div>
              <div className="text-[11px] text-[var(--txt3)] leading-relaxed line-clamp-2">
                {s.text}
              </div>
            </div>
          </button>
        ))}
      </div>

    </div>
  );
}
