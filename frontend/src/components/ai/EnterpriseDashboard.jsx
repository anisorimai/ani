import React, { useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  LineChart, Line, Legend,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
} from 'recharts';

// ─── DESIGN TOKENS ───────────────────────────────────────────────────────────
const T = {
  bg: '#f0f2f7', surface: '#ffffff', border: '#e8eaf0', borderAlert: '#fcd9b6',
  text: { primary: '#0f1117', secondary: '#5a6072', muted: '#9da3b4' },
  green:  { solid: '#16a34a', light: '#dcfce7', text: '#15803d' },
  red:    { solid: '#dc2626', light: '#fee2e2', text: '#b91c1c' },
  amber:  { solid: '#d97706', light: '#fef3c7', text: '#b45309' },
  blue:   { solid: '#2563eb', light: '#dbeafe', text: '#1d4ed8' },
  prod:   { solid: '#6366f1', light: '#ede9fe', text: '#4f46e5', gradA: '#6366f1', gradB: '#818cf8' },
  pkg:    { solid: '#0ea5e9', light: '#e0f2fe', text: '#0369a1', gradA: '#0ea5e9', gradB: '#38bdf8' },
  qlt:    { solid: '#10b981', light: '#d1fae5', text: '#059669', gradA: '#10b981', gradB: '#34d399' },
  log:    { solid: '#f59e0b', light: '#fef3c7', text: '#b45309', gradA: '#f59e0b', gradB: '#fbbf24' },
};

// ─── DATA ────────────────────────────────────────────────────────────────────
const KPI_CARDS = [
  { id: 'prod-out', domain: 'Production', label: "Today's Output",       value: '1.25M', unit: 'units', delta: '+8.4% vs target',     pos: true,  spark: [8,12,9,15,11,14,18,16,20],   ...T.prod, iconBg: T.prod.light, iconColor: T.prod.solid, iconType: 'factory'  },
  { id: 'prod-cap', domain: 'Production', label: 'Capacity Utilization', value: '68%',   unit: null,   delta: '+5.6% vs yesterday',   pos: true,  spark: [55,60,58,62,59,65,63,67,68], ...T.prod, iconBg: T.prod.light, iconColor: T.prod.solid, iconType: 'gauge'    },
  { id: 'pkg-eff',  domain: 'Packaging',  label: 'Line Efficiency',      value: '94.2%', unit: null,   delta: '+2.1% vs yesterday',   pos: true,  spark: [88,90,89,92,91,93,92,94,94], ...T.pkg,  iconBg: T.pkg.light,  iconColor: T.pkg.solid,  iconType: 'box'      },
  { id: 'pkg-pkg',  domain: 'Packaging',  label: 'Packages Today',       value: '45.2K', unit: null,   delta: '+6.8% vs target',      pos: true,  spark: [38,40,39,42,41,43,44,45,45], ...T.pkg,  iconBg: T.pkg.light,  iconColor: T.pkg.solid,  iconType: 'package'  },
  { id: 'qlt-pas',  domain: 'Quality',    label: 'Quality Pass Rate',    value: '98.6%', unit: null,   delta: '+1.3% vs yesterday',   pos: true,  spark: [96,97,96,98,97,99,98,98,99], ...T.qlt,  iconBg: T.qlt.light,  iconColor: T.qlt.solid,  iconType: 'shield'   },
  { id: 'qlt-ncr',  domain: 'Quality',    label: 'Open NCRs',            value: '7',     unit: null,   delta: '-2 vs last week',      pos: true,  spark: [12,10,9,8,9,7,8,7,7],       ...T.qlt,  iconBg: T.qlt.light,  iconColor: T.qlt.solid,  iconType: 'alertTri', isAlert: true },
  { id: 'log-otd',  domain: 'Logistics',  label: 'On-Time Delivery',     value: '92%',   unit: null,   delta: '+3.4% vs last month',  pos: true,  spark: [85,87,88,89,90,91,90,92,92], ...T.log,  iconBg: T.log.light,  iconColor: T.log.solid,  iconType: 'truck'    },
  { id: 'log-int',  domain: 'Logistics',  label: 'In Transit',           value: '15',    unit: null,   delta: '2 delayed',            pos: false, spark: [10,12,11,13,14,13,15,15,15], ...T.log,  iconBg: T.log.light,  iconColor: T.log.solid,  iconType: 'truck',    isAlert: true },
];

const DOMAIN_LEGEND = [
  { label: 'Production', color: T.prod.solid },
  { label: 'Packaging',  color: T.pkg.solid  },
  { label: 'Quality',    color: T.qlt.solid  },
  { label: 'Logistics',  color: T.log.solid  },
];

const WEEKLY_TREND = [
  { day: 'Mon', Production: 88, Packaging: 91, Quality: 97, Logistics: 89 },
  { day: 'Tue', Production: 90, Packaging: 92, Quality: 98, Logistics: 91 },
  { day: 'Wed', Production: 87, Packaging: 90, Quality: 98, Logistics: 88 },
  { day: 'Thu', Production: 91, Packaging: 93, Quality: 98, Logistics: 90 },
  { day: 'Fri', Production: 92, Packaging: 94, Quality: 99, Logistics: 92 },
  { day: 'Sat', Production: 89, Packaging: 92, Quality: 99, Logistics: 90 },
  { day: 'Sun', Production: 92, Packaging: 94, Quality: 99, Logistics: 88 },
];

const PERF_VS_TARGET = [
  { domain: 'Production', actual: 92, target: 85 },
  { domain: 'Packaging',  actual: 94, target: 90 },
  { domain: 'Quality',    actual: 99, target: 95 },
  { domain: 'Logistics',  actual: 88, target: 90 },
];
const PERF_COLORS = [T.prod.solid, T.pkg.solid, T.qlt.solid, T.log.solid];

const DOMAIN_STATUS = [
  { icon: '🏭', label: 'Production', color: T.prod.solid, light: T.prod.light, health: 'On Track',  hc: T.green.solid, hb: T.green.light, detail: '8 active batches · 3/3 shifts running'         },
  { icon: '📦', label: 'Packaging',  color: T.pkg.solid,  light: T.pkg.light,  health: 'On Track',  hc: T.green.solid, hb: T.green.light, detail: '2/4 lines running · Line C under maintenance'   },
  { icon: '📋', label: 'Quality',    color: T.qlt.solid,  light: T.qlt.light,  health: 'Attention', hc: T.amber.solid, hb: T.amber.light, detail: '1 critical CAPA pending · 3 open deviations'    },
  { icon: '🚛', label: 'Logistics',  color: T.log.solid,  light: T.log.light,  health: 'Attention', hc: T.amber.solid, hb: T.amber.light, detail: '2 shipments delayed · 23 pending dispatch'      },
];

const ALERTS = [
  { icon: '🏭', domain: 'Production', msg: '4 open production issues require attention',       priority: 'High',   pc: T.red.solid,   pb: T.red.light   },
  { icon: '📋', domain: 'Quality',    msg: '1 critical CAPA is overdue for review',            priority: 'High',   pc: T.red.solid,   pb: T.red.light   },
  { icon: '🚛', domain: 'Logistics',  msg: 'SHP-004 & SHP-005 delayed — Bangalore & Chennai', priority: 'Medium', pc: T.amber.solid, pb: T.amber.light },
  { icon: '📋', domain: 'Quality',    msg: 'Internal GMP Audit scheduled Jun 25, 2024',        priority: 'Low',    pc: T.blue.solid,  pb: T.blue.light  },
  { icon: '📦', domain: 'Packaging',  msg: 'Line C maintenance expected complete by 4 PM',    priority: 'Low',    pc: T.blue.solid,  pb: T.blue.light  },
];

const SCORECARD = [
  { metric: 'Efficiency',  Production: 92, Packaging: 94, Quality: 96, Logistics: 88 },
  { metric: 'Quality',     Production: 97, Packaging: 91, Quality: 99, Logistics: 85 },
  { metric: 'Delivery',    Production: 88, Packaging: 90, Quality: 92, Logistics: 92 },
  { metric: 'Capacity',    Production: 68, Packaging: 75, Quality: 82, Logistics: 78 },
  { metric: 'Compliance',  Production: 96, Packaging: 93, Quality: 99, Logistics: 90 },
  { metric: 'Cost Index',  Production: 85, Packaging: 88, Quality: 91, Logistics: 82 },
];

const UPCOMING = [
  { label: 'Equipment Calibration', note: '3 due today',    iconBg: T.blue.light,        iconColor: T.blue.solid,   urgency: 'high', domain: 'Production' },
  { label: 'Preventive Maintenance',note: '5 due this week',iconBg: T.green.light,        iconColor: T.green.solid,  urgency: 'med',  domain: 'Production' },
  { label: 'CAPA Review Meeting',   note: 'Today 3:00 PM', iconBg: T.red.light,          iconColor: T.red.solid,    urgency: 'high', domain: 'Quality'    },
  { label: 'Carrier Performance',   note: 'Jun 25',         iconBg: T.log.light,          iconColor: T.log.solid,    urgency: 'low',  domain: 'Logistics'  },
];

// ─── ICON SYSTEM ─────────────────────────────────────────────────────────────
function Icon({ type, size = 14, color = 'currentColor' }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth: '2', strokeLinecap: 'round', strokeLinejoin: 'round' };
  switch (type) {
    case 'factory':  return <svg {...p}><path d="M2 20V8l5-3v4l5-3v4l5-3v16H2z"/><rect x="5" y="14" width="3" height="6"/><rect x="10" y="14" width="3" height="6"/></svg>;
    case 'box':      return <svg {...p}><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>;
    case 'shield':   return <svg {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>;
    case 'truck':    return <svg {...p}><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>;
    case 'package':  return <svg {...p}><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>;
    case 'gauge':    return <svg {...p}><path d="M12 2a10 10 0 1 0 10 10"/><path d="M12 12l3-4"/><circle cx="12" cy="12" r="1" fill={color}/></svg>;
    case 'alertTri': return <svg width={size} height={size} viewBox="0 0 24 24" fill={color}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13" stroke="white" strokeWidth="2" strokeLinecap="round"/><circle cx="12" cy="17" r="1" fill="white"/></svg>;
    default:         return null;
  }
}

// ─── SPARKLINE ────────────────────────────────────────────────────────────────
function Sparkline({ data, color }) {
  const w = 72, h = 30;
  const min = Math.min(...data), max = Math.max(...data), range = max - min || 1;
  const pts = data.map((p, i) => ({ x: (i / (data.length - 1)) * w, y: h - 4 - ((p - min) / range) * (h - 8) }));
  const area = `M${pts[0].x},${h} ` + pts.map(p => `L${p.x},${p.y}`).join(' ') + ` L${pts[pts.length-1].x},${h} Z`;
  return (
    <svg width={w} height={h} style={{ overflow: 'visible', flexShrink: 0 }}>
      <path d={area} fill={color} opacity="0.12" />
      <polyline points={pts.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[pts.length-1].x} cy={pts[pts.length-1].y} r="3" fill={color} />
    </svg>
  );
}

// ─── CARD ────────────────────────────────────────────────────────────────────
function Card({ children, style = {}, alert }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: T.surface, borderRadius: 12,
        border: `1px solid ${alert ? T.borderAlert : hov ? '#c8ccd8' : T.border}`,
        boxShadow: hov ? '0 8px 28px rgba(0,0,0,0.10),0 2px 6px rgba(0,0,0,0.06)' : '0 1px 3px rgba(0,0,0,0.04)',
        transform: hov ? 'translateY(-2px)' : 'none',
        transition: 'all 0.2s ease',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function SectionTitle({ children, action }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: T.text.primary, letterSpacing: '0.01em' }}>{children}</span>
      {action && <span style={{ fontSize: 11, color: T.blue.text, fontWeight: 600, cursor: 'pointer' }}>{action}</span>}
    </div>
  );
}

function ChartTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#fff', border: `1px solid ${T.border}`, borderRadius: 8, padding: '8px 12px', fontSize: 12, boxShadow: '0 4px 16px rgba(0,0,0,0.12)' }}>
      <div style={{ fontWeight: 700, color: T.text.primary, marginBottom: 5 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, color: T.text.secondary, marginBottom: 2 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color || p.fill, display: 'inline-block' }} />
          {p.name}: <b style={{ color: T.text.primary, marginLeft: 2 }}>{p.value}%</b>
        </div>
      ))}
    </div>
  );
}

// ─── CSS ─────────────────────────────────────────────────────────────────────
const CSS = `
  .ent-content { padding: 14px 16px; display: flex; flex-direction: column; gap: 14px; }
  @media (min-width: 768px) { .ent-content { padding: 16px 24px; gap: 16px; } }

  .ent-kpi { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
  @media (min-width: 640px)  { .ent-kpi { grid-template-columns: repeat(4, 1fr); } }
  @media (min-width: 1200px) { .ent-kpi { grid-template-columns: repeat(8, 1fr); gap: 10px; } }

  .ent-mid { display: grid; grid-template-columns: 1fr; gap: 12px; }
  @media (min-width: 900px) { .ent-mid { grid-template-columns: 1.8fr 1fr; } }

  .ent-bot { display: grid; grid-template-columns: 1fr; gap: 12px; }
  @media (min-width: 900px)  { .ent-bot { grid-template-columns: 1fr 1fr; } }
  @media (min-width: 1280px) { .ent-bot { grid-template-columns: 1fr 1fr 1fr; } }

  .ent-kpi-val { font-size: 20px; }
  @media (min-width: 480px) { .ent-kpi-val { font-size: 24px; } }

  .ent-spark { display: none; }
  @media (min-width: 360px) { .ent-spark { display: flex; } }
`;

// ─── MAIN ────────────────────────────────────────────────────────────────────
export default function EnterpriseDashboard() {
  return (
    <div style={{ fontFamily: 'Inter, system-ui, -apple-system, sans-serif', background: T.bg, minHeight: '100%' }}>
      <style>{CSS}</style>

      {/* ── Sticky Header ── */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 20,
        background: '#fff', borderBottom: `1px solid ${T.border}`,
        padding: '0 20px', height: 52,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8, flexShrink: 0,
            background: 'linear-gradient(135deg, #ede9fe 0%, #ddd6fe 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={T.prod.solid} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: T.text.primary, letterSpacing: '-0.01em' }}>Enterprise Overview</div>
            <div style={{ fontSize: 10.5, color: T.text.muted, marginTop: 1 }}>Consolidated view across all operations</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {/* Domain legend pills */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {DOMAIN_LEGEND.map(d => (
              <span key={d.label} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10.5, color: d.color, fontWeight: 600 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: d.color, display: 'inline-block' }} />
                {d.label}
              </span>
            ))}
          </div>
          <div style={{ fontSize: 10.5, color: T.green.text, background: T.green.light, padding: '4px 10px', borderRadius: 20, border: `1px solid ${T.green.solid}30`, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 }}>
            ● Live
          </div>
        </div>
      </div>

      <div className="ent-content">

        {/* ── Row 1: 8 KPI Cards ── */}
        <div className="ent-kpi">
          {KPI_CARDS.map((k) => (
            <Card key={k.id} alert={k.isAlert} style={{ padding: '13px 14px 12px', display: 'flex', flexDirection: 'column', gap: 0, position: 'relative', overflow: 'hidden', cursor: 'pointer' }}>
              {/* Color top bar */}
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, borderRadius: '12px 12px 0 0', background: `linear-gradient(90deg, ${k.gradA}, ${k.gradB})` }} />

              {/* Label + Icon */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginTop: 5, marginBottom: 8 }}>
                <span style={{ fontSize: 10.5, color: T.text.secondary, fontWeight: 500, lineHeight: 1.3, maxWidth: '55%' }}>{k.label}</span>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                  <div style={{ width: 24, height: 24, borderRadius: 6, background: k.iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon type={k.iconType} size={12} color={k.iconColor} />
                  </div>
                  <div className="ent-spark">
                    <Sparkline data={k.spark} color={k.gradA} />
                  </div>
                </div>
              </div>

              {/* Value */}
              <div style={{ marginBottom: 8 }}>
                <span className="ent-kpi-val" style={{ fontWeight: 800, color: T.text.primary, letterSpacing: '-0.03em' }}>{k.value}</span>
                {k.unit && <span style={{ fontSize: 10.5, color: T.text.muted, marginLeft: 3, fontWeight: 500 }}>{k.unit}</span>}
              </div>

              <div style={{ height: 1, background: T.border, marginBottom: 8 }} />

              {/* Delta */}
              <div style={{ fontSize: 10.5, color: k.pos ? T.green.text : T.red.text, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 3 }}>
                <span style={{ fontSize: 12 }}>{k.pos ? '↑' : '↓'}</span>
                <span>{k.delta}</span>
              </div>
            </Card>
          ))}
        </div>

        {/* ── Row 2: Weekly Trend + Domain Health ── */}
        <div className="ent-mid">

          {/* Weekly Performance Trend */}
          <Card style={{ padding: '16px 20px' }}>
            <SectionTitle>Weekly Performance Trend (%)</SectionTitle>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={WEEKLY_TREND} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: T.text.muted }} axisLine={false} tickLine={false} />
                <YAxis domain={[82, 100]} tick={{ fontSize: 11, fill: T.text.muted }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTip />} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, fontFamily: 'Inter, system-ui' }} />
                <Line type="monotone" dataKey="Production" stroke={T.prod.solid} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="Packaging"  stroke={T.pkg.solid}  strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="Quality"    stroke={T.qlt.solid}  strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="Logistics"  stroke={T.log.solid}  strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </Card>

          {/* Domain Health Status */}
          <Card style={{ padding: '16px 18px' }}>
            <SectionTitle>Domain Health Status</SectionTitle>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {DOMAIN_STATUS.map((d, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 12px', borderRadius: 10,
                  border: `1px solid ${T.border}`,
                  background: `${d.light}60`,
                }}>
                  <span style={{ fontSize: 18, flexShrink: 0 }}>{d.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: T.text.primary }}>{d.label}</div>
                    <div style={{ fontSize: 10.5, color: T.text.muted, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.detail}</div>
                  </div>
                  <div style={{
                    flexShrink: 0, fontSize: 10, fontWeight: 700,
                    padding: '3px 9px', borderRadius: 999,
                    background: d.hb, color: d.hc,
                    border: `1px solid ${d.hc}30`,
                  }}>
                    {d.health}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* ── Row 3: Performance vs Target + Scorecard + Alerts ── */}
        <div className="ent-bot" style={{ alignItems: 'stretch' }}>

          {/* Performance vs Target */}
          <Card style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column' }}>
            <SectionTitle>Performance vs Target (%)</SectionTitle>
            <ResponsiveContainer width="100%" height={190}>
              <BarChart data={PERF_VS_TARGET} margin={{ top: 4, right: 8, left: -18, bottom: 0 }} barCategoryGap="32%" barGap={3}>
                <XAxis dataKey="domain" tick={{ fontSize: 11, fill: T.text.muted }} axisLine={false} tickLine={false} />
                <YAxis domain={[78, 100]} ticks={[80,85,90,95,100]} tick={{ fontSize: 11, fill: T.text.muted }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(0,0,0,0.04)', radius: [4, 4, 0, 0] }} />
                <Legend iconType="square" iconSize={9} wrapperStyle={{ fontSize: 11, fontFamily: 'Inter, system-ui' }} />
                <Bar dataKey="actual" name="Actual" radius={[4, 4, 0, 0]}>
                  {PERF_VS_TARGET.map((_, i) => <Cell key={i} fill={PERF_COLORS[i]} />)}
                </Bar>
                <Bar dataKey="target" name="Target" fill="#dde1ea" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>

            {/* Domain progress bars filling remaining space */}
            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
              <div style={{ height: 1, background: T.border, marginBottom: 2 }} />
              {PERF_VS_TARGET.map((d, i) => (
                <div key={i}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: PERF_COLORS[i], display: 'inline-block', flexShrink: 0 }} />
                      <span style={{ fontSize: 11.5, color: T.text.secondary, fontWeight: 500 }}>{d.domain}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 11, color: T.text.muted }}>Target: {d.target}%</span>
                      <span style={{
                        fontSize: 11, fontWeight: 700, color: d.actual >= d.target ? T.green.text : T.red.text,
                        background: d.actual >= d.target ? T.green.light : T.red.light,
                        padding: '1px 6px', borderRadius: 999,
                      }}>
                        {d.actual >= d.target ? '▲' : '▼'} {d.actual}%
                      </span>
                    </div>
                  </div>
                  <div style={{ height: 7, background: T.border, borderRadius: 999, position: 'relative', overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: 999, background: PERF_COLORS[i], width: `${((d.actual - 78) / (100 - 78)) * 100}%`, transition: 'width 0.4s ease' }} />
                    {/* Target tick */}
                    <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${((d.target - 78) / (100 - 78)) * 100}%`, width: 2, background: '#64748b', opacity: 0.5 }} />
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Domain Scorecard — Radar */}
          <Card style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column' }}>
            <SectionTitle>Domain Scorecard</SectionTitle>
            <ResponsiveContainer width="100%" height={210}>
              <RadarChart
                data={SCORECARD}
                cx="50%" cy="52%"
                outerRadius="62%"
                margin={{ top: 28, right: 36, left: 36, bottom: 16 }}
              >
                <PolarGrid stroke={T.border} />
                <PolarAngleAxis
                  dataKey="metric"
                  tick={{ fontSize: 10.5, fill: T.text.secondary, fontFamily: 'Inter, system-ui', fontWeight: 500 }}
                />
                <PolarRadiusAxis domain={[60, 100]} tick={false} axisLine={false} />
                <Tooltip content={<ChartTip />} />
                <Radar name="Production" dataKey="Production" stroke={T.prod.solid} fill={T.prod.solid} fillOpacity={0.13} strokeWidth={2} />
                <Radar name="Packaging"  dataKey="Packaging"  stroke={T.pkg.solid}  fill={T.pkg.solid}  fillOpacity={0.13} strokeWidth={2} />
                <Radar name="Quality"    dataKey="Quality"    stroke={T.qlt.solid}  fill={T.qlt.solid}  fillOpacity={0.13} strokeWidth={2} />
                <Radar name="Logistics"  dataKey="Logistics"  stroke={T.log.solid}  fill={T.log.solid}  fillOpacity={0.13} strokeWidth={2} />
                <Legend
                  iconType="circle" iconSize={8}
                  verticalAlign="top" align="center"
                  wrapperStyle={{ fontSize: 11, fontFamily: 'Inter, system-ui', paddingBottom: 4 }}
                />
              </RadarChart>
            </ResponsiveContainer>

            {/* Domain average score tiles */}
            <div style={{ marginTop: 14, flex: 1 }}>
              <div style={{ height: 1, background: T.border, marginBottom: 12 }} />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                {[
                  { label: 'Production', color: T.prod.solid, light: T.prod.light, avg: '87.7', top: 'Compliance 96%' },
                  { label: 'Packaging',  color: T.pkg.solid,  light: T.pkg.light,  avg: '88.5', top: 'Efficiency 94%' },
                  { label: 'Quality',    color: T.qlt.solid,  light: T.qlt.light,  avg: '93.2', top: 'Compliance 99%' },
                  { label: 'Logistics',  color: T.log.solid,  light: T.log.light,  avg: '85.8', top: 'Delivery 92%'   },
                ].map((d, i) => (
                  <div key={i} style={{
                    background: `${d.light}80`, borderRadius: 10, padding: '10px 12px',
                    border: `1px solid ${d.color}22`,
                  }}>
                    <div style={{ fontSize: 10.5, color: T.text.secondary, fontWeight: 500, marginBottom: 4 }}>{d.label}</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: d.color, letterSpacing: '-0.03em', lineHeight: 1 }}>{d.avg}<span style={{ fontSize: 11, fontWeight: 500, marginLeft: 1 }}>%</span></div>
                    <div style={{ fontSize: 10, color: T.text.muted, marginTop: 4 }}>avg · best: {d.top}</div>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          {/* Alerts + Upcoming */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* Active Alerts */}
            <Card style={{ padding: '16px 18px', flex: 1 }}>
              <SectionTitle action="View All →">Active Alerts</SectionTitle>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {ALERTS.map((a, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'flex-start', gap: 9,
                    padding: '8px 11px', borderRadius: 8,
                    background: a.pb, border: `1px solid ${a.pc}20`,
                  }}>
                    <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>{a.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 9.5, fontWeight: 700, color: a.pc, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 1 }}>
                        {a.domain} · {a.priority}
                      </div>
                      <div style={{ fontSize: 11.5, color: T.text.secondary, lineHeight: 1.4 }}>{a.msg}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            {/* Upcoming Activities */}
            <Card style={{ padding: '16px 18px' }}>
              <SectionTitle action="View All →">Upcoming Activities</SectionTitle>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {UPCOMING.map((a, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '9px 0',
                    borderBottom: i < UPCOMING.length - 1 ? `1px solid ${T.border}` : 'none',
                  }}>
                    <div style={{ width: 28, height: 28, borderRadius: 7, background: a.iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={a.iconColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                      </svg>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: T.text.primary }}>{a.label}</div>
                      <div style={{ fontSize: 10.5, color: T.text.muted, marginTop: 1 }}>{a.domain} · {a.note}</div>
                    </div>
                    <div style={{
                      fontSize: 9.5, fontWeight: 700, padding: '2px 7px', borderRadius: 999,
                      background: a.urgency === 'high' ? T.red.light : a.urgency === 'med' ? T.amber.light : T.blue.light,
                      color:      a.urgency === 'high' ? T.red.text  : a.urgency === 'med' ? T.amber.text  : T.blue.text,
                      textTransform: 'uppercase', flexShrink: 0,
                    }}>
                      {a.urgency === 'high' ? 'Urgent' : a.urgency === 'med' ? 'Soon' : 'Planned'}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>

      </div>
    </div>
  );
}
