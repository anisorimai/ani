import React, { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

const T = {
  bg: '#f0f2f7', surface: '#ffffff', border: '#e8eaf0',
  text: { primary: '#0f1117', secondary: '#5a6072', muted: '#9da3b4' },
  green:  { solid: '#16a34a', light: '#dcfce7', text: '#15803d' },
  blue:   { solid: '#2563eb', light: '#dbeafe', text: '#1d4ed8' },
  amber:  { solid: '#d97706', light: '#fef3c7', text: '#b45309' },
  red:    { solid: '#dc2626', light: '#fee2e2', text: '#b91c1c' },
  purple: { solid: '#7c3aed', light: '#ede9fe', text: '#6d28d9' },
  teal:   { solid: '#0d9488', light: '#ccfbf1', text: '#0f766e' },
};

const KPI_CARDS = [
  { label: 'Inspection Pass Rate', value: '98.6%', delta: '+1.3% vs yesterday', pos: true,  spark: [96,97,96,98,97,99,98,98,99], color: T.green.solid,  bg: T.green.light  },
  { label: 'Open NCRs',            value: '7',     delta: '-2 vs last week',    pos: true,  spark: [12,10,9,8,9,7,8,7,7],        color: T.amber.solid,  bg: T.amber.light  },
  { label: 'CAPA Pending',         value: '3',     delta: '1 critical, 2 major',pos: false, spark: [6,5,5,4,4,3,4,3,3],          color: T.red.solid,    bg: T.red.light    },
  { label: 'Audit Score',          value: '96%',   delta: '+2% vs last audit',  pos: true,  spark: [88,90,91,93,92,94,95,95,96],  color: T.blue.solid,   bg: T.blue.light   },
];

const DEVIATION_SEVERITY = [
  { label: 'Critical', count: 1, pct: 6,  color: T.red.solid,    bg: T.red.light    },
  { label: 'Major',    count: 3, pct: 19, color: T.amber.solid,  bg: T.amber.light  },
  { label: 'Minor',    count: 12,pct: 75, color: T.green.solid,  bg: T.green.light  },
];

const TREND_DATA = [
  { day: 'Mon', pass: 97.2, fail: 2.8 },
  { day: 'Tue', pass: 98.1, fail: 1.9 },
  { day: 'Wed', pass: 97.8, fail: 2.2 },
  { day: 'Thu', pass: 98.4, fail: 1.6 },
  { day: 'Fri', pass: 98.6, fail: 1.4 },
  { day: 'Sat', pass: 99.1, fail: 0.9 },
  { day: 'Sun', pass: 98.6, fail: 1.4 },
];

const RECENT_INSPECTIONS = [
  { batch: 'BTC-20240622-001', product: 'Amoxicillin 500mg',  type: 'In-Process',   score: 99,  result: 'Pass',   color: T.green.solid,  bg: T.green.light  },
  { batch: 'BTC-20240622-002', product: 'Ibuprofen 400mg',    type: 'Final Release', score: 98,  result: 'Pass',   color: T.green.solid,  bg: T.green.light  },
  { batch: 'BTC-20240622-003', product: 'Paracetamol 650mg',  type: 'In-Process',   score: 94,  result: 'Cond.Pass', color: T.amber.solid, bg: T.amber.light },
  { batch: 'BTC-20240622-004', product: 'Metformin 1g',        type: 'Stability',    score: 97,  result: 'Pass',   color: T.green.solid,  bg: T.green.light  },
  { batch: 'BTC-20240621-007', product: 'Cetirizine 10mg',    type: 'Final Release', score: 82,  result: 'Fail',   color: T.red.solid,    bg: T.red.light    },
];

const UPCOMING_AUDITS = [
  { title: 'Internal GMP Audit',    date: 'Jun 25, 2024', dept: 'Manufacturing',   urgency: 'high',   color: T.red.solid,   bg: T.red.light   },
  { title: 'Supplier Qualification',date: 'Jun 27, 2024', dept: 'Procurement',     urgency: 'medium', color: T.amber.solid, bg: T.amber.light },
  { title: 'Annual Regulatory Audit',date:'Jul 10, 2024', dept: 'QA Department',   urgency: 'low',    color: T.blue.solid,  bg: T.blue.light  },
];

function Sparkline({ data, color }) {
  const w = 64, h = 28;
  const min = Math.min(...data), max = Math.max(...data), range = max - min || 1;
  const pts = data.map((p, i) => ({ x: (i / (data.length - 1)) * w, y: h - 4 - ((p - min) / range) * (h - 8) }));
  return (
    <svg width={w} height={h} style={{ overflow: 'visible', flexShrink: 0 }}>
      <polyline points={pts.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[pts.length-1].x} cy={pts[pts.length-1].y} r="3" fill={color} />
    </svg>
  );
}

function Card({ children, style = {} }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ background: T.surface, borderRadius: 12, border: `1px solid ${hov ? '#c8ccd8' : T.border}`, boxShadow: hov ? '0 8px 28px rgba(0,0,0,0.10)' : '0 1px 3px rgba(0,0,0,0.04)', transform: hov ? 'translateY(-2px)' : 'none', transition: 'all 0.2s ease', ...style }}
    >
      {children}
    </div>
  );
}

function SectionTitle({ children, action }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: T.text.primary }}>{children}</span>
      {action && <span style={{ fontSize: 11, color: T.blue.text, fontWeight: 600, cursor: 'pointer' }}>{action}</span>}
    </div>
  );
}

function ChartTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#fff', border: `1px solid ${T.border}`, borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
      <div style={{ fontWeight: 700, color: T.text.primary, marginBottom: 4 }}>{label}</div>
      {payload.map((p, i) => <div key={i} style={{ color: p.fill }}>{p.name}: {p.value}%</div>)}
    </div>
  );
}

const CSS = `
  .qlt-kpi  { display:grid; grid-template-columns:repeat(2,1fr); gap:10px }
  @media(min-width:1024px){ .qlt-kpi { grid-template-columns:repeat(4,1fr) } }
  .qlt-main { display:grid; grid-template-columns:1fr; gap:12px }
  @media(min-width:768px) { .qlt-main { grid-template-columns:1fr 1fr } }
  @media(min-width:1280px){ .qlt-main { grid-template-columns:1fr 1.8fr 1.3fr } }
  .qlt-kpi-val { font-size:22px }
  @media(min-width:480px){ .qlt-kpi-val { font-size:26px } }
`;

export default function QualityDashboard() {
  const total = DEVIATION_SEVERITY.reduce((s, d) => s + d.count, 0);

  return (
    <div style={{ fontFamily: 'Inter, system-ui, sans-serif', background: T.bg, minHeight: '100%' }}>
      <style>{CSS}</style>

      {/* Header */}
      <div style={{ position: 'sticky', top: 0, zIndex: 20, background: '#fff', borderBottom: `1px solid ${T.border}`, padding: '0 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 52, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: T.green.light, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={T.green.solid} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: T.text.primary }}>Quality Assurance</div>
            <div style={{ fontSize: 10.5, color: T.text.muted }}>QC & Compliance Dashboard</div>
          </div>
        </div>
        <div style={{ fontSize: 10.5, color: T.green.text, background: T.green.light, padding: '4px 10px', borderRadius: 20, fontWeight: 600 }}>● Live</div>
      </div>

      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* KPI row */}
        <div className="qlt-kpi">
          {KPI_CARDS.map((k) => (
            <Card key={k.label} style={{ padding: '14px 16px 12px', position: 'relative', overflow: 'hidden', cursor: 'pointer' }}>
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: k.color, borderRadius: '12px 12px 0 0' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: 4, marginBottom: 10 }}>
                <span style={{ fontSize: 11, color: T.text.secondary, fontWeight: 500, maxWidth: '55%', lineHeight: 1.4 }}>{k.label}</span>
                <Sparkline data={k.spark} color={k.color} />
              </div>
              <div style={{ marginBottom: 8 }}>
                <span className="qlt-kpi-val" style={{ fontWeight: 800, color: T.text.primary, letterSpacing: '-0.03em' }}>{k.value}</span>
              </div>
              <div style={{ height: 1, background: T.border, marginBottom: 8 }} />
              <div style={{ fontSize: 11, color: k.pos ? T.green.text : T.red.text, fontWeight: 600 }}>
                {k.pos ? '↑' : '⚠'} {k.delta}
              </div>
            </Card>
          ))}
        </div>

        {/* Main row */}
        <div className="qlt-main">

          {/* Deviation severity */}
          <Card style={{ padding: '16px 18px' }}>
            <SectionTitle>Deviation by Severity</SectionTitle>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {DEVIATION_SEVERITY.map((d) => (
                <div key={d.label}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                    <span style={{ fontSize: 12, color: T.text.secondary, fontWeight: 500 }}>{d.label}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 800, color: T.text.primary }}>{d.count}</span>
                      <span style={{ fontSize: 10, color: d.color, background: d.bg, padding: '1px 6px', borderRadius: 6, fontWeight: 600 }}>{d.pct}%</span>
                    </div>
                  </div>
                  <div style={{ height: 5, borderRadius: 4, background: '#eef0f5', overflow: 'hidden' }}>
                    <div style={{ width: `${d.pct}%`, height: '100%', background: d.color, borderRadius: 4, transition: 'width 0.4s' }} />
                  </div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 18 }}>
              <SectionTitle action="Schedule →">Upcoming Audits</SectionTitle>
              {UPCOMING_AUDITS.map((a) => (
                <div key={a.title} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: `1px solid ${T.border}` }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: a.color, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 600, color: T.text.primary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.title}</div>
                    <div style={{ fontSize: 10, color: T.text.muted }}>{a.dept} · {a.date}</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Pass/Fail trend */}
          <Card style={{ padding: '16px 18px' }}>
            <SectionTitle>Inspection Score Trend (7 Days)</SectionTitle>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={TREND_DATA} barCategoryGap="22%" barGap={3} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: T.text.muted }} axisLine={false} tickLine={false} />
                <YAxis domain={[95, 100]} tick={{ fontSize: 10, fill: T.text.muted }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
                <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
                <Bar dataKey="pass" name="Pass %" fill={T.green.solid} radius={[4,4,0,0]} />
                <Bar dataKey="fail" name="Fail %" fill={T.red.solid} radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          {/* Recent inspections */}
          <Card style={{ padding: '16px 18px' }}>
            <SectionTitle action="View All →">Recent Inspections</SectionTitle>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {RECENT_INSPECTIONS.map((r, i) => (
                <div key={r.batch} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 4px', borderBottom: i < RECENT_INSPECTIONS.length - 1 ? `1px solid ${T.border}` : 'none' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 600, color: T.text.primary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.product}</div>
                    <div style={{ fontSize: 10, color: T.text.muted, marginTop: 2 }}>{r.batch} · {r.type}</div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: T.text.primary }}>{r.score}</div>
                    <span style={{ fontSize: 10, fontWeight: 600, color: r.color, background: r.bg, padding: '1px 6px', borderRadius: 6 }}>{r.result}</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
