const LIGHT = {
  bg: '#f0f2f7', surface: '#ffffff', border: '#e8eaf0', borderAlert: '#fcd9b6',
  text: { primary: '#0f1117', secondary: '#374151', muted: '#5e6a80' },
  green:  { solid: '#16a34a', light: '#dcfce7',               text: '#15803d' },
  red:    { solid: '#dc2626', light: '#fee2e2',               text: '#b91c1c' },
  amber:  { solid: '#d97706', light: '#fef3c7',               text: '#b45309' },
  blue:   { solid: '#2563eb', light: '#dbeafe',               text: '#1d4ed8' },
  purple: { solid: '#7c3aed', light: '#ede9fe',               text: '#6d28d9' },
  orange: { solid: '#ea580c', light: '#ffedd5',               text: '#c2410c' },
  pink:   { solid: '#db2777', light: '#fce7f3',               text: '#be185d' },
  prod:   { solid: '#6366f1', light: '#ede9fe', text: '#4f46e5', gradA: '#6366f1', gradB: '#818cf8' },
  pkg:    { solid: '#0ea5e9', light: '#e0f2fe', text: '#0369a1', gradA: '#0ea5e9', gradB: '#38bdf8' },
  qlt:    { solid: '#10b981', light: '#d1fae5', text: '#059669', gradA: '#10b981', gradB: '#34d399' },
  log:    { solid: '#f59e0b', light: '#fef3c7', text: '#b45309', gradA: '#f59e0b', gradB: '#fbbf24' },
};

const DARK = {
  bg: '#0B0B0F', surface: '#1A1A1F', border: 'rgba(255,255,255,0.08)', borderAlert: 'rgba(251,146,60,0.30)',
  text: { primary: '#F8FAFC', secondary: '#E2E8F0', muted: '#CBD5E1' },
  green:  { solid: '#22c55e', light: 'rgba(34,197,94,0.15)',    text: '#4ade80' },
  red:    { solid: '#ef4444', light: 'rgba(239,68,68,0.15)',    text: '#f87171' },
  amber:  { solid: '#f59e0b', light: 'rgba(245,158,11,0.15)',   text: '#fbbf24' },
  blue:   { solid: '#3b82f6', light: 'rgba(59,130,246,0.15)',   text: '#60a5fa' },
  purple: { solid: '#a78bfa', light: 'rgba(167,139,250,0.15)',  text: '#c4b5fd' },
  orange: { solid: '#fb923c', light: 'rgba(251,146,60,0.15)',   text: '#fdba74' },
  pink:   { solid: '#f472b6', light: 'rgba(244,114,182,0.15)',  text: '#f9a8d4' },
  prod:   { solid: '#818cf8', light: 'rgba(129,140,248,0.15)',  text: '#a5b4fc', gradA: '#6366f1', gradB: '#818cf8' },
  pkg:    { solid: '#38bdf8', light: 'rgba(56,189,248,0.15)',   text: '#7dd3fc', gradA: '#0ea5e9', gradB: '#38bdf8' },
  qlt:    { solid: '#34d399', light: 'rgba(52,211,153,0.15)',   text: '#6ee7b7', gradA: '#10b981', gradB: '#34d399' },
  log:    { solid: '#fbbf24', light: 'rgba(251,191,36,0.15)',   text: '#fde68a', gradA: '#f59e0b', gradB: '#fbbf24' },
};

export function getThemeTokens(isDark) {
  return isDark ? DARK : LIGHT;
}
