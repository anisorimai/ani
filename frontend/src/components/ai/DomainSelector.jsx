import React from 'react';

const DOMAINS = [
  {
    id:    'Production',
    icon:  '🏭',
    label: 'Production',
    desc:  'Manufacturing & Output',
    color: '#6366f1',
  },
  {
    id:    'Packaging',
    icon:  '📦',
    label: 'Packaging',
    desc:  'Packaging Lines',
    color: '#0ea5e9',
  },
  {
    id:    'Quality',
    icon:  '🔬',
    label: 'Quality',
    desc:  'QC & Compliance',
    color: '#10b981',
  },
  {
    id:    'Logistics',
    icon:  '🚛',
    label: 'Logistics',
    desc:  'Supply & Delivery',
    color: '#f59e0b',
  },
];

export default function DomainSelector({ selectedDomain, onDomainChange }) {
  return (
    <div className="px-4 sm:px-6 lg:px-8 py-3 border-b border-[var(--brd)] flex-shrink-0">
      <div className="flex items-center gap-2 sm:gap-3 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {DOMAINS.map((d) => {
          const active = selectedDomain === d.id;
          return (
            <button
              key={d.id}
              onClick={() => onDomainChange(d.id)}
              className={`
                flex items-center gap-2 px-4 py-2 rounded-full flex-shrink-0
                text-xs sm:text-sm font-semibold
                transition-all duration-200 select-none
                ${active
                  ? 'scale-[1.03] shadow-sm'
                  : 'bg-[var(--surf)] border border-[var(--brd)] text-[var(--txt2)] hover:bg-[var(--surf-hover)] hover:border-[var(--brd2)] hover:-translate-y-px'}
              `}
              style={active ? {
                background: `${d.color}18`,
                color:      d.color,
                border:     `1.5px solid ${d.color}45`,
              } : {}}
            >
              <span className="text-sm leading-none">{d.icon}</span>
              <span>{d.label}</span>
              <span className="hidden lg:inline text-[10px] opacity-65 font-normal">{d.desc}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
