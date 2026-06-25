import React, { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

const T = {
  bg: '#f0f2f7', surface: '#ffffff', border: '#e8eaf0',
  text: { primary: '#0f1117', secondary: '#5a6072', muted: '#9da3b4' },
  blue:   { solid: '#0ea5e9', light: '#e0f2fe', text: '#0369a1' },
  green:  { solid: '#16a34a', light: '#dcfce7', text: '#15803d' },
  amber:  { solid: '#d97706', light: '#fef3c7', text: '#b45309' },
  red:    { solid: '#dc2626', light: '#fee2e2', text: '#b91c1c' },
  purple: { solid: '#7c3aed', light: '#ede9fe', text: '#6d28d9' },
  gray:   { solid: '#6b7280', light: '#f3f4f6', text: '#4b5563' },
};

const KPI_CARDS = [
  { label: 'Line Efficiency',     value: '94.2%', delta: '+2.1% vs yesterday', pos: true,  spark: [88,90,89,92,91,93,92,94,94], color: T.blue.solid,   icon: 'efficiency', bg: T.blue.light   },
  { label: 'Packages Produced',   value: '45,200',delta: '+6.8% vs target',    pos: true,  spark: [38,40,39,42,41,43,44,45,45], color: '#7c3aed',      icon: 'box',        bg: T.purple.light },
  { label: 'Material Waste %',    value: '2.1%',  delta: '-0.4% vs yesterday', pos: true,  spark: [3.1,2.8,2.9,2.5,2.6,2.4,2.3,2.2,2.1], color: T.green.solid, icon: 'recycle', bg: T.green.light },
  { label: 'Line Uptime',         value: '97.8%', delta: '+1.2% vs yesterday', pos: true,  spark: [94,95,96,95,97,96,98,97,98], color: T.amber.solid,  icon: 'clock',      bg: T.amber.light  },
];

const LINE_STATUS = [
  { name: 'Line A', product: 'Amoxicillin 500mg', speed: '420 pkg/min', status: 'Running',     color: T.green.solid,  bg: T.green.light  },
  { name: 'Line B', product: 'Ibuprofen 400mg',   speed: '380 pkg/min', status: 'Running',     color: T.green.solid,  bg: T.green.light  },
  { name: 'Line C', product: 'Paracetamol 650mg', speed: '—',           status: 'Maintenance', color: T.amber.solid,  bg: T.amber.light  },
  { name: 'Line D', product: 'Metformin 1g',       speed: '—',          status: 'Idle',        color: T.gray.solid,   bg: T.gray.light   },
];

const HOURLY_DATA = [
  { hour: '08:00', packages: 4800 },
  { hour: '09:00', packages: 5200 },
  { hour: '10:00', packages: 5600 },
  { hour: '11:00', packages: 5100 },
  { hour: '12:00', packages: 4200 },
  { hour: '13:00', packages: 5400 },
  { hour: '14:00', packages: 5800 },
  { hour: '15:00', packages: 5100 },
];

const PENDING_ORDERS = [
  { order: 'PKG-2024-001', product: 'Amoxicillin 500mg Blist.',  qty: '12,000', due: 'Today 4 PM',   status: 'In Progress', color: T.blue.solid,  bg: T.blue.light  },
  { order: 'PKG-2024-002', product: 'Ibuprofen 400mg Strip',     qty: '8,500',  due: 'Today 6 PM',   status: 'In Progress', color: T.blue.solid,  bg: T.blue.light  },
  { order: 'PKG-2024-003', product: 'Paracetamol 650mg Box',     qty: '15,000', due: 'Tomorrow 9 AM',status: 'Pending',     color: T.amber.solid, bg: T.amber.light },
  { order: 'PKG-2024-004', product: 'Metformin 1g Foil Strip',   qty: '6,200',  due: 'Tomorrow 2 PM',status: 'Pending',     color: T.amber.solid, bg: T.amber.light },
  { order: 'PKG-2024-005', product: 'Cetirizine 10mg Blister',   qty: '20,000', due: 'Jun 25',       status: 'Scheduled',  color: T.gray.solid,  bg: T.gray.light  },
];

function Sparkline({ data, color }) {
  const w = 72, h = 30;
  const min = Math.min(...data), max = Math.max(...data), range = max - min || 1;
  const pts = data.map((p, i) => ({
    x: (i / (data.length - 1)) * w,
    y: h - 4 - ((p - min) / range) * (h - 8),
  }));
  const area = `M${pts[0].x},${h} ` + pts.map(p => `L${p.x},${p.y}`).join(' ') + ` L${pts[pts.length-1].x},${h} Z`;
  return (
    <svg width={w} height={h} style={{ overflow: 'visible', flexShrink: 0 }}>
      <path d={area} fill={color} opacity="0.12" />
      <polyline points={pts.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[pts.length-1].x} cy={pts[pts.length-1].y} r="3" fill={color} />
    </svg>
  );
}

function Card({ children, style = {}, alert }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: T.surface, borderRadius: 12,
        border: `1px solid ${alert ? '#fcd9b6' : hov ? '#c8ccd8' : T.border}`,
        boxShadow: hov ? '0 8px 28px rgba(0,0,0,0.10)' : '0 1px 3px rgba(0,0,0,0.04)',
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
      <span style={{ fontSize: 13, fontWeight: 700, color: T.text.primary }}>{children}</span>
      {action && <span style={{ fontSize: 11, color: T.blue.text, fontWeight: 600, cursor: 'pointer' }}>{action}</span>}
    </div>
  );
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#fff', border: `1px solid ${T.border}`, borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
      <div style={{ fontWeight: 700, color: T.text.primary, marginBottom: 4 }}>{label}</div>
      <div style={{ color: T.blue.text }}>{payload[0].value.toLocaleString()} packages</div>
    </div>
  );
}

const CSS = `
  .pkg-kpi  { display:grid; grid-template-columns:repeat(2,1fr); gap:10px }
  @media(min-width:1024px){ .pkg-kpi { grid-template-columns:repeat(4,1fr) } }
  .pkg-main { display:grid; grid-template-columns:1fr; gap:12px }
  @media(min-width:768px) { .pkg-main { grid-template-columns:1fr 1fr } }
  @media(min-width:1280px){ .pkg-main { grid-template-columns:1.2fr 1fr 1.5fr } }
  .pkg-kpi-val { font-size:22px }
  @media(min-width:480px){ .pkg-kpi-val { font-size:26px } }
`;

export default function PackagingDashboard() {
  return (
    <div style={{ fontFamily: 'Inter, system-ui, sans-serif', background: T.bg, minHeight: '100%' }}>
      <style>{CSS}</style>

      {/* Header */}
      <div style={{ position: 'sticky', top: 0, zIndex: 20, background: '#fff', borderBottom: `1px solid ${T.border}`, padding: '0 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 52, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: T.blue.light, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={T.blue.solid} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: T.text.primary }}>Packaging Operations</div>
            <div style={{ fontSize: 10.5, color: T.text.muted }}>Line Dashboard</div>
          </div>
        </div>
        <div style={{ fontSize: 10.5, color: T.green.text, background: T.green.light, padding: '4px 10px', borderRadius: 20, fontWeight: 600 }}>● Live</div>
      </div>

      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* KPI row */}
        <div className="pkg-kpi">
          {KPI_CARDS.map((k) => (
            <Card key={k.label} style={{ padding: '14px 16px 12px', position: 'relative', overflow: 'hidden', cursor: 'pointer' }}>
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: k.color, borderRadius: '12px 12px 0 0' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: 4, marginBottom: 10 }}>
                <span style={{ fontSize: 11, color: T.text.secondary, fontWeight: 500, maxWidth: '55%', lineHeight: 1.4 }}>{k.label}</span>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                  <div style={{ width: 24, height: 24, borderRadius: 6, background: k.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ fontSize: 12 }}>📦</span>
                  </div>
                  <Sparkline data={k.spark} color={k.color} />
                </div>
              </div>
              <div style={{ marginBottom: 8 }}>
                <span className="pkg-kpi-val" style={{ fontWeight: 800, color: T.text.primary, letterSpacing: '-0.03em' }}>{k.value}</span>
              </div>
              <div style={{ height: 1, background: T.border, marginBottom: 8 }} />
              <div style={{ fontSize: 11, color: k.pos ? T.green.text : T.red.text, fontWeight: 600 }}>
                {k.pos ? '↑' : '↓'} {k.delta}
              </div>
            </Card>
          ))}
        </div>

        {/* Main row */}
        <div className="pkg-main">

          {/* Line Status */}
          <Card style={{ padding: '16px 18px' }}>
            <SectionTitle>Packaging Line Status</SectionTitle>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {LINE_STATUS.map((l) => (
                <div key={l.name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, border: `1px solid ${T.border}`, background: '#fafbfc' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: l.color, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: T.text.primary }}>{l.name}</div>
                    <div style={{ fontSize: 10.5, color: T.text.muted, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.product}</div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: l.color, background: l.bg, padding: '2px 8px', borderRadius: 8 }}>{l.status}</div>
                    {l.speed !== '—' && <div style={{ fontSize: 10, color: T.text.muted, marginTop: 3 }}>{l.speed}</div>}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Hourly output chart */}
          <Card style={{ padding: '16px 18px' }}>
            <SectionTitle>Hourly Output (Today)</SectionTitle>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={HOURLY_DATA} barCategoryGap="25%" margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                <XAxis dataKey="hour" tick={{ fontSize: 10, fill: T.text.muted }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: T.text.muted }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v/1000).toFixed(1)}k`} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(0,0,0,0.04)', radius: [4,4,0,0] }} />
                <Bar dataKey="packages" fill={T.blue.solid} radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          {/* Pending orders */}
          <Card style={{ padding: '16px 18px' }}>
            <SectionTitle action="View All →">Pending Orders</SectionTitle>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {PENDING_ORDERS.map((o, i) => (
                <div
                  key={o.order}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 4px',
                    borderBottom: i < PENDING_ORDERS.length - 1 ? `1px solid ${T.border}` : 'none',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 600, color: T.text.primary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.product}</div>
                    <div style={{ fontSize: 10, color: T.text.muted, marginTop: 2 }}>{o.order} · {o.qty} units · Due {o.due}</div>
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 600, color: o.color, background: o.bg, padding: '2px 8px', borderRadius: 8, flexShrink: 0 }}>{o.status}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
