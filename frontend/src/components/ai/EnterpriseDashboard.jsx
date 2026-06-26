import React, { useState, useRef } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  LineChart, Line, Legend,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
} from 'recharts';
import { useProductionData } from '../../hooks/useProductionData';
import { useQualityData } from '../../hooks/useQualityData';
import useThemeStore from '../../store/useThemeStore';
import { getThemeTokens } from '../../utils/themeTokens';

// ─── STATIC DATA (no T references) ───────────────────────────────────────────
const SCORECARD = [
  { metric: 'Efficiency',  Production: 92, Packaging: 94, Quality: 96, Logistics: 88 },
  { metric: 'Quality',     Production: 97, Packaging: 91, Quality: 99, Logistics: 85 },
  { metric: 'Delivery',    Production: 88, Packaging: 90, Quality: 92, Logistics: 92 },
  { metric: 'Capacity',    Production: 68, Packaging: 75, Quality: 82, Logistics: 78 },
  { metric: 'Compliance',  Production: 96, Packaging: 93, Quality: 99, Logistics: 90 },
  { metric: 'Cost Index',  Production: 85, Packaging: 88, Quality: 91, Logistics: 82 },
];

const _WEEKLY_FALLBACK = [
  { day: 'Mon', Production: 88, Packaging: 91, Quality: 97, Logistics: 89 },
  { day: 'Tue', Production: 90, Packaging: 92, Quality: 98, Logistics: 91 },
  { day: 'Wed', Production: 87, Packaging: 90, Quality: 98, Logistics: 88 },
  { day: 'Thu', Production: 91, Packaging: 93, Quality: 98, Logistics: 90 },
  { day: 'Fri', Production: 92, Packaging: 94, Quality: 99, Logistics: 92 },
  { day: 'Sat', Production: 89, Packaging: 92, Quality: 99, Logistics: 90 },
  { day: 'Sun', Production: 92, Packaging: 94, Quality: 99, Logistics: 88 },
];

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function fmtUnits(n) {
  if (n == null) return '—';
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

function signedDelta(cur, prev) {
  const d = (cur - prev).toFixed(1);
  return `${parseFloat(d) >= 0 ? '+' : ''}${d}%`;
}

// ─── BUILDER FUNCTIONS (all accept T) ────────────────────────────────────────
function buildKpiCards(prodData, qualData, T) {
  const p  = prodData?.today;
  const pY = prodData?.yesterday;
  const q  = qualData?.today;
  const qY = qualData?.yesterday;

  const prodOut    = p?.totalProduced ?? null;
  const prodTarget = p?.totalTarget   ?? null;
  const prodDelta  = (prodOut != null && prodTarget > 0)
    ? `${((prodOut - prodTarget) / prodTarget * 100).toFixed(1)}` : null;

  const cap   = p?.capacityPct      ?? null;
  const capY  = pY?.capacityPct     ?? null;
  const qpr   = q?.qualityPassRate  ?? null;
  const qprY  = qY?.qualityPassRate ?? null;
  const ncr   = q?.openNcrs         ?? null;

  const pOutSpark = (prodData?.last9 ?? []).map(d => Math.round((d.totalProduced ?? 0) / 1000));
  const capSpark  = (prodData?.last9 ?? []).map(d => Math.round(d.capacityPct ?? 0));
  const qprSpark  = (qualData?.last9 ?? []).map(d => Math.round(d.qualityPassRate ?? 0));

  return [
    {
      id: 'prod-out', domain: 'Production', label: "Today's Output",
      value: prodOut != null ? fmtUnits(prodOut) : '—', unit: 'units',
      delta: prodDelta != null ? `${parseFloat(prodDelta) >= 0 ? '+' : ''}${prodDelta}% vs target` : '+8.4% vs target',
      pos: prodDelta != null ? parseFloat(prodDelta) >= 0 : true,
      spark: pOutSpark.length >= 3 ? pOutSpark : [8,12,9,15,11,14,18,16,20],
      ...T.prod, iconBg: T.prod.light, iconColor: T.prod.solid, iconType: 'factory',
    },
    {
      id: 'prod-cap', domain: 'Production', label: 'Capacity Utilization',
      value: cap != null ? `${cap.toFixed(1)}%` : '—', unit: null,
      delta: (cap != null && capY != null) ? `${signedDelta(cap, capY)} vs yesterday` : '+5.6% vs yesterday',
      pos: (cap != null && capY != null) ? cap >= capY : true,
      spark: capSpark.length >= 3 ? capSpark : [55,60,58,62,59,65,63,67,68],
      ...T.prod, iconBg: T.prod.light, iconColor: T.prod.solid, iconType: 'gauge',
    },
    { id: 'pkg-eff', domain: 'Packaging', label: 'Line Efficiency',   value: '94.2%', unit: null, delta: '+2.1% vs yesterday', pos: true, spark: [88,90,89,92,91,93,92,94,94], ...T.pkg, iconBg: T.pkg.light, iconColor: T.pkg.solid, iconType: 'box'     },
    { id: 'pkg-pkg', domain: 'Packaging', label: 'Packages Today',    value: '45.2K', unit: null, delta: '+6.8% vs target',    pos: true, spark: [38,40,39,42,41,43,44,45,45], ...T.pkg, iconBg: T.pkg.light, iconColor: T.pkg.solid, iconType: 'package' },
    {
      id: 'qlt-pas', domain: 'Quality', label: 'Quality Pass Rate',
      value: qpr != null ? `${qpr.toFixed(1)}%` : '—', unit: null,
      delta: (qpr != null && qprY != null) ? `${signedDelta(qpr, qprY)} vs yesterday` : '+1.3% vs yesterday',
      pos: (qpr != null && qprY != null) ? qpr >= qprY : true,
      spark: qprSpark.length >= 3 ? qprSpark : [96,97,96,98,97,99,98,98,99],
      ...T.qlt, iconBg: T.qlt.light, iconColor: T.qlt.solid, iconType: 'shield',
    },
    {
      id: 'qlt-ncr', domain: 'Quality', label: 'Open NCRs',
      value: ncr != null ? String(ncr) : '—', unit: null,
      delta: q ? `${q.capaCritical ?? 0} critical CAPA pending` : '-2 vs last week',
      pos: q ? (q.capaCritical ?? 0) === 0 : true,
      spark: [12, 10, 9, 8, 9, 7, 8, 7, ncr ?? 7],
      ...T.qlt, iconBg: T.qlt.light, iconColor: T.qlt.solid, iconType: 'alertTri', isAlert: ncr != null ? ncr > 0 : true,
    },
    { id: 'log-otd', domain: 'Logistics', label: 'On-Time Delivery', value: '92%', unit: null, delta: '+3.4% vs last month', pos: true,  spark: [85,87,88,89,90,91,90,92,92], ...T.log, iconBg: T.log.light, iconColor: T.log.solid, iconType: 'truck' },
    { id: 'log-int', domain: 'Logistics', label: 'In Transit',       value: '15',  unit: null, delta: '2 delayed',           pos: false, spark: [10,12,11,13,14,13,15,15,15], ...T.log, iconBg: T.log.light, iconColor: T.log.solid, iconType: 'truck', isAlert: true },
  ];
}

function buildWeeklyTrend(prodData, qualData) {
  const pMap = {}, qMap = {};
  (prodData?.last9 ?? []).forEach(d => { pMap[d.date] = d; });
  (qualData?.last9 ?? []).forEach(d => { qMap[d.date] = d; });
  const allDates = [...new Set([...Object.keys(pMap), ...Object.keys(qMap)])].sort().slice(-7);
  if (allDates.length < 2) return _WEEKLY_FALLBACK;
  return allDates.map(date => ({
    day: new Date(date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' }),
    Production: Math.round(pMap[date]?.onTimePct   ?? 0),
    Quality:    Math.round(qMap[date]?.qualityPassRate ?? 0),
    Packaging:  94, Logistics: 90,
  }));
}

function buildPerfVsTarget(prodData, qualData) {
  const p = prodData?.today, q = qualData?.today;
  return [
    { domain: 'Production', actual: p ? Math.round(p.capacityPct)    : 92, target: 85 },
    { domain: 'Packaging',  actual: 94, target: 90 },
    { domain: 'Quality',    actual: q ? Math.round(q.qualityPassRate) : 99, target: 95 },
    { domain: 'Logistics',  actual: 88, target: 90 },
  ];
}

function buildDomainStatus(prodData, qualData, T) {
  const p = prodData?.today, q = qualData?.today;
  const prodHealth = p && p.openIssues > 5 ? 'Attention' : 'On Track';
  const qualHealth = q && (q.capaCritical > 0 || q.deviationCritical > 0) ? 'Attention' : 'On Track';
  return [
    {
      icon: '🏭', label: 'Production', color: T.prod.solid, light: T.prod.light,
      health: prodHealth, hc: prodHealth === 'On Track' ? T.green.solid : T.amber.solid, hb: prodHealth === 'On Track' ? T.green.light : T.amber.light,
      detail: p ? `${p.batches?.in_progress ?? 0} active batches · ${p.batches?.completed ?? 0} completed today` : '8 active batches · 3/3 shifts running',
    },
    { icon: '📦', label: 'Packaging',  color: T.pkg.solid,  light: T.pkg.light,  health: 'On Track',  hc: T.green.solid, hb: T.green.light, detail: '2/4 lines running · Line C under maintenance' },
    {
      icon: '📋', label: 'Quality', color: T.qlt.solid, light: T.qlt.light,
      health: qualHealth, hc: qualHealth === 'On Track' ? T.green.solid : T.amber.solid, hb: qualHealth === 'On Track' ? T.green.light : T.amber.light,
      detail: q ? `${q.capaCritical ?? 0} critical CAPA pending · ${(q.deviationCritical ?? 0) + (q.deviationMajor ?? 0) + (q.deviationMinor ?? 0)} open deviations` : '1 critical CAPA pending · 3 open deviations',
    },
    { icon: '🚛', label: 'Logistics', color: T.log.solid, light: T.log.light, health: 'Attention', hc: T.amber.solid, hb: T.amber.light, detail: '2 shipments delayed · 23 pending dispatch' },
  ];
}

function buildAlerts(prodData, qualData, T) {
  const p = prodData?.today, q = qualData?.today;
  const list = [];
  if (p?.alerts?.high > 0)
    list.push({ icon: '🏭', domain: 'Production', msg: `${p.alerts.high} open high-priority production issues`, priority: 'High', pc: T.red.solid, pb: T.red.light });
  else if (p?.openIssues > 0)
    list.push({ icon: '🏭', domain: 'Production', msg: `${p.openIssues} open production issues require attention`, priority: 'Medium', pc: T.amber.solid, pb: T.amber.light });
  if (q?.capaCritical > 0)
    list.push({ icon: '📋', domain: 'Quality', msg: `${q.capaCritical} critical CAPA${q.capaCritical > 1 ? 's are' : ' is'} overdue for review`, priority: 'High', pc: T.red.solid, pb: T.red.light });
  if (q?.deviationCritical > 0)
    list.push({ icon: '📋', domain: 'Quality', msg: `${q.deviationCritical} critical deviation${q.deviationCritical > 1 ? 's' : ''} logged today`, priority: 'High', pc: T.red.solid, pb: T.red.light });
  const audit = q?.upcomingAudits?.[0];
  if (audit)
    list.push({ icon: '📋', domain: 'Quality', msg: `${audit.name} scheduled ${audit.date}`, priority: 'Low', pc: T.blue.solid, pb: T.blue.light });
  list.push({ icon: '🚛', domain: 'Logistics', msg: 'SHP-004 & SHP-005 delayed — Bangalore & Chennai', priority: 'Medium', pc: T.amber.solid, pb: T.amber.light });
  list.push({ icon: '📦', domain: 'Packaging', msg: 'Line C maintenance expected complete by 4 PM', priority: 'Low', pc: T.blue.solid, pb: T.blue.light });
  const ORDER = { High: 0, Medium: 1, Low: 2 };
  return list.sort((a, b) => ORDER[a.priority] - ORDER[b.priority]).slice(0, 5);
}

function buildUpcoming(prodData, qualData, T) {
  const acts = prodData?.today?.activities ?? {};
  const audits = qualData?.today?.upcomingAudits ?? [];
  const list = [];
  const calDue = acts.equipment_calibration_due ?? 0;
  if (calDue > 0) list.push({ label: 'Equipment Calibration', note: `${calDue} due today`, iconBg: T.blue.light, iconColor: T.blue.solid, urgency: 'high', domain: 'Production' });
  const maintDue = acts.preventive_maintenance_due ?? 0;
  if (maintDue > 0) list.push({ label: 'Preventive Maintenance', note: `${maintDue} due this week`, iconBg: T.green.light, iconColor: T.green.solid, urgency: 'med', domain: 'Production' });
  const qcTime = acts.qc_review_time;
  if (qcTime) list.push({ label: 'QC Review', note: typeof qcTime === 'string' ? qcTime : 'Today', iconBg: T.red.light, iconColor: T.red.solid, urgency: 'high', domain: 'Quality' });
  audits.slice(0, 2).forEach(a => {
    list.push({
      label: a.name ?? 'Scheduled Audit', note: a.date ?? '',
      iconBg:    a.priority === 'High' ? T.red.light   : T.amber.light,
      iconColor: a.priority === 'High' ? T.red.solid   : T.amber.solid,
      urgency:   a.priority === 'High' ? 'high' : a.priority === 'Medium' ? 'med' : 'low',
      domain: 'Quality',
    });
  });
  if (list.length < 4) list.push({ label: 'Carrier Performance Review', note: 'Logistics · Jun 25', iconBg: T.log.light, iconColor: T.log.solid, urgency: 'low', domain: 'Logistics' });
  return list.slice(0, 4);
}

function buildProdLines(prodData, T) {
  const PROD_LINE_BASE = [
    { key: 'granulation', label: 'Granulation', color: T.prod.solid, light: T.prod.light },
    { key: 'compression', label: 'Compression', color: T.pkg.solid,  light: T.pkg.light  },
    { key: 'coating',     label: 'Coating',     color: T.qlt.solid,  light: T.qlt.light  },
    { key: 'packaging',   label: 'Packaging',   color: T.log.solid,  light: T.log.light  },
  ];
  const areas    = prodData?.today?.areas    ?? {};
  const total    = prodData?.today?.totalProduced ?? 1;
  const maintDue = prodData?.today?.activities?.preventive_maintenance_due ?? 0;
  const onHold   = prodData?.today?.batches?.on_hold ?? 0;

  return PROD_LINE_BASE.map((l, i) => {
    const units = areas[l.key] ?? 0;
    const pct   = total > 0 ? ((units / total) * 100).toFixed(1) : '0.0';
    let status, statusColor, statusBg, dotColor;
    if (i === 2 && maintDue > 3) {
      status = 'Maintenance'; statusColor = T.amber.text; statusBg = T.amber.light; dotColor = T.amber.solid;
    } else if (i === 3 && onHold > 2) {
      status = 'On Hold'; statusColor = T.amber.text; statusBg = T.amber.light; dotColor = T.amber.solid;
    } else if (units > 0) {
      status = 'Running'; statusColor = T.green.text; statusBg = T.green.light; dotColor = T.green.solid;
    } else {
      status = 'Idle'; statusColor = 'var(--txt2)'; statusBg = 'var(--bg)'; dotColor = 'var(--txt3)';
    }
    return { ...l, status, statusColor, statusBg, dotColor, sub: `${pct}% of total output`, unitsFormatted: `${(units / 1000).toFixed(1)}K` };
  });
}

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
let _sparkId = 0;
function Sparkline({ data, color }) {
  const id = useRef(`spk-${_sparkId++}`).current;
  const w = 72, h = 32;
  const min = Math.min(...data), max = Math.max(...data), range = max - min || 1;
  const pts = data.map((p, i) => ({ x: (i / (data.length - 1)) * w, y: h - 5 - ((p - min) / range) * (h - 10) }));
  const linePath = `M${pts.map(p => `${p.x},${p.y}`).join(' L')}`;
  const areaPath = `${linePath} L${pts[pts.length-1].x},${h} L${pts[0].x},${h} Z`;
  return (
    <svg width={w} height={h} style={{ overflow: 'visible', flexShrink: 0 }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity="0.55" />
          <stop offset="60%"  stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0"    />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${id})`} />
      <path d={linePath} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[pts.length-1].x} cy={pts[pts.length-1].y} r="3.5" fill={color} />
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
        background: 'var(--surf)', borderRadius: 12,
        border: `1px solid ${alert ? 'rgba(251,146,60,0.5)' : hov ? 'var(--brd2)' : 'var(--brd)'}`,
        boxShadow: hov ? '0 8px 28px rgba(0,0,0,0.15),0 2px 6px rgba(0,0,0,0.08)' : '0 1px 3px rgba(0,0,0,0.06)',
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
      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--txt)', letterSpacing: '0.01em' }}>{children}</span>
      {action && <span style={{ fontSize: 11, color: '#3b82f6', fontWeight: 600, cursor: 'pointer' }}>{action}</span>}
    </div>
  );
}

function ChartTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: 'var(--surf)', border: '1px solid var(--brd)', borderRadius: 8, padding: '8px 12px', fontSize: 12, boxShadow: '0 4px 16px rgba(0,0,0,0.15)' }}>
      <div style={{ fontWeight: 700, color: 'var(--txt)', marginBottom: 5 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--txt2)', marginBottom: 2 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color || p.fill, display: 'inline-block' }} />
          {p.name}: <b style={{ color: 'var(--txt)', marginLeft: 2 }}>{p.value}%</b>
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
  @media (min-width: 640px)  { .ent-kpi { grid-template-columns: repeat(4, 1fr); gap: 10px; } }
  .ent-mid { display: grid; grid-template-columns: 1fr; gap: 12px; }
  @media (min-width: 900px)  { .ent-mid { grid-template-columns: 1.2fr 1fr; } }
  @media (min-width: 1280px) { .ent-mid { grid-template-columns: 1.2fr 1fr 1fr; } }
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
  const { theme } = useThemeStore();
  const T = getThemeTokens(theme === 'dark');

  const { data: prodData } = useProductionData();
  const { data: qualData } = useQualityData();

  const DOMAIN_LEGEND = [
    { label: 'Production', color: T.prod.solid },
    { label: 'Packaging',  color: T.pkg.solid  },
    { label: 'Quality',    color: T.qlt.solid  },
    { label: 'Logistics',  color: T.log.solid  },
  ];
  const PERF_COLORS = [T.prod.solid, T.pkg.solid, T.qlt.solid, T.log.solid];

  const kpiCards     = buildKpiCards(prodData, qualData, T);
  const prodLines    = buildProdLines(prodData, T);
  const weeklyTrend  = buildWeeklyTrend(prodData, qualData);
  const perfVsTarget = buildPerfVsTarget(prodData, qualData);
  const domainStatus = buildDomainStatus(prodData, qualData, T);
  const alerts       = buildAlerts(prodData, qualData, T);
  const upcoming     = buildUpcoming(prodData, qualData, T);

  return (
    <div style={{ fontFamily: 'Inter, system-ui, -apple-system, sans-serif', background: 'var(--bg)', minHeight: '100%' }}>
      <style>{CSS}</style>

      {/* Sticky Header */}
      <div style={{ position: 'sticky', top: 0, zIndex: 20, background: 'var(--surf)', borderBottom: '1px solid var(--brd)', padding: '0 20px', height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0, background: T.prod.light, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={T.prod.solid} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--txt)', letterSpacing: '-0.01em' }}>Enterprise Overview</div>
            <div style={{ fontSize: 10.5, color: 'var(--txt3)', marginTop: 1 }}>Consolidated view across all operations</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
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

        {/* Row 1: 8 KPI Cards */}
        <div className="ent-kpi">
          {kpiCards.map((k) => (
            <Card key={k.id} alert={k.isAlert} style={{ padding: '13px 14px 12px', display: 'flex', flexDirection: 'column', gap: 0, position: 'relative', overflow: 'hidden', cursor: 'pointer' }}>
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, borderRadius: '12px 12px 0 0', background: `linear-gradient(90deg, ${k.gradA}, ${k.gradB})` }} />
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginTop: 5, marginBottom: 8 }}>
                <span style={{ fontSize: 10.5, color: 'var(--txt2)', fontWeight: 500, flex: 1, minWidth: 0, lineHeight: 1.3, paddingRight: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k.label}</span>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                  <div style={{ width: 24, height: 24, borderRadius: 6, background: k.iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon type={k.iconType} size={12} color={k.iconColor} />
                  </div>
                  <div className="ent-spark">
                    <Sparkline data={k.spark} color={k.gradA} />
                  </div>
                </div>
              </div>
              <div style={{ marginBottom: 8 }}>
                <span className="ent-kpi-val" style={{ fontWeight: 800, color: 'var(--txt)', letterSpacing: '-0.03em' }}>{k.value}</span>
                {k.unit && <span style={{ fontSize: 10.5, color: 'var(--txt3)', marginLeft: 3, fontWeight: 500 }}>{k.unit}</span>}
              </div>
              <div style={{ height: 1, background: 'var(--brd)', marginBottom: 8 }} />
              <div style={{ fontSize: 10.5, color: k.pos ? T.green.text : T.red.text, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 3, overflow: 'hidden' }}>
                <span style={{ fontSize: 12, flexShrink: 0 }}>{k.pos ? '↑' : '↓'}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{k.delta}</span>
              </div>
            </Card>
          ))}
        </div>

        {/* Row 2: Weekly Trend + Production Lines + Alerts */}
        <div className="ent-mid">

          <Card style={{ padding: '16px 20px' }}>
            <SectionTitle>Weekly Performance Trend (%)</SectionTitle>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={weeklyTrend} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: 'var(--txt3)' }} axisLine={false} tickLine={false} />
                <YAxis domain={[82, 100]} tick={{ fontSize: 11, fill: 'var(--txt3)' }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTip />} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, fontFamily: 'Inter, system-ui' }} />
                <Line type="monotone" dataKey="Production" stroke={T.prod.solid} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="Packaging"  stroke={T.pkg.solid}  strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="Quality"    stroke={T.qlt.solid}  strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="Logistics"  stroke={T.log.solid}  strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </Card>

          <Card style={{ padding: '16px 18px' }}>
            <SectionTitle>Production Line Status</SectionTitle>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {prodLines.map((line) => (
                <div key={line.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--brd)', background: `${line.light}55` }}>
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: line.dotColor, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--txt)' }}>{line.label}</div>
                    <div style={{ fontSize: 10.5, color: 'var(--txt3)', marginTop: 1 }}>{line.sub}</div>
                  </div>
                  <div style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 999, background: line.statusBg, color: line.statusColor, border: `1px solid ${line.statusColor}30` }}>
                    {line.status}
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--txt2)', minWidth: 44, textAlign: 'right', flexShrink: 0 }}>
                    {line.unitsFormatted}
                  </div>
                </div>
              ))}
            </div>
            {prodData?.today && (
              <>
                <div style={{ height: 1, background: 'var(--brd)', margin: '12px 0 10px' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  {[
                    { label: 'In Progress', value: prodData.today.batches.in_progress ?? 0, color: T.prod.solid },
                    { label: 'Completed',   value: prodData.today.batches.completed   ?? 0, color: T.green.solid },
                    { label: 'On Hold',     value: prodData.today.batches.on_hold     ?? 0, color: T.amber.solid },
                    { label: 'Pending',     value: prodData.today.batches.pending     ?? 0, color: 'var(--txt3)' },
                  ].map((s, i) => (
                    <div key={i} style={{ textAlign: 'center', flex: 1 }}>
                      <div style={{ fontSize: 18, fontWeight: 800, color: s.color, letterSpacing: '-0.03em' }}>{s.value}</div>
                      <div style={{ fontSize: 9.5, color: 'var(--txt3)', marginTop: 2, fontWeight: 500 }}>{s.label}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </Card>

          <Card style={{ padding: '16px 18px' }}>
            <SectionTitle>Active Alerts</SectionTitle>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {alerts.map((a, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '8px 11px', borderRadius: 8, background: a.pb, border: `1px solid ${a.pc}20` }}>
                  <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>{a.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 9.5, fontWeight: 700, color: a.pc, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 1 }}>{a.domain} · {a.priority}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--txt2)', lineHeight: 1.4 }}>{a.msg}</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Row 3: Performance vs Target + Scorecard + Status */}
        <div className="ent-bot" style={{ alignItems: 'stretch' }}>

          <Card style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column' }}>
            <SectionTitle>Performance vs Target (%)</SectionTitle>
            <ResponsiveContainer width="100%" height={190}>
              <BarChart data={perfVsTarget} margin={{ top: 4, right: 8, left: -18, bottom: 0 }} barCategoryGap="32%" barGap={3}>
                <XAxis dataKey="domain" tick={{ fontSize: 11, fill: 'var(--txt3)' }} axisLine={false} tickLine={false} />
                <YAxis domain={[78, 100]} ticks={[80,85,90,95,100]} tick={{ fontSize: 11, fill: 'var(--txt3)' }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(128,128,128,0.06)', radius: [4,4,0,0] }} />
                <Legend iconType="square" iconSize={9} wrapperStyle={{ fontSize: 11, fontFamily: 'Inter, system-ui' }} />
                <Bar dataKey="actual" name="Actual" radius={[4,4,0,0]}>
                  {perfVsTarget.map((_, i) => <Cell key={i} fill={PERF_COLORS[i]} />)}
                </Bar>
                <Bar dataKey="target" name="Target" fill="rgba(128,128,128,0.25)" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
              <div style={{ height: 1, background: 'var(--brd)', marginBottom: 2 }} />
              {perfVsTarget.map((d, i) => (
                <div key={i}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: PERF_COLORS[i], display: 'inline-block', flexShrink: 0 }} />
                      <span style={{ fontSize: 11.5, color: 'var(--txt2)', fontWeight: 500 }}>{d.domain}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 11, color: 'var(--txt3)' }}>Target: {d.target}%</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: d.actual >= d.target ? T.green.text : T.red.text, background: d.actual >= d.target ? T.green.light : T.red.light, padding: '1px 6px', borderRadius: 999 }}>
                        {d.actual >= d.target ? '▲' : '▼'} {d.actual}%
                      </span>
                    </div>
                  </div>
                  <div style={{ height: 7, background: 'var(--brd)', borderRadius: 999, position: 'relative', overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: 999, background: PERF_COLORS[i], width: `${((d.actual - 78) / (100 - 78)) * 100}%`, transition: 'width 0.4s ease' }} />
                    <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${((d.target - 78) / (100 - 78)) * 100}%`, width: 2, background: 'var(--txt3)', opacity: 0.5 }} />
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column' }}>
            <SectionTitle>Domain Scorecard</SectionTitle>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 20, flexWrap: 'wrap', marginBottom: 8 }}>
              {[
                { label: 'Production', color: T.prod.solid },
                { label: 'Packaging',  color: T.pkg.solid  },
                { label: 'Quality',    color: T.qlt.solid  },
                { label: 'Logistics',  color: T.log.solid  },
              ].map(d => (
                <div key={d.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: d.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 11, color: 'var(--txt2)', fontWeight: 500 }}>{d.label}</span>
                </div>
              ))}
            </div>
            <ResponsiveContainer width="100%" height={210}>
              <RadarChart data={SCORECARD} cx="50%" cy="50%" outerRadius="68%" margin={{ top: 10, right: 36, left: 36, bottom: 10 }}>
                <PolarGrid stroke="var(--brd)" />
                <PolarAngleAxis dataKey="metric" tick={{ fontSize: 10.5, fill: 'var(--txt2)', fontFamily: 'Inter, system-ui', fontWeight: 500 }} />
                <PolarRadiusAxis domain={[60, 100]} tick={false} axisLine={false} />
                <Tooltip content={<ChartTip />} />
                <Radar name="Production" dataKey="Production" stroke={T.prod.solid} fill={T.prod.solid} fillOpacity={0.13} strokeWidth={2} />
                <Radar name="Packaging"  dataKey="Packaging"  stroke={T.pkg.solid}  fill={T.pkg.solid}  fillOpacity={0.13} strokeWidth={2} />
                <Radar name="Quality"    dataKey="Quality"    stroke={T.qlt.solid}  fill={T.qlt.solid}  fillOpacity={0.13} strokeWidth={2} />
                <Radar name="Logistics"  dataKey="Logistics"  stroke={T.log.solid}  fill={T.log.solid}  fillOpacity={0.13} strokeWidth={2} />
              </RadarChart>
            </ResponsiveContainer>
            <div style={{ marginTop: 14, flex: 1 }}>
              <div style={{ height: 1, background: 'var(--brd)', marginBottom: 12 }} />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                {[
                  { label: 'Production', color: T.prod.solid, light: T.prod.light, avg: prodData?.today ? prodData.today.capacityPct.toFixed(1) : '87.7', top: `On-time ${prodData?.today ? prodData.today.onTimePct.toFixed(0) : 88}%` },
                  { label: 'Packaging',  color: T.pkg.solid,  light: T.pkg.light,  avg: '88.5', top: 'Efficiency 94%' },
                  { label: 'Quality',    color: T.qlt.solid,  light: T.qlt.light,  avg: qualData?.today ? qualData.today.qualityPassRate.toFixed(1) : '93.2', top: `Audit ${qualData?.today ? qualData.today.auditScore.toFixed(0) : 99}%` },
                  { label: 'Logistics',  color: T.log.solid,  light: T.log.light,  avg: '85.8', top: 'Delivery 92%' },
                ].map((d, i) => (
                  <div key={i} style={{ background: `${d.light}80`, borderRadius: 10, padding: '10px 12px', border: `1px solid ${d.color}22` }}>
                    <div style={{ fontSize: 10.5, color: 'var(--txt2)', fontWeight: 500, marginBottom: 4 }}>{d.label}</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: d.color, letterSpacing: '-0.03em', lineHeight: 1 }}>{d.avg}<span style={{ fontSize: 11, fontWeight: 500, marginLeft: 1 }}>%</span></div>
                    <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 4 }}>avg · best: {d.top}</div>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

            <Card style={{ padding: '16px 18px', flex: 1 }}>
              <SectionTitle>Domain Health Status</SectionTitle>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {domainStatus.map((d, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--brd)', background: `${d.light}60` }}>
                    <span style={{ fontSize: 18, flexShrink: 0 }}>{d.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--txt)' }}>{d.label}</div>
                      <div style={{ fontSize: 10.5, color: 'var(--txt3)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.detail}</div>
                    </div>
                    <div style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 999, background: d.hb, color: d.hc, border: `1px solid ${d.hc}30` }}>
                      {d.health}
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <Card style={{ padding: '16px 18px' }}>
              <SectionTitle>Upcoming Activities</SectionTitle>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {upcoming.map((a, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: i < upcoming.length - 1 ? '1px solid var(--brd)' : 'none' }}>
                    <div style={{ width: 28, height: 28, borderRadius: 7, background: a.iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={a.iconColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                      </svg>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt)' }}>{a.label}</div>
                      <div style={{ fontSize: 10.5, color: 'var(--txt3)', marginTop: 1 }}>{a.domain} · {a.note}</div>
                    </div>
                    <div style={{ fontSize: 9.5, fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: a.urgency === 'high' ? T.red.light : a.urgency === 'med' ? T.amber.light : T.blue.light, color: a.urgency === 'high' ? T.red.text : a.urgency === 'med' ? T.amber.text : T.blue.text, textTransform: 'uppercase', flexShrink: 0 }}>
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
