import { useState, useMemo } from "react";
import { useProductionData } from "../hooks/useProductionData";
import { useQualityData } from "../hooks/useQualityData";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import useThemeStore from "../store/useThemeStore";
import { getThemeTokens } from "../utils/themeTokens";

// ─── DATA HELPERS ─────────────────────────────────────────────────────────────
function fmtUnits(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(Math.round(n));
}

function signedPct(a, b) {
  if (!b) return null;
  return ((a - b) / b) * 100;
}

function fmtDelta(d, suffix) {
  return d != null ? `${d >= 0 ? "+" : ""}${d.toFixed(1)}% ${suffix}` : "—";
}

function fmtParamValue(v) {
  return v >= 100 ? String(Math.round(v)) : v.toFixed(1);
}

function formatLabel(key) {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bQc\b/g, "QC")
    .replace(/\bToc\b/g, "TOC")
    .replace(/\bRpm\b/g, "RPM");
}

function formatActivityNote(key, value) {
  if (ACTIVITY_NOTE_OVERRIDES[key]) return ACTIVITY_NOTE_OVERRIDES[key](value);
  if (key.endsWith("_due")) return `${value} Due Today`;
  if (key.endsWith("_scheduled")) return `${value} Scheduled`;
  if (key.endsWith("_time")) return `Today ${value}`;
  return String(value);
}

// ─── PALETTES & ICON LOOKUP TABLES ────────────────────────────────────────────
const AREA_PALETTE  = ["#2563eb", "#16a34a", "#7c3aed", "#d97706", "#cbd5e1", "#db2777", "#0ea5e9"];
const BATCH_PALETTE = ["#16a34a", "#2563eb", "#d97706", "#dc2626", "#7c3aed", "#0ea5e9"];

const PARAM_ICON_PATTERNS = [
  { pattern: "rpm",      iconType: "gear",      iconBg: "#ede9fe", iconColor: "#7c3aed" },
  { pattern: "temp",     iconType: "snowflake", iconBg: "#d1fae5", iconColor: "#10b981" },
  { pattern: "force",    iconType: "compress",  iconBg: "#dbeafe", iconColor: "#2563eb" },
  { pattern: "humidity", iconType: "droplet",   iconBg: "#e0f2fe", iconColor: "#0ea5e9" },
  { pattern: "pressure", iconType: "gauge",     iconBg: "#fef3c7", iconColor: "#d97706" },
  { pattern: "toc",      iconType: "flask",     iconBg: "#fce7f3", iconColor: "#db2777" },
];

// ACTIVITY_ICON_PATTERNS and AREA_ICON_CONFIG are computed inside the component (they use T)

const ACTIVITY_NOTE_OVERRIDES = {
  preventive_maintenance_due: (v) => `${v} Due This Week`,
};

const ACTIVITY_LABEL_OVERRIDES = {
  qc_review: "QC Review Meeting",
};

function getIconByPattern(patterns, key, fallback) {
  for (const { pattern, ...icon } of patterns) {
    if (key.includes(pattern)) return icon;
  }
  return fallback;
}

// ─── KPI CARD CONFIG (drives buildKpiCards — add/remove entries here to change the KPI row) ──
const KPI_CONFIG = [
  {
    id: "production", label: "Today's Production", unit: "Units",
    getValue: (t) => fmtUnits(t.totalProduced),
    getDelta: (t) => { const d = t.totalTarget ? ((t.totalProduced - t.totalTarget) / t.totalTarget) * 100 : 0; return { text: `${d >= 0 ? "+" : ""}${d.toFixed(1)}% vs target`, positive: d >= 0 }; },
    getSparkVal: (d) => Math.round(d.totalProduced / 1000),
    iconType: "factory", iconBg: "#ede9fe", iconColor: "#6366f1", gradientA: "#6366f1", gradientB: "#818cf8",
  },
  {
    id: "capacity", label: "Capacity Utilization", unit: null,
    getValue: (t) => `${t.capacityPct.toFixed(1)}%`,
    getDelta: (t, y) => { const d = signedPct(t.capacityPct, y?.capacityPct); return { text: fmtDelta(d, "vs yesterday"), positive: (d ?? 0) >= 0 }; },
    getSparkVal: (d) => Math.round(d.capacityPct),
    iconType: "box", iconBg: "#e0f2fe", iconColor: "#0ea5e9", gradientA: "#0ea5e9", gradientB: "#38bdf8",
  },
  {
    id: "quality", label: "Quality Pass Rate", unit: null,
    getValue: (t) => `${t.qualityPassRate.toFixed(1)}%`,
    getDelta: (t, y) => { const d = signedPct(t.qualityPassRate, y?.qualityPassRate); return { text: fmtDelta(d, "vs yesterday"), positive: (d ?? 0) >= 0 }; },
    getSparkVal: (d) => Math.round(d.qualityPassRate),
    iconType: "shield", iconBg: "#d1fae5", iconColor: "#10b981", gradientA: "#10b981", gradientB: "#34d399",
  },
  {
    id: "batch", label: "Batch Success Rate", unit: null,
    getValue: (t) => `${t.batchSuccessRate.toFixed(1)}%`,
    getDelta: (t, y) => { const d = signedPct(t.batchSuccessRate, y?.batchSuccessRate); return { text: fmtDelta(d, "vs yesterday"), positive: (d ?? 0) >= 0 }; },
    getSparkVal: (d) => Math.round(d.batchSuccessRate),
    iconType: "check", iconBg: "#ede9fe", iconColor: "#8b5cf6", gradientA: "#8b5cf6", gradientB: "#a78bfa",
  },
  {
    id: "delivery", label: "On Time Delivery", unit: null,
    getValue: (t) => `${t.onTimePct.toFixed(1)}%`,
    getDelta: (t, y) => { const d = signedPct(t.onTimePct, y?.onTimePct); return { text: fmtDelta(d, "vs yesterday"), positive: (d ?? 0) >= 0 }; },
    getSparkVal: (d) => Math.round(d.onTimePct),
    iconType: "truck", iconBg: "#fef3c7", iconColor: "#f59e0b", gradientA: "#f59e0b", gradientB: "#fbbf24",
  },
  {
    id: "issues", label: "Open Issues", unit: null,
    getValue: (t) => String(t.openIssues),
    getDelta: () => ({ text: "Requires Attention", positive: false }),
    getSparkVal: (d) => d.openIssues,
    iconType: "alertTri", iconBg: "#fee2e2", iconColor: "#ef4444", gradientA: "#ef4444", gradientB: "#f87171", isAlert: true,
  },
];

function buildKpiCards(today, yesterday, last9) {
  return KPI_CONFIG.map((cfg) => {
    const { text: delta, positive: deltaPositive } = cfg.getDelta(today, yesterday);
    return {
      id: cfg.id, label: cfg.label, unit: cfg.unit ?? null,
      value: cfg.getValue(today),
      delta, deltaPositive,
      sparkData: last9.map(cfg.getSparkVal),
      iconType: cfg.iconType, iconBg: cfg.iconBg, iconColor: cfg.iconColor,
      gradientA: cfg.gradientA, gradientB: cfg.gradientB,
      isAlert: cfg.isAlert ?? false,
    };
  });
}

function buildProductionByArea(areas) {
  const total = Object.values(areas).reduce((s, v) => s + v, 0) || 1;
  return Object.entries(areas).map(([key, value], i) => ({
    name: formatLabel(key),
    value: Math.round((value / total) * 100),
    color: AREA_PALETTE[i % AREA_PALETTE.length],
  }));
}

function buildBatchStatus(batches) {
  const total = batches.total || 1;
  return Object.entries(batches)
    .filter(([key]) => key !== "total")
    .map(([key, value], i) => ({
      name: formatLabel(key),
      value,
      pct: `${Math.round((value / total) * 100)}%`,
      color: BATCH_PALETTE[i % BATCH_PALETTE.length],
    }));
}

function buildCriticalParams(params, paramRanges) {
  return Object.entries(params).map(([col, value]) => {
    const meta = paramRanges?.[col] ?? { label: formatLabel(col), unit: "", min: 0, max: 100 };
    const { iconType, iconBg, iconColor } = getIconByPattern(PARAM_ICON_PATTERNS, col, { iconType: "gauge", iconBg: "var(--bg)", iconColor: "var(--txt2)" });
    const range = meta.max - meta.min || 1;
    return {
      label: meta.label,
      value: fmtParamValue(value),
      unit: meta.unit,
      status: "Normal",
      iconType, iconBg, iconColor,
      gaugePct: Math.min(1, Math.max(0, (value - meta.min) / range)),
    };
  });
}

function buildActivities(activities, T) {
  const ACTIVITY_ICON_PATTERNS = [
    { pattern: "calibration", iconType: "cal",      iconBg: T.blue.light,   iconColor: T.blue.solid   },
    { pattern: "maintenance",  iconType: "wrench",   iconBg: T.green.light,  iconColor: T.green.solid  },
    { pattern: "changeover",   iconType: "swap",     iconBg: T.amber.light,  iconColor: T.amber.solid  },
    { pattern: "qc",           iconType: "calcheck", iconBg: T.purple.light, iconColor: T.purple.solid },
  ];
  return Object.entries(activities).map(([key, value]) => {
    const { iconType, iconBg, iconColor } = getIconByPattern(ACTIVITY_ICON_PATTERNS, key, { iconType: "cal", iconBg: T.blue.light, iconColor: T.blue.solid });
    const baseKey = key.replace(/_due$|_scheduled$|_time$/, "");
    return {
      label: ACTIVITY_LABEL_OVERRIDES[baseKey] ?? formatLabel(baseKey),
      note: formatActivityNote(key, value),
      iconType, iconBg, iconColor,
      urgency: key.includes("_due") ? "high" : "med",
    };
  });
}

function buildInventory(areas, T) {
  const AREA_ICON_CONFIG = [
    { iconType: "droplet", iconBg: T.blue.light,   iconColor: T.blue.solid   },
    { iconType: "gear",    iconBg: T.amber.light,  iconColor: T.amber.solid  },
    { iconType: "box2",    iconBg: T.green.light,  iconColor: T.green.solid  },
    { iconType: "package", iconBg: T.pink.light,   iconColor: T.pink.solid   },
    { iconType: "box",     iconBg: T.purple.light, iconColor: T.purple.solid },
  ];
  const vals = Object.values(areas);
  const maxVal = Math.max(...vals) || 1;
  return Object.entries(areas).map(([key, value], i) => {
    const cfg = AREA_ICON_CONFIG[i % AREA_ICON_CONFIG.length];
    return {
      label: formatLabel(key),
      value: fmtUnits(value),
      unit: "Units",
      iconType: cfg.iconType, iconBg: cfg.iconBg, iconColor: cfg.iconColor,
      bar: value / maxVal,
    };
  });
}

// ─── ICON SYSTEM ──────────────────────────────────────────────────────────────
function Icon({ type, size = 16, color = "currentColor" }) {
  const s = size;
  const props = { width: s, height: s, viewBox: "0 0 24 24", fill: "none", stroke: color, strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" };
  switch (type) {
    case "factory":    return <svg {...props}><path d="M2 20V8l5-3v4l5-3v4l5-3v16H2z"/><rect x="5" y="14" width="3" height="6"/><rect x="10" y="14" width="3" height="6"/></svg>;
    case "box":        return <svg {...props}><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>;
    case "shield":     return <svg {...props}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>;
    case "check":      return <svg {...props}><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><polyline points="9 12 11 14 15 10"/></svg>;
    case "truck":      return <svg {...props}><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>;
    case "alertTri":   return <svg width={s} height={s} viewBox="0 0 24 24" fill={color}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13" stroke="white" strokeWidth="2" strokeLinecap="round"/><circle cx="12" cy="17" r="1" fill="white"/></svg>;
    case "droplet":    return <svg {...props}><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>;
    case "gear":       return <svg {...props}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>;
    case "box2":       return <svg {...props}><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>;
    case "package":    return <svg {...props}><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>;
    case "snowflake":  return <svg {...props}><line x1="12" y1="2" x2="12" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>;
    case "compress":   return <svg {...props}><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="10" y1="14" x2="3" y2="21"/><line x1="21" y1="3" x2="14" y2="10"/></svg>;
    case "gauge":      return <svg {...props}><path d="M12 2a10 10 0 1 0 10 10"/><path d="M12 12l3-4"/><circle cx="12" cy="12" r="1" fill={color}/></svg>;
    case "flask":      return <svg {...props}><path d="M9 3h6"/><path d="M10 3v5L6.5 14A4 4 0 0 0 10 20h4a4 4 0 0 0 3.5-6L14 8V3"/></svg>;
    case "cal":        return <svg {...props}><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>;
    case "wrench":     return <svg {...props}><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>;
    case "swap":       return <svg {...props}><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>;
    case "calcheck":   return <svg {...props}><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><polyline points="9 16 11 18 15 14"/></svg>;
    default:           return null;
  }
}

// ─── SPARKLINE ────────────────────────────────────────────────────────────────
function Sparkline({ data, color, filled }) {
  const w = 80, h = 34;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((p, i) => ({
    x: (i / (data.length - 1)) * w,
    y: h - 4 - ((p - min) / range) * (h - 8),
  }));
  const polyPts = pts.map(p => `${p.x},${p.y}`).join(" ");
  const areaPath = `M${pts[0].x},${h} ` + pts.map(p => `L${p.x},${p.y}`).join(" ") + ` L${pts[pts.length-1].x},${h} Z`;
  return (
    <svg width={w} height={h} style={{ flexShrink: 0, overflow: "visible" }}>
      {filled && <path d={areaPath} fill={color} opacity="0.12" />}
      <polyline points={polyPts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[pts.length-1].x} cy={pts[pts.length-1].y} r="3" fill={color} />
    </svg>
  );
}

// ─── DONUT (interactive: hover segments to highlight + update center) ──────────
function Donut({ data, total, centerText, centerSub, size = 150, thickness = 18 }) {
  const [hovered, setHovered] = useState(null);
  const r = (size / 2) - thickness;
  const cx = size / 2, cy = size / 2;
  const circ = 2 * Math.PI * r;
  let cum = 0;
  const slices = data.map(d => {
    const pct = d.value / total;
    const s = { ...d, pct, offset: cum };
    cum += pct;
    return s;
  });

  const displayText = hovered !== null ? (data[hovered].pct ?? `${data[hovered].value}`) : centerText;
  const displaySub  = hovered !== null ? data[hovered].name : centerSub;

  return (
    <svg width={size} height={size} style={{ cursor: "pointer" }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#eef0f5" strokeWidth={thickness} />
      {slices.map((s, i) => {
        const isHov = hovered === i;
        const thick = isHov ? thickness + 4 : thickness;
        const dim   = hovered !== null && !isHov;
        return (
          <circle
            key={i} cx={cx} cy={cy} r={r} fill="none"
            stroke={s.color}
            strokeWidth={thick}
            strokeDasharray={`${s.pct * circ} ${circ}`}
            strokeDashoffset={-s.offset * circ}
            transform={`rotate(-90 ${cx} ${cy})`}
            strokeLinecap="butt"
            opacity={dim ? 0.3 : 1}
            style={{ transition: "all 0.18s ease", cursor: "pointer" }}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
          />
        );
      })}
      <text x={cx} y={cy - 7} textAnchor="middle" fontSize="15" fontWeight="700" fontFamily="Inter, system-ui, sans-serif"
        style={{ fill: 'var(--txt)', transition: "all 0.15s" }}>
        {displayText}
      </text>
      <text x={cx} y={cy + 10} textAnchor="middle" fontSize="10" fill={hovered !== null ? slices[hovered]?.color : undefined}
        fontFamily="Inter, system-ui, sans-serif"
        style={{ fill: hovered !== null ? slices[hovered]?.color : 'var(--txt3)', transition: "all 0.15s" }}>
        {displaySub}
      </text>
    </svg>
  );
}

// ─── RESPONSIVE CSS ───────────────────────────────────────────────────────────
const DASHBOARD_CSS = `
  .pd-content { padding: 12px 14px 25px; display: flex; flex-direction: column; gap: 12px; flex: 1; min-height: 0; overflow-y: auto; }
  @media (min-width: 768px) { .pd-content { padding: 16px 24px 25px; gap: 14px; } }

  /* KPI row — 2 cols mobile, 3 on sm, 6 on lg */
  .pd-grid-kpi { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
  @media (min-width: 540px)  { .pd-grid-kpi { grid-template-columns: repeat(3, 1fr); } }
  @media (min-width: 1024px) { .pd-grid-kpi { grid-template-columns: repeat(6, 1fr); gap: 10px; } }

  /* Row 2: donuts + shift bar + area output (4 cols on desktop) */
  .pd-grid-row2 { display: grid; grid-template-columns: 1fr; gap: 10px; }
  @media (min-width: 640px)  { .pd-grid-row2 { grid-template-columns: 1fr 1fr; } }
  @media (min-width: 1024px) { .pd-grid-row2 { grid-template-columns: 1fr 1fr 2fr 1.5fr; gap: 10px; } }
  @media (min-width: 640px) and (max-width: 1023px) { .pd-row2-shift { grid-column: span 2; } }

  /* Row 3: machine parameters + production quality + activities */
  .pd-grid-row3 { display: grid; grid-template-columns: 1fr; gap: 10px; align-items: start; }
  @media (min-width: 768px)  { .pd-grid-row3 { grid-template-columns: 1fr 1fr; } }
  @media (min-width: 1024px) { .pd-grid-row3 { grid-template-columns: 2fr 1.3fr 1fr; gap: 10px; } }

  /* Critical params inner grid */
  .pd-grid-params { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
  @media (min-width: 480px)  { .pd-grid-params { grid-template-columns: repeat(3, 1fr); } }
  @media (min-width: 1280px) { .pd-grid-params { grid-template-columns: repeat(6, 1fr); gap: 10px; } }

  /* KPI card value */
  .pd-kpi-value { font-size: 22px; }
  @media (min-width: 480px) { .pd-kpi-value { font-size: 26px; } }

  /* Sparkline: always shown — placed below value so it never crowds the label */
  .pd-sparkline-wrap { display: flex; margin-bottom: 6px; }

  /* Live badge */
  .pd-live-text { display: none; }
  @media (min-width: 480px) { .pd-live-text { display: inline; } }

  /* Pharma header title */
  .pd-header-title { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px; }
  @media (min-width: 480px) { .pd-header-title { font-size: 15px; max-width: none; } }
`;

// ─── CARD SHELL (hover lift) ───────────────────────────────────────────────────
function Card({ children, style = {}, alert, className = "" }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      className={className}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: 'var(--surf)',
        border: `1px solid ${alert ? 'rgba(251,146,60,0.5)' : hov ? 'var(--brd2)' : 'var(--brd)'}`,
        borderRadius: 12,
        boxShadow: hov
          ? "0 8px 28px rgba(0,0,0,0.15), 0 2px 6px rgba(0,0,0,0.08)"
          : "0 1px 3px rgba(0,0,0,0.06)",
        transform: hov ? "translateY(-2px)" : "translateY(0)",
        transition: "all 0.2s ease",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ─── SECTION TITLE ────────────────────────────────────────────────────────────
function SectionTitle({ children, action }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--txt)', letterSpacing: "0.01em" }}>{children}</span>
      {action && <span style={{ fontSize: 11, color: "#3b82f6", fontWeight: 600, cursor: "pointer" }}>{action}</span>}
    </div>
  );
}

// ─── RECHARTS TOOLTIP ─────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: 'var(--surf)', border: '1px solid var(--brd)', borderRadius: 8, padding: "8px 12px", fontSize: 12, boxShadow: "0 4px 16px rgba(0,0,0,0.15)" }}>
      <div style={{ fontWeight: 700, color: 'var(--txt)', marginBottom: 5 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, color: 'var(--txt2)', marginBottom: 2 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: p.fill, display: "inline-block" }} />
          {p.name}: <b style={{ color: 'var(--txt)', marginLeft: 2 }}>{p.value}</b>
        </div>
      ))}
    </div>
  );
}

// ─── SHIFT BAR CHART (Recharts — produced vs target per shift) ───────────────
function ShiftBarChart({ data }) {
  const maxVal = data.length ? Math.max(...data.flatMap((d) => [d.produced, d.target])) : 500;
  const yMax = Math.ceil(maxVal / 50) * 50;
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} barCategoryGap="22%" barGap={3} margin={{ top: 4, right: 8, left: -12, bottom: 40 }}>
        <XAxis
          dataKey="shift"
          interval={0}
          tick={{ fontSize: 10, fill: 'var(--txt3)', fontFamily: "Inter, system-ui, sans-serif", angle: -30, textAnchor: "end", dy: 6 }}
          axisLine={false}
          tickLine={false}
          height={55}
        />
        <YAxis
          domain={[0, yMax]}
          tick={{ fontSize: 10, fill: 'var(--txt3)', fontFamily: "Inter, system-ui, sans-serif" }}
          tickFormatter={(v) => `${v}K`}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(0,0,0,0.04)", radius: [4, 4, 0, 0] }} />
        <Legend
          iconType="square"
          iconSize={9}
          wrapperStyle={{ fontSize: 11, fontFamily: "Inter, system-ui, sans-serif", paddingTop: 4 }}
        />
        <Bar dataKey="produced" name="Produced (K)" fill="#16a34a" radius={[4, 4, 0, 0]} />
        <Bar dataKey="target"   name="Target (K)"   fill="#94a3b8" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── PARAM GAUGE ARC ─────────────────────────────────────────────────────────
function ParamGauge({ pct, color }) {
  const r = 22, cx = 32, cy = 30, stroke = 5;
  const startAngle = -200, sweepDeg = 220;
  const toRad = (d) => (d * Math.PI) / 180;
  const arc = (angle) => {
    const rad = toRad(angle);
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  };
  const s = arc(startAngle);
  const eAll = arc(startAngle + sweepDeg);
  const eFill = arc(startAngle + sweepDeg * pct);
  const lg = sweepDeg > 180 ? 1 : 0;
  const lgFill = sweepDeg * pct > 180 ? 1 : 0;
  return (
    <svg width={64} height={38} style={{ marginBottom: 4, overflow: "visible" }}>
      <path d={`M ${s.x} ${s.y} A ${r} ${r} 0 ${lg} 1 ${eAll.x} ${eAll.y}`}
        fill="none" stroke="#eef0f5" strokeWidth={stroke} strokeLinecap="round" />
      {pct > 0 && (
        <path d={`M ${s.x} ${s.y} A ${r} ${r} 0 ${lgFill} 1 ${eFill.x} ${eFill.y}`}
          fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" opacity="0.85" />
      )}
      <circle cx={eFill.x} cy={eFill.y} r="3" fill={color} />
    </svg>
  );
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
export default function PharmaPlantDashboard() {
  const { theme } = useThemeStore();
  const T = getThemeTokens(theme === 'dark');

  const { data, loading: prodLoading, error: prodError } = useProductionData();
  const { data: qData, loading: qualLoading } = useQualityData();

  const loading = prodLoading || qualLoading;

  const ALERT_PALETTE = [
    { color: T.red.text,    bg: T.red.light,    fill: "#dc2626" },
    { color: T.amber.text,  bg: T.amber.light,  fill: "#d97706" },
    { color: T.blue.text,   bg: T.blue.light,   fill: "#2563eb" },
    { color: T.purple.text, bg: T.purple.light, fill: "#7c3aed" },
    { color: T.green.text,  bg: T.green.light,  fill: "#16a34a" },
  ];

  const derived = useMemo(() => {
    if (!data?.today) return null;
    const { today: prodToday, yesterday: prodYesterday, last9: prodLast9, shiftData, paramRanges } = data;

    // Merge real quality pass rate from quality CSV (falls back to batch-derived value if not loaded yet)
    const mergeQuality = (prod, qual) =>
      qual ? { ...prod, qualityPassRate: qual.qualityPassRate } : prod;

    const today = mergeQuality(prodToday, qData?.today);
    const yesterday = prodYesterday ? mergeQuality(prodYesterday, qData?.yesterday) : null;
    const last9 = prodLast9.map((d, i) => mergeQuality(d, qData?.last9?.[i]));

    return {
      kpiCards: buildKpiCards(today, yesterday, last9),
      productionByArea: buildProductionByArea(today.areas),
      batchStatus: buildBatchStatus(today.batches),
      criticalParams: buildCriticalParams(today.params, paramRanges),
      activities: buildActivities(today.activities, T),
      inventoryData: buildInventory(today.areas, T),
      shiftChartData: shiftData ?? [],
      alerts: Object.entries(today.alerts).map(([key, count], i) => ({
        label: formatLabel(key),
        count,
        ...ALERT_PALETTE[i % ALERT_PALETTE.length],
      })),
      totalProduced: fmtUnits(today.totalProduced),
      batchTotal: today.batches.total,
      qualityMetrics: qData?.today ?? null,
      qualityLast9: (qData?.last9 ?? []).map((d) => Math.round(d.qualityPassRate)),
    };
  }, [data, qData, theme]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div style={{ fontFamily: "Inter, system-ui, sans-serif", background: 'var(--bg)', minHeight: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: 'var(--txt3)', fontSize: 14 }}>
        Loading dashboard data…
      </div>
    );
  }

  if (prodError || !derived) {
    return (
      <div style={{ fontFamily: "Inter, system-ui, sans-serif", background: 'var(--bg)', minHeight: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: T.red.text, fontSize: 14 }}>
        Failed to load data: {prodError}
      </div>
    );
  }

  const { kpiCards, productionByArea, batchStatus, criticalParams, activities, inventoryData, shiftChartData, alerts, totalProduced, batchTotal, qualityMetrics, qualityLast9 } = derived;

  return (
    <div style={{ fontFamily: "Inter, system-ui, -apple-system, sans-serif", background: 'var(--bg)', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <style>{DASHBOARD_CSS}</style>

      {/* ── STICKY HEADER ──────────────────────────────────────────────────── */}
      <div style={{
        position: "sticky", top: 0, zIndex: 20,
        background: 'var(--surf)', borderBottom: '1px solid var(--brd)',
        padding: "0 16px", display: "flex", alignItems: "center",
        justifyContent: "space-between", height: 52, flexShrink: 0,
        boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <div style={{ width: 32, height: 32, flexShrink: 0, borderRadius: 8, background: T.blue.light, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={T.blue.solid} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/>
              <path d="M8.5 8.5 16 16"/>
            </svg>
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="pd-header-title" style={{ fontWeight: 800, color: 'var(--txt)', letterSpacing: "-0.01em" }}>Pharma Manufacturing Plant</div>
            <div style={{ fontSize: 10.5, color: 'var(--txt3)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Operations Overview · {data.latestDate}</div>
          </div>
        </div>

      </div>

      <div className="pd-content">

        {/* ── ROW 1: KPI CARDS ───────────────────────────────────────────────── */}
        <div className="pd-grid-kpi">
          {kpiCards.map((k) => (
            <Card key={k.id} alert={k.isAlert} style={{ padding: "13px 14px 12px", display: "flex", flexDirection: "column", gap: 0, position: "relative", overflow: "hidden", cursor: "pointer" }}>
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, borderRadius: "12px 12px 0 0", background: k.gradientA }} />
              {/* Label row — icon sits right, label gets all remaining width */}
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginTop: 4, marginBottom: 8, gap: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--txt2)', fontWeight: 500, lineHeight: 1.35, flex: 1, minWidth: 0 }}>{k.label}</span>
                <div style={{ width: 26, height: 26, borderRadius: 7, background: k.iconBg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Icon type={k.iconType} size={13} color={k.iconColor} />
                </div>
              </div>
              {/* Value row */}
              <div style={{ marginBottom: 6 }}>
                <span className="pd-kpi-value" style={{ fontWeight: 800, color: 'var(--txt)', letterSpacing: "-0.03em" }}>{k.value}</span>
                {k.unit && <span style={{ fontSize: 11, color: 'var(--txt3)', marginLeft: 4, fontWeight: 500 }}>{k.unit}</span>}
              </div>
              {/* Sparkline — below value, no longer competing with label */}
              <div className="pd-sparkline-wrap"><Sparkline data={k.sparkData} color={k.gradientA} filled /></div>
              <div style={{ height: 1, background: 'var(--brd)', marginBottom: 8 }} />
              <div style={{ fontSize: 11, color: k.deltaPositive ? T.green.text : T.orange.text, fontWeight: 600, display: "flex", alignItems: "center", gap: 3, overflow: "hidden" }}>
                <span style={{ fontSize: 13, flexShrink: 0 }}>{k.deltaPositive ? "↑" : "⚠"}</span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{k.delta}</span>
              </div>
            </Card>
          ))}
        </div>

        {/* ── ROW 2: Donuts + Shift Bar + Area Output ─────────────────────────── */}
        <div className="pd-grid-row2">

          {/* Production by Area */}
          <Card style={{ padding: "16px 18px" }}>
            <SectionTitle>Production by Area</SectionTitle>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
              <Donut data={productionByArea} total={100} centerText={totalProduced} centerSub="Units" size={148} thickness={19} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {productionByArea.map((d) => (
                <DonutLegendRow key={d.name} d={d} />
              ))}
            </div>
          </Card>

          {/* Batch Status */}
          <Card style={{ padding: "16px 18px" }}>
            <SectionTitle>Batch Status</SectionTitle>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
              <Donut data={batchStatus} total={batchTotal} centerText={batchTotal} centerSub="Total Batches" size={148} thickness={19} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {batchStatus.map((d) => (
                <BatchLegendRow key={d.name} d={d} />
              ))}
            </div>
          </Card>

          {/* Shift Performance — spans 2 cols on tablet */}
          <Card className="pd-row2-shift" style={{ padding: "16px 18px" }}>
            <SectionTitle>Shift Performance</SectionTitle>
            <ShiftBarChart data={shiftChartData} />
          </Card>

          {/* Area Output Today */}
          <Card style={{ padding: "16px 18px" }}>
            <SectionTitle>Area Output Today</SectionTitle>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {inventoryData.map((inv) => (
                <InventoryRow key={inv.label} inv={inv} />
              ))}
            </div>
          </Card>

        </div>

        {/* ── ROW 3: Critical Machine Parameters (left) + Upcoming Activities (right) ── */}
        <div className="pd-grid-row3">

          {/* Left: Critical Machine Parameters */}
          <Card style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "11px 16px", borderBottom: '1px solid var(--brd)', display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--txt)', letterSpacing: "0.01em" }}>Critical Machine Parameters</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)" }}>
              {criticalParams.map((p, i) => {
                const total = criticalParams.length;
                const isOdd = total % 2 !== 0;
                const isLastItem = i === total - 1;
                const isRightCol = i % 2 !== 0;
                const isBottomRow = isOdd ? isLastItem : i >= total - 2;
                return (
                  <div
                    key={p.label}
                    style={{
                      padding: "13px 15px",
                      borderRight: !isRightCol ? '1px solid var(--brd)' : "none",
                      borderBottom: isBottomRow ? "none" : '1px solid var(--brd)',
                      gridColumn: isOdd && isLastItem ? "span 2" : undefined,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{ width: 22, height: 22, borderRadius: 6, background: p.iconBg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <Icon type={p.iconType} size={11} color={p.iconColor} />
                        </div>
                        <span style={{ fontSize: 10.5, color: 'var(--txt2)', fontWeight: 500 }}>{p.label}</span>
                      </div>
                      <span style={{ fontSize: 9, fontWeight: 700, color: T.green.text, background: T.green.light, padding: "1px 5px", borderRadius: 4 }}>Normal</span>
                    </div>
                    <div style={{ marginBottom: 7 }}>
                      <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--txt)', letterSpacing: "-0.02em" }}>{p.value}</span>
                      {p.unit && <span style={{ fontSize: 11, color: 'var(--txt3)', marginLeft: 3 }}>{p.unit}</span>}
                    </div>
                    <div style={{ height: 4, borderRadius: 4, background: "rgba(128,128,128,0.15)", overflow: "hidden" }}>
                      <div style={{ width: `${p.gaugePct * 100}%`, height: "100%", background: p.iconColor, borderRadius: 4, transition: "width 0.4s" }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Middle: Production Quality — quality data that directly reflects production */}
          {qualityMetrics && (
            <Card style={{ padding: "16px 18px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <SectionTitle style={{ margin: 0 }}>Production Quality</SectionTitle>
                <span style={{ fontSize: 9.5, fontWeight: 600, color: T.blue.text, background: T.blue.light, padding: "2px 7px", borderRadius: 8 }}>Today</span>
              </div>

              {/* Batch Pass Rate */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}>
                  <span style={{ fontSize: 10.5, color: 'var(--txt2)', fontWeight: 500 }}>Batch Pass Rate</span>
                  <span style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.02em", color: qualityMetrics.qualityPassRate >= 90 ? T.green.text : qualityMetrics.qualityPassRate >= 75 ? T.amber.text : T.red.text }}>
                    {qualityMetrics.qualityPassRate.toFixed(1)}%
                  </span>
                </div>
                <div style={{ height: 5, borderRadius: 5, background: "rgba(128,128,128,0.13)", overflow: "hidden" }}>
                  <div style={{ width: `${qualityMetrics.qualityPassRate}%`, height: "100%", borderRadius: 5, background: qualityMetrics.qualityPassRate >= 90 ? T.green.solid : qualityMetrics.qualityPassRate >= 75 ? T.amber.solid : T.red.solid, transition: "width 0.4s" }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                  <span style={{ fontSize: 10, color: T.green.text, fontWeight: 600 }}>✓ {qualityMetrics.passCount} passed</span>
                  <span style={{ fontSize: 10, color: T.red.text, fontWeight: 600 }}>✗ {qualityMetrics.failCount} failed</span>
                </div>
              </div>

              <div style={{ height: 1, background: 'var(--brd)', marginBottom: 12 }} />

              {/* Process Deviations */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 7 }}>
                  <Icon type="alertTri" size={11} color={T.amber.solid} />
                  <span style={{ fontSize: 10.5, color: 'var(--txt2)', fontWeight: 500 }}>Process Deviations</span>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {[
                    { label: "Critical", count: qualityMetrics.deviationCritical, bg: T.red.light,   text: T.red.text   },
                    { label: "Major",    count: qualityMetrics.deviationMajor,    bg: T.amber.light, text: T.amber.text },
                    { label: "Minor",    count: qualityMetrics.deviationMinor,    bg: T.blue.light,  text: T.blue.text  },
                  ].map(({ label, count, bg, text }) => (
                    <div key={label} style={{ flex: 1, background: bg, borderRadius: 8, padding: "6px 4px", textAlign: "center" }}>
                      <div style={{ fontSize: 16, fontWeight: 800, color: text }}>{count}</div>
                      <div style={{ fontSize: 9, color: text, fontWeight: 600 }}>{label}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ height: 1, background: 'var(--brd)', marginBottom: 12 }} />

              {/* Open NCRs + Inspected count */}
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ flex: 1, padding: "8px 10px", borderRadius: 8, background: qualityMetrics.openNcrs > 0 ? T.red.light : T.green.light, border: `1px solid ${qualityMetrics.openNcrs > 0 ? T.red.text : T.green.text}22` }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: qualityMetrics.openNcrs > 0 ? T.red.text : T.green.text }}>{qualityMetrics.openNcrs}</div>
                  <div style={{ fontSize: 9.5, fontWeight: 500, color: qualityMetrics.openNcrs > 0 ? T.red.text : T.green.text }}>Open NCRs</div>
                </div>
                <div style={{ flex: 1, padding: "8px 10px", borderRadius: 8, background: T.blue.light, border: `1px solid ${T.blue.text}22` }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: T.blue.text }}>{qualityMetrics.totalInspected}</div>
                  <div style={{ fontSize: 9.5, fontWeight: 500, color: T.blue.text }}>Inspected Today</div>
                </div>
              </div>
            </Card>
          )}

          {/* Right: Upcoming Activities */}
          <Card style={{ padding: "16px 18px" }}>
            <SectionTitle>Upcoming Activities</SectionTitle>
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {activities.map((a, i) => (
                <ActivityRow key={a.label} a={a} last={i === activities.length - 1} />
              ))}
            </div>
          </Card>

        </div>
      </div>
    </div>
  );
}

// ─── SUB-ROW COMPONENTS (each has its own hover state) ───────────────────────

function DonutLegendRow({ d }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "3px 6px", borderRadius: 6, cursor: "default",
        background: hov ? `${d.color}12` : "transparent",
        transition: "background 0.15s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7, flex: 1, minWidth: 0 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: d.color, display: "inline-block", flexShrink: 0 }} />
        <span style={{ fontSize: 11, color: 'var(--txt2)', overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
        <div style={{ width: 36, height: 4, borderRadius: 4, background: "rgba(128,128,128,0.15)", overflow: "hidden" }}>
          <div style={{ width: `${d.value * 3}%`, height: "100%", background: d.color, borderRadius: 4, transition: "width 0.3s" }} />
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--txt)', minWidth: 26, textAlign: "right" }}>{d.value}%</span>
      </div>
    </div>
  );
}

function BatchLegendRow({ d }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "3px 6px", borderRadius: 6, cursor: "default",
        background: hov ? `${d.color}12` : "transparent",
        transition: "background 0.15s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7, flex: 1, minWidth: 0 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: d.color, display: "inline-block", flexShrink: 0 }} />
        <span style={{ fontSize: 11, color: 'var(--txt2)', overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--txt)' }}>{d.value}</span>
        <span style={{ fontSize: 10, color: 'var(--txt3)', background: hov ? `${d.color}20` : 'var(--bg)', padding: "1px 5px", borderRadius: 4, transition: "background 0.15s" }}>{d.pct}</span>
      </div>
    </div>
  );
}

function InventoryRow({ inv }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        padding: "6px 8px", borderRadius: 8, cursor: "default",
        background: hov ? `${inv.iconColor}0a` : "transparent",
        border: `1px solid ${hov ? `${inv.iconColor}25` : "transparent"}`,
        transition: "all 0.15s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5, gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
          <div style={{ width: 28, height: 28, borderRadius: 7, background: inv.iconBg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transform: hov ? "scale(1.1)" : "scale(1)", transition: "transform 0.15s" }}>
            <Icon type={inv.iconType} size={13} color={inv.iconColor} />
          </div>
          <span style={{ fontSize: 11.5, color: 'var(--txt2)', overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{inv.label}</span>
        </div>
        <div style={{ flexShrink: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--txt)' }}>{inv.value}</span>
          <span style={{ fontSize: 10, color: 'var(--txt3)', marginLeft: 3 }}>{inv.unit}</span>
        </div>
      </div>
      <div style={{ height: 4, borderRadius: 4, background: "rgba(128,128,128,0.15)", overflow: "hidden" }}>
        <div style={{ width: `${inv.bar * 100}%`, height: "100%", background: inv.iconColor, borderRadius: 4, opacity: hov ? 1 : 0.7, transition: "all 0.3s" }} />
      </div>
    </div>
  );
}

function ActivityRow({ a, last }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "9px 6px",
        borderBottom: last ? "none" : '1px solid var(--brd)',
        borderRadius: 8,
        background: hov ? `${a.iconColor}08` : "transparent",
        cursor: "pointer",
        transition: "background 0.15s",
      }}
    >
      <div style={{ width: 30, height: 30, borderRadius: 8, background: a.iconBg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transform: hov ? "scale(1.08)" : "scale(1)", transition: "transform 0.15s" }}>
        <Icon type={a.iconType} size={14} color={a.iconColor} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--txt)', marginBottom: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.label}</div>
        <div style={{ fontSize: 10.5, color: a.iconColor, fontWeight: 600 }}>{a.note}</div>
      </div>
      {hov && <span style={{ fontSize: 10, color: a.iconColor, fontWeight: 700, flexShrink: 0 }}>→</span>}
    </div>
  );
}

function ParamCard({ p }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: hov
          ? `linear-gradient(160deg, ${p.iconBg}99 0%, #f8f9ff 60%)`
          : `linear-gradient(160deg, ${p.iconBg}55 0%, #ffffff 60%)`,
        border: `1px solid ${hov ? `${p.iconColor}50` : `${p.iconColor}30`}`,
        borderRadius: 12,
        padding: "14px 12px 12px",
        display: "flex", flexDirection: "column", alignItems: "center", gap: 0,
        position: "relative", overflow: "hidden",
        transform: hov ? "translateY(-2px)" : "translateY(0)",
        boxShadow: hov ? `0 6px 20px ${p.iconColor}25` : "none",
        transition: "all 0.2s ease",
        cursor: "default",
      }}
    >
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, borderRadius: "12px 0 0 12px", background: p.iconColor }} />
      <ParamGauge color={p.iconColor} pct={p.gaugePct} />
      <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 6, width: "100%" }}>
        <div style={{ width: 22, height: 22, borderRadius: 5, background: p.iconBg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Icon type={p.iconType} size={11} color={p.iconColor} />
        </div>
        <span style={{ fontSize: 9.5, color: 'var(--txt3)', lineHeight: 1.3, fontWeight: 500 }}>{p.label}</span>
      </div>
      <div style={{ width: "100%", marginBottom: 8 }}>
        <span style={{ fontSize: 22, fontWeight: 800, color: 'var(--txt)', letterSpacing: "-0.02em" }}>{p.value}</span>
        <span style={{ fontSize: 10, color: 'var(--txt3)', marginLeft: 2 }}>{p.unit}</span>
      </div>
      <div style={{ width: "100%", display: "flex", alignItems: "center", gap: 4, background: p.iconBg, borderRadius: 6, padding: "3px 7px" }}>
        <span style={{ width: 5, height: 5, borderRadius: "50%", background: p.iconColor, display: "inline-block", flexShrink: 0 }} />
        <span style={{ fontSize: 10, color: p.iconColor, fontWeight: 700 }}>{p.status}</span>
      </div>
    </div>
  );
}

function AlertRow({ a }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: hov ? `${a.fill}22` : a.bg,
        borderRadius: 8, padding: "9px 12px",
        border: `1px solid ${hov ? `${a.fill}40` : "transparent"}`,
        cursor: "pointer",
        transform: hov ? "translateX(2px)" : "translateX(0)",
        transition: "all 0.15s ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill={a.fill}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13" stroke="white" strokeWidth="2" strokeLinecap="round"/><circle cx="12" cy="17" r="1" fill="white"/></svg>
        <span style={{ fontSize: 12, fontWeight: 600, color: a.color }}>{a.label}</span>
      </div>
      <span style={{ fontSize: 18, fontWeight: 800, color: a.fill }}>{a.count}</span>
    </div>
  );
}
